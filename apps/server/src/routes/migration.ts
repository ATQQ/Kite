import { Elysia, t } from 'elysia';
import {
  listMigrationProjects,
  buildExportArchive,
  applyImportArchive,
  type ExportOptions,
  type ImportOptions,
  type ImportStrategy,
} from '../lib/migration.js';
import { writeAudit } from '../lib/audit.js';

const verifyAdminToken = (headers: Record<string, string | undefined>) => {
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  return token === process.env.ADMIN_TOKEN;
};

const toBool = (v: unknown, fallback: boolean): boolean => {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return fallback;
};

export const migrationRoutes = new Elysia()
  .get('/api/migration/projects', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    try {
      const list = await listMigrationProjects();
      return { projects: list };
    } catch (err: any) {
      set.status = 500;
      return { error: err.message };
    }
  })
  .post('/api/migration/export', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }); }

    const options: ExportOptions = {
      projectIds: Array.isArray(body?.projectIds) ? body.projectIds.map(String) : undefined,
      includeArtifacts: body?.includeArtifacts !== false,
      includeDeployments: body?.includeDeployments !== false,
      deploymentLimitPerProject: Number(body?.deploymentLimitPerProject) || 0,
      kiteVersion: process.env.KITE_SERVER_VERSION,
    };

    try {
      const { buffer, filename } = await buildExportArchive(options);
      await writeAudit({ headers }, {
        action: 'migration.export',
        targetType: 'migration',
        targetName: filename,
        after: {
          filename,
          sizeBytes: buffer.length,
          projectIds: options.projectIds ?? 'all',
          includeArtifacts: options.includeArtifacts,
          includeDeployments: options.includeDeployments,
          deploymentLimitPerProject: options.deploymentLimitPerProject,
        },
        summary: `导出迁移包 ${filename}（${(options.projectIds?.length ?? 'all')} 个项目）`,
      });
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length),
        },
      });
    } catch (err: any) {
      await writeAudit({ headers }, {
        action: 'migration.export',
        targetType: 'migration',
        after: {
          projectIds: options.projectIds ?? 'all',
          includeArtifacts: options.includeArtifacts,
          includeDeployments: options.includeDeployments,
        },
        summary: '导出迁移包失败',
        status: 'failed',
        errorMessage: err.message,
      });
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }, {
    body: t.Object({
      projectIds: t.Optional(t.Array(t.String())),
      includeArtifacts: t.Optional(t.Boolean()),
      includeDeployments: t.Optional(t.Boolean()),
      deploymentLimitPerProject: t.Optional(t.Number()),
    }),
  })
  .post('/api/migration/import', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const file = body?.file as File | undefined;
    if (!file) {
      set.status = 400;
      return { error: 'Missing file field' };
    }

    const strategy = (String(body?.strategy || 'skip-existing') as ImportStrategy);
    if (!['merge', 'overwrite', 'skip-existing'].includes(strategy)) {
      set.status = 400;
      return { error: `Invalid strategy: ${strategy}` };
    }

    if (strategy === 'overwrite') {
      const confirm = headers['x-confirm-overwrite'];
      if (confirm !== 'yes') {
        set.status = 400;
        return { error: 'Overwrite requires header X-Confirm-Overwrite: yes' };
      }
    }

    const opts: ImportOptions = {
      strategy,
      restoreArtifacts: toBool(body?.restoreArtifacts, true),
    };

    try {
      const ab = await file.arrayBuffer();
      const buffer = Buffer.from(ab);
      const summary = await applyImportArchive(buffer, opts);
      await writeAudit({ headers }, {
        action: 'migration.import',
        targetType: 'migration',
        targetName: (file as any).name || 'import.zip',
        after: {
          fileName: (file as any).name,
          sizeBytes: buffer.length,
          strategy: opts.strategy,
          restoreArtifacts: opts.restoreArtifacts,
          summary,
        },
        summary: `导入迁移包（策略：${opts.strategy}）`,
      });
      return { success: true, summary };
    } catch (err: any) {
      await writeAudit({ headers }, {
        action: 'migration.import',
        targetType: 'migration',
        targetName: (file as any)?.name || 'import.zip',
        after: { strategy: opts.strategy, restoreArtifacts: opts.restoreArtifacts },
        summary: '导入迁移包失败',
        status: 'failed',
        errorMessage: err.message,
      });
      set.status = 500;
      return { error: err.message };
    }
  }, {
    body: t.Object({
      file: t.File(),
      strategy: t.Optional(t.String()),
      restoreArtifacts: t.Optional(t.Any()),
    }),
  });
