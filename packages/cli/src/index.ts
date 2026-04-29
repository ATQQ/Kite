import cac from 'cac';
// @ts-ignore
import Conf from 'conf';
import path from 'path';
import fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';
import { packProject } from './pack.js';
import { uploadZip } from './upload.js';

// @ts-ignore
const cli = cac('kite');
const getConfig = () => new Conf({ projectName: 'kite-cli' });

// ==========================
// Config commands
// ==========================
cli.command('config set <key> <value>', 'Set global configuration')
  .action((key: string, value: string) => {
    const config = getConfig();
    config.set(key, value);
    console.log(chalk.green(`Set ${key} = ${value}`));
  });

cli.command('config get <key>', 'Get global configuration')
  .action((key: string) => {
    const config = getConfig();
    console.log(config.get(key));
  });

cli.command('config list', 'List all global configurations')
  .action(() => {
    const config = getConfig();
    console.log(config.store);
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
      // 1. 读取全局配置
      const config = options.token && options.server ? null : getConfig();
      const token = options.token || config?.get('token');
      const serverUrl = options.server || config?.get('serverUrl');
      
      if (!token || !serverUrl) {
        console.error(chalk.red('Missing token or serverUrl. Please set them via CLI options or config set.'));
        process.exit(1);
      }

      // 2. 读取项目配置
      const configPath = path.resolve(process.cwd(), 'kite.config.json');
      let projectConfig: any = {};
      if (fs.existsSync(configPath)) {
        projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }

      // 3. 合并配置优先级 (CLI > kite.config.json)
      const projectId = options.project || projectConfig.projectId;
      if (!projectId) {
        console.error(chalk.red('Error: projectId is required. Pass --project or set projectId in kite.config.json.'));
        process.exit(1);
      }

      const outputDir = options.out || projectConfig.outputDir || './';
      const files = projectConfig.files || []; // 获取配置的要上传的文件/目录列表
      const preDeploy = options.pre || projectConfig.preDeploy;
      const postDeploy = options.command || options.post || projectConfig.command || projectConfig.postDeploy;

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
