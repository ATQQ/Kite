import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  pathGuard,
  readTail,
  readRange,
  grepStream,
  isBinarySample,
} from '../src/lib/log-tail.js';

const TEST_ROOT = path.join(os.tmpdir(), `kite-log-tail-test-${Date.now()}`);

const emptyFile = path.join(TEST_ROOT, 'empty.log');
const smallFile = path.join(TEST_ROOT, 'small.log');
const largeFile = path.join(TEST_ROOT, 'large.log');
const binaryFile = path.join(TEST_ROOT, 'binary.bin');

beforeAll(async () => {
  await fs.mkdir(TEST_ROOT, { recursive: true });
  await fs.writeFile(emptyFile, '');
  const small = ['line1', 'line2', 'line3', 'error happened', 'info ok'].join('\n') + '\n';
  await fs.writeFile(smallFile, small);

  let big = '';
  for (let i = 0; i < 5000; i++) {
    big += `2026-06-22 row ${i} payload ${'x'.repeat(40)}\n`;
  }
  await fs.writeFile(largeFile, big);

  const buf = Buffer.alloc(2048); // all-zero buffer is strongly binary
  await fs.writeFile(binaryFile, buf);
});

afterAll(async () => {
  await fs.rm(TEST_ROOT, { recursive: true, force: true });
});

describe('pathGuard', () => {
  it('rejects relative path', async () => {
    const r = await pathGuard('relative/path.log');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });

  it('rejects non-existent file', async () => {
    const r = await pathGuard(path.join(TEST_ROOT, 'nope.log'));
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });

  it('accepts a valid plain file', async () => {
    const r = await pathGuard(smallFile);
    expect(r.ok).toBe(true);
    // realpath may resolve macOS /var → /private/var, so just check suffix
    expect(r.resolved?.endsWith('small.log')).toBe(true);
    expect(typeof r.size).toBe('number');
  });

  it('rejects blacklisted kite config path', async () => {
    const rawHome = path.join(TEST_ROOT, 'fake-kite-home');
    await fs.mkdir(rawHome, { recursive: true });
    const fakeHome = await fs.realpath(rawHome);
    const cfg = path.join(fakeHome, 'config.json');
    await fs.writeFile(cfg, '{}');
    const prev = process.env.KITE_HOME;
    process.env.KITE_HOME = fakeHome;
    try {
      const r = await pathGuard(cfg);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
    } finally {
      if (prev === undefined) delete process.env.KITE_HOME;
      else process.env.KITE_HOME = prev;
    }
  });
});

describe('isBinarySample', () => {
  it('detects buffer with many NULs as binary', () => {
    const buf = Buffer.alloc(2048);
    expect(isBinarySample(buf)).toBe(true);
  });

  it('detects normal text as non-binary', () => {
    expect(isBinarySample(Buffer.from('hello world\nplain text\n'))).toBe(false);
  });
});

describe('readTail', () => {
  it('returns empty array on empty file', async () => {
    const r = await readTail(emptyFile, 100);
    expect(r.lines.length).toBe(0);
  });

  it('returns last N lines', async () => {
    const r = await readTail(smallFile, 2);
    expect(r.lines.length).toBe(2);
    expect(r.lines[r.lines.length - 1]).toBe('info ok');
  });

  it('handles tail across many chunks on large file', async () => {
    const r = await readTail(largeFile, 3);
    expect(r.lines.length).toBe(3);
    expect(r.lines[r.lines.length - 1]).toContain('row 4999');
  });
});

describe('readRange', () => {
  it('returns empty on empty file', async () => {
    const r = await readRange(emptyFile, { offset: 0, size: 1024 });
    expect(r.lines.length).toBe(0);
    expect(r.fileSize).toBe(0);
  });

  it('marks binary file', async () => {
    const r = await readRange(binaryFile, { offset: 0, size: 1024 });
    expect(r.binary).toBe(true);
  });

  it('aligns head/tail to newlines in middle window', async () => {
    const stat = await fs.stat(largeFile);
    const offset = Math.floor(stat.size / 2);
    const r = await readRange(largeFile, { offset, size: 4096 });
    expect(r.truncatedHead).toBe(true);
    // ensure every returned line is non-partial (does not start mid-payload)
    for (const line of r.lines) {
      expect(line.startsWith('2026-06-22 row ')).toBe(true);
    }
  });

  it('reads from very beginning without truncating head', async () => {
    const r = await readRange(largeFile, { offset: 0, size: 4096 });
    expect(r.truncatedHead).toBe(false);
    expect(r.lines[0]).toContain('row 0');
  });
});

describe('grepStream', () => {
  it('finds substring matches', async () => {
    const hits: any[] = [];
    await new Promise<void>((resolve, reject) => {
      grepStream(smallFile, { q: 'error' }, {
        onHit: (h) => hits.push(h),
        onTruncated: () => {},
        onDone: () => resolve(),
        onError: (e) => reject(e),
      });
    });
    expect(hits.length).toBe(1);
    expect(hits[0].text).toContain('error');
  });

  it('rejects invalid regex via onError', async () => {
    let err: Error | null = null;
    await new Promise<void>((resolve) => {
      grepStream(smallFile, { q: '[', regex: true }, {
        onHit: () => {},
        onTruncated: () => {},
        onDone: () => resolve(),
        onError: (e) => { err = e; resolve(); },
      });
    });
    expect(err).toBeTruthy();
  });

  it('respects maxHits and signals truncated', async () => {
    const hits: any[] = [];
    let truncated = false;
    await new Promise<void>((resolve) => {
      grepStream(largeFile, { q: 'row', maxHits: 10 }, {
        onHit: (h) => hits.push(h),
        onTruncated: () => { truncated = true; },
        onDone: () => resolve(),
        onError: () => resolve(),
      });
    });
    expect(hits.length).toBeLessThanOrEqual(10);
    expect(truncated).toBe(true);
  });
});
