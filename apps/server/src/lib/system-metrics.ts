import os from 'node:os';
import fs from 'node:fs/promises';
import { fsFree, runCmd } from './health.js';

interface CpuSnapshot {
  idle: number;
  total: number;
}

function readCpuSnapshot(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

let lastSnapshot: CpuSnapshot | null = null;
let lastCpuPercent: number | null = null;

function sampleCpuPercent(): number | null {
  const cur = readCpuSnapshot();
  if (!lastSnapshot) {
    lastSnapshot = cur;
    return lastCpuPercent;
  }
  const idleDiff = cur.idle - lastSnapshot.idle;
  const totalDiff = cur.total - lastSnapshot.total;
  lastSnapshot = cur;
  if (totalDiff <= 0) return lastCpuPercent;
  const pct = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 10000) / 100));
  lastCpuPercent = pct;
  return pct;
}

// Pre-warm so the first /api/system/resources request has a valid sample window
readCpuSnapshot();
lastSnapshot = readCpuSnapshot();

// macOS: parse `vm_stat` page counters -> available = free + inactive + speculative + (purgeable)
// Linux: parse `/proc/meminfo` MemAvailable (kernel 3.14+)
// Others: fall back to os.freemem()
async function readAvailableMemoryBytes(totalBytes: number): Promise<number> {
  try {
    if (process.platform === 'darwin') {
      const { stdout, code } = await runCmd('vm_stat', []);
      if (code !== 0) return os.freemem();
      const pageSizeMatch = stdout.match(/page size of (\d+) bytes/);
      const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 4096;
      const pick = (key: string): number => {
        const m = stdout.match(new RegExp(`Pages ${key}:\\s+(\\d+)`));
        return m ? Number(m[1]) : 0;
      };
      const free = pick('free');
      const inactive = pick('inactive');
      const speculative = pick('speculative');
      const purgeable = pick('purgeable');
      const available = (free + inactive + speculative + purgeable) * pageSize;
      return available > 0 ? Math.min(available, totalBytes) : os.freemem();
    }
    if (process.platform === 'linux') {
      const content = await fs.readFile('/proc/meminfo', 'utf8');
      const m = content.match(/^MemAvailable:\s+(\d+)\s*kB/m);
      if (m) {
        const bytes = Number(m[1]) * 1024;
        return Number.isFinite(bytes) ? bytes : os.freemem();
      }
      return os.freemem();
    }
  } catch {
    return os.freemem();
  }
  return os.freemem();
}

export interface SystemResources {
  collectedAt: string;
  host: {
    hostname: string;
    platform: string;
    arch: string;
    cpuModel: string | null;
    cpuCount: number;
    loadAvg: number[];
    uptimeSec: number;
  };
  cpu: {
    percent: number | null;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    availableBytes: number;
    usedBytes: number;
    percentUsed: number;
  };
  disk: {
    freeBytes: number | null;
    totalBytes: number | null;
    percentUsed: number | null;
  };
  process: {
    pid: number;
    runtime: 'bun' | 'node';
    runtimeVersion: string;
    uptimeSec: number;
    cpuPercent: number | null;
    memoryRssBytes: number;
    memoryHeapUsedBytes: number;
  };
}

let lastProcCpuUsage = process.cpuUsage();
let lastProcSampleAt = Date.now();
let lastProcCpuPercent: number | null = null;

function sampleProcessCpuPercent(): number | null {
  const usage = process.cpuUsage(lastProcCpuUsage);
  const now = Date.now();
  const elapsedMs = now - lastProcSampleAt;
  lastProcCpuUsage = process.cpuUsage();
  lastProcSampleAt = now;
  if (elapsedMs <= 0) return lastProcCpuPercent;
  const cpuMs = (usage.user + usage.system) / 1000;
  const cores = Math.max(1, os.cpus().length);
  const pct = Math.max(0, Math.min(100, Math.round((cpuMs / (elapsedMs * cores)) * 10000) / 100));
  lastProcCpuPercent = pct;
  return pct;
}

export async function collectSystemResources(): Promise<SystemResources> {
  const cpus = os.cpus();
  const cpuPercent = sampleCpuPercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const [availMem, disk] = await Promise.all([
    readAvailableMemoryBytes(totalMem),
    fsFree(),
  ]);
  const usedMem = Math.max(0, totalMem - availMem);
  const mem = process.memoryUsage();
  const runtimeName: 'bun' | 'node' = typeof (globalThis as any).Bun !== 'undefined' ? 'bun' : 'node';
  const runtimeVersion = runtimeName === 'bun'
    ? `v${(globalThis as any).Bun.version}`
    : process.version;
  return {
    collectedAt: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus[0]?.model ?? null,
      cpuCount: cpus.length,
      loadAvg: os.loadavg(),
      uptimeSec: Math.floor(os.uptime()),
    },
    cpu: { percent: cpuPercent },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      availableBytes: availMem,
      usedBytes: usedMem,
      percentUsed: totalMem > 0 ? Math.round((usedMem / totalMem) * 10000) / 100 : 0,
    },
    disk,
    process: {
      pid: process.pid,
      runtime: runtimeName,
      runtimeVersion,
      uptimeSec: Math.floor(process.uptime()),
      cpuPercent: sampleProcessCpuPercent(),
      memoryRssBytes: mem.rss,
      memoryHeapUsedBytes: mem.heapUsed,
    },
  };
}
