import cac from 'cac';
import path from 'path';
import fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { packProject } from './pack.js';
import { uploadZip } from './upload.js';
import { getKiteHome, readGlobalConfig, readLocalEnv, setGlobalConfig, writeLocalEnvValue } from './home.js';
import { startLocalServer } from './local-server.js';

// @ts-ignore
const cli = cac('kite');

// ==========================
// Config commands
// ==========================
cli.command('config set <key> <value>', 'Set global configuration')
  .action((key: string, value: string) => {
    setGlobalConfig(key as 'serverUrl' | 'token', value);
    console.log(chalk.green(`Set ${key} = ${value}`));
  });

cli.command('config get <key>', 'Get global configuration')
  .action((key: string) => {
    const config = readGlobalConfig() as Record<string, string | undefined>;
    console.log(config[key]);
  });

cli.command('config list', 'List all global configurations')
  .action(() => {
    console.log(readGlobalConfig());
  });

cli.command('home', 'Print Kite home directory')
  .action(() => {
    console.log(getKiteHome());
  });

const askTokenStore = async () => {
  if (!process.stdin.isTTY) return 'none';

  const rl = readline.createInterface({ input, output });
  const answer = await rl.question('Save deploy token to global config or current .env.local? (global/local/none) ');
  rl.close();
  const normalized = answer.trim().toLowerCase();
  if (normalized === 'global' || normalized === 'local') return normalized;
  return 'none';
};

// ==========================
// Init command
// ==========================
cli.command('init', 'Create kite.config.json without writing token into source config')
  .option('--project <projectId>', 'Project ID')
  .option('--out <dir>', 'Output directory', { default: './dist' })
  .option('--files <patterns>', 'Comma separated upload file patterns', { default: '**/*' })
  .option('--server <server>', 'Server URL to save globally')
  .option('--token <token>', 'Deploy token to save globally or in .env.local')
  .option('--token-store <target>', 'Where to save token: global, local, none')
  .option('--pre <script>', 'Pre-deploy script')
  .option('--post <script>', 'Post-deploy script')
  .option('--command <script>', 'Deploy command alias, same as --post')
  .action(async (options: any) => {
    const projectId = options.project;
    if (!projectId) {
      console.error(chalk.red('Error: --project is required.'));
      process.exit(1);
    }

    const configPath = path.resolve(process.cwd(), 'kite.config.json');
    const projectConfig: Record<string, unknown> = {
      projectId,
      outputDir: options.out || './dist',
      files: String(options.files || '**/*').split(',').map(item => item.trim()).filter(Boolean)
    };

    if (options.pre) projectConfig.preDeploy = options.pre;
    if (options.command || options.post) projectConfig.postDeploy = options.command || options.post;

    fs.writeFileSync(configPath, `${JSON.stringify(projectConfig, null, 2)}\n`);
    console.log(chalk.green(`Created ${configPath}`));
    console.log(chalk.gray('Deploy token is intentionally not written to kite.config.json.'));

    if (options.server) {
      setGlobalConfig('serverUrl', options.server);
      console.log(chalk.green(`Saved serverUrl to ${getKiteHome()}/config.json`));
    }

    if (options.token) {
      const tokenStore = options.tokenStore || await askTokenStore();
      if (tokenStore === 'global') {
        setGlobalConfig('token', options.token);
        console.log(chalk.green(`Saved token to ${getKiteHome()}/config.json`));
      } else if (tokenStore === 'local') {
        writeLocalEnvValue('KITE_DEPLOY_TOKEN', options.token);
        console.log(chalk.green('Saved token to .env.local'));
      } else {
        console.log(chalk.yellow('Token was not saved. Pass --token on push, or save it with `kite config set token <token>`.'));
      }
    }
  });

// ==========================
// Local server command
// ==========================
cli.command('serve', 'Start bundled Kite Server and Web console')
  .option('--host <host>', 'Host to listen on', { default: '127.0.0.1' })
  .option('--port <port>', 'Port to listen on', { default: 3000 })
  .option('--runtime <runtime>', 'Runtime label: auto, node, bun', { default: 'auto' })
  .action(async (options: any) => {
    try {
      await startLocalServer({
        host: options.host,
        port: Number(options.port),
        runtime: options.runtime
      });
    } catch (error: any) {
      console.error(chalk.red(`Failed to start Kite: ${error.message}`));
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
  .option('--out <dir>', 'Output directory to pack')
  .option('--pre <script>', 'Pre-deploy script (Server side)')
  .option('--post <script>', 'Post-deploy script (Server side)')
  .option('--command <script>', 'Deploy command alias, same as --post')
  .action(async (options: any) => {
    try {
      // 1. 读取全局配置、本地密钥与项目配置
      const config = options.token && options.server ? null : readGlobalConfig();
      const localEnv = readLocalEnv();

      const configPath = path.resolve(process.cwd(), 'kite.config.json');
      let projectConfig: any = {};
      if (fs.existsSync(configPath)) {
        projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }

      const token = options.token || localEnv.KITE_DEPLOY_TOKEN || localEnv.KITE_TOKEN || config?.token;
      const serverUrl = options.server || localEnv.KITE_SERVER_URL || config?.serverUrl;
      
      if (!token || !serverUrl) {
        console.error(chalk.red('Missing token or serverUrl. Use CLI options, .env.local, or `kite config set`.'));
        process.exit(1);
      }

      // 2. 合并部署配置：CLI > .env.local / kite.config.json > 服务端项目配置
      const projectId = options.project || localEnv.KITE_PROJECT_ID || projectConfig.projectId;
      if (!projectId) {
        console.error(chalk.red('Error: projectId is required. Pass --project or set projectId in kite.config.json.'));
        process.exit(1);
      }

      const outputDir = options.out || localEnv.KITE_OUTPUT_DIR || projectConfig.outputDir || './';
      const files = projectConfig.files || []; // 获取配置的要上传的文件/目录列表
      const preDeploy = options.pre || localEnv.KITE_PRE_DEPLOY || projectConfig.preDeploy;
      const postDeploy = options.command || options.post || localEnv.KITE_DEPLOY_COMMAND || localEnv.KITE_POST_DEPLOY || projectConfig.command || projectConfig.postDeploy;

      const sourceDir = path.resolve(process.cwd(), outputDir);
      if (!fs.existsSync(sourceDir)) {
        console.error(chalk.red(`Error: Output directory not found: ${sourceDir}`));
        process.exit(1);
      }

      // 4. 打包文件
      const spinner = ora('Packing files...').start();
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');
      
      await packProject(sourceDir, zipFilePath, files.length > 0 ? files : undefined);
      spinner.succeed(chalk.green(`Packed successfully: ${zipFilePath}`));

      // 5. 上传与部署
      spinner.start(`Uploading to ${serverUrl}...`);
      await uploadZip({
        serverUrl: serverUrl as string,
        token: token as string,
        zipFilePath,
        projectId,
        preDeploy,
        postDeploy
      });
      spinner.succeed(chalk.green('Deployed successfully!'));

    } catch (error: any) {
      console.error(chalk.red(`\nDeployment failed: ${error.message}`));
      process.exit(1);
    } finally {
      // 6. 清理临时文件
      const zipFilePath = path.resolve(process.cwd(), '.deploy-archive.zip');
      if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
      }
    }
  });

cli.help();
cli.version('1.0.0');
cli.parse();
