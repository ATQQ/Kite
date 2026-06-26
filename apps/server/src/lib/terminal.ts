import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { moduleLogger } from './logger.js';

const termLog = moduleLogger('terminal');

export const TERMINAL_LIMITS = {
  maxSessionsPerIp: 4,
  maxTotalSessions: 16,
  maxLifetimeMs: 2 * 60 * 60 * 1000,
  idleTimeoutMs: 15 * 60 * 1000,
};

export interface SpawnPtyOptions {
  cwd: string;
  cols: number;
  rows: number;
}

export interface PtyHandle {
  id: string;
  pid: number;
  cwd: string;
  shell: string;
  createdAt: number;
  ip: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (info: { exitCode: number; signal?: number }) => void): void;
  touch(): void;
}

interface InternalSession extends PtyHandle {
  dataListeners: Set<(chunk: string) => void>;
  exitListeners: Set<(info: { exitCode: number; signal?: number }) => void>;
  lifetimeTimer: NodeJS.Timeout;
  idleTimer: NodeJS.Timeout;
  lastActiveAt: number;
  pendingChunks: string[];
  pendingExit: { exitCode: number; signal?: number } | null;
  _killImpl: (signal?: string) => void;
  _writeImpl: (data: string) => void;
  _resizeImpl: (cols: number, rows: number) => void;
}

type LoadResult = {
  available: boolean;
  error?: string;
  driver?: 'bun' | 'node-pty';
  ptyMod?: any;
};

let loadPromise: Promise<LoadResult> | null = null;

export function isPlatformSupported(): boolean {
  return process.platform === 'darwin' || process.platform === 'linux';
}

function isBunRuntime(): boolean {
  return typeof (globalThis as any).Bun !== 'undefined'
    && typeof (globalThis as any).Bun?.spawn === 'function';
}

export async function loadPty(): Promise<LoadResult> {
  if (!isPlatformSupported()) {
    return { available: false, error: `当前平台不支持终端能力：${process.platform}` };
  }
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    if (isBunRuntime()) {
      // Bun ≥ 1.3 ships a native PTY via `Bun.spawn(cmd, { terminal: {...} })`.
      // We don't need node-pty at all under Bun, which also avoids the
      // spawn-helper executable-bit / N-API onData issues.
      return { available: true, driver: 'bun' };
    }
    try {
      const mod: any = await import('node-pty');
      const spawn = mod?.spawn || mod?.default?.spawn;
      if (typeof spawn !== 'function') {
        return { available: false, error: 'node-pty 加载成功但未导出 spawn 函数' };
      }
      return { available: true, driver: 'node-pty', ptyMod: mod };
    } catch (err: any) {
      const msg = err?.message || String(err);
      termLog.warn({ err: msg }, '加载 node-pty 失败，终端能力将不可用');
      return { available: false, error: msg };
    }
  })();
  return loadPromise;
}

const sessions = new Map<string, InternalSession>();
const sessionsByIp = new Map<string, Set<string>>();

export interface TerminalCounts {
  total: number;
  perIp: Record<string, number>;
}

export function listSessionsCounts(): TerminalCounts {
  const perIp: Record<string, number> = {};
  for (const [ip, ids] of sessionsByIp) perIp[ip] = ids.size;
  return { total: sessions.size, perIp };
}

export function defaultShell(): string {
  if (process.platform === 'darwin' || process.platform === 'linux') {
    return process.env.SHELL || '/bin/bash';
  }
  return process.env.SHELL || '/bin/sh';
}

export function resolveCwd(candidate: string | undefined | null): string {
  const home = os.homedir();
  if (!candidate || typeof candidate !== 'string') return home;
  try {
    const resolved = path.resolve(candidate);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return resolved;
  } catch {
    // fall through
  }
  return home;
}

export interface SpawnResult {
  ok: boolean;
  reason?: 'unavailable' | 'limit-per-ip' | 'limit-total' | 'spawn-error';
  message?: string;
  handle?: PtyHandle;
}

function clampCols(c: number): number {
  return Math.max(2, Math.min(500, Math.floor(c) || 80));
}
function clampRows(r: number): number {
  return Math.max(2, Math.min(200, Math.floor(r) || 24));
}

function attachToBookkeeping(session: InternalSession, ip: string) {
  sessions.set(session.id, session);
  const bucket = sessionsByIp.get(ip);
  if (!bucket) sessionsByIp.set(ip, new Set([session.id]));
  else bucket.add(session.id);
}

function detachFromBookkeeping(session: InternalSession, ip: string) {
  sessions.delete(session.id);
  const bucket = sessionsByIp.get(ip);
  if (bucket) {
    bucket.delete(session.id);
    if (bucket.size === 0) sessionsByIp.delete(ip);
  }
}

function makeSessionShell(params: {
  id: string;
  pid: number;
  cwd: string;
  shell: string;
  ip: string;
}): InternalSession {
  const dataListeners = new Set<(chunk: string) => void>();
  const exitListeners = new Set<(info: { exitCode: number; signal?: number }) => void>();
  const session: InternalSession = {
    id: params.id,
    pid: params.pid,
    cwd: params.cwd,
    shell: params.shell,
    createdAt: Date.now(),
    ip: params.ip,
    dataListeners,
    exitListeners,
    lastActiveAt: Date.now(),
    pendingChunks: [],
    pendingExit: null,
    lifetimeTimer: undefined as any,
    idleTimer: undefined as any,
    _killImpl: () => {},
    _writeImpl: () => {},
    _resizeImpl: () => {},
    write(data: string) {
      session.touch();
      try { session._writeImpl(data); } catch {}
    },
    resize(c: number, r: number) {
      session.touch();
      try { session._resizeImpl(clampCols(c), clampRows(r)); } catch {}
    },
    kill(signal?: string) {
      try { session._killImpl(signal || 'SIGTERM'); } catch {}
    },
    onData(listener) {
      dataListeners.add(listener);
      if (session.pendingChunks.length > 0) {
        const buffered = session.pendingChunks.splice(0);
        for (const chunk of buffered) {
          try { listener(chunk); } catch {}
        }
      }
    },
    onExit(listener) {
      exitListeners.add(listener);
      if (session.pendingExit) {
        const evt = session.pendingExit;
        try { listener(evt); } catch {}
      }
    },
    touch() {
      session.lastActiveAt = Date.now();
      if (session.idleTimer) clearTimeout(session.idleTimer);
      session.idleTimer = setTimeout(() => {
        termLog.warn({ id: session.id, pid: session.pid }, 'pty session idle timeout, killing');
        try { session.kill('SIGTERM'); } catch {}
      }, TERMINAL_LIMITS.idleTimeoutMs);
    },
  };
  return session;
}

function emitData(session: InternalSession, chunk: string) {
  session.touch();
  if (session.dataListeners.size === 0) {
    session.pendingChunks.push(chunk);
    if (session.pendingChunks.length > 256) {
      session.pendingChunks.splice(0, session.pendingChunks.length - 256);
    }
    return;
  }
  for (const l of session.dataListeners) {
    try { l(chunk); } catch {}
  }
}

function emitExit(session: InternalSession, ip: string, evt: { exitCode: number; signal?: number }) {
  if (session.lifetimeTimer) clearTimeout(session.lifetimeTimer);
  if (session.idleTimer) clearTimeout(session.idleTimer);
  detachFromBookkeeping(session, ip);
  if (session.exitListeners.size === 0) {
    session.pendingExit = evt;
    return;
  }
  for (const l of session.exitListeners) {
    try { l(evt); } catch {}
  }
  session.dataListeners.clear();
  session.exitListeners.clear();
}

export async function spawnTerminalSession(params: {
  cwd: string;
  cols: number;
  rows: number;
  ip: string;
}): Promise<SpawnResult> {
  const load = await loadPty();
  if (!load.available) {
    return { ok: false, reason: 'unavailable', message: load.error || '终端能力不可用' };
  }
  if (sessions.size >= TERMINAL_LIMITS.maxTotalSessions) {
    return { ok: false, reason: 'limit-total', message: `已达到全局并发上限 (${TERMINAL_LIMITS.maxTotalSessions})` };
  }
  const ipBucket = sessionsByIp.get(params.ip);
  if (ipBucket && ipBucket.size >= TERMINAL_LIMITS.maxSessionsPerIp) {
    return { ok: false, reason: 'limit-per-ip', message: `单 IP 并发上限 (${TERMINAL_LIMITS.maxSessionsPerIp})` };
  }

  const shell = defaultShell();
  const cwd = resolveCwd(params.cwd);
  const cols = clampCols(params.cols);
  const rows = clampRows(params.rows);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: process.env.TERM || 'xterm-256color',
    LANG: process.env.LANG || 'en_US.UTF-8',
    KITE_TERMINAL: '1',
  };
  delete env.ADMIN_TOKEN;

  const id = 'term_' + randomUUID().replace(/-/g, '').slice(0, 16);

  if (load.driver === 'bun') {
    return spawnViaBun({ id, shell, cwd, cols, rows, env, ip: params.ip });
  }
  return spawnViaNodePty({ id, shell, cwd, cols, rows, env, ip: params.ip, ptyMod: load.ptyMod });
}

function spawnViaNodePty(opts: {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  ip: string;
  ptyMod: any;
}): SpawnResult {
  let pty: any;
  try {
    pty = opts.ptyMod.spawn(opts.shell, [], {
      name: opts.env.TERM,
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env,
    });
  } catch (err: any) {
    termLog.error({ err: err?.message || String(err) }, 'spawn pty failed (node-pty)');
    return { ok: false, reason: 'spawn-error', message: err?.message || 'spawn pty failed' };
  }

  const session = makeSessionShell({
    id: opts.id,
    pid: pty.pid,
    cwd: opts.cwd,
    shell: opts.shell,
    ip: opts.ip,
  });
  session._writeImpl = (data) => pty.write(data);
  session._resizeImpl = (c, r) => pty.resize(c, r);
  session._killImpl = (sig) => pty.kill(sig || 'SIGTERM');
  session.lifetimeTimer = setTimeout(() => {
    termLog.warn({ id: opts.id, pid: pty.pid }, 'pty session exceeded max lifetime, killing');
    try { pty.kill('SIGTERM'); } catch {}
  }, TERMINAL_LIMITS.maxLifetimeMs);
  session.idleTimer = setTimeout(() => {
    termLog.warn({ id: opts.id, pid: pty.pid }, 'pty session idle timeout, killing');
    try { pty.kill('SIGTERM'); } catch {}
  }, TERMINAL_LIMITS.idleTimeoutMs);

  attachToBookkeeping(session, opts.ip);

  pty.onData((chunk: string) => emitData(session, chunk));
  pty.onExit((evt: { exitCode: number; signal?: number }) =>
    emitExit(session, opts.ip, { exitCode: evt.exitCode ?? 0, signal: evt.signal }),
  );

  termLog.info({ id: opts.id, pid: pty.pid, cwd: opts.cwd, shell: opts.shell, ip: opts.ip, driver: 'node-pty' }, 'pty session started');
  return { ok: true, handle: session };
}

function spawnViaBun(opts: {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
  ip: string;
}): SpawnResult {
  const Bun: any = (globalThis as any).Bun;
  if (!Bun || typeof Bun.spawn !== 'function') {
    return { ok: false, reason: 'spawn-error', message: 'Bun.spawn 不可用' };
  }

  // Lazily-created session shell so the `terminal` callbacks can reference it.
  const session = makeSessionShell({
    id: opts.id,
    pid: 0,
    cwd: opts.cwd,
    shell: opts.shell,
    ip: opts.ip,
  });

  let proc: any;
  try {
    proc = Bun.spawn([opts.shell], {
      cwd: opts.cwd,
      env: opts.env,
      // NOTE: when `terminal` is supplied Bun wires stdio through the PTY for us;
      // do NOT pass an explicit `stdio` array or the parent process's
      // stdin/stdout will get hijacked.
      terminal: {
        cols: opts.cols,
        rows: opts.rows,
        data(_terminal: any, data: any) {
          let str: string;
          if (typeof data === 'string') str = data;
          else if (data instanceof Uint8Array) str = new TextDecoder('utf-8').decode(data);
          else if (data?.toString) str = data.toString();
          else str = '';
          if (str) emitData(session, str);
        },
        exit(_terminal: any, exitCode: number) {
          emitExit(session, opts.ip, { exitCode: exitCode ?? 0 });
        },
      },
    });
  } catch (err: any) {
    termLog.error({ err: err?.message || String(err) }, 'spawn pty failed (bun)');
    return { ok: false, reason: 'spawn-error', message: err?.message || 'spawn pty failed' };
  }

  const terminal = proc?.terminal;
  if (!terminal) {
    try { proc?.kill?.('SIGTERM'); } catch {}
    return { ok: false, reason: 'spawn-error', message: 'Bun.spawn 未返回 terminal 句柄（请升级到 Bun ≥ 1.3）' };
  }

  session.pid = proc.pid || 0;
  session._writeImpl = (data) => terminal.write(data);
  session._resizeImpl = (c, r) => {
    try { terminal.resize(c, r); } catch {}
  };
  session._killImpl = (sig) => {
    try { proc.kill?.(sig || 'SIGTERM'); } catch {}
    try { terminal.close?.(); } catch {}
  };
  session.lifetimeTimer = setTimeout(() => {
    termLog.warn({ id: opts.id, pid: session.pid }, 'pty session exceeded max lifetime, killing');
    try { proc.kill?.('SIGTERM'); } catch {}
  }, TERMINAL_LIMITS.maxLifetimeMs);
  session.idleTimer = setTimeout(() => {
    termLog.warn({ id: opts.id, pid: session.pid }, 'pty session idle timeout, killing');
    try { proc.kill?.('SIGTERM'); } catch {}
  }, TERMINAL_LIMITS.idleTimeoutMs);

  attachToBookkeeping(session, opts.ip);

  // Belt-and-suspenders: ensure exit propagates even if the `terminal.exit`
  // callback misses (e.g. if the child is killed externally).
  if (proc.exited && typeof proc.exited.then === 'function') {
    proc.exited.then((code: number) => {
      if (!sessions.has(session.id)) return;
      emitExit(session, opts.ip, { exitCode: typeof code === 'number' ? code : 0 });
    }).catch(() => {
      if (!sessions.has(session.id)) return;
      emitExit(session, opts.ip, { exitCode: 1 });
    });
  }

  termLog.info({ id: opts.id, pid: session.pid, cwd: opts.cwd, shell: opts.shell, ip: opts.ip, driver: 'bun' }, 'pty session started');
  return { ok: true, handle: session };
}

export function getSession(id: string): PtyHandle | null {
  return sessions.get(id) || null;
}

export function shutdownAllSessions(reason = 'shutdown') {
  for (const s of sessions.values()) {
    try { s.kill('SIGTERM'); } catch {}
  }
  termLog.info({ count: sessions.size, reason }, 'killed all pty sessions');
}
