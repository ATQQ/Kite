import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { moduleLogger } from './logger.js';

const log = moduleLogger('disk');

function kiteHome(): string {
  return process.env.KITE_DB_DIR || process.cwd();
}

export function homeRelative(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

export interface DirSizeResult {
  bytes: number;
  files: number;
  oldestMtime: number | null;
  newestMtime: number | null;
  approximated: boolean;
  exists: boolean;
}

const EMPTY: DirSizeResult = { bytes: 0, files: 0, oldestMtime: null, newestMtime: null, approximated: false, exists: false };

/**
 * Recursive opendir stream walker. Honors a soft deadline (default 5s);
 * if exceeded, returns whatever has been accumulated so far with approximated=true.
 */
export async function dirSize(target: string, opts: { timeoutMs?: number } = {}): Promise<DirSizeResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  let exists = true;
  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      return { bytes: stat.size, files: 1, oldestMtime: stat.mtimeMs, newestMtime: stat.mtimeMs, approximated: false, exists: true };
    }
  } catch {
    exists = false;
    return { ...EMPTY, exists };
  }

  const deadline = Date.now() + timeoutMs;
  const result: DirSizeResult = { bytes: 0, files: 0, oldestMtime: null, newestMtime: null, approximated: false, exists: true };

  async function walk(dir: string): Promise<void> {
    if (Date.now() > deadline) {
      result.approximated = true;
      return;
    }
    let dh: any;
    try {
      dh = await fs.opendir(dir);
    } catch {
      return;
    }
    try {
      for await (const ent of dh) {
        if (Date.now() > deadline) {
          result.approximated = true;
          return;
        }
        const full = path.join(dir, ent.name);
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          await walk(full);
        } else if (ent.isFile()) {
          try {
            const s = await fs.stat(full);
            result.bytes += s.size;
            result.files += 1;
            if (result.oldestMtime === null || s.mtimeMs < result.oldestMtime) result.oldestMtime = s.mtimeMs;
            if (result.newestMtime === null || s.mtimeMs > result.newestMtime) result.newestMtime = s.mtimeMs;
          } catch {
            /* ignore vanished entries */
          }
        }
      }
    } catch {
      /* opendir iterator failure */
    }
  }

  await walk(target);
  return result;
}

export interface ArtifactStat {
  deployId: string;
  filePath: string;
  size: number;
  createdAt: string;
}

export async function listArtifactFiles(projectId: string): Promise<ArtifactStat[]> {
  const dir = path.join(kiteHome(), 'deployments', projectId, 'artifacts');
  let entries: any[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ArtifactStat[] = [];
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.zip')) continue;
    const full = path.join(dir, ent.name);
    try {
      const s = await fs.stat(full);
      out.push({
        deployId: ent.name.replace(/\.zip$/, ''),
        filePath: full,
        size: s.size,
        createdAt: new Date(s.mtimeMs).toISOString(),
      });
    } catch { /* ignore */ }
  }
  return out;
}

// ---- Cache ----

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: any; expiresAt: number }>();

export function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number = CACHE_TTL_MS): T {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function cacheInvalidate(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function kiteHomePath(): string {
  return kiteHome();
}

export function deploymentsRoot(): string {
  return path.join(kiteHome(), 'deployments');
}

export function projectArtifactsDir(projectId: string): string {
  return path.join(deploymentsRoot(), projectId, 'artifacts');
}

export function logFor(): ReturnType<typeof moduleLogger> {
  return log;
}
