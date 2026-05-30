import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

export interface KiteGlobalConfig {
  serverUrl?: string;
  token?: string;
  projectToken?: Record<string, string>;
}

export interface KiteLocalEnv {
  KITE_SERVER_URL?: string;
  KITE_TOKEN?: string;
  KITE_DEPLOY_TOKEN?: string;
  KITE_PROJECT_ID?: string;
  KITE_OUTPUT_DIR?: string;
  KITE_PRE_DEPLOY?: string;
  KITE_POST_DEPLOY?: string;
  KITE_DEPLOY_COMMAND?: string;
}

export function getKiteHome() {
  return process.env.KITE_HOME || path.join(os.homedir(), '.kite');
}

export function ensureKiteHome() {
  const home = getKiteHome();
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(home, 'deployments'), { recursive: true });
  fs.mkdirSync(path.join(home, 'tmp'), { recursive: true });
  return home;
}

export function getConfigPath() {
  return path.join(ensureKiteHome(), 'config.json');
}

export function readGlobalConfig(): KiteGlobalConfig {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

export function writeGlobalConfig(config: KiteGlobalConfig) {
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
}

export function setGlobalConfig(key: 'serverUrl' | 'token', value: string) {
  const config = readGlobalConfig();
  config[key] = value;
  writeGlobalConfig(config);
}

export function randomToken(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function readLocalEnv(cwd = process.cwd()): KiteLocalEnv {
  const envPath = path.join(cwd, '.env.local');
  if (!fs.existsSync(envPath)) return {};

  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return env as KiteLocalEnv;
}

export interface ResolvedProjectConfig {
  env: string | undefined;        // undefined = default (kite.config.json)
  config: Record<string, any>;
  configPath: string;
}

/**
 * Scan cwd for kite.config*.json files.
 * Returns array sorted: default first, then alphabetical by env name.
 */
export function listProjectEnvs(cwd = process.cwd()): ResolvedProjectConfig[] {
  const files = fs.readdirSync(cwd).filter(f => /^kite\.config(\.[a-zA-Z0-9_-]+)?\.json$/.test(f));
  const results: ResolvedProjectConfig[] = [];
  for (const file of files.sort()) {
    const match = file.match(/^kite\.config(?:\.([a-zA-Z0-9_-]+))?\.json$/);
    if (!match) continue;
    const env = match[1]; // undefined for kite.config.json
    const configPath = path.join(cwd, file);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    results.push({ env, config, configPath });
  }
  // default (no env) first, then alphabetical
  return results.sort((a, b) => {
    if (!a.env && b.env) return -1;
    if (a.env && !b.env) return 1;
    return (a.env || '').localeCompare(b.env || '');
  });
}

/**
 * Resolve a single project config by env name.
 * If env is undefined, returns the default config (kite.config.json).
 */
export function resolveProjectConfig(env?: string, cwd = process.cwd()): ResolvedProjectConfig | null {
  const all = listProjectEnvs(cwd);
  if (all.length === 0) return null;
  if (env === undefined) {
    return all.find(e => e.env === undefined) || null;
  }
  return all.find(e => e.env === env) || null;
}

/**
 * Build the token lookup key for projectToken storage.
 * With env: "projectId:env", without env: "projectId"
 */
export function envTokenKey(projectId: string, env?: string): string {
  return env ? `${projectId}:${env}` : projectId;
}

export function writeLocalEnvValue(key: keyof KiteLocalEnv, value: string, cwd = process.cwd()) {
  const envPath = path.join(cwd, '.env.local');
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
    : [];
  let found = false;
  const nextLines = lines.map((line) => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  }).filter((line, index, arr) => line || index < arr.length - 1);

  if (!found) nextLines.push(`${key}=${value}`);
  fs.writeFileSync(envPath, `${nextLines.join('\n')}\n`);
}
