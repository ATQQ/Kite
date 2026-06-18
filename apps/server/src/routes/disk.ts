import { Elysia } from 'elysia';
import fs from 'node:fs/promises';
import path from 'node:path';
import { db } from '../db/index.js';
import { writeAudit } from '../lib/audit.js';
import { fsFree } from '../lib/health.js';
import {
  dirSize,
  listArtifactFiles,
  cacheGet,
  cacheSet,
  cacheInvalidate,
  homeRelative,
  kiteHomePath,
  deploymentsRoot,
  projectArtifactsDir,
  logFor,
} from '../lib/disk.js';

const log = logFor();

const verifyAdminToken = (headers: Record<string, string | undefined>) => {
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  return token === process.env.ADMIN_TOKEN;
};

export const diskRoutes = new Elysia()
  // -------------- Global overview --------------
  .get('/api/disk/overview', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const cacheKey = 'disk:overview';
    const cached = cacheGet<any>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const home = kiteHomePath();
    const dbFile = path.join(home, 'kite.db');
    const configFile = path.join(home, 'config.json');
    const tmpDir = path.join(home, 'tmp');
    const deployDir = deploymentsRoot();

    const [tmp, deployments, fs1, fs2, fs3] = await Promise.all([
      dirSize(tmpDir, { timeoutMs: 2000 }),
      dirSize(deployDir, { timeoutMs: 5000 }),
      fs.stat(dbFile).then(s => s.size).catch(() => 0),
      fs.stat(configFile).then(s => s.size).catch(() => 0),
      fsFree(home),
    ]);

    const breakdown = {
      deployments: deployments.bytes,
      tmp: tmp.bytes,
      db: fs1,
      config: fs2,
    };
    const totalBytes = breakdown.deployments + breakdown.tmp + breakdown.db + breakdown.config;

    const result = {
      kiteHome: {
        path: homeRelative(home),
        totalBytes,
        breakdown,
        approximated: tmp.approximated || deployments.approximated,
      },
      filesystem: fs3,
      cached: false,
    };
    cacheSet(cacheKey, result);
    return result;
  })

  // -------------- Per-project overview --------------
  .get('/api/disk/projects', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const cacheKey = 'disk:projects';
    const cached = cacheGet<any>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const projects = await db.projects.findAll();
    const items: any[] = [];
    let totalArtifacts = 0;
    let totalDeployPath = 0;

    for (const p of projects) {
      const artDir = projectArtifactsDir(p.id);
      const [art, deployPathStat] = await Promise.all([
        dirSize(artDir, { timeoutMs: 3000 }),
        p.deployPath ? dirSize(p.deployPath, { timeoutMs: 3000 }) : Promise.resolve({ bytes: 0, files: 0, oldestMtime: null, newestMtime: null, approximated: false, exists: false }),
      ]);
      totalArtifacts += art.bytes;
      totalDeployPath += deployPathStat.bytes;
      items.push({
        projectId: p.id,
        projectName: p.name,
        artifactsBytes: art.bytes,
        artifactCount: art.files,
        oldestAt: art.oldestMtime ? new Date(art.oldestMtime).toISOString() : null,
        newestAt: art.newestMtime ? new Date(art.newestMtime).toISOString() : null,
        deployPath: p.deployPath ? homeRelative(p.deployPath) : null,
        deployPathBytes: deployPathStat.bytes,
        deployPathExists: deployPathStat.exists,
        approximated: art.approximated || deployPathStat.approximated,
      });
    }

    const result = {
      items,
      totals: { artifactsBytes: totalArtifacts, deployPathBytes: totalDeployPath },
      cached: false,
    };
    cacheSet(cacheKey, result);
    return result;
  })

  // -------------- Per-project artifact list --------------
  .get('/api/disk/projects/:id/artifacts', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }

    const [files, deployments] = await Promise.all([
      listArtifactFiles(params.id),
      db.deployments.findByProject(params.id),
    ]);

    // Map deployId -> deployment row
    const deployById = new Map(deployments.map(d => [d.id, d]));
    // Index of reference counts on artifact paths (so we know if it's shared)
    const refCount = new Map<string, number>();
    for (const d of deployments) {
      if (d.artifactPath) refCount.set(d.artifactPath, (refCount.get(d.artifactPath) || 0) + 1);
    }

    const items = files.map(f => {
      const dep = deployById.get(f.deployId);
      const refs = refCount.get(f.filePath) || 0;
      return {
        deployId: f.deployId,
        sizeBytes: f.size,
        createdAt: f.createdAt,
        status: dep?.status ?? null,
        triggerSource: dep?.triggerSource ?? null,
        rollbackOf: dep?.rollbackOf ?? null,
        referencedBy: refs,
        canDelete: refs <= 1,
      };
    }).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    return {
      projectId: params.id,
      projectName: project.name,
      items,
      totalBytes: items.reduce((s, i) => s + i.sizeBytes, 0),
    };
  })

  // -------------- Delete one artifact --------------
  .delete('/api/disk/artifacts/:deployId', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const dep = await db.deployments.findById(params.deployId);
    if (!dep) { set.status = 404; return { code: 'DEPLOY_NOT_FOUND', error: 'Deployment not found' }; }
    if (!dep.artifactPath) { set.status = 404; return { code: 'ARTIFACT_NOT_FOUND', error: 'Artifact already cleared' }; }

    const targetPath = dep.artifactPath;
    const refs = await db.deployments.countByArtifactPath(targetPath);
    if (refs > 1) {
      set.status = 409;
      await writeAudit({ headers }, {
        action: 'artifact.delete',
        targetType: 'artifact',
        targetId: dep.id,
        targetName: dep.projectName,
        summary: `拒绝删除归档：被 ${refs} 条部署记录引用`,
        status: 'failed',
        errorMessage: 'ARTIFACT_REFERENCED',
      });
      return { code: 'ARTIFACT_REFERENCED', error: 'Artifact is referenced by other deployments', refCount: refs };
    }

    // 1. clear DB pointer first (so any concurrent rollback won't try to use it)
    await db.deployments.clearArtifactPath(dep.id);
    // 2. unlink file
    let freedBytes = dep.artifactSize || 0;
    try {
      const stat = await fs.stat(targetPath);
      freedBytes = stat.size;
      await fs.unlink(targetPath);
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.warn({ deployId: dep.id, path: targetPath, err: err?.message }, 'unlink failed');
      }
    }
    cacheInvalidate('disk:');
    await writeAudit({ headers }, {
      action: 'artifact.delete',
      targetType: 'artifact',
      targetId: dep.id,
      targetName: dep.projectName,
      summary: `删除归档 ${dep.id.slice(0, 8)} (${freedBytes} bytes)`,
    });
    log.info({ deployId: dep.id, path: targetPath, freedBytes }, 'artifact deleted');
    return { success: true, deployId: dep.id, freedBytes };
  });
