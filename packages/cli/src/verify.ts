import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { createClient } from '@libsql/client';
import { ensureKiteHome, getConfigPath, readGlobalConfig } from './home.js';

export interface VerifyOptions {
  checkServer?: boolean;
  timeout?: number;
}

interface CheckResult {
  ok: boolean;
  warnings: number;
  failures: number;
}

const tableExists = async (client: ReturnType<typeof createClient>, name: string): Promise<boolean> => {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  });
  return result.rows.length > 0;
};

export async function runVerify(options: VerifyOptions = {}): Promise<void> {
  const home = ensureKiteHome();
  const dbPath = path.join(home, 'kite.db');
  const configPath = getConfigPath();

  console.log(chalk.bold('Kite migration verify'));
  console.log(chalk.gray(`  home:   ${home}`));
  console.log(chalk.gray(`  db:     ${dbPath}`));
  console.log(chalk.gray(`  config: ${configPath}`));
  console.log();

  const result: CheckResult = { ok: true, warnings: 0, failures: 0 };

  if (!fs.existsSync(dbPath)) {
    console.log(chalk.red('✗ kite.db not found. Run `kite serve` once or `kite import <file>` first.'));
    process.exit(1);
  }
  if (!fs.existsSync(configPath)) {
    console.log(chalk.yellow(`! ${configPath} not found. CLI push commands will need explicit --token / --server.`));
    result.warnings++;
  }

  const globalConfig = fs.existsSync(configPath) ? readGlobalConfig() : { projectToken: {} as Record<string, string> };
  const projectToken = globalConfig.projectToken || {};
  const hasServerUrl = !!globalConfig.serverUrl;

  const client = createClient({ url: `file:${dbPath}` });

  try {
    if (!(await tableExists(client, 'projects'))) {
      console.log(chalk.red('✗ projects table missing in kite.db.'));
      process.exit(1);
    }

    const spinner = ora('Loading projects...').start();
    const projectsRows = (await client.execute(`SELECT id, name, deploy_path, token FROM projects`)).rows;
    const deploymentRows = (await tableExists(client, 'deployments'))
      ? (await client.execute(`SELECT id, project_id FROM deployments`)).rows
      : [];
    spinner.succeed(chalk.green(`Loaded ${projectsRows.length} projects, ${deploymentRows.length} deployment records`));

    console.log(chalk.bold('\nProject checks:'));

    for (const row of projectsRows) {
      const id = String(row.id);
      const name = String(row.name);
      const deployPath = String(row.deploy_path || '');
      const dbToken = row.token != null ? String(row.token) : '';
      const labelHead = `  • ${name} (${id})`;
      const subIssues: string[] = [];

      if (!deployPath) {
        subIssues.push(chalk.red('deploy_path is empty'));
        result.failures++;
      } else {
        const abs = path.isAbsolute(deployPath) ? deployPath : path.resolve(home, deployPath);
        if (!fs.existsSync(abs)) {
          subIssues.push(chalk.yellow(`deploy_path missing on disk: ${abs}`));
          result.warnings++;
        } else {
          const stat = fs.statSync(abs);
          if (!stat.isDirectory()) {
            subIssues.push(chalk.red(`deploy_path is not a directory: ${abs}`));
            result.failures++;
          }
        }
      }

      const cliToken = projectToken[id];
      if (!cliToken) {
        subIssues.push(chalk.yellow('no projectToken in ~/.kite/config.json (run `kite config:set token`)'));
        result.warnings++;
      } else if (dbToken && cliToken !== dbToken) {
        subIssues.push(chalk.yellow('projectToken differs from DB token (push will hit auth error)'));
        result.warnings++;
      }

      if (subIssues.length === 0) {
        console.log(`${labelHead} ${chalk.green('ok')}`);
      } else {
        console.log(`${labelHead} ${chalk.red(`${subIssues.length} issue(s)`)}`);
        for (const issue of subIssues) console.log(`      - ${issue}`);
      }
    }

    console.log(chalk.bold('\nGlobal config checks:'));
    if (!hasServerUrl) {
      console.log(`  ${chalk.yellow('! serverUrl is empty')} - run \`kite config:set serverUrl <url>\``);
      result.warnings++;
    } else {
      console.log(`  ${chalk.green('✓ serverUrl:')} ${globalConfig.serverUrl}`);
    }
    const tokenKeys = Object.keys(projectToken);
    console.log(`  ${chalk.green('✓ projectToken:')} ${tokenKeys.length} keys`);

    console.log(chalk.bold('\nDeployment integrity:'));
    const projectIdSet = new Set(projectsRows.map(r => String(r.id)));
    let orphanCount = 0;
    for (const d of deploymentRows) {
      if (!projectIdSet.has(String(d.project_id))) orphanCount++;
    }
    if (orphanCount === 0) {
      console.log(`  ${chalk.green('✓ no orphan deployments')}`);
    } else {
      console.log(`  ${chalk.yellow(`! ${orphanCount} deployment rows reference missing project_id`)}`);
      result.warnings++;
    }

    if (options.checkServer) {
      console.log(chalk.bold('\nServer health check:'));
      if (!hasServerUrl) {
        console.log(`  ${chalk.yellow('! skip: serverUrl not configured')}`);
        result.warnings++;
      } else {
        const url = String(globalConfig.serverUrl).replace(/\/$/, '');
        const timeoutMs = Math.max(1000, options.timeout || 5000);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          const resp = await fetch(url, { signal: ctrl.signal });
          if (resp.status < 500) {
            console.log(`  ${chalk.green('✓')} ${url} -> ${resp.status}`);
          } else {
            console.log(`  ${chalk.yellow('!')} ${url} -> ${resp.status}`);
            result.warnings++;
          }
        } catch (err: any) {
          console.log(`  ${chalk.red('✗')} ${url} -> ${err.message}`);
          console.log(chalk.gray('     Tip: run `kite serve` on the target machine first.'));
          result.failures++;
        } finally {
          clearTimeout(timer);
        }
      }
    }

    console.log();
    if (result.failures > 0) {
      console.log(chalk.red(`Verify failed: ${result.failures} error(s), ${result.warnings} warning(s).`));
      process.exit(1);
    } else if (result.warnings > 0) {
      console.log(chalk.yellow(`Verify finished with ${result.warnings} warning(s).`));
    } else {
      console.log(chalk.green('Verify passed. Migration looks complete.'));
    }
  } finally {
    client.close();
  }
}
