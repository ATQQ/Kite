import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { moduleLogger } from './logger.js';

const log = moduleLogger('log-tail');

export const MAX_RANGE_SIZE = 1024 * 1024;          // 1MB single window cap
export const DEFAULT_RANGE_SIZE = 64 * 1024;        // 64KB default
export const MAX_TAIL_LINES = 5000;
export const DEFAULT_TAIL_LINES = 200;
export const MAX_SEARCH_HITS = 5000;
export const DEFAULT_SEARCH_HITS = 500;
export const DEFAULT_SEARCH_CONTEXT = 2;
export const STREAM_HEARTBEAT_MS = 15_000;
export const STREAM_POLL_MS = 1500;
export const STREAM_FLUSH_MS = 500;

export interface GuardOptions {
  allowMissing?: boolean;
}

export interface GuardResult {
  ok: boolean;
  status?: number;
  error?: string;
  resolved?: string;
  size?: number;
}

function getBlacklist(): string[] {
  const home = process.env.KITE_HOME || path.join(os.homedir(), '.kite');
  return [
    path.join(home, 'config.json'),
    path.join(home, 'kite.db'),
    '/etc/shadow',
    '/etc/passwd',
    '/etc/master.passwd',
  ];
}

export async function pathGuard(rawPath: string, opts: GuardOptions = {}): Promise<GuardResult> {
  if (typeof rawPath !== 'string' || !rawPath) {
    return { ok: false, status: 400, error: 'path is required' };
  }
  if (!path.isAbsolute(rawPath)) {
    return { ok: false, status: 400, error: 'path must be absolute' };
  }
  let resolved = path.resolve(rawPath);
  try {
    resolved = await fsp.realpath(resolved);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      if (opts.allowMissing) return { ok: true, resolved };
      return { ok: false, status: 404, error: 'path not found', resolved };
    }
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return { ok: false, status: 403, error: 'permission denied', resolved };
    }
    return { ok: false, status: 500, error: err?.message || 'realpath failed', resolved };
  }

  const blacklist = getBlacklist();
  for (const blocked of blacklist) {
    if (resolved === blocked) {
      return { ok: false, status: 403, error: 'path is blacklisted', resolved };
    }
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(resolved);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { ok: false, status: 404, error: 'path not found', resolved };
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return { ok: false, status: 403, error: 'permission denied', resolved };
    }
    return { ok: false, status: 500, error: err?.message || 'stat failed', resolved };
  }
  if (!stat.isFile()) {
    return { ok: false, status: 400, error: 'path is not a regular file', resolved };
  }
  return { ok: true, resolved, size: stat.size };
}

export function isBinarySample(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  let nul = 0;
  let ctrl = 0;
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) nul++;
    else if (b < 9 || (b > 13 && b < 32)) ctrl++;
  }
  if (nul / sample.length > 0.01) return true;
  if (ctrl / sample.length > 0.3) return true;
  return false;
}

export interface TailResult {
  lines: string[];
  binary: boolean;
  size: number;
  startOffset: number;
}

export async function readTail(filePath: string, maxLines: number): Promise<TailResult> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const stat = await fh.stat();
    const size = stat.size;
    if (size === 0) return { lines: [], binary: false, size, startOffset: 0 };

    const chunkSize = 64 * 1024;
    let position = size;
    const chunks: Buffer[] = [];
    let lineCount = 0;
    let binary = false;
    let sampled = false;

    while (position > 0 && lineCount <= maxLines) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      await fh.read(buf, 0, readSize, position);
      if (!sampled) {
        binary = isBinarySample(buf);
        sampled = true;
        if (binary) return { lines: [], binary: true, size, startOffset: size };
      }
      chunks.unshift(buf);
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x0a) lineCount++;
      }
    }

    const all = Buffer.concat(chunks).toString('utf8');
    const allLines = all.split('\n');
    // remove trailing empty line caused by file ending with \n
    if (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();
    const sliced = allLines.length > maxLines ? allLines.slice(allLines.length - maxLines) : allLines;
    return { lines: sliced, binary: false, size, startOffset: position };
  } finally {
    await fh.close();
  }
}

export interface RangeOptions {
  offset?: number;
  size?: number;
  direction?: 'forward' | 'backward' | 'tail';
}

export interface RangeResult {
  startOffset: number;
  endOffset: number;
  fileSize: number;
  lines: string[];
  truncatedHead: boolean;
  truncatedTail: boolean;
  binary: boolean;
}

export async function readRange(filePath: string, opts: RangeOptions = {}): Promise<RangeResult> {
  const fh = await fsp.open(filePath, 'r');
  try {
    const stat = await fh.stat();
    const fileSize = stat.size;
    const winSize = Math.max(1024, Math.min(opts.size ?? DEFAULT_RANGE_SIZE, MAX_RANGE_SIZE));
    const direction = opts.direction ?? (opts.offset === undefined ? 'tail' : 'forward');

    if (fileSize === 0) {
      return { startOffset: 0, endOffset: 0, fileSize, lines: [], truncatedHead: false, truncatedTail: false, binary: false };
    }

    let start: number;
    if (direction === 'tail') {
      start = Math.max(0, fileSize - winSize);
    } else if (direction === 'backward') {
      const o = opts.offset ?? fileSize;
      start = Math.max(0, o - winSize);
    } else {
      start = Math.max(0, Math.min(opts.offset ?? 0, fileSize));
    }
    let end = Math.min(start + winSize, fileSize);

    const len = end - start;
    if (len <= 0) {
      return { startOffset: start, endOffset: end, fileSize, lines: [], truncatedHead: false, truncatedTail: false, binary: false };
    }
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);

    if (isBinarySample(buf)) {
      return { startOffset: start, endOffset: end, fileSize, lines: [], truncatedHead: false, truncatedTail: false, binary: true };
    }

    let truncatedHead = false;
    let truncatedTail = false;
    let viewStart = 0;
    let viewEnd = buf.length;

    // align head to newline unless we're at file start
    if (start > 0) {
      const nl = buf.indexOf(0x0a);
      if (nl >= 0) {
        viewStart = nl + 1;
        truncatedHead = true;
      } else {
        // entire window has no newline, can't align — return empty + flag
        return {
          startOffset: start,
          endOffset: end,
          fileSize,
          lines: [],
          truncatedHead: true,
          truncatedTail: end < fileSize,
          binary: false,
        };
      }
    }
    // align tail to newline unless we're at file end
    if (end < fileSize) {
      const nl = buf.lastIndexOf(0x0a);
      if (nl >= viewStart) {
        viewEnd = nl + 1;
        truncatedTail = true;
      } else {
        return {
          startOffset: start,
          endOffset: end,
          fileSize,
          lines: [],
          truncatedHead,
          truncatedTail: true,
          binary: false,
        };
      }
    }

    const text = buf.subarray(viewStart, viewEnd).toString('utf8');
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    return {
      startOffset: start + viewStart,
      endOffset: start + viewEnd,
      fileSize,
      lines,
      truncatedHead,
      truncatedTail,
      binary: false,
    };
  } finally {
    await fh.close();
  }
}

export interface WatchHandle {
  close(): void;
}

export interface WatchCallbacks {
  onAppend: (chunk: string, newSize: number) => void;
  onRotate: () => void;
  onError?: (err: Error) => void;
}

export function watchTail(filePath: string, initialOffset: number, cb: WatchCallbacks): WatchHandle {
  let lastSize = initialOffset;
  let closed = false;
  let reading = false;
  let pending = false;

  const handleChange = async () => {
    if (closed) return;
    if (reading) { pending = true; return; }
    reading = true;
    try {
      let stat: fs.Stats;
      try {
        stat = await fsp.stat(filePath);
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          // file rotated away; reset and wait for next event
          if (lastSize !== 0) {
            lastSize = 0;
            cb.onRotate();
          }
          return;
        }
        throw err;
      }
      const newSize = stat.size;
      if (newSize < lastSize) {
        lastSize = 0;
        cb.onRotate();
        return;
      }
      if (newSize === lastSize) return;
      const fh = await fsp.open(filePath, 'r');
      try {
        const len = newSize - lastSize;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, lastSize);
        lastSize = newSize;
        cb.onAppend(buf.toString('utf8'), newSize);
      } finally {
        await fh.close();
      }
    } catch (err: any) {
      cb.onError?.(err);
    } finally {
      reading = false;
      if (pending) {
        pending = false;
        setImmediate(handleChange);
      }
    }
  };

  let watcher: fs.FSWatcher | null = null;
  try {
    watcher = fs.watch(filePath, { persistent: false }, () => { handleChange(); });
    watcher.on('error', (err) => { cb.onError?.(err); });
  } catch (err) {
    log.warn({ filePath, err: (err as Error).message }, 'fs.watch failed; relying on polling');
  }
  const timer = setInterval(handleChange, STREAM_POLL_MS);
  if (typeof (timer as any).unref === 'function') (timer as any).unref();

  return {
    close() {
      if (closed) return;
      closed = true;
      try { watcher?.close(); } catch { /* ignore */ }
      clearInterval(timer);
    },
  };
}

export interface SearchHit {
  offset: number;
  text: string;
  before: string[];
  after: string[];
}

export interface SearchOptions {
  q: string;
  regex?: boolean;
  caseInsensitive?: boolean;
  maxHits?: number;
  context?: number;
  fromOffset?: number;
  toOffset?: number;
  signal?: AbortSignal;
}

export interface SearchCallbacks {
  onHit: (hit: SearchHit) => void;
  onTruncated: () => void;
  onDone: (scannedBytes: number) => void;
  onError: (err: Error) => void;
}

export function grepStream(filePath: string, opts: SearchOptions, cb: SearchCallbacks): { abort(): void } {
  const maxHits = Math.max(1, Math.min(opts.maxHits ?? DEFAULT_SEARCH_HITS, MAX_SEARCH_HITS));
  const context = Math.max(0, Math.min(opts.context ?? DEFAULT_SEARCH_CONTEXT, 20));

  let matcher: (line: string) => boolean;
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(opts.q, opts.caseInsensitive ? 'i' : '');
    } catch (err: any) {
      cb.onError(new Error(`invalid regex: ${err?.message || err}`));
      return { abort() { /* nothing */ } };
    }
    matcher = (line) => re.test(line);
  } else if (opts.caseInsensitive) {
    const needle = opts.q.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(needle);
  } else {
    const needle = opts.q;
    matcher = (line) => line.includes(needle);
  }

  const start = Math.max(0, opts.fromOffset ?? 0);
  const end = opts.toOffset !== undefined ? Math.max(start, opts.toOffset) : undefined;
  const readStream = fs.createReadStream(filePath, end === undefined
    ? { start }
    : { start, end });
  const rl = readline.createInterface({ input: readStream, crlfDelay: Infinity });

  let bytesSeen = start;
  let hits = 0;
  let aborted = false;
  // ring buffer of {offset, text} for context-before
  const beforeBuf: { offset: number; text: string }[] = [];
  // pending entries waiting for context-after lines
  const pendingAfter: { hit: SearchHit; need: number }[] = [];

  function flushPending(currentLine: { offset: number; text: string } | null) {
    if (!currentLine) {
      for (const p of pendingAfter) cb.onHit(p.hit);
      pendingAfter.length = 0;
      return;
    }
    const stillPending: typeof pendingAfter = [];
    for (const p of pendingAfter) {
      p.hit.after.push(currentLine.text);
      p.need -= 1;
      if (p.need <= 0) cb.onHit(p.hit);
      else stillPending.push(p);
    }
    pendingAfter.length = 0;
    pendingAfter.push(...stillPending);
  }

  function pushBefore(entry: { offset: number; text: string }) {
    beforeBuf.push(entry);
    if (beforeBuf.length > context) beforeBuf.shift();
  }

  rl.on('line', (line) => {
    if (aborted) return;
    if (opts.signal?.aborted) { abort(); return; }
    const lineOffset = bytesSeen;
    const byteLen = Buffer.byteLength(line, 'utf8') + 1; // + newline
    bytesSeen += byteLen;

    flushPending({ offset: lineOffset, text: line });

    if (matcher(line)) {
      const hit: SearchHit = {
        offset: lineOffset,
        text: line,
        before: beforeBuf.map(b => b.text),
        after: [],
      };
      if (context > 0) {
        pendingAfter.push({ hit, need: context });
      } else {
        cb.onHit(hit);
      }
      hits += 1;
      if (hits >= maxHits) {
        cb.onTruncated();
        abort();
        return;
      }
    }
    pushBefore({ offset: lineOffset, text: line });
  });

  rl.on('close', () => {
    if (aborted) return;
    flushPending(null);
    cb.onDone(bytesSeen - start);
  });

  readStream.on('error', (err) => {
    if (aborted) return;
    aborted = true;
    cb.onError(err);
  });

  function abort() {
    if (aborted) return;
    aborted = true;
    try { rl.close(); } catch { /* ignore */ }
    try { readStream.destroy(); } catch { /* ignore */ }
    flushPending(null);
    cb.onDone(bytesSeen - start);
  }

  if (opts.signal) {
    if (opts.signal.aborted) abort();
    else opts.signal.addEventListener('abort', abort, { once: true });
  }

  return { abort };
}
