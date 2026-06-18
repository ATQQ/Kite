import chalk from 'chalk';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { randomUUID } from 'crypto';
import {
  readGlobalConfig,
  readLocalEnv,
  resolveProjectConfig,
  envTokenKey,
  listProjectEnvs,
} from './home.js';

export interface OpsAuth {
  serverUrl: string;
  token: string;
  source: string;
}

export interface ResolveAuthOptions {
  server?: string;
  token?: string;
  env?: string;
  requireAdmin?: boolean;
}

export function resolveOpsAuth(opts: ResolveAuthOptions = {}): OpsAuth {
  const globalCfg = readGlobalConfig();
  const localEnv = readLocalEnv();

  const serverUrl =
    opts.server ||
    process.env.KITE_SERVER_URL ||
    localEnv.KITE_SERVER_URL ||
    globalCfg.serverUrl;

  if (!serverUrl) {
    throw new Error(
      'Server URL not configured. Use --server <url> or run `kite config:set serverUrl <url> --global`.',
    );
  }

  if (opts.token) {
    return { serverUrl, token: opts.token, source: 'cli flag' };
  }

  if (opts.requireAdmin) {
    const adminTok = process.env.KITE_TOKEN || globalCfg.token;
    if (!adminTok) {
      throw new Error(
        'Admin token required. Run `kite config:set token <admin> --global` or pass --token.',
      );
    }
    return { serverUrl, token: adminTok, source: 'global admin token' };
  }

  const envTok = process.env.KITE_TOKEN || process.env.KITE_DEPLOY_TOKEN || localEnv.KITE_TOKEN || localEnv.KITE_DEPLOY_TOKEN;
  if (envTok) return { serverUrl, token: envTok, source: 'env var' };

  const allEnvs = listProjectEnvs();
  let resolved = null as ReturnType<typeof resolveProjectConfig>;
  if (opts.env) {
    resolved = resolveProjectConfig(opts.env);
  } else if (allEnvs.length === 1) {
    resolved = allEnvs[0];
  }

  if (resolved?.config?.projectId) {
    const key = envTokenKey(resolved.config.projectId, resolved.env);
    const projTok = globalCfg.projectToken?.[key];
    if (projTok) return { serverUrl, token: projTok, source: `project token (${key})` };
  }

  if (globalCfg.token) {
    return { serverUrl, token: globalCfg.token, source: 'global admin token' };
  }

  throw new Error(
    'Token not found. Configure via `kite config:set token <value>` (project) or `kite config:set token <admin> --global`.',
  );
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function expectOk(res: Response, label: string): Promise<any> {
  if (res.status === 401) throw new Error(`Unauthorized: invalid token (${label})`);
  if (res.status === 404) {
    const body = await readJson(res);
    throw new Error(`Not found: ${body.error || label}`);
  }
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(`[${res.status}] ${body.error || label}`);
  }
  return readJson(res);
}

interface ProjectRow {
  id: string;
  name: string;
  env?: string | null;
  status?: string | null;
  deployPath?: string;
  updatedAt?: string;
}

interface DeploymentRow {
  id: string;
  projectId: string;
  projectName: string;
  status: string;
  triggerSource: string;
  duration?: string | null;
  startTime: string;
  endTime?: string | null;
  output?: string | null;
  artifactPath?: string | null;
  rollbackOf?: string | null;
}

function statusColor(status: string | null | undefined): string {
  switch (status) {
    case 'success': return chalk.green(status);
    case 'failed': return chalk.red(status);
    case 'running': return chalk.yellow(status);
    case 'idle': return chalk.gray(status);
    default: return chalk.gray(status || '-');
  }
}

function padCell(text: string, width: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, '');
  if (visible.length >= width) return text;
  return text + ' '.repeat(width - visible.length);
}

function printTable(rows: string[][], headers: string[]) {
  const cols = headers.length;
  const widths = new Array(cols).fill(0);
  for (const r of [headers, ...rows]) {
    for (let i = 0; i < cols; i++) {
      const visible = (r[i] || '').replace(/\x1b\[[0-9;]*m/g, '');
      if (visible.length > widths[i]) widths[i] = visible.length;
    }
  }
  const headerLine = headers.map((h, i) => padCell(chalk.bold(h), widths[i])).join('  ');
  console.log(headerLine);
  console.log(chalk.gray(widths.map((w) => '-'.repeat(w)).join('  ')));
  for (const r of rows) {
    console.log(r.map((c, i) => padCell(c, widths[i])).join('  '));
  }
}

export interface ListOptions {
  server?: string;
  token?: string;
  env?: string;
  json?: boolean;
}

export async function runList(opts: ListOptions): Promise<number> {
  const auth = resolveOpsAuth({ ...opts, requireAdmin: true });
  const res = await fetch(`${auth.serverUrl.replace(/\/$/, '')}/api/projects`, {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  const projects: ProjectRow[] = await expectOk(res, 'GET /api/projects');
  let filtered = projects;
  if (opts.env) filtered = projects.filter((p) => (p.env || '') === opts.env);

  if (opts.json) {
    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
    return 0;
  }

  if (filtered.length === 0) {
    console.log(chalk.gray('No projects found.'));
    return 0;
  }

  const rows = filtered.map((p) => [
    p.id,
    p.name,
    p.env || chalk.gray('-'),
    statusColor(p.status),
    chalk.gray(p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 19).replace('T', ' ') : '-'),
  ]);
  printTable(rows, ['ID', 'NAME', 'ENV', 'STATUS', 'UPDATED']);
  console.log(chalk.gray(`\n${filtered.length} project(s)`));
  return 0;
}

export interface StatusOptions {
  server?: string;
  token?: string;
  env?: string;
  limit?: number;
  json?: boolean;
}

export async function runStatus(projectIdArg: string | undefined, opts: StatusOptions): Promise<number> {
  const auth = resolveOpsAuth({ ...opts, requireAdmin: true });
  const limit = Math.min(Math.max(Number(opts.limit) || 5, 1), 50);

  let projectId = projectIdArg;
  if (!projectId) {
    const all = listProjectEnvs();
    const resolved = opts.env ? resolveProjectConfig(opts.env) : (all.length === 1 ? all[0] : null);
    if (resolved?.config?.projectId) {
      projectId = resolved.config.projectId as string;
    }
  }
  if (!projectId) {
    throw new Error('projectId required. Pass <projectId> or run inside a project directory with kite.config*.json');
  }

  const base = auth.serverUrl.replace(/\/$/, '');
  const [projectRes, logsRes] = await Promise.all([
    fetch(`${base}/api/projects/${projectId}`, { headers: { Authorization: `Bearer ${auth.token}` } }),
    fetch(`${base}/api/logs`, { headers: { Authorization: `Bearer ${auth.token}` } }),
  ]);
  const project: ProjectRow = await expectOk(projectRes, `GET /api/projects/${projectId}`);
  const logs: DeploymentRow[] = await expectOk(logsRes, 'GET /api/logs');

  const projectLogs = logs
    .filter((l) => l.projectId === projectId)
    .sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''))
    .slice(0, limit);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ project, deployments: projectLogs }, null, 2) + '\n');
    return 0;
  }

  console.log(chalk.bold(`Project: ${project.name}`) + chalk.gray(`  (${project.id})`));
  console.log(chalk.gray(`Status: `) + statusColor(project.status));
  console.log('');

  if (projectLogs.length === 0) {
    console.log(chalk.gray('No deployments yet.'));
    return 0;
  }

  const rows = projectLogs.map((d) => [
    d.id.slice(0, 12),
    statusColor(d.status),
    d.triggerSource,
    chalk.gray(d.startTime ? d.startTime.slice(0, 19).replace('T', ' ') : '-'),
    d.duration || chalk.gray('-'),
    d.rollbackOf ? chalk.gray(`← ${d.rollbackOf.slice(0, 8)}`) : '',
  ]);
  printTable(rows, ['DEPLOY ID', 'STATUS', 'TRIGGER', 'STARTED', 'DURATION', 'ROLLBACK OF']);
  return 0;
}

export interface LogsOptions {
  server?: string;
  token?: string;
  env?: string;
  follow?: boolean;
  json?: boolean;
}

const STATUS_EXIT: Record<string, number> = { success: 0, failed: 1, running: 0 };

export async function runLogs(deployId: string, opts: LogsOptions): Promise<number> {
  const auth = resolveOpsAuth({ ...opts, requireAdmin: true });
  const base = auth.serverUrl.replace(/\/$/, '');

  if (!opts.follow) {
    const res = await fetch(`${base}/api/logs/${deployId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const log: DeploymentRow = await expectOk(res, `GET /api/logs/${deployId}`);
    if (opts.json) {
      process.stdout.write(JSON.stringify(log, null, 2) + '\n');
      return STATUS_EXIT[log.status] ?? 1;
    }
    console.log(chalk.bold(`Deployment ${log.id.slice(0, 12)}`) + chalk.gray(`  (${log.projectName})`));
    console.log(chalk.gray('Status: ') + statusColor(log.status) + chalk.gray(`  duration=${log.duration || '-'}  trigger=${log.triggerSource}`));
    console.log('');
    if (log.output) process.stdout.write(log.output);
    if (!log.output?.endsWith('\n')) process.stdout.write('\n');
    return STATUS_EXIT[log.status] ?? 1;
  }

  const res = await fetch(`${base}/api/logs/${deployId}/stream`, {
    headers: {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'text/event-stream',
    },
  });
  if (res.status === 401) throw new Error('Unauthorized: invalid token');
  if (res.status === 404) throw new Error('Deployment not found');
  if (!res.ok || !res.body) throw new Error(`SSE failed: HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastStatus: string | null = null;
  let printedOutputLen = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop()!;

    for (const block of events) {
      if (!block.trim()) continue;
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7).trim();
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      let parsed: any = data;
      try { parsed = JSON.parse(data); } catch {}

      if (event === 'log') {
        // First log event from server contains the full historical output.
        // Subsequent events are incremental lines.
        if (printedOutputLen === 0 && typeof parsed === 'string' && parsed.includes('\n')) {
          process.stdout.write(parsed);
          if (!parsed.endsWith('\n')) process.stdout.write('\n');
          printedOutputLen = parsed.length;
        } else {
          process.stdout.write(parsed + '\n');
        }
      } else if (event === 'status') {
        let payload = parsed;
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch {}
        }
        lastStatus = payload?.status || null;
        const dur = payload?.duration || '-';
        console.log(chalk.gray(`\n[Kite Logs] Deployment finished: `) + statusColor(lastStatus) + chalk.gray(`  duration=${dur}`));
        try { reader.cancel(); } catch {}
        break;
      }
    }
    if (lastStatus) break;
  }

  return STATUS_EXIT[lastStatus || ''] ?? 0;
}

export interface RollbackOptions {
  server?: string;
  token?: string;
  env?: string;
  to?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runRollback(projectIdArg: string | undefined, opts: RollbackOptions): Promise<number> {
  const auth = resolveOpsAuth({ ...opts, requireAdmin: true });
  const base = auth.serverUrl.replace(/\/$/, '');

  let projectId = projectIdArg;
  if (!projectId) {
    const all = listProjectEnvs();
    const resolved = opts.env ? resolveProjectConfig(opts.env) : (all.length === 1 ? all[0] : null);
    if (resolved?.config?.projectId) projectId = resolved.config.projectId as string;
  }
  if (!projectId) throw new Error('projectId required for rollback.');

  let targetDeployId = opts.to;
  if (!targetDeployId) {
    const logsRes = await fetch(`${base}/api/logs`, { headers: { Authorization: `Bearer ${auth.token}` } });
    const logs: DeploymentRow[] = await expectOk(logsRes, 'GET /api/logs');
    const candidates = logs
      .filter((l) => l.projectId === projectId && l.status === 'success' && !!l.artifactPath && l.triggerSource !== 'rollback')
      .sort((a, b) => (b.startTime || '').localeCompare(a.startTime || ''));
    if (candidates.length === 0) {
      throw new Error('No successful deployment with archived artifact found. Pass --to <deployId> explicitly.');
    }
    targetDeployId = candidates[0].id;
    console.log(chalk.gray(`Selected latest success deploy: ${targetDeployId.slice(0, 12)}  (${candidates[0].startTime.slice(0, 19).replace('T', ' ')})`));
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY) {
      throw new Error('Refusing to rollback in non-TTY mode without --yes. Add --yes to confirm.');
    }
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(chalk.yellow(`About to rollback project ${projectId} to deploy ${targetDeployId.slice(0, 12)}. Proceed? [y/N] `));
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log(chalk.gray('Rollback cancelled.'));
      return 1;
    }
  }

  const traceId = randomUUID();
  const res = await fetch(`${base}/api/deployments/${targetDeployId}/rollback`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'X-Kite-Trace-Id': traceId,
    },
  });
  const body = await readJson(res);
  if (res.status === 401) throw new Error('Unauthorized: invalid token');
  if (res.status === 404) throw new Error(body?.error || 'Deployment or artifact not found');
  if (!res.ok || !body?.success) {
    throw new Error(body?.error || `Rollback failed: HTTP ${res.status}`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(body, null, 2) + '\n');
    return 0;
  }

  console.log(chalk.green(`Rollback succeeded.`));
  console.log(chalk.gray(`  new deployId : ${body.deployId}`));
  console.log(chalk.gray(`  rolled back  : ${body.rollbackOf}`));
  console.log(chalk.gray(`  duration     : ${body.duration}`));
  console.log(chalk.gray(`  traceId      : ${body.traceId}`));
  return 0;
}
