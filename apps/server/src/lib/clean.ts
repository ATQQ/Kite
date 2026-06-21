import fs from 'node:fs/promises';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { moduleLogger } from './logger.js';

const log = moduleLogger('clean');

export type CleanMode = 'merge' | 'clean' | 'clean-all';

export interface CleanItem {
  path: string;          // relative to deployPath
  size: number;          // bytes (0 for directories)
  type: 'file' | 'dir';
}

export interface CleanResult {
  mode: CleanMode;
  deleteList: CleanItem[];
  skipList: CleanItem[];
  totalDeleteSize: number;
  totalDeleteFiles: number;
  totalSkipFiles: number;
  scanned: number;
  truncated: boolean;
}

export interface CleanOptions {
  dryRun?: boolean;
  traceId?: string;
  maxItems?: number;     // hard cap for delete/skip lists (default 10000)
}

const ALWAYS_PROTECT_PREFIXES = ['.kite-'];

export function normalizeMode(input: string | null | undefined): CleanMode {
  if (input === 'clean' || input === 'clean-all') return input;
  return 'merge';
}

export function parseProtectPaths(input: string | null | undefined): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string' && s.length > 0);
    }
  } catch {
    /* ignore */
  }
  return [];
}

function isAlwaysProtected(rel: string): boolean {
  const segments = rel.split('/');
  return segments.some((seg) => ALWAYS_PROTECT_PREFIXES.some((p) => seg.startsWith(p)));
}

function matchesAnyGlob(rel: string, globs: string[]): boolean {
  for (const g of globs) {
    if (minimatch(rel, g, { dot: true, matchBase: false })) return true;
    // Also match when a directory glob like "uploads/**" should protect "uploads" itself
    if (g.endsWith('/**') && rel === g.slice(0, -3)) return true;
  }
  return false;
}

async function* walk(
  root: string,
  rel: string = '',
): AsyncGenerator<{ rel: string; type: 'file' | 'dir'; size: number }> {
  const dir = path.join(root, rel);
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      yield { rel: childRel, type: 'dir', size: 0 };
      yield* walk(root, childRel);
    } else if (entry.isFile()) {
      let size = 0;
      try {
        const stat = await fs.stat(path.join(root, childRel));
        size = stat.size;
      } catch {
        /* ignore stat errors */
      }
      yield { rel: childRel, type: 'file', size };
    }
  }
}

/**
 * Apply the configured cleaning strategy to the deploy path.
 *
 * - `merge`        : no-op (kept here for symmetry; returns empty result)
 * - `clean`        : delete every file/dir not matched by `protectPaths` (and never the .kite-* prefix)
 * - `clean-all`    : delete everything (still keeps `.kite-*` for Kite internal usage)
 *
 * The same function powers the dry-run preview when `opts.dryRun === true`:
 * nothing is unlinked, only the prospective delete/skip lists are returned.
 */
export async function applyCleanStrategy(
  deployPath: string,
  mode: CleanMode,
  protectPaths: string[],
  opts: CleanOptions = {},
): Promise<CleanResult> {
  const result: CleanResult = {
    mode,
    deleteList: [],
    skipList: [],
    totalDeleteSize: 0,
    totalDeleteFiles: 0,
    totalSkipFiles: 0,
    scanned: 0,
    truncated: false,
  };

  if (mode === 'merge') {
    log.info({ traceId: opts.traceId, deployPath, mode }, 'clean: merge mode (no-op)');
    return result;
  }

  const maxItems = opts.maxItems ?? 10_000;
  const filesToDelete: CleanItem[] = [];
  const dirsToDelete: CleanItem[] = [];

  try {
    await fs.access(deployPath);
  } catch {
    log.warn({ traceId: opts.traceId, deployPath }, 'clean: deployPath missing, nothing to scan');
    return result;
  }

  for await (const entry of walk(deployPath)) {
    result.scanned += 1;
    const alwaysProtected = isAlwaysProtected(entry.rel);
    let shouldDelete: boolean;
    if (mode === 'clean-all') {
      shouldDelete = !alwaysProtected;
    } else {
      // clean mode: protect when matching any user glob OR .kite-*
      shouldDelete = !(alwaysProtected || matchesAnyGlob(entry.rel, protectPaths));
    }

    const item: CleanItem = { path: entry.rel, size: entry.size, type: entry.type };

    if (shouldDelete) {
      if (entry.type === 'file') {
        result.totalDeleteFiles += 1;
        result.totalDeleteSize += entry.size;
        if (result.deleteList.length < maxItems) result.deleteList.push(item);
        filesToDelete.push(item);
      } else {
        if (result.deleteList.length < maxItems) result.deleteList.push(item);
        dirsToDelete.push(item);
      }
    } else {
      if (entry.type === 'file') result.totalSkipFiles += 1;
      if (result.skipList.length < maxItems) result.skipList.push(item);
    }
  }

  if (result.deleteList.length >= maxItems || result.skipList.length >= maxItems) {
    result.truncated = true;
  }

  if (opts.dryRun) {
    log.info(
      {
        traceId: opts.traceId,
        deployPath,
        mode,
        deleteFiles: result.totalDeleteFiles,
        deleteBytes: result.totalDeleteSize,
        skipFiles: result.totalSkipFiles,
      },
      'clean: dry-run finished',
    );
    return result;
  }

  // Execute: files first, then dirs sorted by depth desc so child dirs go first.
  for (const f of filesToDelete) {
    const abs = path.join(deployPath, f.path);
    try {
      await fs.unlink(abs);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.warn({ traceId: opts.traceId, path: abs, err: err?.message }, 'clean: unlink failed');
      }
    }
  }

  dirsToDelete.sort((a, b) => b.path.split('/').length - a.path.split('/').length);
  for (const d of dirsToDelete) {
    const abs = path.join(deployPath, d.path);
    try {
      await fs.rmdir(abs);
    } catch (err: any) {
      // dir may be non-empty when a protected file lives inside; that's expected
      if (err?.code !== 'ENOTEMPTY' && err?.code !== 'ENOENT') {
        log.warn({ traceId: opts.traceId, path: abs, err: err?.message }, 'clean: rmdir failed');
      }
    }
  }

  log.info(
    {
      traceId: opts.traceId,
      deployPath,
      mode,
      deletedFiles: result.totalDeleteFiles,
      deletedBytes: result.totalDeleteSize,
      keptFiles: result.totalSkipFiles,
    },
    'clean: executed',
  );

  return result;
}

export interface TreeNode {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  willDelete: boolean;
  children?: TreeNode[];
}

/**
 * Convert a CleanResult into a hierarchical TreeNode for UI rendering.
 * Directories' size = sum of children; willDelete = all leaves under it are willDelete.
 */
export function buildPreviewTree(result: CleanResult): TreeNode {
  const root: TreeNode = { name: '', path: '', type: 'dir', size: 0, willDelete: false, children: [] };

  const ensureDir = (relPath: string): TreeNode => {
    if (!relPath) return root;
    const parts = relPath.split('/');
    let node = root;
    let acc = '';
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children?.find((c) => c.name === part && c.type === 'dir');
      if (!child) {
        child = { name: part, path: acc, type: 'dir', size: 0, willDelete: true, children: [] };
        (node.children ||= []).push(child);
      }
      node = child;
    }
    return node;
  };

  const addLeaf = (item: CleanItem, willDelete: boolean) => {
    const parts = item.path.split('/');
    const name = parts.pop()!;
    const parentRel = parts.join('/');
    const parent = ensureDir(parentRel);
    if (item.type === 'file') {
      (parent.children ||= []).push({
        name,
        path: item.path,
        type: 'file',
        size: item.size,
        willDelete,
      });
    } else {
      ensureDir(item.path);
    }
  };

  for (const f of result.deleteList) addLeaf(f, true);
  for (const f of result.skipList) addLeaf(f, false);

  // Roll up size + willDelete from leaves to root
  const rollup = (node: TreeNode) => {
    if (node.type === 'file') return;
    let size = 0;
    let allDelete = true;
    let anyChild = false;
    for (const child of node.children || []) {
      rollup(child);
      size += child.size;
      anyChild = true;
      if (!child.willDelete) allDelete = false;
    }
    node.size = size;
    node.willDelete = anyChild ? allDelete : false;
    (node.children || []).sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };
  rollup(root);

  return root;
}
