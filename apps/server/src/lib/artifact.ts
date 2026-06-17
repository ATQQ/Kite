import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db/index.js';
import { moduleLogger } from './logger.js';

const log = moduleLogger('artifact');

function kiteHome(): string {
  return process.env.KITE_DB_DIR || process.cwd();
}

export function artifactDir(projectId: string): string {
  return path.join(kiteHome(), 'deployments', projectId, 'artifacts');
}

export function artifactPathFor(projectId: string, deployId: string): string {
  return path.join(artifactDir(projectId), `${deployId}.zip`);
}

export interface ArchiveResult {
  artifactPath: string;
  artifactSize: number;
}

/**
 * Copy a freshly-uploaded zip into the project's artifact directory.
 * The source file is left untouched (caller is responsible for cleanup).
 */
export async function archiveZip(opts: {
  projectId: string;
  deployId: string;
  sourceZip: string;
  traceId?: string;
}): Promise<ArchiveResult> {
  const dir = artifactDir(opts.projectId);
  await fs.mkdir(dir, { recursive: true });
  const dest = artifactPathFor(opts.projectId, opts.deployId);
  await fs.copyFile(opts.sourceZip, dest);
  const stat = await fs.stat(dest);
  log.info({ traceId: opts.traceId, projectId: opts.projectId, deployId: opts.deployId, path: dest, size: stat.size }, 'archived deployment zip');
  return { artifactPath: dest, artifactSize: stat.size };
}

/**
 * Resolve an archived zip path. Throws if the file no longer exists on disk.
 */
export async function restoreZip(artifactPath: string): Promise<string> {
  await fs.access(artifactPath);
  return artifactPath;
}

export interface GcResult {
  inspected: number;
  removedFiles: number;
  removedBytes: number;
  preserved: number;          // entries that still have references (shared by rollback)
  detached: number;           // db rows whose artifactPath was cleared
}

/**
 * Garbage-collect oldest archives beyond keepN.
 * Reference counting: a zip is physically removed only when no remaining deployment row
 * references the same artifactPath (shared rollback artifacts stay until the last referer is GC'd).
 *
 * Strategy:
 *   1. List all deployments for the project sorted by startTime desc.
 *   2. Keep the most-recent `keepN` rows untouched.
 *   3. For each older row with a non-null artifactPath:
 *        - clear its DB artifactPath (so the row stops referencing the file)
 *        - if no other deployment row still references that file path, unlink it
 */
export async function gcArtifacts(opts: {
  projectId: string;
  keepN: number;
  traceId?: string;
}): Promise<GcResult> {
  const result: GcResult = { inspected: 0, removedFiles: 0, removedBytes: 0, preserved: 0, detached: 0 };
  if (opts.keepN <= 0) return result;
  const rows = await db.deployments.findByProject(opts.projectId);
  result.inspected = rows.length;
  if (rows.length <= opts.keepN) return result;

  const stale = rows.slice(opts.keepN);
  for (const row of stale) {
    if (!row.artifactPath) continue;
    const targetPath = row.artifactPath;
    const targetSize = row.artifactSize || 0;
    await db.deployments.clearArtifactPath(row.id);
    result.detached += 1;
    const remaining = await db.deployments.countByArtifactPath(targetPath);
    if (remaining > 0) {
      result.preserved += 1;
      log.info({ traceId: opts.traceId, projectId: opts.projectId, deployId: row.id, path: targetPath, remainingRefs: remaining }, 'gc kept shared artifact');
      continue;
    }
    try {
      await fs.unlink(targetPath);
      result.removedFiles += 1;
      result.removedBytes += targetSize;
      log.info({ traceId: opts.traceId, projectId: opts.projectId, deployId: row.id, path: targetPath, size: targetSize }, 'gc removed artifact');
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.warn({ traceId: opts.traceId, projectId: opts.projectId, deployId: row.id, path: targetPath, err: err?.message }, 'gc unlink failed');
      }
    }
  }
  return result;
}

/**
 * Sweep one project's deployments and clear DB references whose file is missing on disk.
 * Used by `reconcileArtifacts()` at server boot to recover from manual file deletion.
 */
export async function reconcileArtifacts(projectId: string): Promise<{ scanned: number; cleared: number }> {
  const rows = await db.deployments.findByProject(projectId);
  let cleared = 0;
  for (const row of rows) {
    if (!row.artifactPath) continue;
    try {
      await fs.access(row.artifactPath);
    } catch {
      await db.deployments.clearArtifactPath(row.id);
      cleared += 1;
      log.warn({ projectId, deployId: row.id, path: row.artifactPath }, 'reconcile cleared missing artifact');
    }
  }
  return { scanned: rows.length, cleared };
}

export async function getArtifactKeepN(): Promise<number> {
  const raw = await db.settings.get('artifact_keep_n');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.floor(n);
}
