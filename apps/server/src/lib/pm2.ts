import os from 'node:os';
import path from 'node:path';
import { runCmd } from './health.js';

export interface Pm2InstanceLogPaths {
  pmId: number;
  instanceId?: number;         // pm2_env.NODE_APP_INSTANCE, cluster mode 下每个实例的序号
  outLogPath?: string;
  errorLogPath?: string;
}

export interface Pm2AppStatus {
  found: boolean;
  name: string;
  pmId?: number;
  pid?: number;
  status?: string;             // 'online' | 'stopped' | 'errored' | ...
  uptimeMs?: number;
  restarts?: number;
  unstableRestarts?: number;
  cpuPercent?: number;
  memoryBytes?: number;
  execMode?: string;           // 'fork_mode' | 'cluster_mode'
  instances?: number;
  pm2_env_status?: string;
  errorLogPath?: string;
  outLogPath?: string;
  instancesLogPaths?: Pm2InstanceLogPaths[]; // 全部同名实例的日志文件路径（cluster 模式下每个实例的 -0/-1/...）
  createdAt?: number;
  message?: string;            // error / hint when not found
}

let cachedPm2Path: string | null | undefined = undefined;

async function resolvePm2Path(): Promise<string | null> {
  if (cachedPm2Path !== undefined) return cachedPm2Path;
  const candidates = ['pm2'];
  const home = os.homedir();
  candidates.push(
    path.join(home, '.local/bin/pm2'),
    '/usr/local/bin/pm2',
    '/opt/homebrew/bin/pm2',
  );
  for (const c of candidates) {
    const probe = await runCmd(c, ['--version'], 1500);
    if (probe.code === 0) {
      cachedPm2Path = c;
      return c;
    }
  }
  cachedPm2Path = null;
  return null;
}

export async function isPm2Available(): Promise<boolean> {
  return (await resolvePm2Path()) !== null;
}

let cache: { at: number; data: any[] } | null = null;
const CACHE_TTL_MS = 1500;

async function pm2Jlist(): Promise<any[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  const bin = await resolvePm2Path();
  if (!bin) return [];
  const { stdout, code } = await runCmd(bin, ['jlist'], 4000);
  if (code !== 0) return [];
  try {
    // pm2 jlist sometimes prefixes with non-JSON text; find first '['
    const start = stdout.indexOf('[');
    if (start < 0) return [];
    const arr = JSON.parse(stdout.slice(start));
    if (!Array.isArray(arr)) return [];
    cache = { at: Date.now(), data: arr };
    return arr;
  } catch {
    return [];
  }
}

export async function listPm2Apps(): Promise<Array<{ name: string; pmId: number; status: string }>> {
  const list = await pm2Jlist();
  return list.map(item => ({
    name: String(item?.name ?? ''),
    pmId: Number(item?.pm_id ?? -1),
    status: String(item?.pm2_env?.status ?? 'unknown'),
  })).filter(x => x.name);
}

export async function getPm2AppStatus(name: string): Promise<Pm2AppStatus> {
  const available = await isPm2Available();
  if (!available) {
    return { found: false, name, message: 'pm2 binary not found in PATH' };
  }
  const list = await pm2Jlist();
  // pm2 jlist returns one entry per instance; we aggregate by name
  const matched = list.filter(item => String(item?.name) === name);
  if (matched.length === 0) {
    return { found: false, name, message: `no pm2 app named "${name}"` };
  }
  const first = matched[0];
  let cpuSum = 0;
  let memSum = 0;
  let restarts = 0;
  let unstable = 0;
  let uptimeMax = 0;
  let status = 'unknown';
  const instancesLogPaths: Pm2InstanceLogPaths[] = [];
  for (const m of matched) {
    const monit = m?.monit || {};
    cpuSum += Number(monit.cpu ?? 0);
    memSum += Number(monit.memory ?? 0);
    const env = m?.pm2_env || {};
    restarts += Number(env.restart_time ?? 0);
    unstable += Number(env.unstable_restarts ?? 0);
    if (typeof env.pm_uptime === 'number') {
      const up = Date.now() - env.pm_uptime;
      if (up > uptimeMax) uptimeMax = up;
    }
    if (env.status) status = String(env.status);
    const rawInstanceId = env.NODE_APP_INSTANCE ?? env.pm_id;
    const instanceId = typeof rawInstanceId === 'number'
      ? rawInstanceId
      : (rawInstanceId !== undefined && rawInstanceId !== null && rawInstanceId !== '' && Number.isFinite(Number(rawInstanceId)))
        ? Number(rawInstanceId)
        : undefined;
    instancesLogPaths.push({
      pmId: Number(m?.pm_id ?? -1),
      instanceId,
      outLogPath: env.pm_out_log_path ? String(env.pm_out_log_path) : undefined,
      errorLogPath: env.pm_err_log_path ? String(env.pm_err_log_path) : undefined,
    });
  }
  const env = first?.pm2_env || {};
  return {
    found: true,
    name,
    pmId: Number(first?.pm_id ?? -1),
    pid: Number(first?.pid ?? 0),
    status,
    uptimeMs: uptimeMax || undefined,
    restarts,
    unstableRestarts: unstable,
    cpuPercent: Math.round(cpuSum * 100) / 100,
    memoryBytes: memSum,
    execMode: env.exec_mode ? String(env.exec_mode) : undefined,
    instances: matched.length,
    pm2_env_status: env.status ? String(env.status) : undefined,
    errorLogPath: env.pm_err_log_path ? String(env.pm_err_log_path) : undefined,
    outLogPath: env.pm_out_log_path ? String(env.pm_out_log_path) : undefined,
    instancesLogPaths,
    createdAt: typeof env.created_at === 'number' ? env.created_at : undefined,
  };
}
