import cac from 'cac';
import path from 'path';
import fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { packProject, type PackResult } from './pack.js';
import { uploadZip } from './upload.js';
import { getConfigPath, getKiteHome, randomToken, readGlobalConfig, readLocalEnv, setGlobalConfig, writeGlobalConfig, writeLocalEnvValue, listProjectEnvs, resolveProjectConfig, envTokenKey, type ResolvedProjectConfig } from './home.js';
import { LocalStore } from './local-store.js';
import { startServe } from './serve.js';
import { parseIgnoreOption } from './ignore.js';
import { runExport } from './export.js';
import { runImport } from './import.js';
import { runVerify } from './verify.js';
import { runDoctor } from './doctor.js';
import { runList, runStatus, runLogs, runRollback } from './ops.js';
import { getTelemetryStatus, setTelemetryEnabled, setTelemetryEndpoint, getDefaultTelemetryEndpoint, reportPushStart } from './telemetry.js';

// @ts-ignore
const cli = cac('kite');

const CLI_PKG_VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// ==========================
// Config commands
// ==========================
cli.command('config:set <key> <value>', 'Set global configuration')
  .option('--global', 'Set global fallback token instead of per-project token')
  .option('--env <name>', 'Environment name (selects kite.config.<name>.json)')
  .action((key: string, value: string, options: any) => {
    if (key === 'token' && !options.global) {
      const allEnvs = listProjectEnvs();
      let resolved: ResolvedProjectConfig | null = null;

      if (options.env) {
        resolved = resolveProjectConfig(options.env);
      } else if (allEnvs.length === 1) {
        resolved = allEnvs[0];
      } else if (allEnvs.length > 1) {
        // 多环境时，非 TTY 提示传 --env
        if (!process.stdin.isTTY) {
          console.error(chalk.red('Multiple kite.config*.json found. Pass --env to specify environment.'));
          process.exit(1);
        }
        // 同步场景不能用 async prompt，直接提示
        console.error(chalk.red('Multiple kite.config*.json found. Pass --env to specify environment.'));
        process.exit(1);
      }

      if (resolved && resolved.config.projectId) {
        const tokenKey = envTokenKey(resolved.config.projectId, resolved.env);
        const config = readGlobalConfig();
        config.projectToken = { ...config.projectToken, [tokenKey]: value };
        writeGlobalConfig(config);
        console.log(chalk.green(`Set token for ${tokenKey}`));
        return;
      }
      console.log(chalk.yellow('No kite.config*.json found, setting as global token.'));
    }

    // serverUrl: 优先写入项目配置
    if (key === 'serverUrl' && !options.global) {
      const allEnvs = listProjectEnvs();
      let resolved: ResolvedProjectConfig | null = null;

      if (options.env) {
        resolved = resolveProjectConfig(options.env);
      } else if (allEnvs.length === 1) {
        resolved = allEnvs[0];
      } else if (allEnvs.length > 1) {
        if (!process.stdin.isTTY) {
          console.error(chalk.red('Multiple kite.config*.json found. Pass --env to specify environment.'));
          process.exit(1);
        }
        console.error(chalk.red('Multiple kite.config*.json found. Pass --env to specify environment.'));
        process.exit(1);
      }

      if (resolved) {
        resolved.config.serverUrl = value;
        fs.writeFileSync(resolved.configPath, `${JSON.stringify(resolved.config, null, 2)}\n`);
        console.log(chalk.green(`Set serverUrl in ${resolved.configPath}`));
        return;
      }
      console.log(chalk.yellow('No kite.config*.json found, setting as global serverUrl.'));
    }

    setGlobalConfig(key as 'serverUrl' | 'token', value);
    console.log(chalk.green(`Set ${key} = ${value}`));
  });

cli.command('config:get <key>', 'Get global configuration')
  .option('--env <name>', 'Environment name (selects kite.config.<name>.json)')
  .action((key: string, options: any) => {
    const config = readGlobalConfig();
    if (key === 'token') {
      const allEnvs = listProjectEnvs();
      let resolved: ResolvedProjectConfig | null = null;

      if (options.env) {
        resolved = resolveProjectConfig(options.env);
      } else if (allEnvs.length === 1) {
        resolved = allEnvs[0];
      } else if (allEnvs.length > 1) {
        // 多环境非 TTY 时尝试 default
        resolved = resolveProjectConfig();
      }

      if (resolved && resolved.config.projectId) {
        const tokenKey = envTokenKey(resolved.config.projectId, resolved.env);
        const projectToken = config.projectToken?.[tokenKey]
          || (resolved.env ? config.projectToken?.[resolved.config.projectId] : undefined);
        if (projectToken) {
          console.log(projectToken);
          return;
        }
      }
    }
    console.log((config as Record<string, string | undefined>)[key]);
  });

cli.command('config:list', 'List all global configurations')
  .action(() => {
    const config = readGlobalConfig();
    console.log(config);
    if (config.projectToken && Object.keys(config.projectToken).length > 0) {
      console.log(chalk.gray('\nPer-project tokens:'));
      for (const [pid, tok] of Object.entries(config.projectToken)) {
        console.log(`  ${pid}: ${tok}`);
      }
    }
  });

cli.command('config', 'Show current effective configuration (merged from all sources)')
  .option('--env <name>', 'Environment name (selects kite.config.<name>.json)')
  .action((options: any) => {
    const globalConfig = readGlobalConfig();
    const localEnv = readLocalEnv();

    // 列出所有可用环境
    const allEnvs = listProjectEnvs();
    let resolved: ResolvedProjectConfig | null = null;
    if (options.env) {
      resolved = resolveProjectConfig(options.env);
    } else if (allEnvs.length === 1) {
      resolved = allEnvs[0];
    } else if (allEnvs.length > 1) {
      resolved = resolveProjectConfig(); // default
    }

    const projectConfig = resolved?.config || {};
    const envName = resolved?.env;
    const configPath = resolved?.configPath;

    const projectId = localEnv.KITE_PROJECT_ID || projectConfig.projectId;
    const tokenKey = projectId ? envTokenKey(projectId, envName) : '';
    const token = localEnv.KITE_DEPLOY_TOKEN || localEnv.KITE_TOKEN || globalConfig.projectToken?.[tokenKey] || (envName && projectId ? globalConfig.projectToken?.[projectId] : undefined) || globalConfig.token;
    const serverUrl = localEnv.KITE_SERVER_URL || projectConfig.serverUrl || globalConfig.serverUrl;
    const outputDir = localEnv.KITE_OUTPUT_DIR || projectConfig.outputDir || './';
    const preDeploy = localEnv.KITE_PRE_DEPLOY || projectConfig.preDeploy;
    const postDeploy = localEnv.KITE_DEPLOY_COMMAND || localEnv.KITE_POST_DEPLOY || projectConfig.command || projectConfig.postDeploy;

    console.log(chalk.bold('Effective config:'));
    if (allEnvs.length > 1) {
      console.log(`  env:         ${envName || chalk.gray('default')}`);
    }
    console.log(`  serverUrl:   ${serverUrl || chalk.gray('(not set)')}`);
    console.log(`  projectId:   ${projectId || chalk.gray('(not set)')}`);
    console.log(`  token:       ${token ? '****' + token.slice(-4) : chalk.gray('(not set)')}`);
    console.log(`  outputDir:   ${outputDir}`);
    console.log(`  preDeploy:   ${preDeploy || chalk.gray('(not set)')}`);
    console.log(`  postDeploy:  ${postDeploy || chalk.gray('(not set)')}`);

    if (projectConfig.files?.length) {
      console.log(`  files:       ${projectConfig.files.join(', ')}`);
    }
    if (projectConfig.env && Object.keys(projectConfig.env).length > 0) {
      const entries = Object.entries(projectConfig.env).map(([k, v]) => `${k}=${v}`).join(', ');
      console.log(`  env:         ${entries}`);
    }

    if (allEnvs.length > 1) {
      console.log(chalk.gray('\nAvailable environments:'));
      for (const e of allEnvs) {
        const label = e.env || 'default';
        const marker = e.env === envName ? chalk.green(' (current)') : '';
        console.log(chalk.gray(`  ${label}: ${e.configPath}`) + marker);
      }
    }

    console.log(chalk.gray(`\nSources:`));
    console.log(chalk.gray(`  global:  ${getConfigPath()}`));
    console.log(chalk.gray(`  project: ${configPath || '(not found)'}`));
    console.log(chalk.gray(`  env:     ${fs.existsSync(path.join(process.cwd(), '.env.local')) ? path.join(process.cwd(), '.env.local') : '(not found)'}`));
  });

cli.command('home', 'Print Kite home directory')
  .action(() => {
    console.log(getKiteHome());
  });

const askAdminToken = async () => {
  if (!process.stdin.isTTY) {
    return randomToken('admin');
  }

  const rl = readline.createInterface({ input, output });
  const mode = (await rl.question('Reset admin password with random token or manual input? (random/manual) ')).trim().toLowerCase();
  if (mode === 'manual') {
    const manualToken = (await rl.question('Enter new admin password/token: ')).trim();
    rl.close();
    if (!manualToken) {
      throw new Error('Admin password/token cannot be empty.');
    }
    return manualToken;
  }

  rl.close();
  return randomToken('admin');
};

const resetAdminPassword = async (options: any) => {
  try {
    const nextToken = options.password
      ? String(options.password)
      : options.random
        ? randomToken('admin')
        : await askAdminToken();

    if (!nextToken) {
      throw new Error('Admin password/token cannot be empty.');
    }

    const store = new LocalStore();
    store.updateAdminToken(nextToken);
    console.log(chalk.green('Admin password/token has been reset.'));
    console.log(chalk.gray(`Data home: ${store.home}`));
    console.log(chalk.yellow(`New admin password/token: ${nextToken}`));
    console.log(chalk.gray('Running `kite serve` instances read this file on each request, so restart is not required.'));
  } catch (error: any) {
    console.error(chalk.red(`Failed to reset admin password/token: ${error.message}`));
    process.exit(1);
  }
};

cli.command('admin <action>', 'Admin operations')
  .option('--random', 'Generate a random admin password/token')
  .option('--password <password>', 'Set admin password/token manually')
  .action(async (action: string, options: any) => {
    if (action !== 'reset-password') {
      console.error(chalk.red(`Unknown admin action: ${action}`));
      console.log('Available actions: reset-password');
      process.exit(1);
    }
    await resetAdminPassword(options);
  });

cli.command('reset-password', 'Reset Web admin password without restarting Kite server')
  .option('--random', 'Generate a random admin password/token')
  .option('--password <password>', 'Set admin password/token manually')
  .action(resetAdminPassword);

const askEnvironment = async (envs: ResolvedProjectConfig[]): Promise<string | undefined> => {
  if (!process.stdin.isTTY) {
    console.error(chalk.red('Multiple kite.config*.json files found. Pass --env to specify environment.'));
    process.exit(1);
  }

  let selected = 0;

  const render = () => {
    // Move cursor up to overwrite previous render
    if ((render as any)._rendered) {
      process.stdout.write(`\x1b[${(render as any)._rendered + 1}A`);
    }
    console.log(chalk.bold('Select environment:'));
    for (let i = 0; i < envs.length; i++) {
      const e = envs[i];
      const label = e.env || 'default';
      const indicator = i === selected ? chalk.cyan('❯ ') : '  ';
      const name = i === selected ? chalk.cyan.bold(label) : label;
      const file = chalk.gray(path.basename(e.configPath));
      console.log(`${indicator}${name}  ${file}`);
    }
    console.log(chalk.gray('  ↑↓ move  enter confirm'));
    (render as any)._rendered = envs.length + 1; // lines printed (header + items + footer)
  };

  return new Promise<string | undefined>((resolve) => {
    process.stdin.setRawMode!(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    render();

    const onData = (key: string) => {
      // Enter
      if (key === '\r' || key === '\n') {
        cleanup();
        console.log(); // newline after selection
        resolve(envs[selected].env);
        return;
      }
      // Ctrl-C
      if (key === '') {
        cleanup();
        process.exit(1);
      }
      // Up arrow or k
      if (key === '[A' || key === 'k') {
        selected = (selected - 1 + envs.length) % envs.length;
        render();
        return;
      }
      // Down arrow or j
      if (key === '[B' || key === 'j') {
        selected = (selected + 1) % envs.length;
        render();
        return;
      }
      // Number keys 1-9 for quick jump
      const num = parseInt(key, 10);
      if (num >= 1 && num <= envs.length) {
        selected = num - 1;
        render();
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode!(false);
      process.stdin.pause();
    };

    process.stdin.on('data', onData);
  });
};

const askTokenStore = async (): Promise<string> => {
  if (!process.stdin.isTTY) return 'none';

  const options = [
    { value: 'global' as const, label: 'Global config', desc: '~/.kite/config.json' },
    { value: 'local' as const, label: 'Local .env.local', desc: 'current project directory' },
    { value: 'none' as const, label: "Don't save", desc: 'save manually later' },
  ];

  let selected = 0;

  const render = () => {
    if ((render as any)._rendered) {
      process.stdout.write(`\x1b[${(render as any)._rendered + 1}A`);
    }
    console.log(chalk.bold('Save deploy token to:'));
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const indicator = i === selected ? chalk.cyan('❯ ') : '  ';
      const name = i === selected ? chalk.cyan.bold(o.label) : o.label;
      const desc = chalk.gray(o.desc);
      console.log(`${indicator}${name}  ${desc}`);
    }
    console.log(chalk.gray('  ↑↓ move  enter confirm'));
    (render as any)._rendered = options.length + 1;
  };

  return new Promise<string>((resolve) => {
    process.stdin.setRawMode!(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    render();

    const onData = (key: string) => {
      if (key === '\r' || key === '\n') {
        cleanup();
        console.log();
        resolve(options[selected].value);
        return;
      }
      if (key === '\x03') {
        cleanup();
        process.exit(1);
      }
      if (key === '\x1b[A' || key === 'k') {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }
      if (key === '\x1b[B' || key === 'j') {
        selected = (selected + 1) % options.length;
        render();
        return;
      }
      const num = parseInt(key, 10);
      if (num >= 1 && num <= options.length) {
        selected = num - 1;
        render();
        return;
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode!(false);
      process.stdin.pause();
    };

    process.stdin.on('data', onData);
  });
};

// ==========================
// Init command
// ==========================
cli.command('init', 'Create kite.config.json without writing token into source config')
  .option('--project <projectId>', 'Project ID')
  .option('--env <name>', 'Environment name (creates kite.config.<name>.json)')
  .option('--out <dir>', 'Output directory', { default: './dist' })
  .option('--files <patterns>', 'Comma separated upload file patterns', { default: '**/*' })
  .option('--server <server>', 'Server URL to save globally')
  .option('--token <token>', 'Deploy token to save globally or in .env.local')
  .option('--token-store <target>', 'Where to save token: global, local, none')
  .option('--pre <script>', 'Pre-deploy script')
  .option('--post <script>', 'Post-deploy script')
  .option('--command <script>', 'Deploy command alias, same as --post')
  .option('--set-env <vars>', 'Environment variables as JSON or KEY=VALUE')
  .action(async (options: any) => {
    const projectId = options.project;
    if (!projectId) {
      console.error(chalk.red('Error: --project is required.'));
      process.exit(1);
    }

    const env: string | undefined = options.env || undefined;
    const configFileName = env ? `kite.config.${env}.json` : 'kite.config.json';
    const configPath = path.resolve(process.cwd(), configFileName);
    const projectConfig: Record<string, unknown> = {
      projectId,
      outputDir: options.out || './dist',
      files: String(options.files || '**/*').split(',').map(item => item.trim()).filter(Boolean)
    };

    if (options.server) projectConfig.serverUrl = options.server;
    if (options.pre) projectConfig.preDeploy = options.pre;
    if (options.command || options.post) projectConfig.postDeploy = options.command || options.post;
    if (options.setEnv) {
      const envVars: Record<string, string> = {};
      const raw = options.setEnv as string;
      if (raw.trimStart().startsWith('{')) {
        Object.assign(envVars, JSON.parse(raw));
      } else {
        for (const pair of raw.split(',')) {
          const eq = pair.indexOf('=');
          if (eq > 0) envVars[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
        }
      }
      if (Object.keys(envVars).length > 0) projectConfig.env = envVars;
    }

    fs.writeFileSync(configPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
    console.log(chalk.green(`Created ${configPath}`));
    console.log(chalk.gray('Deploy token is intentionally not written to kite config file.'));

    if (options.token) {
      const tokenStore = options.tokenStore || await askTokenStore();
      const tokenKey = envTokenKey(projectId, env);
      if (tokenStore === 'global') {
        const config = readGlobalConfig();
        config.projectToken = { ...config.projectToken, [tokenKey]: options.token };
        writeGlobalConfig(config);
        console.log(chalk.green(`Saved token for ${tokenKey} to ${getKiteHome()}/config.json`));
      } else if (tokenStore === 'local') {
        writeLocalEnvValue('KITE_DEPLOY_TOKEN', options.token);
        console.log(chalk.green('Saved token to .env.local'));
      } else {
        console.log(chalk.yellow('Token was not saved. Pass --token on push, or save it with `kite config:set token <token>`.'));
      }
    }
  });

// ==========================
// Local server command
// ==========================
cli.command('serve', 'Start Kite Server and Web console')
  .option('--host <host>', 'Host to listen on', { default: '127.0.0.1' })
  .option('--port <port>', 'Port to listen on', { default: 5431 })
  .option('--runtime <runtime>', 'Runtime to use: bun or node (default: auto, prefer bun)')
  .option('--pm2 [action]', 'Daemonize with pm2 (pass "stop" to stop)')
  .option('--base <path>', 'URL path prefix for web + api + ws (e.g. --base kite → served at /kite/)')
  .action(async (options: any) => {
    try {
      const pm2Action = typeof options.pm2 === 'string' ? options.pm2 : undefined;
      await startServe({
        host: options.host,
        port: Number(options.port),
        runtime: options.runtime,
        pm2: !!options.pm2,
        pm2Action: pm2Action as 'stop' | undefined,
        base: options.base,
      });
    } catch (error: any) {
      console.error(chalk.red(`Failed to start Kite: ${error.message}`));
      process.exit(1);
    }
  });

// ==========================
// Pack result display helper
// ==========================
const displayPackResult = (result: PackResult) => {
  const sizeKB = (result.size / 1024).toFixed(1);
  const sizeMB = (result.size / (1024 * 1024)).toFixed(2);
  const sizeStr = result.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
  console.log(chalk.gray(`  Archive size: ${sizeStr} (${result.fileCount} files)`));
  console.log(chalk.gray('  Included:'));
  for (const entry of result.entries) {
    const isDir = entry.endsWith('/');
    console.log(chalk.gray(`    ${isDir ? chalk.blue(entry) : entry}`));
  }
};

// ==========================
// Build command
// ==========================
cli.command('build', 'Pack project files and verify packaging (no upload)')
  .option('--env <name>', 'Environment name (selects kite.config.<name>.json)')
  .option('--out <dir>', 'Output directory to pack')
  .option('--ignore <patterns>', 'Extra ignore patterns (comma separated, may repeat)')
  .option('--no-ignore-builtin', 'Disable built-in ignore patterns (node_modules, .git, .env*, etc.)')
  .action(async (options: any) => {
    try {
      const allEnvs = listProjectEnvs();
      if (allEnvs.length === 0) {
        console.error(chalk.red('No kite.config*.json found. Run `kite init` first.'));
        process.exit(1);
      }

      let resolved: ResolvedProjectConfig;
      if (options.env) {
        const found = resolveProjectConfig(options.env);
        if (!found) {
          console.error(chalk.red(`kite.config.${options.env}.json not found.`));
          process.exit(1);
        }
        resolved = found;
      } else if (allEnvs.length === 1) {
        resolved = allEnvs[0];
      } else {
        const selectedEnv = await askEnvironment(allEnvs);
        resolved = allEnvs.find(e => e.env === selectedEnv)!;
      }

      const projectConfig = resolved.config;
      const outputDir = options.out || projectConfig.outputDir || './';
      const files = projectConfig.files || [];
      const sourceDir = path.resolve(process.cwd(), outputDir);

      if (!fs.existsSync(sourceDir)) {
        console.error(chalk.red(`Error: Output directory not found: ${sourceDir}`));
        process.exit(1);
      }

      const cliIgnore = parseIgnoreOption(options.ignore);
      const ignore = cliIgnore.length > 0
        ? cliIgnore
        : (Array.isArray(projectConfig.ignore) ? projectConfig.ignore : []);
      // cac: --no-ignore-builtin 时 options.ignoreBuiltin === false；未传时 true
      const ignoreBuiltin = options.ignoreBuiltin === false
        ? true
        : (projectConfig.ignoreBuiltin === true);

      const spinner = ora('Packing files...').start();
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');

      const result = await packProject(sourceDir, zipFilePath, {
        files: files.length > 0 ? files : undefined,
        ignore,
        ignoreBuiltin,
      });
      spinner.succeed(chalk.green('Pack successful!'));
      displayPackResult(result);
      console.log(chalk.gray(`  Archive: ${zipFilePath}`));
    } catch (error: any) {
      console.error(chalk.red(`\nBuild failed: ${error.message}`));
      process.exit(1);
    }
  });

// ==========================
// Push command
// ==========================
cli.command('push', 'Push and deploy project')
  .option('--token <token>', 'Deployment token')
  .option('--server <server>', 'Server URL')
  .option('--project <projectId>', 'Project ID')
  .option('--env <name>', 'Environment name (selects kite.config.<name>.json)')
  .option('--out <dir>', 'Output directory to pack')
  .option('--pre <script>', 'Pre-deploy script (Server side)')
  .option('--post <script>', 'Post-deploy script (Server side)')
  .option('--command <script>', 'Deploy command alias, same as --post')
  .option('--post-deploy-async', 'Run postDeploy asynchronously (do not wait for it to finish)')
  .option('--set-env <vars>', 'Environment variables as JSON or KEY=VALUE (overrides config)')
  .option('--ignore <patterns>', 'Extra ignore patterns (comma separated, may repeat)')
  .option('--no-ignore-builtin', 'Disable built-in ignore patterns (node_modules, .git, .env*, etc.)')
  .action(async (options: any) => {
    const pushStartedAt = new Date().toISOString();
    void reportPushStart(CLI_PKG_VERSION);
    try {
      // 1. 解析环境配置
      const allEnvs = listProjectEnvs();
      if (allEnvs.length === 0) {
        console.error(chalk.red('No kite.config*.json found. Run `kite init` first.'));
        process.exit(1);
      }

      let resolved: ResolvedProjectConfig;
      if (options.env) {
        const found = resolveProjectConfig(options.env);
        if (!found) {
          console.error(chalk.red(`kite.config.${options.env}.json not found.`));
          process.exit(1);
        }
        resolved = found;
      } else if (allEnvs.length === 1) {
        resolved = allEnvs[0];
      } else {
        const selectedEnv = await askEnvironment(allEnvs);
        resolved = allEnvs.find(e => e.env === selectedEnv)!;
      }

      const projectConfig = resolved.config;
      const envName = resolved.env;

      if (envName) {
        console.log(chalk.gray(`Environment: ${envName}`));
      }

      // 2. 读取全局配置与本地密钥
      const globalConfig = options.token && options.server ? null : readGlobalConfig();
      const localEnv = readLocalEnv();

      // 3. 解析 projectId（token 查找需要依赖它）
      const projectId = options.project || localEnv.KITE_PROJECT_ID || projectConfig.projectId;
      if (!projectId) {
        console.error(chalk.red('Error: projectId is required. Pass --project or set projectId in kite config.'));
        process.exit(1);
      }

      // 4. 解析 token：env-specific key 优先，再 fallback 到 default key
      const tokenKey = envTokenKey(projectId, envName);
      const token = options.token
        || localEnv.KITE_DEPLOY_TOKEN
        || localEnv.KITE_TOKEN
        || globalConfig?.projectToken?.[tokenKey]
        || (envName ? globalConfig?.projectToken?.[projectId] : undefined)
        || globalConfig?.token;
      const serverUrl = options.server || localEnv.KITE_SERVER_URL || projectConfig.serverUrl || globalConfig?.serverUrl;

      if (!token && !serverUrl) {
        console.error(chalk.red('Missing token and serverUrl. Run `kite config:set serverUrl <url>` and `kite config:set token <token>`.'));
        process.exit(1);
      }
      if (!serverUrl) {
        console.error(chalk.red('Missing serverUrl. Run `kite config:set serverUrl <url>`.'));
        process.exit(1);
      }
      if (!token) {
        console.error(chalk.red(`Missing token for "${tokenKey}". Run \`kite config:set token <token>\` or pass --token.`));
        process.exit(1);
      }

      const outputDir = options.out || localEnv.KITE_OUTPUT_DIR || projectConfig.outputDir || './';
      const files = projectConfig.files || [];
      const preDeploy = options.pre || localEnv.KITE_PRE_DEPLOY || projectConfig.preDeploy;
      const postDeploy = options.command || options.post || localEnv.KITE_DEPLOY_COMMAND || localEnv.KITE_POST_DEPLOY || projectConfig.command || projectConfig.postDeploy;
      // postDeployAsync: CLI flag > env > project config（undefined = 不覆盖项目设置）
      let postDeployAsync: boolean | undefined;
      if (options.postDeployAsync === true) postDeployAsync = true;
      else if (localEnv.KITE_POST_DEPLOY_ASYNC === 'true' || localEnv.KITE_POST_DEPLOY_ASYNC === '1') postDeployAsync = true;
      else if (localEnv.KITE_POST_DEPLOY_ASYNC === 'false' || localEnv.KITE_POST_DEPLOY_ASYNC === '0') postDeployAsync = false;
      else if (typeof projectConfig.postDeployAsync === 'boolean') postDeployAsync = projectConfig.postDeployAsync;

      // 解析 env: 项目配置 + CLI --set-env 覆盖
      let deployEnv: Record<string, string> | undefined = projectConfig.env || undefined;
      if (options.setEnv) {
        const cliEnv: Record<string, string> = {};
        const raw = options.setEnv as string;
        if (raw.trimStart().startsWith('{')) {
          Object.assign(cliEnv, JSON.parse(raw));
        } else {
          for (const pair of raw.split(',')) {
            const eq = pair.indexOf('=');
            if (eq > 0) cliEnv[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
          }
        }
        deployEnv = { ...deployEnv, ...cliEnv };
      }

      const sourceDir = path.resolve(process.cwd(), outputDir);
      if (!fs.existsSync(sourceDir)) {
        console.error(chalk.red(`Error: Output directory not found: ${sourceDir}`));
        process.exit(1);
      }

      // 5. 打包文件
      const cliIgnore = parseIgnoreOption(options.ignore);
      const ignore = cliIgnore.length > 0
        ? cliIgnore
        : (Array.isArray(projectConfig.ignore) ? projectConfig.ignore : []);
      // cac: --no-ignore-builtin 时 options.ignoreBuiltin === false；未传时 true
      const ignoreBuiltin = options.ignoreBuiltin === false
        ? true
        : (projectConfig.ignoreBuiltin === true);

      const spinner = ora('Packing files...').start();
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');

      const packResult = await packProject(sourceDir, zipFilePath, {
        files: files.length > 0 ? files : undefined,
        ignore,
        ignoreBuiltin,
      });
      spinner.succeed(chalk.green('Packed successfully'));
      displayPackResult(packResult);

      // 6. 上传与部署
      spinner.start(`Uploading to ${serverUrl}...`);
      spinner.stop();
      const result = await uploadZip({
        serverUrl: serverUrl as string,
        token: token as string,
        zipFilePath,
        projectId,
        preDeploy,
        postDeploy,
        postDeployAsync,
        env: deployEnv,
        startedAt: pushStartedAt
      });
      if (result.success) {
        console.log(chalk.green(`\nDeployed successfully! (${result.duration})`));
        if (result.traceId) {
          console.log(chalk.gray(`  trace: ${result.traceId}`));
        }
      } else {
        console.error(chalk.red('\nDeployment failed'));
        if (result.traceId) {
          console.error(chalk.gray(`  trace: ${result.traceId}`));
        }
        process.exit(1);
      }

    } catch (error: any) {
      console.error(chalk.red(`\nDeployment failed: ${error.message}`));
      process.exit(1);
    } finally {
      // 7. 清理临时文件
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');
      if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
      }
    }
  });

// ==========================
// Pack command: validate packaging without deployment
// ==========================
cli.command('pack', 'Pack project and show included files (does not deploy)')
  .option('--out <dir>', 'Output directory to pack')
  .option('--ignore <patterns>', 'Extra ignore patterns (comma separated, may repeat)')
  .option('--no-ignore-builtin', 'Disable built-in ignore patterns (node_modules, .git, .env*, etc.)')
  .option('--env <name>', 'Environment name (selects kite.config.<name>.json)')
  .action(async (options: any) => {
    try {
      const allEnvs = listProjectEnvs();
      if (allEnvs.length === 0) {
        console.error(chalk.red('No kite.config*.json found. Run `kite init` first.'));
        process.exit(1);
      }

      let resolved: ResolvedProjectConfig;
      if (options.env) {
        const found = resolveProjectConfig(options.env);
        if (!found) {
          console.error(chalk.red(`kite.config.${options.env}.json not found.`));
          process.exit(1);
        }
        resolved = found;
      } else if (allEnvs.length === 1) {
        resolved = allEnvs[0];
      } else {
        const selectedEnv = await askEnvironment(allEnvs);
        resolved = allEnvs.find(e => e.env === selectedEnv)!;
      }

      const projectConfig = resolved.config;
      const envName = resolved.env;

      if (envName) {
        console.log(chalk.gray(`Environment: ${envName}`));
      }

      const localEnv = readLocalEnv();
      const outputDir = options.out || localEnv.KITE_OUTPUT_DIR || projectConfig.outputDir || './';
      const files = projectConfig.files || [];

      const sourceDir = path.resolve(process.cwd(), outputDir);
      if (!fs.existsSync(sourceDir)) {
        console.error(chalk.red(`Error: Output directory not found: ${sourceDir}`));
        process.exit(1);
      }

      const cliIgnore = parseIgnoreOption(options.ignore);
      const ignore = cliIgnore.length > 0
        ? cliIgnore
        : (Array.isArray(projectConfig.ignore) ? projectConfig.ignore : []);
      const ignoreBuiltin = options.ignoreBuiltin === false
        ? true
        : (projectConfig.ignoreBuiltin === true);

      const spinner = ora('Packing files...').start();
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');

      const packResult = await packProject(sourceDir, zipFilePath, {
        files: files.length > 0 ? files : undefined,
        ignore,
        ignoreBuiltin,
      });
      spinner.succeed(chalk.green('Packed successfully'));
      displayPackResult(packResult);

      console.log(chalk.gray('\nNote: This is a dry-run for validation. Use `kite push` to deploy.'));

    } catch (error: any) {
      console.error(chalk.red(`\nPack failed: ${error.message}`));
      process.exit(1);
    } finally {
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');
      if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
      }
    }
  });

// ==========================
// Migration commands: export / import
// ==========================
cli.command('export', 'Export Kite database (and optional artifacts) to a portable archive')
  .option('--out <file>', 'Output file path (default: kite-export-<timestamp>.zip)')
  .option('--no-include-artifacts', 'Skip packing each project deployPath contents (default: include)')
  .option('--no-include-logs', 'Skip deployment history (default: include)')
  .option('--projects <ids>', 'Comma separated project ids to include (default: all)')
  .option('--ignore <patterns>', 'Extra ignore patterns for artifacts (comma separated, may repeat)')
  .option('--no-ignore-builtin', 'Disable built-in ignore patterns when packing artifacts')
  .action(async (options: any) => {
    try {
      const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
      const ignoreBuiltin = options.ignoreBuiltin === false;
      await runExport({
        out: options.out,
        includeArtifacts: options.includeArtifacts !== false,
        includeLogs: options.includeLogs !== false,
        projects: options.projects,
        ignore: options.ignore,
        ignoreBuiltin,
      }, pkg.version || '0.0.0');
    } catch (error: any) {
      console.error(chalk.red(`\nExport failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('import <file>', 'Import Kite database from an export archive')
  .option('--strategy <mode>', 'Conflict strategy: merge | overwrite | skip-existing', { default: 'skip-existing' })
  .option('--no-restore-artifacts', 'Skip restoring each project deployPath from the archive (default: restore when archive contains artifacts)')
  .option('--dry-run', 'Show summary without writing')
  .option('--yes', 'Confirm destructive --strategy overwrite')
  .action(async (file: string, options: any) => {
    try {
      await runImport(file, {
        strategy: options.strategy,
        restoreArtifacts: options.restoreArtifacts !== false,
        dryRun: !!options.dryRun,
        yes: !!options.yes,
      });
    } catch (error: any) {
      console.error(chalk.red(`\nImport failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('verify', 'Verify ~/.kite migration integrity (db, deploy paths, tokens, optional server health)')
  .option('--check-server', 'Also probe configured serverUrl with HTTP GET')
  .option('--timeout <ms>', 'Server probe timeout in ms', { default: 5000 })
  .action(async (options: any) => {
    try {
      await runVerify({
        checkServer: !!options.checkServer,
        timeout: Number(options.timeout) || 5000,
      });
    } catch (error: any) {
      console.error(chalk.red(`\nVerify failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('doctor', 'Run local + remote health diagnostics')
  .option('--server <url>', 'Override server URL (defaults to global config / KITE_SERVER_URL)')
  .option('--token <token>', 'Override admin token (defaults to global config / KITE_TOKEN)')
  .action(async (options: any) => {
    try {
      const code = await runDoctor({ server: options.server, token: options.token });
      process.exit(code);
    } catch (error: any) {
      console.error(chalk.red(`\nDoctor failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('list', 'List projects on Kite server')
  .option('--server <url>', 'Override server URL')
  .option('--token <token>', 'Override admin token')
  .option('--env <name>', 'Filter by project env')
  .option('--json', 'Output JSON (no colors)')
  .action(async (options: any) => {
    try {
      const code = await runList({ server: options.server, token: options.token, env: options.env, json: options.json });
      process.exit(code);
    } catch (error: any) {
      console.error(chalk.red(`\nList failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('status [projectId]', 'Show recent deployments of a project')
  .option('--server <url>', 'Override server URL')
  .option('--token <token>', 'Override admin token')
  .option('--env <name>', 'Pick kite.config.<env>.json when no projectId given')
  .option('--limit <n>', 'Number of deployments to show (default 5, max 50)')
  .option('--json', 'Output JSON')
  .action(async (projectId: string | undefined, options: any) => {
    try {
      const code = await runStatus(projectId, {
        server: options.server,
        token: options.token,
        env: options.env,
        limit: options.limit ? Number(options.limit) : undefined,
        json: options.json,
      });
      process.exit(code);
    } catch (error: any) {
      console.error(chalk.red(`\nStatus failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('logs <deployId>', 'Print deployment logs (or follow live with -f)')
  .option('--server <url>', 'Override server URL')
  .option('--token <token>', 'Override admin token')
  .option('-f, --follow', 'Stream live logs via SSE until the deployment finishes')
  .option('--json', 'Output JSON (only without --follow)')
  .action(async (deployId: string, options: any) => {
    try {
      const code = await runLogs(deployId, {
        server: options.server,
        token: options.token,
        follow: options.follow,
        json: options.json,
      });
      process.exit(code);
    } catch (error: any) {
      console.error(chalk.red(`\nLogs failed: ${error.message}`));
      process.exit(1);
    }
  });

cli.command('rollback [projectId]', 'Rollback a project to a previous successful deployment')
  .option('--server <url>', 'Override server URL')
  .option('--token <token>', 'Override admin token (admin required)')
  .option('--env <name>', 'Pick kite.config.<env>.json when no projectId given')
  .option('--to <deployId>', 'Target deployment to roll back to (default: previous success)')
  .option('--yes', 'Skip interactive confirmation (required in non-TTY)')
  .option('--json', 'Output JSON on success')
  .action(async (projectId: string | undefined, options: any) => {
    try {
      const code = await runRollback(projectId, {
        server: options.server,
        token: options.token,
        env: options.env,
        to: options.to,
        yes: options.yes,
        json: options.json,
      });
      process.exit(code);
    } catch (error: any) {
      console.error(chalk.red(`\nRollback failed: ${error.message}`));
      process.exit(1);
    }
  });

// ==========================
// Telemetry commands (opt-out, default on)
// Field list governed by plan/2026-06-30-f27-telemetry.md §2.
// ==========================
const TELEMETRY_DOCS = 'https://docs.kite.sugarat.top/guide/telemetry';

cli.command('telemetry:on', 'Enable anonymous usage ping')
  .action(() => {
    const { instanceId } = setTelemetryEnabled(true);
    console.log(chalk.green('Telemetry enabled.'));
    console.log(chalk.gray(`  Anonymous instance: ${instanceId.slice(0, 8)}…`));
    console.log(chalk.gray(`  Docs: ${TELEMETRY_DOCS}`));
    console.log(chalk.gray('  Disable anytime via: kite telemetry:off'));
  });

cli.command('telemetry:off', 'Disable anonymous usage ping')
  .action(() => {
    setTelemetryEnabled(false);
    console.log(chalk.green('Telemetry disabled.'));
    console.log(chalk.gray('  No further data will be sent.'));
    console.log(chalk.gray(`  Docs: ${TELEMETRY_DOCS}`));
  });

cli.command('telemetry:status', 'Show current telemetry switch and anonymous instance id')
  .action(() => {
    const status = getTelemetryStatus();
    console.log(chalk.gray(`  Status: ${status.enabled ? chalk.green('enabled') : chalk.yellow('disabled')}`));
    if (status.instanceId) {
      console.log(chalk.gray(`  Anonymous instance: ${status.instanceId.slice(0, 8)}…`));
    } else {
      console.log(chalk.gray('  Anonymous instance: (not generated yet)'));
    }
    console.log(chalk.gray(`  Endpoint: ${status.endpoint} (${status.endpointSource})`));
    console.log(chalk.gray(`  Docs: ${TELEMETRY_DOCS}`));
  });

cli.command('telemetry:endpoint <url>', 'Override telemetry ingest endpoint (use "default" to reset)')
  .action((url: string) => {
    const value = String(url || '').trim();
    if (!value) {
      console.log(chalk.red('Missing <url>. Example: kite telemetry:endpoint http://127.0.0.1:5430/api/telemetry'));
      process.exit(1);
    }
    if (value === 'default' || value === '--' || value === 'reset') {
      setTelemetryEndpoint(null);
      console.log(chalk.green('Telemetry endpoint reset to default:'));
      console.log(chalk.gray(`  ${getDefaultTelemetryEndpoint()}`));
      return;
    }
    if (!/^https?:\/\//i.test(value)) {
      console.log(chalk.red('Endpoint must start with http:// or https://'));
      process.exit(1);
    }
    setTelemetryEndpoint(value);
    console.log(chalk.green('Telemetry endpoint updated.'));
    console.log(chalk.gray(`  ${value}`));
    console.log(chalk.gray('  Tip: KITE_TELEMETRY_ENDPOINT env var overrides this config value at runtime.'));
  });

cli.help();
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'));
cli.version(pkg.version);
cli.parse();
