import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { db } from '../db/index.js';

const SERVER_VERSION = process.env.KITE_SERVER_VERSION || 'dev';
const BOOT_TIME = Date.now();

function kiteHomePath(): string {
  return process.env.KITE_DB_DIR || process.cwd();
}

function homeRelative(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

export interface HealthSummary {
  status: 'ok' | 'degraded';
  uptime: number;
  version: string;
}

export function getBasicHealth(): HealthSummary {
  return {
    status: 'ok',
    uptime: Math.floor((Date.now() - BOOT_TIME) / 1000),
    version: SERVER_VERSION,
  };
}

async function pingDb(): Promise<{ ok: boolean; latencyMs: number; path: string; error?: string }> {
  const dbPath = path.join(kiteHomePath(), 'kite.db');
  const start = performance.now();
  try {
    // findAll() is light enough; we only count, not load all
    await db.deployments.countByProject('__noop_health_check__');
    const latencyMs = Number((performance.now() - start).toFixed(1));
    return { ok: true, latencyMs, path: homeRelative(dbPath) };
  } catch (err: any) {
    return { ok: false, latencyMs: Number((performance.now() - start).toFixed(1)), path: homeRelative(dbPath), error: err?.message };
  }
}

async function checkKiteHomeWritable(): Promise<{ path: string; writable: boolean; tmpWritable: boolean }> {
  const home = kiteHomePath();
  const tmp = path.join(home, 'tmp');
  let writable = false;
  let tmpWritable = false;
  try {
    await fs.mkdir(home, { recursive: true });
    const probe = path.join(home, `.health-${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    writable = true;
  } catch { /* writable stays false */ }
  try {
    await fs.mkdir(tmp, { recursive: true });
    const probe = path.join(tmp, `.health-${Date.now()}.tmp`);
    await fs.writeFile(probe, 'ok');
    await fs.unlink(probe);
    tmpWritable = true;
  } catch { /* tmpWritable stays false */ }
  return { path: homeRelative(home), writable, tmpWritable };
}

export function runCmd(cmd: string, args: string[], timeoutMs = 3000): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} resolve({ stdout, code: 124 }); }, timeoutMs);
    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    proc.on('close', (code: number | null) => { clearTimeout(timer); resolve({ stdout, code: code ?? 0 }); });
    proc.on('error', () => { clearTimeout(timer); resolve({ stdout, code: 127 }); });
  });
}

// Cross-platform best-effort `df -kP <kiteHome>` parser.
// Windows: returns nulls (no portable shell tool covered here).
export async function fsFree(target?: string): Promise<{ freeBytes: number | null; totalBytes: number | null; percentUsed: number | null }> {
  const dir = target || kiteHomePath();
  if (process.platform === 'win32') {
    return { freeBytes: null, totalBytes: null, percentUsed: null };
  }
  const { stdout, code } = await runCmd('df', ['-kP', dir]);
  if (code !== 0) return { freeBytes: null, totalBytes: null, percentUsed: null };
  // Expected: header line + data line; fields: Filesystem 1024-blocks Used Available Capacity Mounted
  const lines = stdout.trim().split('\n');
  const data = lines[lines.length - 1].trim().split(/\s+/);
  // some df implementations wrap long device names; data row may have >= 6 cols
  const cols = data.slice(-5); // [1024-blocks, Used, Available, Capacity, Mounted]
  const totalBlocks = Number(cols[0]);
  const availBlocks = Number(cols[2]);
  if (!Number.isFinite(totalBlocks) || !Number.isFinite(availBlocks)) {
    return { freeBytes: null, totalBytes: null, percentUsed: null };
  }
  const totalBytes = totalBlocks * 1024;
  const freeBytes = availBlocks * 1024;
  const percentUsed = totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : null;
  return { freeBytes, totalBytes, percentUsed };
}

async function recentDeployStats(): Promise<{ last5: Array<{ id: string; projectId: string; status: string; startTime: string }>; successRate: number | null }> {
  try {
    const all = await db.deployments.findAll();
    const last5 = all.slice(0, 5).map(d => ({ id: d.id, projectId: d.projectId, status: d.status, startTime: d.startTime }));
    if (last5.length === 0) return { last5: [], successRate: null };
    const successes = last5.filter(d => d.status === 'success').length;
    return { last5, successRate: Number((successes / last5.length).toFixed(2)) };
  } catch {
    return { last5: [], successRate: null };
  }
}

export interface HealthDetail {
  version: string;
  runtime: { name: string; version: string };
  uptimeSec: number;
  serverTime: string;
  db: { ok: boolean; latencyMs: number; path: string; error?: string };
  disk: { freeBytes: number | null; totalBytes: number | null; percentUsed: number | null };
  kiteHome: { path: string; writable: boolean; tmpWritable: boolean };
  deploy: { last5: Array<{ id: string; projectId: string; status: string; startTime: string }>; successRate: number | null };
  memoryMB: { rss: number; heapUsed: number };
}

export async function collectHealth(): Promise<HealthDetail> {
  const [dbInfo, kiteHome, disk, deployStats] = await Promise.all([
    pingDb(),
    checkKiteHomeWritable(),
    fsFree(),
    recentDeployStats(),
  ]);
  const mem = process.memoryUsage();
  const runtimeName = typeof (globalThis as any).Bun !== 'undefined' ? 'bun' : 'node';
  const runtimeVersion = runtimeName === 'bun'
    ? `v${(globalThis as any).Bun.version}`
    : process.version;
  return {
    version: SERVER_VERSION,
    runtime: { name: runtimeName, version: runtimeVersion },
    uptimeSec: Math.floor((Date.now() - BOOT_TIME) / 1000),
    serverTime: new Date().toISOString(),
    db: dbInfo,
    disk,
    kiteHome,
    deploy: deployStats,
    memoryMB: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
  };
}

export function isHealthDegraded(detail: HealthDetail): boolean {
  if (!detail.db.ok) return true;
  if (!detail.kiteHome.writable) return true;
  if (detail.disk.percentUsed != null && detail.disk.percentUsed >= 95) return true;
  return false;
}
