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
  console.log('config', config);
  console.log('value', value);
  
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
