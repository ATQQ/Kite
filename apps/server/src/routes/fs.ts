import { Elysia } from 'elysia';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { moduleLogger } from '../lib/logger.js';
import { verifyAdminToken } from '../lib/auth.js';

const log = moduleLogger('fs');

const MAX_ENTRIES = 500;

function listRoots(): string[] {
  if (process.platform === 'win32') {
    const drives: string[] = [];
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      drives.push(`${letter}:\\`);
    }
    return drives;
  }
  return ['/'];
}

function parentOf(p: string): string | null {
  const parent = path.dirname(p);
  if (parent === p) return null;
  return parent;
}

export const fsRoutes = new Elysia()
  .get('/api/fs/home', ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    return {
      home: os.homedir(),
      cwd: process.cwd(),
      sep: path.sep,
      roots: listRoots(),
    };
  })
  .get('/api/fs/list', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const rawPath = typeof query.path === 'string' ? query.path : '';
    if (!rawPath) { set.status = 400; return { error: 'path is required' }; }
    if (!path.isAbsolute(rawPath)) { set.status = 400; return { error: 'path must be absolute' }; }

    const normalized = path.resolve(rawPath);

    let stat: import('node:fs').Stats;
    try {
      stat = await fs.stat(normalized);
    } catch (err: any) {
      if (err?.code === 'ENOENT') { set.status = 404; return { error: 'Path not found', path: normalized }; }
      if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        set.status = 403; return { error: 'Permission denied', path: normalized };
      }
      log.warn({ path: normalized, err: err?.message }, 'stat failed');
      set.status = 500; return { error: err?.message || 'stat failed', path: normalized };
    }

    if (!stat.isDirectory()) {
      set.status = 400;
      return { error: 'path is not a directory', path: normalized };
    }

    let raw: import('node:fs').Dirent[];
    try {
      raw = await fs.readdir(normalized, { withFileTypes: true });
    } catch (err: any) {
      if (err?.code === 'EACCES' || err?.code === 'EPERM') {
        set.status = 403; return { error: 'Permission denied', path: normalized };
      }
      log.warn({ path: normalized, err: err?.message }, 'readdir failed');
      set.status = 500; return { error: err?.message || 'readdir failed', path: normalized };
    }

    const dirEntries = raw.filter((e) => e.isDirectory() || e.isSymbolicLink());
    const truncated = dirEntries.length > MAX_ENTRIES;
    const sliced = truncated ? dirEntries.slice(0, MAX_ENTRIES) : dirEntries;

    const entries = await Promise.all(sliced.map(async (e) => {
      const full = path.join(normalized, e.name);
      let isDir = e.isDirectory();
      const isSymlink = e.isSymbolicLink();
      if (!isDir && isSymlink) {
        try {
          const s = await fs.stat(full);
          isDir = s.isDirectory();
        } catch {
          isDir = false;
        }
      }
      return {
        name: e.name,
        path: full,
        isDir,
        isHidden: e.name.startsWith('.'),
        isSymlink,
      };
    }));

    const dirOnly = entries.filter((e) => e.isDir);
    dirOnly.sort((a, b) => {
      if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
      return a.name.localeCompare(b.name);
    });

    return {
      path: normalized,
      parent: parentOf(normalized),
      exists: true,
      isDir: true,
      truncated,
      entries: dirOnly,
    };
  });
