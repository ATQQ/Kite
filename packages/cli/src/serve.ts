import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { randomToken, readLocalEnv, writeLocalEnvValue, ensureKiteHome, getKiteHome } from './home.js';
import { getTelemetryStatus, reportServeStartup } from './telemetry.js';

const TELEMETRY_DOCS_URL = 'https://docs.kite.sugarat.top/guide/telemetry';

function printTelemetryBanner(): void {
  if (!getTelemetryStatus().enabled) return;
  console.log(chalk.gray(`  Telemetry: enabled (anonymous usage ping; docs: ${TELEMETRY_DOCS_URL})`));
  console.log(chalk.gray('  Disable via: kite telemetry:off'));
}

interface ServeOptions {
  host: string;
  port: number;
  runtime?: string;
  pm2?: boolean;
  pm2Action?: 'stop';
}

function getServerBundlePath(): string {
  // dist/server/index.js relative to this compiled file (dist/serve.js)
  const bundlePath = path.resolve(new URL('../dist/server/index.js', import.meta.url).pathname);
  return bundlePath;
}

function getWebDirPath(): string {
  return path.resolve(new URL('../dist/web', import.meta.url).pathname);
}

function detectRuntime(preferred?: string): { name: string; version: string } {
  const checkRuntime = (name: string): { name: string; version: string } | null => {
    const result = spawnSync(name, ['--version'], { stdio: 'pipe' });
    if (result.error) return null;
    const ver = result.stdout.toString().trim();
    return { name, version: name === 'bun' ? `v${ver}` : ver };
  };

  if (preferred) {
    const rt = checkRuntime(preferred);
    if (!rt) {
      console.error(chalk.red(`${preferred} is not installed.`));
      process.exit(1);
    }
    return rt;
  }

  // Default: try bun first, fallback to node
  return checkRuntime('bun') || checkRuntime('node') || (() => {
    console.error(chalk.red('Neither Bun nor Node.js is installed.'));
    console.error(chalk.gray('Install Bun from https://bun.sh or Node.js from https://nodejs.org'));
    process.exit(1);
  }) as never;
}

function isWeakAdminToken(token: string): { weak: boolean; reason?: string } {
  if (typeof token !== 'string') return { weak: true, reason: 'token 必须是字符串' };
  if (token.length < 24) return { weak: true, reason: '长度不足 24' };
  if (!/[A-Za-z]/.test(token) || !/[0-9]/.test(token)) return { weak: true, reason: '需同时包含字母和数字' };
  if (new Set(token).size < 8) return { weak: true, reason: '字符多样性不足（去重 < 8）' };
  return { weak: false };
}

function ensureAdminToken(): string {
  const localEnv = readLocalEnv();
  if (localEnv.KITE_DEPLOY_TOKEN) {
    // Use existing token from .env.local
    // But we need ADMIN_TOKEN specifically
  }

  // Check if ADMIN_TOKEN already exists in .env.local
  const envPath = path.join(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const match = content.match(/^ADMIN_TOKEN=(.+)$/m);
    if (match) {
      const existing = match[1].replace(/^['"]|['"]$/g, '');
      const check = isWeakAdminToken(existing);
      if (check.weak) {
        console.warn(chalk.yellow(`[warn] 当前 ADMIN_TOKEN 强度不足（${check.reason}），建议执行 kite rotate-token 或在 .env.local 中替换为长度 ≥ 24 且包含字母和数字、去重字符 ≥ 8 的随机字符串。`));
      }
      return existing;
    }
  }

  // Generate a new admin token
  const token = randomToken('admin');
  writeLocalEnvValue('ADMIN_TOKEN' as any, token);
  return token;
}

function buildServerEnv(options: ServeOptions, adminToken: string): Record<string, string> {
  const cliPkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url).pathname, 'utf-8'));

  return {
    ...process.env as Record<string, string>,
    PORT: String(options.port),
    HOST: options.host,
    ADMIN_TOKEN: adminToken,
    KITE_WEB_DIR: getWebDirPath(),
    KITE_DB_DIR: getKiteHome(),
    KITE_SERVER_VERSION: cliPkg.version || '1.0.0',
  };
}

function isLocalHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function warnRemoteHost(host: string): void {
  if (!isLocalHost(host)) {
    console.warn(chalk.yellow(`[warn] 当前监听 host=${host}，将对外网络暴露 Kite 管理端。请确保已在前置代理（Nginx/Caddy）配置 TLS 与限速，否则建议使用 --host 127.0.0.1。`));
  }
}

function startForeground(options: ServeOptions, env: Record<string, string>, runtime: { name: string; version: string }): void {
  const bundlePath = getServerBundlePath();

  if (!fs.existsSync(bundlePath)) {
    console.error(chalk.red(`Server bundle not found at ${bundlePath}`));
    console.error(chalk.gray('Run the build step first: bun run build'));
    process.exit(1);
  }

  console.log(chalk.green('Starting Kite Server...'));
  console.log(chalk.gray(`  Runtime: ${runtime.name} ${runtime.version}`));
  console.log(chalk.gray(`  Host: ${options.host}`));
  console.log(chalk.gray(`  Port: ${options.port}`));
  console.log(chalk.gray(`  Web Dir: ${env.KITE_WEB_DIR}`));
  console.log(chalk.gray(`  DB Dir: ${env.KITE_DB_DIR}`));
  console.log(chalk.yellow(`  Admin Token: ${env.ADMIN_TOKEN}`));
  printTelemetryBanner();
  console.log();
  warnRemoteHost(options.host);

  const args = runtime.name === 'bun' ? ['run', bundlePath] : [bundlePath];
  const child = spawn(runtime.name, args, {
    stdio: 'inherit',
    env,
    cwd: process.cwd(),
  });

  let shuttingDown = false;

  child.on('error', (err) => {
    console.error(chalk.red(`Failed to start server: ${err.message}`));
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      shuttingDown = true;
      if (signal) {
        console.log(chalk.gray(`\nServer stopped by signal ${signal}`));
      } else {
        console.log(chalk.gray(`\nServer exited with code ${code}`));
      }
    }
    process.exit(code ?? 0);
  });

  // Graceful shutdown on SIGINT/SIGTERM
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(chalk.gray(`\nReceived ${signal}, shutting down server...`));
    child.kill('SIGTERM');

    // Force kill after 5s if child doesn't exit
    setTimeout(() => {
      console.log(chalk.yellow('Force killing server...'));
      child.kill('SIGKILL');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

function getPm2Dir(): string {
  const dir = path.join(getKiteHome(), 'pm2');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function startPm2(options: ServeOptions, env: Record<string, string>, runtime: { name: string; version: string }): void {
  const bundlePath = getServerBundlePath();

  if (!fs.existsSync(bundlePath)) {
    console.error(chalk.red(`Server bundle not found at ${bundlePath}`));
    console.error(chalk.gray('Run the build step first: bun run build'));
    process.exit(1);
  }

  // Check pm2 availability
  const pm2Check = spawnSync('pm2', ['--version'], { stdio: 'pipe' });
  if (pm2Check.error) {
    console.error(chalk.red('pm2 is not installed.'));
    console.error(chalk.gray('Install it with: npm install -g pm2'));
    console.error(chalk.gray('Or run without --pm2 for foreground mode.'));
    process.exit(1);
  }

  // Stop existing process if running
  spawnSync('pm2', ['delete', 'kite-server'], { stdio: 'pipe' });

  const pm2Dir = getPm2Dir();
  const configPath = path.join(pm2Dir, 'ecosystem.config.cjs');

  const pm2Args = runtime.name === 'bun' ? `run ${bundlePath}` : bundlePath;
  const config = `module.exports = {
  apps: [{
    name: 'kite-server',
    script: '${runtime.name}',
    args: '${pm2Args}',
    cwd: ${JSON.stringify(process.cwd())},
    env: ${JSON.stringify(env, null, 6)},
    max_restarts: 5,
    min_uptime: '10s',
    error_file: ${JSON.stringify(path.join(pm2Dir, 'error.log'))},
    out_file: ${JSON.stringify(path.join(pm2Dir, 'out.log'))},
    merge_logs: true,
  }]
};
`;

  fs.writeFileSync(configPath, config);

  const result = spawnSync('pm2', ['start', configPath], { stdio: 'inherit' });
  if (result.error) {
    console.error(chalk.red(`Failed to start pm2: ${result.error.message}`));
    process.exit(1);
  }

  console.log();
  console.log(chalk.green('Kite Server started with pm2!'));
  console.log(chalk.gray(`  Name: kite-server`));
  console.log(chalk.gray(`  Runtime: ${runtime.name} ${runtime.version}`));
  console.log(chalk.gray(`  Host: ${options.host}`));
  console.log(chalk.gray(`  Port: ${options.port}`));
  console.log(chalk.gray(`  Web Dir: ${env.KITE_WEB_DIR}`));
  console.log(chalk.gray(`  DB Dir: ${env.KITE_DB_DIR}`));
  console.log(chalk.yellow(`  Admin Token: ${env.ADMIN_TOKEN}`));
  printTelemetryBanner();
  console.log();
  console.log(chalk.gray('Commands:'));
  console.log(chalk.gray('  pm2 logs kite-server    # View logs'));
  console.log(chalk.gray('  pm2 status              # Check status'));
  console.log(chalk.gray('  kite serve --pm2 stop   # Stop server'));
  warnRemoteHost(options.host);
}

function stopPm2(): void {
  const result = spawnSync('pm2', ['delete', 'kite-server'], { stdio: 'inherit' });
  if (result.error) {
    console.error(chalk.red(`Failed to stop pm2: ${result.error.message}`));
    process.exit(1);
  }
  console.log(chalk.green('Kite Server stopped.'));
}

export async function startServe(options: ServeOptions): Promise<void> {
  // Handle pm2 stop
  if (options.pm2 && options.pm2Action === 'stop') {
    stopPm2();
    return;
  }

  const runtime = detectRuntime(options.runtime);

  const adminToken = ensureAdminToken();
  const env = buildServerEnv(options, adminToken);

  // Fire-and-forget anonymous telemetry (opt-in; no-op when disabled).
  // Field list governed by plan/2026-06-30-f27-telemetry.md §2.
  void reportServeStartup(env.KITE_SERVER_VERSION);

  if (options.pm2) {
    startPm2(options, env, runtime);
  } else {
    startForeground(options, env, runtime);
  }
}
