import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import ora from 'ora';
import chalk from 'chalk';
import { createClient, type Row } from '@libsql/client';
import { ensureKiteHome } from './home.js';
import { packProject } from './pack.js';
import { parseIgnoreOption } from './ignore.js';

export interface ExportOptions {
  out?: string;
  includeArtifacts?: boolean;
  includeLogs?: boolean;
  projects?: string;
  ignore?: unknown;
  ignoreBuiltin?: boolean;
}

interface ExportManifest {
  schemaVersion: 1;
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

const rowsToObjects = (rows: Row[]): Record<string, unknown>[] =>
  rows.map(row => ({ ...row }));

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const tableExists = async (client: ReturnType<typeof createClient>, name: string): Promise<boolean> => {
  const result = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
    args: [name],
  });
  return result.rows.length > 0;
};

const dumpTable = async (
  client: ReturnType<typeof createClient>,
  table: string,
): Promise<Record<string, unknown>[]> => {
  if (!(await tableExists(client, table))) return [];
  const result = await client.execute(`SELECT * FROM ${table}`);
  return rowsToObjects(result.rows);
};

export async function runExport(options: ExportOptions, kiteVersion: string): Promise<void> {
  const home = ensureKiteHome();
  const dbPath = path.join(home, 'kite.db');

  if (!fs.existsSync(dbPath)) {
    console.error(chalk.red(`No Kite database found at ${dbPath}`));
    console.error(chalk.gray('Run `kite serve` at least once on the source machine to initialize the database.'));
    process.exit(1);
  }

  const includeArtifacts = !!options.includeArtifacts;
  const includeLogs = !!options.includeLogs;

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const outPath = path.resolve(process.cwd(), options.out || `kite-export-${stamp}.zip`);

  const client = createClient({ url: `file:${dbPath}` });

  try {
    const projectFilter = (options.projects || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    const spinner = ora('Reading Kite database...').start();

    const allProjects = await dumpTable(client, 'projects');
    const projects = projectFilter.length > 0
      ? allProjects.filter(p => projectFilter.includes(String(p.id)))
      : allProjects;
    const settings = await dumpTable(client, 'settings');
    const deployments = includeLogs ? await dumpTable(client, 'deployments') : [];
    const filteredDeployments = projectFilter.length > 0
      ? deployments.filter(d => projectFilter.includes(String(d.project_id)))
      : deployments;

    spinner.succeed(chalk.green(`Read database: ${projects.length} projects, ${settings.length} settings, ${filteredDeployments.length} deployments`));

    const manifest: ExportManifest = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      kiteVersion,
      includes: {
        settings: settings.length > 0,
        projects: projects.length > 0,
        deployments: includeLogs,
        artifacts: includeArtifacts,
      },
      projectIds: projects.map(p => String(p.id)),
      artifacts: [],
    };

    const tmpDir = path.join(home, 'tmp', `export-${stamp}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const artifactsDir = path.join(tmpDir, 'artifacts');
    if (includeArtifacts) {
      fs.mkdirSync(artifactsDir, { recursive: true });

      const artifactsSpinner = ora('Packing project artifacts...').start();
      const ignoreCustom = parseIgnoreOption(options.ignore);
      const ignoreBuiltin = options.ignoreBuiltin === false ? true : false;

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
          const archiveName = `${projectId}.zip`;
          const archivePath = path.join(artifactsDir, archiveName);
          await packProject(deployPath, archivePath, {
            ignore: ignoreCustom,
            ignoreBuiltin,
          });
          manifest.artifacts.push({ projectId, deployPath, archive: `artifacts/${archiveName}` });
        } catch (err: any) {
          manifest.artifacts.push({ projectId, deployPath, skipped: `pack error: ${err.message}` });
        }
      }

      artifactsSpinner.succeed(chalk.green(`Packed artifacts for ${manifest.artifacts.filter(a => a.archive).length} projects`));
    }

    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(tmpDir, 'projects.json'), `${JSON.stringify(projects, null, 2)}\n`);
    fs.writeFileSync(path.join(tmpDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`);
    if (includeLogs) {
      fs.writeFileSync(path.join(tmpDir, 'deployments.json'), `${JSON.stringify(filteredDeployments, null, 2)}\n`);
    }

    const zipSpinner = ora(`Writing ${path.basename(outPath)}...`).start();
    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(outPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(tmpDir, 'kite-export');
      archive.finalize();
    });
    zipSpinner.succeed(chalk.green(`Wrote ${outPath}`));

    fs.rmSync(tmpDir, { recursive: true, force: true });

    const stat = fs.statSync(outPath);
    console.log(chalk.gray(`  Size: ${formatBytes(stat.size)}`));
    console.log(chalk.gray(`  Projects: ${projects.length}${projectFilter.length > 0 ? ` (filtered from ${allProjects.length})` : ''}`));
    console.log(chalk.gray(`  Settings: ${settings.length}`));
    if (includeLogs) console.log(chalk.gray(`  Deployments: ${filteredDeployments.length}`));
    if (includeArtifacts) {
      const ok = manifest.artifacts.filter(a => a.archive).length;
      const skipped = manifest.artifacts.filter(a => a.skipped).length;
      console.log(chalk.gray(`  Artifacts: ${ok} packed, ${skipped} skipped`));
      for (const a of manifest.artifacts.filter(x => x.skipped)) {
        console.log(chalk.yellow(`    ! ${a.projectId}: ${a.skipped}`));
      }
    }
  } finally {
    client.close();
  }
}
