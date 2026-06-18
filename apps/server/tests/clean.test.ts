import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  applyCleanStrategy,
  buildPreviewTree,
  normalizeMode,
  parseProtectPaths,
} from '../src/lib/clean.js';

const TEST_ROOT = path.join(os.tmpdir(), `kite-clean-test-${Date.now()}`);

async function makeFixture(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<html></html>');
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  await fs.writeFile(path.join(dir, 'assets', 'app.css'), 'body{}');
  await fs.mkdir(path.join(dir, 'uploads', 'avatars'), { recursive: true });
  await fs.writeFile(path.join(dir, 'uploads', 'foo.png'), 'PNG_DATA');
  await fs.writeFile(path.join(dir, 'uploads', 'avatars', 'a.jpg'), 'JPG_DATA');
  await fs.writeFile(path.join(dir, '.env'), 'SECRET=1');
  await fs.mkdir(path.join(dir, '.kite-internal'), { recursive: true });
  await fs.writeFile(path.join(dir, '.kite-internal', 'state.json'), '{}');
}

describe('parse helpers', () => {
  it('normalizeMode default to merge', () => {
    expect(normalizeMode(null)).toBe('merge');
    expect(normalizeMode('')).toBe('merge');
    expect(normalizeMode('weird')).toBe('merge');
    expect(normalizeMode('clean')).toBe('clean');
    expect(normalizeMode('clean-all')).toBe('clean-all');
  });

  it('parseProtectPaths handles json + garbage', () => {
    expect(parseProtectPaths(null)).toEqual([]);
    expect(parseProtectPaths('not-json')).toEqual([]);
    expect(parseProtectPaths('["a","b"]')).toEqual(['a', 'b']);
    expect(parseProtectPaths('[1,2,"c"]')).toEqual(['c']);
  });
});

describe('applyCleanStrategy', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
  });
  afterAll(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('merge mode is a no-op', async () => {
    const dir = path.join(TEST_ROOT, 'merge');
    await makeFixture(dir);
    const res = await applyCleanStrategy(dir, 'merge', []);
    expect(res.totalDeleteFiles).toBe(0);
    expect(res.totalDeleteSize).toBe(0);
    await fs.access(path.join(dir, 'index.html'));
    await fs.access(path.join(dir, 'uploads', 'foo.png'));
  });

  it('clean mode deletes non-protected files, keeps protectPaths and .kite-*', async () => {
    const dir = path.join(TEST_ROOT, 'clean');
    await makeFixture(dir);
    const res = await applyCleanStrategy(dir, 'clean', ['uploads/**', '.env']);
    expect(res.totalDeleteFiles).toBeGreaterThan(0);
    // index.html + assets/* should be deleted
    await expect(fs.access(path.join(dir, 'index.html'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'assets', 'app.js'))).rejects.toThrow();
    // uploads/** kept
    await fs.access(path.join(dir, 'uploads', 'foo.png'));
    await fs.access(path.join(dir, 'uploads', 'avatars', 'a.jpg'));
    // .env kept
    await fs.access(path.join(dir, '.env'));
    // .kite-* always protected
    await fs.access(path.join(dir, '.kite-internal', 'state.json'));
  });

  it('clean-all wipes everything except .kite-*', async () => {
    const dir = path.join(TEST_ROOT, 'clean-all');
    await makeFixture(dir);
    const res = await applyCleanStrategy(dir, 'clean-all', ['uploads/**']);
    expect(res.totalDeleteFiles).toBeGreaterThan(0);
    await expect(fs.access(path.join(dir, 'index.html'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'uploads', 'foo.png'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, '.env'))).rejects.toThrow();
    // .kite-* preserved
    await fs.access(path.join(dir, '.kite-internal', 'state.json'));
  });

  it('dryRun does not delete and returns deleteList', async () => {
    const dir = path.join(TEST_ROOT, 'dry');
    await makeFixture(dir);
    const res = await applyCleanStrategy(dir, 'clean', ['uploads/**', '.env'], { dryRun: true });
    expect(res.totalDeleteFiles).toBeGreaterThan(0);
    // nothing actually removed
    await fs.access(path.join(dir, 'index.html'));
    await fs.access(path.join(dir, 'uploads', 'foo.png'));
    await fs.access(path.join(dir, '.env'));
    // deleteList should include index.html and assets files; should NOT include uploads/*, .env or .kite-*
    const deletePaths = res.deleteList.map((i) => i.path);
    expect(deletePaths).toContain('index.html');
    expect(deletePaths).toContain('assets/app.js');
    expect(deletePaths).not.toContain('uploads/foo.png');
    expect(deletePaths).not.toContain('.env');
    expect(deletePaths).not.toContain('.kite-internal/state.json');
  });

  it('deep glob uploads/** also protects uploads dir itself', async () => {
    const dir = path.join(TEST_ROOT, 'deep');
    await makeFixture(dir);
    const res = await applyCleanStrategy(dir, 'clean', ['uploads/**'], { dryRun: true });
    const skipPaths = res.skipList.map((i) => i.path);
    expect(skipPaths).toContain('uploads');
    expect(skipPaths).toContain('uploads/foo.png');
    expect(skipPaths).toContain('uploads/avatars');
    expect(skipPaths).toContain('uploads/avatars/a.jpg');
  });
});

describe('buildPreviewTree', () => {
  beforeAll(async () => {
    await fs.mkdir(TEST_ROOT, { recursive: true });
  });
  it('produces tree with rolled-up size and willDelete flags', async () => {
    const dir = path.join(TEST_ROOT, 'tree');
    await makeFixture(dir);
    const res = await applyCleanStrategy(dir, 'clean', ['uploads/**'], { dryRun: true });
    const tree = buildPreviewTree(res);
    expect(tree.type).toBe('dir');
    const assets = tree.children?.find((c) => c.name === 'assets');
    const uploads = tree.children?.find((c) => c.name === 'uploads');
    expect(assets).toBeDefined();
    expect(assets!.willDelete).toBe(true);
    expect(uploads).toBeDefined();
    expect(uploads!.willDelete).toBe(false);
    // size rolled up
    expect(assets!.size).toBeGreaterThan(0);
    expect(uploads!.size).toBeGreaterThan(0);
  });
});
