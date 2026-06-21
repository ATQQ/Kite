import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { getKiteHome, readGlobalConfig } from './home.js';

type Level = 'ok' | 'warn' | 'error';

interface Check {
  name: string;
  level: Level;
  detail: string;
}

function fmt(level: Level): string {
  if (level === 'ok') return chalk.green('✓');
  if (level === 'warn') return chalk.yellow('!');
  return chalk.red('✗');
}

function homeRelative(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

function checkNodeVersion(): Check {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major >= 18) {
    return { name: 'Node.js', level: 'ok', detail: `v${process.versions.node} (>=18 required)` };
  }
  return { name: 'Node.js', level: 'error', detail: `v${process.versions.node} (require >=18)` };
}

function checkKiteHome(): Check[] {
  const home = getKiteHome();
  const out: Check[] = [];
  try {
    fs.mkdirSync(home, { recursive: true });
    const probe = path.join(home, `.doctor-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    out.push({ name: 'Kite Home', level: 'ok', detail: homeRelative(home) });
  } catch (err: any) {
    out.push({ name: 'Kite Home', level: 'error', detail: `${homeRelative(home)} not writable: ${err?.message}` });
  }
  for (const sub of ['deployments', 'tmp']) {
    const p = path.join(home, sub);
    try {
      fs.mkdirSync(p, { recursive: true });
      out.push({ name: `Kite Home / ${sub}`, level: 'ok', detail: homeRelative(p) });
    } catch (err: any) {
      out.push({ name: `Kite Home / ${sub}`, level: 'error', detail: `${homeRelative(p)} create failed: ${err?.message}` });
    }
  }
  return out;
}

function checkDiskFree(): Check {
  if (process.platform === 'win32') {
    return { name: 'Disk free', level: 'warn', detail: 'skipped on Windows' };
  }
  try {
    const home = getKiteHome();
    const out = execSync(`df -kP "${home}"`, { encoding: 'utf-8', timeout: 3000 });
    const lines = out.trim().split('\n');
    const cols = lines[lines.length - 1].trim().split(/\s+/).slice(-5);
    const total = Number(cols[0]);
    const avail = Number(cols[2]);
    if (!Number.isFinite(total) || !Number.isFinite(avail) || total <= 0) {
      return { name: 'Disk free', level: 'warn', detail: 'unable to parse df output' };
    }
    const freeGB = (avail / 1024 / 1024).toFixed(2);
    const pctUsed = Math.round(((total - avail) / total) * 100);
    if (pctUsed >= 95) return { name: 'Disk free', level: 'error', detail: `${freeGB} GB free (${pctUsed}% used)` };
    if (pctUsed >= 85) return { name: 'Disk free', level: 'warn', detail: `${freeGB} GB free (${pctUsed}% used)` };
    return { name: 'Disk free', level: 'ok', detail: `${freeGB} GB free (${pctUsed}% used)` };
  } catch (err: any) {
    return { name: 'Disk free', level: 'warn', detail: `df failed: ${err?.message}` };
  }
}

function checkLocalConfig(): Check {
  const cfg = readGlobalConfig();
  if (cfg.serverUrl) return { name: 'Global config', level: 'ok', detail: `serverUrl=${cfg.serverUrl}` };
  return { name: 'Global config', level: 'warn', detail: 'no serverUrl in ~/.kite/config.json (use `kite config set serverUrl <url>`)' };
}

interface RemoteOpts {
  serverUrl?: string;
  token?: string;
}

async function checkRemote(opts: RemoteOpts): Promise<Check[]> {
  if (!opts.serverUrl) {
    return [{ name: 'Remote', level: 'warn', detail: 'no server url (pass --server or configure globally)' }];
  }
  const base = opts.serverUrl.replace(/\/$/, '');
  const out: Check[] = [];

  try {
    const res = await fetch(`${base}/api/health`);
    if (res.ok) {
      const body: any = await res.json().catch(() => ({}));
      out.push({ name: 'GET /api/health', level: 'ok', detail: `status=${body.status} uptime=${body.uptime}s version=${body.version}` });
    } else {
      out.push({ name: 'GET /api/health', level: 'error', detail: `HTTP ${res.status}` });
      return out;
    }
  } catch (err: any) {
    out.push({ name: 'GET /api/health', level: 'error', detail: `network error: ${err?.message}` });
    return out;
  }

  if (!opts.token) {
    out.push({ name: 'GET /api/health/detail', level: 'warn', detail: 'no admin token (pass --token or configure globally) — detail skipped' });
    return out;
  }
  try {
    const res = await fetch(`${base}/api/health/detail`, { headers: { Authorization: `Bearer ${opts.token}` } });
    if (res.status === 401) {
      out.push({ name: 'GET /api/health/detail', level: 'error', detail: 'unauthorized — token mismatch' });
      return out;
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      out.push({ name: 'GET /api/health/detail', level: 'error', detail: `HTTP ${res.status}` });
    }
    if (body?.db) {
      out.push({ name: 'Remote DB', level: body.db.ok ? 'ok' : 'error', detail: `${body.db.path} (${body.db.latencyMs}ms)${body.db.error ? ' ' + body.db.error : ''}` });
    }
    if (body?.kiteHome) {
      out.push({ name: 'Remote Kite Home', level: body.kiteHome.writable ? 'ok' : 'error', detail: `${body.kiteHome.path} writable=${body.kiteHome.writable} tmp=${body.kiteHome.tmpWritable}` });
    }
    if (body?.disk) {
      const d = body.disk;
      if (d.percentUsed == null) {
        out.push({ name: 'Remote Disk', level: 'warn', detail: 'unavailable on remote platform' });
      } else {
        const lvl: Level = d.percentUsed >= 95 ? 'error' : d.percentUsed >= 85 ? 'warn' : 'ok';
        const freeGB = d.freeBytes != null ? (d.freeBytes / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '?';
        out.push({ name: 'Remote Disk', level: lvl, detail: `${freeGB} free (${d.percentUsed}% used)` });
      }
    }
    if (body?.deploy) {
      const rate = body.deploy.successRate;
      const lvl: Level = rate == null ? 'warn' : rate >= 0.8 ? 'ok' : rate >= 0.5 ? 'warn' : 'error';
      out.push({ name: 'Recent deploys', level: lvl, detail: `last ${body.deploy.last5.length} success rate=${rate == null ? 'n/a' : (rate * 100).toFixed(0) + '%'}` });
    }
    if (body?.runtime) {
      out.push({ name: 'Remote runtime', level: 'ok', detail: `${body.runtime.name} ${body.runtime.version} uptime=${body.uptimeSec}s` });
    }
  } catch (err: any) {
    out.push({ name: 'GET /api/health/detail', level: 'error', detail: `network error: ${err?.message}` });
  }
  return out;
}

export interface DoctorOptions {
  server?: string;
  token?: string;
}

export async function runDoctor(opts: DoctorOptions = {}): Promise<number> {
  const cfg = readGlobalConfig();
  const serverUrl = opts.server || process.env.KITE_SERVER_URL || cfg.serverUrl;
  const token = opts.token || process.env.KITE_TOKEN || cfg.token;

  const localChecks: Check[] = [
    checkNodeVersion(),
    ...checkKiteHome(),
    checkDiskFree(),
    checkLocalConfig(),
  ];
  const remoteChecks = await checkRemote({ serverUrl, token });

  console.log(chalk.bold('\n[Local]'));
  for (const c of localChecks) {
    console.log(`  ${fmt(c.level)} ${c.name.padEnd(22)} ${chalk.gray(c.detail)}`);
  }
  console.log(chalk.bold(`\n[Remote ${serverUrl || '(none)'}]`));
  for (const c of remoteChecks) {
    console.log(`  ${fmt(c.level)} ${c.name.padEnd(22)} ${chalk.gray(c.detail)}`);
  }

  const all = [...localChecks, ...remoteChecks];
  const hasError = all.some(c => c.level === 'error');
  const hasWarn = all.some(c => c.level === 'warn');
  console.log('');
  if (hasError) {
    console.log(chalk.red('Doctor: some checks failed.'));
    return 1;
  }
  if (hasWarn) {
    console.log(chalk.yellow('Doctor: passed with warnings.'));
    return 0;
  }
  console.log(chalk.green('Doctor: all checks passed.'));
  return 0;
}
