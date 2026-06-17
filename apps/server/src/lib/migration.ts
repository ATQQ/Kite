// MUST keep manifest schema in sync with packages/cli/src/export.ts / import.ts
// Both sides write/read the same kite-export/* zip layout with schemaVersion=1
// so that a zip produced by CLI is importable by the web UI and vice-versa.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import AdmZip from 'adm-zip';
import { createClient } from '@libsql/client';

const SCHEMA_VERSION = 1;

export interface MigrationProjectSummary {
  id: string;
  name: string;
  deployPath: string;
  deployPathExists: boolean;
  deploymentCount: number;
}

export interface ExportOptions {
  projectIds?: string[];
  includeArtifacts?: boolean;
  includeDeployments?: boolean;
  deploymentLimitPerProject?: number;
  kiteVersion?: string;
}

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  manifest: ExportManifest;
}

export type ImportStrategy = 'merge' | 'overwrite' | 'skip-existing';

export interface ImportOptions {
  strategy?: ImportStrategy;
  restoreArtifacts?: boolean;
}

interface CountBucket {
  inserted: number;
  updated: number;
  skipped: number;
}

interface ArtifactSummaryItem {
  projectId: string;
  status: 'ok' | 'skipped';
  message?: string;
}

export interface ImportSummary {
  manifest: { schemaVersion: number; exportedAt: string; kiteVersion: string };
  projects: CountBucket;
  settings: CountBucket;
  deployments: CountBucket;
  artifacts: { ok: number; warnings: number; items: ArtifactSummaryItem[] };
}

interface ExportManifest {
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

function resolveKiteHome(): string {
  return process.env.KITE_HOME || path.join(os.homedir(), '.kite');
}

function resolveDbPath(): string {
  return path.join(process.env.KITE_DB_DIR || process.cwd(), 'kite.db');
}

function ensureTmpDir(): string {
  const home = resolveKiteHome();
  const tmp = path.join(home, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  return tmp;
}

function tableExists(client: ReturnType<typeof createClient>, name: string): Promise<boolean> {
  return client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  }).then(r => r.rows.length > 0);
}

async function dumpAll(client: ReturnType<typeof createClient>, table: string): Promise<Record<string, unknown>[]> {
  if (!(await tableExists(client, table))) return [];
  const result = await client.execute(`SELECT * FROM ${table}`);
  return result.rows.map(row => ({ ...row }));
}

function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPath: string): void {
  const stat = fs.statSync(dirPath);
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const child = path.join(dirPath, entry.name);
    const childZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, child, childZipPath);
    } else if (entry.isFile()) {
      zip.addLocalFile(child, path.dirname(childZipPath), path.basename(childZipPath));
    }
  }
}

export async function listMigrationProjects(): Promise<MigrationProjectSummary[]> {
  const client = createClient({ url: `file:${resolveDbPath()}` });
  try {
    await ensureSchema(client);
    const projects = await dumpAll(client, 'projects');
    const deploymentsAgg = await client.execute(
      `SELECT project_id, COUNT(*) as c FROM deployments GROUP BY project_id`
    );
    const countMap = new Map<string, number>();
    for (const row of deploymentsAgg.rows) {
      countMap.set(String(row.project_id), Number(row.c) || 0);
    }
    return projects.map(p => {
      const deployPath = String(p.deploy_path || '');
      const id = String(p.id);
      let exists = false;
      try {
        exists = !!deployPath && fs.statSync(deployPath).isDirectory();
      } catch { exists = false; }
      return {
        id,
        name: String(p.name || ''),
        deployPath,
        deployPathExists: exists,
        deploymentCount: countMap.get(id) || 0,
      };
    });
  } finally {
    client.close();
  }
}

export async function buildExportArchive(options: ExportOptions): Promise<ExportResult> {
  const includeArtifacts = options.includeArtifacts !== false;
  const includeDeployments = options.includeDeployments !== false;
  const limit = Math.max(0, Math.floor(Number(options.deploymentLimitPerProject) || 0));
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const filename = `kite-export-${stamp}.zip`;

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Kite database not found at ${dbPath}. Start \`kite serve\` to initialize.`);
  }

  const client = createClient({ url: `file:${dbPath}` });
  try {
    await ensureSchema(client);

    const projectFilter = (options.projectIds || []).map(s => String(s).trim()).filter(Boolean);
    const allProjects = await dumpAll(client, 'projects');
    const projects = projectFilter.length > 0
      ? allProjects.filter(p => projectFilter.includes(String(p.id)))
      : allProjects;
    const settings = await dumpAll(client, 'settings');

    let deployments: Record<string, unknown>[] = [];
    if (includeDeployments) {
      if (limit > 0) {
        const collected: Record<string, unknown>[] = [];
        for (const project of projects) {
          const result = await client.execute({
            sql: `SELECT * FROM deployments WHERE project_id = ? ORDER BY start_time DESC LIMIT ?`,
            args: [String(project.id), limit],
          });
          for (const row of result.rows) collected.push({ ...row });
        }
        deployments = collected;
      } else {
        const all = await dumpAll(client, 'deployments');
        deployments = projectFilter.length > 0
          ? all.filter(d => projectFilter.includes(String(d.project_id)))
          : all;
      }
    }

    const manifest: ExportManifest = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      kiteVersion: options.kiteVersion || process.env.KITE_SERVER_VERSION || '0.0.0',
      includes: {
        settings: settings.length > 0,
        projects: projects.length > 0,
        deployments: includeDeployments,
        artifacts: includeArtifacts,
      },
      projectIds: projects.map(p => String(p.id)),
      artifacts: [],
    };

    const tmpRoot = ensureTmpDir();
    const tmpWork = path.join(tmpRoot, `web-export-${stamp}`);
    fs.mkdirSync(tmpWork, { recursive: true });

    try {
      const zip = new AdmZip();
      const root = 'kite-export';

      if (includeArtifacts) {
        const artifactsDir = path.join(tmpWork, 'artifacts');
        fs.mkdirSync(artifactsDir, { recursive: true });

        for (const project of projects) {
          const projectId = String(project.id);
          const deployPath = String(project.deploy_path || '');
          if (!deployPath || !fs.existsSync(deployPath)) {
            manifest.artifacts.push({ projectId, deployPath, skipped: 'deploy path not found' });
            continue;
          }
          try {
            const stat = fs.statSync(deployPath);
            if (!stat.isDirectory()) {
              manifest.artifacts.push({ projectId, deployPath, skipped: 'deploy path is not a directory' });
              continue;
            }
            const innerZip = new AdmZip();
            addDirectoryToZip(innerZip, deployPath, '');
            const archiveName = `${projectId}.zip`;
            const archivePath = path.join(artifactsDir, archiveName);
            innerZip.writeZip(archivePath);
            zip.addLocalFile(archivePath, `${root}/artifacts`, archiveName);
            manifest.artifacts.push({ projectId, deployPath, archive: `artifacts/${archiveName}` });
          } catch (err: any) {
            manifest.artifacts.push({ projectId, deployPath, skipped: `pack error: ${err.message}` });
          }
        }
      }

      zip.addFile(`${root}/manifest.json`, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf-8'));
      zip.addFile(`${root}/projects.json`, Buffer.from(`${JSON.stringify(projects, null, 2)}\n`, 'utf-8'));
      zip.addFile(`${root}/settings.json`, Buffer.from(`${JSON.stringify(settings, null, 2)}\n`, 'utf-8'));
      if (includeDeployments) {
        zip.addFile(`${root}/deployments.json`, Buffer.from(`${JSON.stringify(deployments, null, 2)}\n`, 'utf-8'));
      }

      const buffer = zip.toBuffer();
      return { buffer, filename, manifest };
    } finally {
      try { fs.rmSync(tmpWork, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  } finally {
    client.close();
  }
}

export async function applyImportArchive(zipBuffer: Buffer, options: ImportOptions): Promise<ImportSummary> {
  const strategy: ImportStrategy = options.strategy || 'skip-existing';
  if (!['merge', 'overwrite', 'skip-existing'].includes(strategy)) {
    throw new Error(`Invalid strategy: ${strategy}`);
  }

  const zip = new AdmZip(zipBuffer);
  const manifestEntry = zip.getEntry('kite-export/manifest.json');
  if (!manifestEntry) {
    throw new Error('Invalid import package: kite-export/manifest.json not found');
  }
  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as ExportManifest;
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion ${manifest.schemaVersion} (server supports ${SCHEMA_VERSION})`);
  }

  const readJson = (name: string): Record<string, unknown>[] => {
    const entry = zip.getEntry(`kite-export/${name}`);
    if (!entry) return [];
    return JSON.parse(entry.getData().toString('utf-8')) || [];
  };

  const projects = readJson('projects.json');
  const settings = readJson('settings.json');
  const deployments = manifest.includes.deployments ? readJson('deployments.json') : [];

  const dbPath = resolveDbPath();
  const client = createClient({ url: `file:${dbPath}` });

  try {
    await ensureSchema(client);

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

    const projectBucket: CountBucket = { inserted: 0, updated: 0, skipped: 0 };
    const settingBucket: CountBucket = { inserted: 0, updated: 0, skipped: 0 };
    const deploymentBucket: CountBucket = { inserted: 0, updated: 0, skipped: 0 };

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
          projectBucket.updated++;
        } else {
          projectBucket.skipped++;
        }
      } else if (tokenConflict) {
        projectBucket.skipped++;
      } else {
        projectsToWrite.push(p);
        projectBucket.inserted++;
      }
    }

    for (const s of settings) {
      const key = String(s.key);
      const exists = existingSettingKeys.has(key);
      if (exists) {
        if (strategy === 'overwrite') {
          settingsToWrite.push(s);
          settingBucket.updated++;
        } else {
          settingBucket.skipped++;
        }
      } else {
        settingsToWrite.push(s);
        settingBucket.inserted++;
      }
    }

    for (const d of deployments) {
      const id = String(d.id);
      const exists = existingDeploymentIds.has(id);
      if (exists) {
        if (strategy === 'overwrite') {
          deploymentsToWrite.push(d);
          deploymentBucket.updated++;
        } else {
          deploymentBucket.skipped++;
        }
      } else {
        deploymentsToWrite.push(d);
        deploymentBucket.inserted++;
      }
    }

    const placeholders = (cols: string[]) => cols.map(() => '?').join(', ');
    const upsertProject =
      `INSERT INTO projects (${PROJECT_COLUMNS.join(', ')}) VALUES (${placeholders(PROJECT_COLUMNS)}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${PROJECT_COLUMNS.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`;
    const upsertSetting =
      `INSERT INTO settings (key, value) VALUES (?, ?) ` +
      `ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
    const upsertDeployment =
      `INSERT INTO deployments (${DEPLOYMENT_COLUMNS.join(', ')}) VALUES (${placeholders(DEPLOYMENT_COLUMNS)}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${DEPLOYMENT_COLUMNS.filter(c => c !== 'id').map(c => `${c} = excluded.${c}`).join(', ')}`;

    const tx = await client.transaction('write');
    try {
      for (const p of projectsToWrite) {
        const args = PROJECT_COLUMNS.map(c => (p[c] ?? null) as any);
        await tx.execute({ sql: upsertProject, args });
      }
      for (const s of settingsToWrite) {
        await tx.execute({ sql: upsertSetting, args: [String(s.key), String(s.value ?? '')] });
      }
      for (const d of deploymentsToWrite) {
        const args = DEPLOYMENT_COLUMNS.map(c => (d[c] ?? null) as any);
        await tx.execute({ sql: upsertDeployment, args });
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    const artifactItems: ArtifactSummaryItem[] = [];
    let artifactOk = 0;
    let artifactWarn = 0;

    if (manifest.includes.artifacts && options.restoreArtifacts !== false) {
      const deployPathMap = new Map<string, string>();
      for (const row of (await client.execute(`SELECT id, deploy_path FROM projects`)).rows) {
        deployPathMap.set(String(row.id), String(row.deploy_path));
      }

      const tmpRoot = ensureTmpDir();

      for (const a of manifest.artifacts) {
        if (!a.archive) continue;
        const target = deployPathMap.get(a.projectId);
        if (!target) {
          artifactItems.push({ projectId: a.projectId, status: 'skipped', message: 'project not in DB' });
          artifactWarn++;
          continue;
        }
        const entry = zip.getEntry(`kite-export/${a.archive}`);
        if (!entry) {
          artifactItems.push({ projectId: a.projectId, status: 'skipped', message: 'archive entry missing' });
          artifactWarn++;
          continue;
        }
        try {
          fs.mkdirSync(target, { recursive: true });
          const tmpZipPath = path.join(tmpRoot, `restore-${a.projectId}-${Date.now()}.zip`);
          fs.writeFileSync(tmpZipPath, entry.getData());
          const innerZip = new AdmZip(tmpZipPath);
          const targetResolved = path.resolve(target);
          for (const e of innerZip.getEntries()) {
            const dest = path.resolve(target, e.entryName);
            if (!dest.startsWith(targetResolved + path.sep) && dest !== targetResolved) {
              throw new Error(`Refusing to extract entry outside target: ${e.entryName}`);
            }
          }
          innerZip.extractAllTo(target, true);
          fs.unlinkSync(tmpZipPath);
          artifactItems.push({ projectId: a.projectId, status: 'ok' });
          artifactOk++;
        } catch (err: any) {
          artifactItems.push({ projectId: a.projectId, status: 'skipped', message: `restore failed: ${err.message}` });
          artifactWarn++;
        }
      }
    }

    return {
      manifest: {
        schemaVersion: manifest.schemaVersion,
        exportedAt: manifest.exportedAt,
        kiteVersion: manifest.kiteVersion,
      },
      projects: projectBucket,
      settings: settingBucket,
      deployments: deploymentBucket,
      artifacts: { ok: artifactOk, warnings: artifactWarn, items: artifactItems },
    };
  } finally {
    client.close();
  }
}
