import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import ora from 'ora';
import chalk from 'chalk';
import { createClient } from '@libsql/client';
import { ensureKiteHome, readGlobalConfig, writeGlobalConfig } from './home.js';

const DEFAULT_LOCAL_SERVER_URL = 'http://127.0.0.1:5431';

export type ImportStrategy = 'merge' | 'overwrite' | 'skip-existing';

export interface ImportOptions {
  strategy?: ImportStrategy;
  restoreArtifacts?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

interface ImportManifest {
  schemaVersion: number;
  exportedAt: string;
  kiteVersion: string;
  includes: {
    settings: boolean;
    projects: boolean;
    deployments: boolean;
    artifacts: boolean;
  };
  projectIds: string[];
  artifacts: Array<{ projectId: string; deployPath: string; archive?: string; skipped?: string }>;
}

const SUPPORTED_SCHEMA = 1;

const PROJECT_COLUMNS = [
  'id', 'name', 'description', 'deploy_path', 'token',
  'pre_deploy_script', 'post_deploy_script', 'env', 'status',
  'created_at', 'updated_at',
];

const DEPLOYMENT_COLUMNS = [
  'id', 'project_id', 'project_name', 'status', 'trigger_source',
  'duration', 'output', 'start_time', 'end_time',
];

const CREATE_PROJECTS = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    deploy_path TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    pre_deploy_script TEXT,
    post_deploy_script TEXT,
    env TEXT,
    status TEXT DEFAULT 'idle',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const CREATE_SETTINGS = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

const CREATE_DEPLOYMENTS = `
  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    project_name TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    duration TEXT,
    output TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT
  );
`;

const ensureSchema = async (client: ReturnType<typeof createClient>) => {
  await client.execute(CREATE_PROJECTS);
  try { await client.execute(`ALTER TABLE projects ADD COLUMN env TEXT`); } catch { /* exists */ }
  await client.execute(CREATE_SETTINGS);
  await client.execute(CREATE_DEPLOYMENTS);
};

const readJsonEntry = (zip: AdmZip, name: string): any => {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  return JSON.parse(entry.getData().toString('utf-8'));
};

interface Counts {
  added: number;
  updated: number;
  skipped: number;
}

export async function runImport(file: string, options: ImportOptions): Promise<void> {
  const strategy: ImportStrategy = options.strategy || 'skip-existing';
  if (!['merge', 'overwrite', 'skip-existing'].includes(strategy)) {
    console.error(chalk.red(`Invalid strategy: ${strategy}. Use merge | overwrite | skip-existing.`));
    process.exit(1);
  }
  if (strategy === 'overwrite' && !options.yes && !options.dryRun) {
    console.error(chalk.red('Strategy "overwrite" requires --yes to confirm destructive replacement.'));
    process.exit(1);
  }

  const absFile = path.resolve(process.cwd(), file);
  if (!fs.existsSync(absFile)) {
    console.error(chalk.red(`Import file not found: ${absFile}`));
    process.exit(1);
  }

  const home = ensureKiteHome();
  const dbPath = path.join(home, 'kite.db');

  const spinner = ora('Reading import package...').start();
  const zip = new AdmZip(absFile);
  const manifest = readJsonEntry(zip, 'kite-export/manifest.json') as ImportManifest | null;
  if (!manifest) {
    spinner.fail();
    console.error(chalk.red('Invalid import package: kite-export/manifest.json not found.'));
    process.exit(1);
  }
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA) {
    spinner.fail();
    console.error(chalk.red(`Unsupported schemaVersion ${manifest.schemaVersion} (CLI supports ${SUPPORTED_SCHEMA}). Upgrade CLI and retry.`));
    process.exit(1);
  }
  spinner.succeed(chalk.green(`Loaded export package (exported ${manifest.exportedAt}, kite ${manifest.kiteVersion})`));

  const projects = (readJsonEntry(zip, 'kite-export/projects.json') as Record<string, unknown>[]) || [];
  const settings = (readJsonEntry(zip, 'kite-export/settings.json') as Record<string, unknown>[]) || [];
  const deployments = manifest.includes.deployments
    ? ((readJsonEntry(zip, 'kite-export/deployments.json') as Record<string, unknown>[]) || [])
    : [];

  const client = createClient({ url: `file:${dbPath}` });

  try {
    await ensureSchema(client);

    // 预扫现状用于摘要 + skip-existing 判断
    const existingProjectIds = new Set<string>();
    const existingTokens = new Set<string>();
    for (const row of (await client.execute(`SELECT id, token FROM projects`)).rows) {
      existingProjectIds.add(String(row.id));
      existingTokens.add(String(row.token));
    }
    const existingSettingKeys = new Set<string>();
    for (const row of (await client.execute(`SELECT key FROM settings`)).rows) {
      existingSettingKeys.add(String(row.key));
    }
    const existingDeploymentIds = new Set<string>();
    for (const row of (await client.execute(`SELECT id FROM deployments`)).rows) {
      existingDeploymentIds.add(String(row.id));
    }

    const projectCounts: Counts = { added: 0, updated: 0, skipped: 0 };
    const settingCounts: Counts = { added: 0, updated: 0, skipped: 0 };
    const deploymentCounts: Counts = { added: 0, updated: 0, skipped: 0 };

    const projectsToWrite: Record<string, unknown>[] = [];
    const settingsToWrite: Record<string, unknown>[] = [];
    const deploymentsToWrite: Record<string, unknown>[] = [];

    for (const p of projects) {
      const id = String(p.id);
      const token = String(p.token);
      const idExists = existingProjectIds.has(id);
      const tokenConflict = !idExists && existingTokens.has(token);
      if (idExists) {
        if (strategy === 'overwrite') {
          projectsToWrite.push(p);
          projectCounts.updated++;
        } else {
          projectCounts.skipped++;
        }
      } else if (tokenConflict) {
        // token unique constraint 会冲突，跳过避免报错
        projectCounts.skipped++;
      } else {
        projectsToWrite.push(p);
        projectCounts.added++;
      }
    }

    for (const s of settings) {
      const key = String(s.key);
      const exists = existingSettingKeys.has(key);
      if (exists) {
        if (strategy === 'overwrite') {
          settingsToWrite.push(s);
          settingCounts.updated++;
        } else {
          settingCounts.skipped++;
        }
      } else {
        settingsToWrite.push(s);
        settingCounts.added++;
      }
    }

    for (const d of deployments) {
      const id = String(d.id);
      const exists = existingDeploymentIds.has(id);
      if (exists) {
        if (strategy === 'overwrite') {
          deploymentsToWrite.push(d);
          deploymentCounts.updated++;
        } else {
          deploymentCounts.skipped++;
        }
      } else {
        deploymentsToWrite.push(d);
        deploymentCounts.added++;
      }
    }

    // 摘要
    console.log(chalk.bold('\nImport summary:'));
    console.log(`  Strategy:    ${strategy}`);
    console.log(`  DB path:     ${dbPath}`);
    console.log(`  Projects:    + ${projectCounts.added} new, ~ ${projectCounts.updated} update, - ${projectCounts.skipped} skip`);
    console.log(`  Settings:    + ${settingCounts.added} new, ~ ${settingCounts.updated} update, - ${settingCounts.skipped} skip`);
    if (manifest.includes.deployments) {
      console.log(`  Deployments: + ${deploymentCounts.added} new, ~ ${deploymentCounts.updated} update, - ${deploymentCounts.skipped} skip`);
    }
    if (manifest.includes.artifacts) {
      const restoreCount = options.restoreArtifacts ? manifest.artifacts.filter(a => a.archive).length : 0;
      console.log(`  Artifacts:   ${options.restoreArtifacts ? `restore ${restoreCount}` : 'available, not restored (pass --restore-artifacts)'}`);
    }
    console.log(`  Global cfg:  will write projectToken for ${projectsToWrite.length} projects to ~/.kite/config.json`);

    if (options.dryRun) {
      console.log(chalk.gray('\nDry-run complete. No changes written.'));
      return;
    }

    const writeSpinner = ora('Writing to database...').start();

    const placeholders = (cols: string[]) => cols.map(() => '?').join(', ');
    const upsertProject = (cols: string[]) =>
      `INSERT INTO projects (${cols.join(', ')}) VALUES (${placeholders(cols)}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`;
    const upsertSetting =
      `INSERT INTO settings (key, value) VALUES (?, ?) ` +
      `ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
    const upsertDeployment = (cols: string[]) =>
      `INSERT INTO deployments (${cols.join(', ')}) VALUES (${placeholders(cols)}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${cols.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`;

    const tx = await client.transaction('write');
    try {
      for (const p of projectsToWrite) {
        const args = PROJECT_COLUMNS.map(c => (p[c] ?? null) as any);
        await tx.execute({ sql: upsertProject(PROJECT_COLUMNS), args });
      }
      for (const s of settingsToWrite) {
        await tx.execute({ sql: upsertSetting, args: [String(s.key), String(s.value ?? '')] });
      }
      for (const d of deploymentsToWrite) {
        const args = DEPLOYMENT_COLUMNS.map(c => (d[c] ?? null) as any);
        await tx.execute({ sql: upsertDeployment(DEPLOYMENT_COLUMNS), args });
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      writeSpinner.fail();
      throw err;
    }

    writeSpinner.succeed(chalk.green('Database updated.'));

    // 写回 CLI 全局 config，方便目标机器直接 kite push
    try {
      const globalConfig = readGlobalConfig();
      const nextProjectToken: Record<string, string> = { ...(globalConfig.projectToken || {}) };
      let tokenAdded = 0;
      let tokenUpdated = 0;
      let tokenSkipped = 0;

      for (const p of projectsToWrite) {
        const projectId = String(p.id);
        const token = p.token != null ? String(p.token) : '';
        if (!projectId || !token) continue;
        const existing = nextProjectToken[projectId];
        if (existing === undefined) {
          nextProjectToken[projectId] = token;
          tokenAdded++;
        } else if (strategy === 'overwrite') {
          if (existing !== token) {
            nextProjectToken[projectId] = token;
            tokenUpdated++;
          }
        } else {
          tokenSkipped++;
        }
      }

      const serverUrlMissing = !globalConfig.serverUrl;
      const nextServerUrl = serverUrlMissing ? DEFAULT_LOCAL_SERVER_URL : globalConfig.serverUrl;

      writeGlobalConfig({
        ...globalConfig,
        serverUrl: nextServerUrl,
        projectToken: nextProjectToken,
      });

      console.log(chalk.green('Global config updated (~/.kite/config.json).'));
      console.log(chalk.gray(`  projectToken: + ${tokenAdded} new, ~ ${tokenUpdated} update, - ${tokenSkipped} skip`));
      if (serverUrlMissing) {
        console.log(chalk.gray(`  serverUrl:    set to ${DEFAULT_LOCAL_SERVER_URL} (override via \`kite config:set serverUrl <url>\`)`));
      }
    } catch (err: any) {
      console.log(chalk.yellow(`  ! Failed to update global config: ${err.message}`));
    }

    if (manifest.includes.artifacts && options.restoreArtifacts) {
      // 重新读取写入后 projects 表，获取最新 deploy_path（可能用户保留了已有项目的路径）
      const deployPathMap = new Map<string, string>();
      for (const row of (await client.execute(`SELECT id, deploy_path FROM projects`)).rows) {
        deployPathMap.set(String(row.id), String(row.deploy_path));
      }

      const artifactSpinner = ora('Restoring artifacts...').start();
      let okCount = 0;
      let warnCount = 0;
      for (const a of manifest.artifacts) {
        if (!a.archive) continue;
        const target = deployPathMap.get(a.projectId);
        if (!target) {
          console.log(chalk.yellow(`  ! ${a.projectId}: project not in DB, skip restore`));
          warnCount++;
          continue;
        }
        const entry = zip.getEntry(`kite-export/${a.archive}`);
        if (!entry) {
          console.log(chalk.yellow(`  ! ${a.projectId}: archive entry missing`));
          warnCount++;
          continue;
        }
        try {
          fs.mkdirSync(target, { recursive: true });
          const tmpZipPath = path.join(home, 'tmp', `restore-${a.projectId}-${Date.now()}.zip`);
          fs.mkdirSync(path.dirname(tmpZipPath), { recursive: true });
          fs.writeFileSync(tmpZipPath, entry.getData());
          const innerZip = new AdmZip(tmpZipPath);
          // 路径穿越校验
          for (const e of innerZip.getEntries()) {
            const dest = path.resolve(target, e.entryName);
            if (!dest.startsWith(path.resolve(target) + path.sep) && dest !== path.resolve(target)) {
              throw new Error(`Refusing to extract entry outside target: ${e.entryName}`);
            }
          }
          innerZip.extractAllTo(target, true);
          fs.unlinkSync(tmpZipPath);
          okCount++;
        } catch (err: any) {
          console.log(chalk.yellow(`  ! ${a.projectId}: restore failed - ${err.message}`));
          warnCount++;
        }
      }
      artifactSpinner.succeed(chalk.green(`Artifacts restored: ${okCount} ok, ${warnCount} warnings`));
    }

    console.log(chalk.green('\nImport completed.'));
    if (!manifest.includes.artifacts || !options.restoreArtifacts) {
      console.log(chalk.gray('Tip: start `kite serve` to verify projects in the dashboard.'));
    }
    console.log(chalk.gray('Tip: `kite push` from your project directory now uses the restored token automatically.'));
    console.log(chalk.gray('Tip: run `kite verify` to self-check migration integrity (db, deploy paths, tokens).'));
  } finally {
    client.close();
  }
}
