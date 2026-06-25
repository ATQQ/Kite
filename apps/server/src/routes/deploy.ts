import { Elysia, t } from 'elysia';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { db } from '../db/index.js';
import { randomUUID } from 'node:crypto';
import { spawn, writeFile } from '../runtime.js';
import { writeAudit, diffFields, sanitize } from '../lib/audit.js';
import { moduleLogger, pickTraceId } from '../lib/logger.js';
import {
  archiveZip,
  gcArtifacts,
  getArtifactKeepN,
} from '../lib/artifact.js';
import {
  applyCleanStrategy,
  buildPreviewTree,
  normalizeMode,
  parseProtectPaths,
  type CleanMode,
} from '../lib/clean.js';
import {
  verifyAdminToken,
  verifyAdminTokenValue,
  extractBearerToken,
  safeEqual,
  loginGuard,
  loginFailure,
  loginSuccess,
  pickClientKey,
} from '../lib/auth.js';

const deployLog = moduleLogger('deploy');

// SSE broadcast: deployId -> Set of controllers
const deploySubscribers = new Map<string, Set<ReadableStreamDefaultController>>();

function broadcastToSubscribers(deployId: string, event: string, data: string) {
  const subs = deploySubscribers.get(deployId);
  if (!subs || subs.size === 0) return;
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const encoded = new TextEncoder().encode(message);
  for (const controller of subs) {
    try { controller.enqueue(encoded); } catch { subs.delete(controller); }
  }
}

// Streaming shell command: yields lines with raw ANSI codes
async function* runShellCommand(command: string, cwd: string, env?: Record<string, string>) {
  const proc = await spawn('sh', ['-c', command], { cwd, env });

  const decoder = new TextDecoder();
  let buffer = '';

  // Read from a stream, yielding complete lines
  async function* readLines(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) yield line;
      }
      if (buffer) { yield buffer; buffer = ''; }
    } finally {
      reader.releaseLock();
    }
  }

  // Merge stdout and stderr
  for await (const line of readLines(proc.stdout)) yield line;
  for await (const line of readLines(proc.stderr)) yield line;

  const exitCode = await proc.exited;
  yield `\x00EXIT:${exitCode}`;
}

export const deployRoutes = new Elysia()
  .post('/api/auth/login', async ({ body, headers, set }) => {
    const clientKey = pickClientKey(headers as Record<string, string | undefined>);
    const guard = await loginGuard(clientKey);
    if (guard.locked) {
      const retrySec = Math.ceil(guard.retryAfterMs / 1000);
      set.status = 429;
      set.headers['Retry-After'] = String(retrySec);
      await writeAudit({ headers }, {
        action: 'auth.login_failed',
        targetType: 'auth',
        summary: `Admin 登录被限流（剩余 ${retrySec}s）`,
        status: 'failed',
        errorMessage: 'Too many attempts',
      });
      return { success: false, message: 'Too many attempts, please retry later', retryAfter: retrySec };
    }
    const { token } = body;
    if (verifyAdminTokenValue(token)) {
      loginSuccess(clientKey);
      return { success: true, message: 'Login successful' };
    }
    loginFailure(clientKey);
    await writeAudit({ headers }, {
      action: 'auth.login_failed',
      targetType: 'auth',
      summary: 'Admin 登录失败',
      status: 'failed',
      errorMessage: 'Invalid token',
    });
    set.status = 401;
    return { success: false, message: 'Invalid token' };
  }, {
    body: t.Object({ token: t.String() })
  })
  .get('/api/projects', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const items = await db.projects.findAllWithMeta();
    // Attach tagIds[] per project (single bulk fetch)
    const pairs = await db.projectTags.listAllPairs();
    const tagMap = new Map<string, string[]>();
    for (const p of pairs) {
      if (!tagMap.has(p.projectId)) tagMap.set(p.projectId, []);
      tagMap.get(p.projectId)!.push(p.tagId);
    }
    const withTags = items.map(p => ({ ...p, tagIds: tagMap.get(p.id) ?? [] }));
    // ?tagIds=a,b,c → AND filter (project must have all)
    const tagIdsParam = typeof query.tagIds === 'string' ? query.tagIds.trim() : '';
    if (!tagIdsParam) return withTags;
    const wantedIds = tagIdsParam.split(',').map(s => s.trim()).filter(Boolean);
    if (wantedIds.length === 0) return withTags;
    const matchIds = new Set(await db.projectTags.projectIdsHavingAll(wantedIds));
    return withTags.filter(p => matchIds.has(p.id));
  })
  .post('/api/projects', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    // Check deployPath uniqueness
    const allProjects = await db.projects.findAll();
    const conflict = allProjects.find((p) => p.deployPath === body.deployPath);
    if (conflict) {
      set.status = 409;
      return { error: '该部署目录已被项目占用', conflictProject: conflict.name };
    }
    // Validate categoryId if provided
    let categoryId: string | null = null;
    if (body.categoryId !== undefined && body.categoryId !== null && body.categoryId !== '') {
      const cat = await db.categories.findById(body.categoryId);
      if (!cat) { set.status = 400; return { error: '分类不存在' }; }
      categoryId = cat.id;
    }
    const pm2AppName = typeof body.pm2AppName === 'string' && body.pm2AppName.trim() !== ''
      ? body.pm2AppName.trim()
      : null;
    // Validate tagIds if provided
    const tagIds: string[] = [];
    if (Array.isArray(body.tagIds)) {
      for (const tid of body.tagIds) {
        if (typeof tid !== 'string' || !tid) continue;
        const tag = await db.tags.findById(tid);
        if (tag) tagIds.push(tag.id);
      }
    }
    // Auto-attach built-in "PM2" tag when project is created with pm2AppName bound.
    if (pm2AppName) {
      const pm2Tag = await db.tags.findByName('PM2');
      if (pm2Tag && !tagIds.includes(pm2Tag.id)) {
        tagIds.push(pm2Tag.id);
      }
    }
    const { tagIds: _omitTagIds, ...rest } = body as Record<string, any>;
    const project = await db.projects.create({
      ...rest,
      categoryId,
      pm2AppName,
      id: 'proj_' + randomUUID().replace(/-/g, '').substring(0, 12),
      token: 'kt_' + randomUUID().replace(/-/g, ''),
    });
    if (tagIds.length > 0) {
      await db.projectTags.setForProject(project.id, tagIds);
    }
    await writeAudit({ headers }, {
      action: 'project.create',
      targetType: 'project',
      targetId: project.id,
      targetName: project.name,
      before: null,
      after: { ...(sanitize(project) as any), tagIds },
      summary: `创建项目 ${project.name}`,
    });
    return { success: true, project: { ...project, tagIds } };
  }, {
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      deployPath: t.String(),
      env: t.Optional(t.String()),
      categoryId: t.Optional(t.Union([t.String(), t.Null()])),
      pm2AppName: t.Optional(t.Union([t.String(), t.Null()])),
      tagIds: t.Optional(t.Array(t.String())),
    })
  })
  .get('/api/projects/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    const tagIds = await db.projectTags.listByProject(params.id);
    return { ...project, tagIds };
  })
  .put('/api/projects/:id', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.projects.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Project not found' }; }
    // Normalise / validate clean-mode related fields before write
    const patch: Record<string, any> = { ...body };
    // Check deployPath uniqueness when it's being changed
    if (typeof patch.deployPath === 'string') {
      const allProjects = await db.projects.findAll();
      const conflict = allProjects.find((p) => p.deployPath === patch.deployPath && p.id !== params.id);
      if (conflict) {
        set.status = 409;
        return { error: '该部署目录已被项目占用', conflictProject: conflict.name };
      }
    }
    // Check name uniqueness when it's being changed
    if (typeof patch.name === 'string') {
      if (!patch.name.trim()) {
        set.status = 400;
        return { error: '项目名不能为空' };
      }
      const allProjects = await db.projects.findAll();
      const conflict = allProjects.find((p) => p.name === patch.name && p.id !== params.id);
      if (conflict) {
        set.status = 409;
        return { error: '项目名已存在' };
      }
    }
    if (typeof patch.cleanMode !== 'undefined') {
      const allowed = ['merge', 'clean', 'clean-all', null, ''];
      if (!allowed.includes(patch.cleanMode)) {
        set.status = 400;
        return { error: `Invalid cleanMode (must be merge|clean|clean-all)` };
      }
      if (patch.cleanMode === '' || patch.cleanMode === 'merge') patch.cleanMode = null;
    }
    if (typeof patch.protectPaths !== 'undefined') {
      if (Array.isArray(patch.protectPaths)) {
        patch.protectPaths = JSON.stringify(
          patch.protectPaths.filter((s: unknown) => typeof s === 'string' && (s as string).length > 0),
        );
      } else if (patch.protectPaths === null || patch.protectPaths === '') {
        patch.protectPaths = null;
      } else if (typeof patch.protectPaths !== 'string') {
        set.status = 400;
        return { error: 'protectPaths must be string[] or null' };
      }
    }
    if (typeof patch.categoryId !== 'undefined') {
      if (patch.categoryId === null || patch.categoryId === '') {
        patch.categoryId = null;
      } else if (typeof patch.categoryId === 'string') {
        const cat = await db.categories.findById(patch.categoryId);
        if (!cat) { set.status = 400; return { error: '分类不存在' }; }
        patch.categoryId = cat.id;
      } else {
        set.status = 400;
        return { error: 'categoryId must be string or null' };
      }
    }
    if (typeof patch.pm2AppName !== 'undefined') {
      if (patch.pm2AppName === null) {
        // ok
      } else if (typeof patch.pm2AppName === 'string') {
        const v = patch.pm2AppName.trim();
        patch.pm2AppName = v === '' ? null : v;
      } else {
        set.status = 400;
        return { error: 'pm2AppName must be string or null' };
      }
    }
    // tagIds handled outside main patch (separate table)
    let nextTagIds: string[] | undefined;
    if (typeof patch.tagIds !== 'undefined') {
      if (!Array.isArray(patch.tagIds)) {
        set.status = 400;
        return { error: 'tagIds must be string[]' };
      }
      const validated: string[] = [];
      for (const tid of patch.tagIds) {
        if (typeof tid !== 'string' || !tid) continue;
        const tag = await db.tags.findById(tid);
        if (tag) validated.push(tag.id);
      }
      nextTagIds = validated;
      delete patch.tagIds;
    }
    const after = await db.projects.update(params.id, patch);
    if (!after) { set.status = 404; return { error: 'Project not found' }; }
    const beforeTagIds = await db.projectTags.listByProject(params.id);
    // Auto-attach built-in "PM2" tag when pm2AppName transitions from empty/different to a new non-empty value.
    const beforePm2 = ((before as any).pm2AppName || '').trim();
    const afterPm2 = ((after as any).pm2AppName || '').trim();
    if (afterPm2 && afterPm2 !== beforePm2) {
      const pm2Tag = await db.tags.findByName('PM2');
      if (pm2Tag) {
        const base = nextTagIds !== undefined ? nextTagIds : [...beforeTagIds];
        if (!base.includes(pm2Tag.id)) {
          base.push(pm2Tag.id);
          nextTagIds = base;
        }
      }
    }
    if (nextTagIds !== undefined) {
      await db.projectTags.setForProject(params.id, nextTagIds);
    }
    const diff = diffFields(before as any, after as any, Object.keys(patch));
    // tagIds diff (only when explicit set in body)
    if (nextTagIds !== undefined) {
      const sortedBefore = [...beforeTagIds].sort();
      const sortedAfter = [...nextTagIds].sort();
      if (sortedBefore.join(',') !== sortedAfter.join(',')) {
        diff.before.tagIds = sortedBefore;
        diff.after.tagIds = sortedAfter;
      }
    }
    if (Object.keys(diff.after).length > 0) {
      await writeAudit({ headers }, {
        action: 'project.update',
        targetType: 'project',
        targetId: params.id,
        targetName: after.name,
        before: diff.before,
        after: diff.after,
        summary: `更新项目配置：${Object.keys(diff.after).join(', ')}`,
      });
    }
    const respTagIds = nextTagIds !== undefined ? nextTagIds : beforeTagIds;
    return { success: true, project: { ...after, tagIds: respTagIds } };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      preDeployScript: t.Optional(t.String()),
      postDeployScript: t.Optional(t.String()),
      postDeployAsync: t.Optional(t.Boolean()),
      deployPath: t.Optional(t.String()),
      description: t.Optional(t.String()),
      env: t.Optional(t.String()),
      cleanMode: t.Optional(t.Union([t.Literal('merge'), t.Literal('clean'), t.Literal('clean-all'), t.Null()])),
      protectPaths: t.Optional(t.Union([t.Array(t.String()), t.Null()])),
      categoryId: t.Optional(t.Union([t.String(), t.Null()])),
      pm2AppName: t.Optional(t.Union([t.String(), t.Null()])),
      tagIds: t.Optional(t.Array(t.String())),
    })
  })
  .delete('/api/projects/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const before = await db.projects.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Project not found' }; }
    const deploymentCount = await db.deployments.countByProject(params.id);

    const success = await db.projects.remove(params.id);
    if (!success) { set.status = 404; return { error: 'Project not found' }; }

    await writeAudit({ headers }, {
      action: 'project.delete',
      targetType: 'project',
      targetId: before.id,
      targetName: before.name,
      before: { ...sanitize(before) as any, deploymentCount },
      after: null,
      summary: `删除项目 ${before.name}（连带 ${deploymentCount} 条部署历史）`,
    });

    return { success: true, message: 'Project deleted successfully' };
  })
  .post('/api/projects/:id/token', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.update(params.id, { token: 'kt_' + randomUUID().replace(/-/g, '') });
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    await writeAudit({ headers }, {
      action: 'project.token.rotate',
      targetType: 'project',
      targetId: project.id,
      targetName: project.name,
      before: { token: '****' },
      after: { token: '****' },
      summary: `重新生成项目 ${project.name} 的 Token`,
    });
    return { success: true, token: project.token };
  })
  .get('/api/logs', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    return await db.deployments.findAll();
  })
  .get('/api/logs/:deployId', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const log = await db.deployments.findById(params.deployId);
    if (!log) { set.status = 404; return { error: 'Deployment log not found' }; }
    return log;
  })
  .get('/api/logs/:deployId/stream', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return new Response('Unauthorized', { status: 401 }); }
    const deployId = params.deployId;
    const log = await db.deployments.findById(deployId);
    if (!log) { set.status = 404; return new Response('Not found', { status: 404 }); }

    let controllerRef: ReadableStreamDefaultController;
    const stream = new ReadableStream({
      start(controller) {
        controllerRef = controller;
        if (!deploySubscribers.has(deployId)) deploySubscribers.set(deployId, new Set());
        deploySubscribers.get(deployId)!.add(controller);
        // Send existing output
        if (log.output) {
          controller.enqueue(new TextEncoder().encode(`event: log\ndata: ${JSON.stringify(log.output)}\n\n`));
        }
        // If already finished, send status and close
        if (log.status !== 'running') {
          controller.enqueue(new TextEncoder().encode(`event: status\ndata: ${JSON.stringify({ status: log.status, duration: log.duration })}\n\n`));
          controller.close();
          deploySubscribers.get(deployId)?.delete(controller);
        }
      },
      cancel() {
        deploySubscribers.get(deployId)?.delete(controllerRef);
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      }
    });
  })
  .post('/api/deploy/upload', async ({ body, headers, set }) => {
    try {
      const token = extractBearerToken(headers as Record<string, string | undefined>);
      if (!token) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      let project = await db.projects.findByToken(token);

      const file = body.file as File;
      const projectId = body.projectId;

      if (!project) {
        const globalToken = await db.settings.get('global_deploy_token');
        if (!globalToken || !safeEqual(token, globalToken)) {
          set.status = 403;
          return { error: 'Invalid Token' };
        }
        project = await db.projects.findById(projectId);
        if (!project) {
          set.status = 404;
          return { error: 'Project not found' };
        }
      } else if (projectId !== project.id) {
        set.status = 403;
        return { error: 'Project ID mismatch' };
      }

      const preDeployCmd = body.preDeploy || project.preDeployScript;
      const postDeployCmd = body.postDeploy || project.postDeployScript;
      // postDeployAsync: 单次 > 项目级；FormData 传字符串 'true'/'false'，需归一化
      const parseBool = (v: unknown): boolean | undefined => {
        if (typeof v === 'boolean') return v;
        if (typeof v === 'string') {
          if (v === 'true' || v === '1') return true;
          if (v === 'false' || v === '0' || v === '') return false;
        }
        return undefined;
      };
      const overrideAsync = parseBool(body.postDeployAsync);
      const postDeployAsync = overrideAsync !== undefined ? overrideAsync : Boolean(project.postDeployAsync);
      // env 通过 FormData 传输为 JSON 字符串，需手动解析
      let deployEnv: Record<string, string> | undefined;
      if (body.env) {
        try {
          deployEnv = typeof body.env === 'string' ? JSON.parse(body.env) : body.env;
        } catch { /* ignore invalid env */ }
      }

      const reqTraceId = pickTraceId(headers as Record<string, string | undefined>);
      const deployTraceId = reqTraceId || randomUUID();
      const reqLog = deployLog.child({ traceId: deployTraceId, projectId });
      reqLog.info('received zip for deploy');

      // 将 traceId 注入子进程 env，方便 pre/post 脚本里串联日志
      deployEnv = { ...(deployEnv || {}), KITE_DEPLOY_TRACE_ID: deployTraceId };

      // 优先使用 CLI push 时间作为 startTime；非法或缺失时回退到 server 当前时间
      let startTimeIso = new Date().toISOString();
      if (typeof body.startedAt === 'string' && body.startedAt) {
        const t = new Date(body.startedAt).getTime();
        const now = Date.now();
        if (!Number.isNaN(t) && t <= now + 10_000 && t >= now - 24 * 60 * 60 * 1000) {
          startTimeIso = new Date(t).toISOString();
        }
      }

      const deploymentRow = await db.deployments.insert({
        id: deployTraceId,
        projectId: project.id,
        projectName: project.name,
        status: 'running',
        triggerSource: 'cli',
        startTime: startTimeIso,
        output: ''
      });

      await db.projects.update(project.id, { status: 'running' });

      // Snapshot project cleaning policy at upload time so concurrent edits don't bite us
      const effectiveMode: CleanMode = normalizeMode(project.cleanMode);
      const effectiveProtect = parseProtectPaths(project.protectPaths);

      let fullOutput = '';
      const appendLog = async (text: string) => {
        fullOutput += text + '\n';
        await db.deployments.update(deploymentRow.id, { output: fullOutput });
        broadcastToSubscribers(deploymentRow.id, 'log', text);
      };

      // Stream NDJSON response to CLI
      const encoder = new TextEncoder();
      const sendEvent = (controller: ReadableStreamDefaultController, event: string, data: any) => {
        controller.enqueue(encoder.encode(JSON.stringify({ event, ...data }) + '\n'));
      };

      const stream = new ReadableStream({
        async start(controller) {
          const startTime = Date.now();

          try {
            sendEvent(controller, 'log', { data: `[Kite Deploy] Starting deployment for ${project.name}...` });
            await appendLog(`[Kite Deploy] Starting deployment for ${project.name}...`);

            const tempDir = path.join(process.cwd(), '.temp_deploy');
            await fs.mkdir(tempDir, { recursive: true });
            const tempZipPath = path.join(tempDir, `${Date.now()}.zip`);

            await writeFile(tempZipPath, await file.arrayBuffer());
            sendEvent(controller, 'log', { data: `[Kite Deploy] Saved temp zip` });
            await appendLog(`[Kite Deploy] Saved temp zip`);

            // Archive immediately so a later step failure doesn't lose the upload
            try {
              const { artifactPath, artifactSize } = await archiveZip({
                projectId: project.id,
                deployId: deploymentRow.id,
                sourceZip: tempZipPath,
                traceId: deployTraceId,
              });
              await db.deployments.update(deploymentRow.id, { artifactPath, artifactSize });
              const sizeKb = (artifactSize / 1024).toFixed(1);
              sendEvent(controller, 'log', { data: `[Kite Deploy] Archived zip (${sizeKb} KB) for rollback` });
              await appendLog(`[Kite Deploy] Archived zip (${sizeKb} KB) for rollback`);
            } catch (archiveErr: any) {
              const msg = `[Kite Deploy] WARN: failed to archive zip (${archiveErr?.message}); rollback for this deploy will be unavailable`;
              sendEvent(controller, 'log', { data: msg });
              await appendLog(msg);
            }

            const destPath = path.resolve(process.cwd(), project.deployPath);
            await fs.mkdir(destPath, { recursive: true });
            sendEvent(controller, 'log', { data: `[Kite Deploy] Target deploy path: ${destPath}` });
            await appendLog(`[Kite Deploy] Target deploy path: ${destPath}`);

            // Pre-deploy
            if (preDeployCmd) {
              sendEvent(controller, 'log', { data: `[Kite Deploy] Running Pre-deploy: ${preDeployCmd}` });
              await appendLog(`[Kite Deploy] Running Pre-deploy: ${preDeployCmd}`);
              let failed = false;
              for await (const line of runShellCommand(preDeployCmd, destPath, deployEnv)) {
                if (line.startsWith('\x00EXIT:')) {
                  const exitCode = parseInt(line.slice(6));
                  if (exitCode !== 0) { failed = true; }
                } else {
                  sendEvent(controller, 'log', { data: line });
                  await appendLog(line);
                }
              }
              if (failed) throw new Error('Pre-deploy failed');
            }

            // Apply cleaning strategy (no-op when mode=merge)
            if (effectiveMode !== 'merge') {
              const cleanMsg = `[Kite Deploy] Applying clean strategy: ${effectiveMode} (protect ${effectiveProtect.length} patterns)`;
              sendEvent(controller, 'log', { data: cleanMsg });
              await appendLog(cleanMsg);
              const cleanRes = await applyCleanStrategy(destPath, effectiveMode, effectiveProtect, { traceId: deployTraceId });
              const cleanSummary = `[Kite Deploy] Clean done: removed ${cleanRes.totalDeleteFiles} files (${(cleanRes.totalDeleteSize / 1024).toFixed(1)} KB), kept ${cleanRes.totalSkipFiles}`;
              sendEvent(controller, 'log', { data: cleanSummary });
              await appendLog(cleanSummary);
            }

            // Extract
            sendEvent(controller, 'log', { data: `[Kite Deploy] Extracting files...` });
            await appendLog(`[Kite Deploy] Extracting files...`);
            new AdmZip(tempZipPath).extractAllTo(destPath, true);

            // Post-deploy
            if (postDeployCmd) {
              if (postDeployAsync) {
                const dispatchMsg = `[Kite Deploy] Dispatching Post-deploy asynchronously (not waiting): ${postDeployCmd}`;
                sendEvent(controller, 'log', { data: dispatchMsg });
                await appendLog(dispatchMsg);
                // Fire-and-forget: 后台仍把输出 appendLog 到 deployments.output 并广播给订阅者；
                // 主流程立即继续。注意：Kite 进程退出时子进程会随父进程组被回收，
                // 需要常驻请在 postDeploy 里用 nohup/pm2/setsid 自行守护。
                (async () => {
                  try {
                    for await (const line of runShellCommand(postDeployCmd, destPath, deployEnv)) {
                      if (line.startsWith('\x00EXIT:')) {
                        const exitCode = parseInt(line.slice(6));
                        const exitMsg = exitCode === 0
                          ? `[Kite Deploy] (async) Post-deploy exited with code 0`
                          : `[Kite Deploy] (async) Post-deploy exited with code ${exitCode}`;
                        await appendLog(exitMsg);
                        if (exitCode !== 0) {
                          try {
                            await writeAudit({ headers }, {
                              action: 'deploy.post_deploy_failed',
                              targetType: 'project',
                              targetId: project.id,
                              targetName: project.name,
                              summary: `异步 postDeploy 退出码 ${exitCode}（部署 ${deploymentRow.id}）`,
                              status: 'failed',
                              errorMessage: `Post-deploy exited with code ${exitCode}`,
                            });
                          } catch { /* audit best-effort */ }
                        }
                      } else {
                        await appendLog(line);
                      }
                    }
                  } catch (asyncErr: any) {
                    await appendLog(`[Kite Deploy] (async) Post-deploy error: ${asyncErr?.message || asyncErr}`);
                  }
                })();
              } else {
                sendEvent(controller, 'log', { data: `[Kite Deploy] Running Post-deploy: ${postDeployCmd}` });
                await appendLog(`[Kite Deploy] Running Post-deploy: ${postDeployCmd}`);
                let failed = false;
                for await (const line of runShellCommand(postDeployCmd, destPath, deployEnv)) {
                  if (line.startsWith('\x00EXIT:')) {
                    const exitCode = parseInt(line.slice(6));
                    if (exitCode !== 0) { failed = true; }
                  } else {
                    sendEvent(controller, 'log', { data: line });
                    await appendLog(line);
                  }
                }
                if (failed) throw new Error('Post-deploy failed');
              }
            }

            await fs.unlink(tempZipPath);

            const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
            const successMsg = `[Kite Deploy] Deployment completed successfully in ${durationStr}.`;
            sendEvent(controller, 'log', { data: successMsg });
            await appendLog(successMsg);

            await db.deployments.update(deploymentRow.id, { status: 'success', duration: durationStr, endTime: new Date().toISOString() });
            await db.projects.update(project.id, { status: 'success' });

            // GC older archives beyond keepN (non-fatal on errors)
            try {
              const keepN = await getArtifactKeepN();
              const gc = await gcArtifacts({ projectId: project.id, keepN, traceId: deployTraceId });
              if (gc.removedFiles > 0 || gc.detached > 0) {
                const gcMsg = `[Kite Deploy] GC: removed ${gc.removedFiles} archive(s) (${(gc.removedBytes / 1024).toFixed(1)} KB), preserved ${gc.preserved} shared`;
                sendEvent(controller, 'log', { data: gcMsg });
                await appendLog(gcMsg);
              }
            } catch (gcErr: any) {
              reqLog.warn({ err: { name: gcErr?.name, message: gcErr?.message } }, 'artifact gc failed');
            }

            sendEvent(controller, 'status', { status: 'success', duration: durationStr, deployId: deploymentRow.id });
            broadcastToSubscribers(deploymentRow.id, 'status', JSON.stringify({ status: 'success', duration: durationStr }));
            reqLog.info({ ms: Date.now() - startTime }, 'deploy success');

          } catch (err: any) {
            const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
            const failMsg = `[Kite Deploy] Deployment failed: ${err.message}`;
            sendEvent(controller, 'log', { data: failMsg });
            await appendLog(failMsg);

            await db.deployments.update(deploymentRow.id, { status: 'failed', duration: durationStr, endTime: new Date().toISOString() });
            await db.projects.update(project.id, { status: 'failed' });

            sendEvent(controller, 'status', { status: 'failed', duration: durationStr, deployId: deploymentRow.id });
            broadcastToSubscribers(deploymentRow.id, 'status', JSON.stringify({ status: 'failed', duration: durationStr }));
            reqLog.error({ ms: Date.now() - startTime, err: { name: err?.name, message: err?.message } }, 'deploy failed');
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'application/x-ndjson',
          'Transfer-Encoding': 'chunked',
        }
      });

    } catch (error: any) {
      deployLog.error({ err: { name: error?.name, message: error?.message, stack: error?.stack } }, 'unhandled error in /api/deploy/upload');
      set.status = 500;
      return { error: error.message };
    }
  }, {
    body: t.Object({
      file: t.File(),
      projectId: t.String(),
      preDeploy: t.Optional(t.String()),
      postDeploy: t.Optional(t.String()),
      postDeployAsync: t.Optional(t.Union([t.Boolean(), t.String()])),
      env: t.Optional(t.Any()),
      startedAt: t.Optional(t.String())
    })
  })
  .get('/api/projects/:id/files', async ({ headers, params, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }

    const basePath = path.resolve(process.cwd(), project.deployPath);
    const subPath = query.path || '';
    const targetPath = path.resolve(basePath, subPath);

    // 防路径穿越
    if (!targetPath.startsWith(basePath)) {
      set.status = 403;
      return { error: 'Access denied' };
    }

    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = path.join(targetPath, entry.name);
          const relativePath = subPath ? `${subPath}/${entry.name}` : entry.name;
          const stat = await fs.stat(fullPath);
          return {
            name: entry.name,
            path: relativePath,
            isDir: entry.isDirectory(),
            isHidden: entry.name.startsWith('.'),
            size: stat.size,
            mtime: stat.mtime.toISOString()
          };
        })
      );

      // 目录排前，文件排后；隐藏项排到同类末尾；按名称排序
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        if (a.isHidden !== b.isHidden) return a.isHidden ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

      return items;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'Directory not found' };
      }
      set.status = 500;
      return { error: err.message };
    }
  })
  .get('/api/projects/:id/file', async ({ headers, params, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }

    const basePath = path.resolve(process.cwd(), project.deployPath);
    const filePath = query.path || '';
    const targetPath = path.resolve(basePath, filePath);

    // 防路径穿越
    if (!targetPath.startsWith(basePath)) {
      set.status = 403;
      return { error: 'Access denied' };
    }

    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        set.status = 400;
        return { error: 'Path is a directory' };
      }

      // 超过 1MB 拒绝
      if (stat.size > 1024 * 1024) {
        return { type: 'binary', size: stat.size, message: 'File too large to preview' };
      }

      // 判断是否为二进制文件（简单检测前 8KB 是否有 null 字节）
      const buffer = Buffer.alloc(Math.min(stat.size, 8192));
      const fh = await fs.open(targetPath, 'r');
      await fh.read(buffer, 0, buffer.length, 0);
      await fh.close();

      const isBinary = buffer.includes(0);
      if (isBinary) {
        return { type: 'binary', size: stat.size };
      }

      const content = await fs.readFile(targetPath, 'utf-8');
      const ext = path.extname(targetPath).toLowerCase();
      const langMap: Record<string, string> = {
        '.js': 'javascript', '.ts': 'typescript', '.jsx': 'jsx', '.tsx': 'tsx',
        '.json': 'json', '.html': 'html', '.htm': 'html', '.css': 'css',
        '.scss': 'scss', '.less': 'less', '.vue': 'vue', '.svelte': 'svelte',
        '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust',
        '.java': 'java', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
        '.sh': 'bash', '.bash': 'bash', '.zsh': 'bash', '.yml': 'yaml', '.yaml': 'yaml',
        '.md': 'markdown', '.xml': 'xml', '.sql': 'sql', '.toml': 'toml',
        '.env': 'bash', '.ini': 'ini', '.cfg': 'ini', '.conf': 'conf',
      };
      const language = langMap[ext] || 'text';

      return { type: 'text', content, language };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        set.status = 404;
        return { error: 'File not found' };
      }
      set.status = 500;
      return { error: err.message };
    }
  })
  .post('/api/projects/:id/clean-preview', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }

    const reqMode: CleanMode = normalizeMode(body.cleanMode ?? null);
    const reqProtect = Array.isArray(body.protectPaths)
      ? body.protectPaths.filter((s) => typeof s === 'string' && s.length > 0)
      : [];

    if (reqMode === 'merge') {
      return {
        tree: { name: '', path: '', type: 'dir', size: 0, willDelete: false, children: [] },
        summary: { totalFiles: 0, deleteFiles: 0, deleteBytes: 0, protectFiles: 0, truncated: false },
        mode: reqMode,
      };
    }

    const cacheKey = `${project.id}::${reqMode}::${reqProtect.slice().sort().join('|')}`;
    const cached = cleanPreviewCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.payload, cached: true };
    }

    const destPath = path.resolve(process.cwd(), project.deployPath);
    try {
      await fs.access(destPath);
    } catch {
      return {
        tree: { name: '', path: '', type: 'dir', size: 0, willDelete: false, children: [] },
        summary: { totalFiles: 0, deleteFiles: 0, deleteBytes: 0, protectFiles: 0, truncated: false },
        mode: reqMode,
        warning: 'deployPath does not exist yet',
      };
    }

    const result = await applyCleanStrategy(destPath, reqMode, reqProtect, { dryRun: true });
    const tree = buildPreviewTree(result);
    const payload = {
      tree,
      summary: {
        totalFiles: result.totalDeleteFiles + result.totalSkipFiles,
        deleteFiles: result.totalDeleteFiles,
        deleteBytes: result.totalDeleteSize,
        protectFiles: result.totalSkipFiles,
        truncated: result.truncated,
      },
      mode: reqMode,
    };
    cleanPreviewCache.set(cacheKey, { expiresAt: Date.now() + 30_000, payload });
    pruneCleanPreviewCache();
    return payload;
  }, {
    body: t.Object({
      cleanMode: t.Optional(t.Union([t.Literal('merge'), t.Literal('clean'), t.Literal('clean-all'), t.Null()])),
      protectPaths: t.Optional(t.Array(t.String())),
    })
  })
  .patch('/api/deployments/:id/status', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const nextStatus = body.status;
    if (nextStatus !== 'success' && nextStatus !== 'failed') {
      set.status = 400;
      return { error: 'status must be "success" or "failed"' };
    }

    const deployment = await db.deployments.findById(params.id);
    if (!deployment) { set.status = 404; return { error: 'Deployment not found' }; }
    if (deployment.status !== 'running') {
      set.status = 409;
      return { error: `Deployment is already ${deployment.status}, cannot mark`, code: 'NOT_RUNNING' };
    }

    const endTimeIso = new Date().toISOString();
    const startMs = new Date(deployment.startTime).getTime();
    const endMs = new Date(endTimeIso).getTime();
    const durationStr = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? ((endMs - startMs) / 1000).toFixed(1) + 's'
      : (deployment.duration || '0s');

    const markLine = `[Kite] Manually marked as ${nextStatus} by admin at ${endTimeIso}`;
    const nextOutput = deployment.output ? `${deployment.output}\n${markLine}` : markLine;

    await db.deployments.update(deployment.id, {
      status: nextStatus,
      endTime: endTimeIso,
      duration: durationStr,
      output: nextOutput,
    });

    const project = await db.projects.findById(deployment.projectId);
    if (project && project.status === 'running') {
      await db.projects.update(project.id, { status: nextStatus });
    }

    broadcastToSubscribers(deployment.id, 'log', markLine);
    broadcastToSubscribers(deployment.id, 'status', JSON.stringify({ status: nextStatus, duration: durationStr }));

    await writeAudit({ headers }, {
      action: 'deployment.mark_status',
      targetType: 'deployment',
      targetId: deployment.id,
      targetName: deployment.projectName,
      before: { status: 'running', endTime: deployment.endTime ?? null, duration: deployment.duration ?? null },
      after: { status: nextStatus, endTime: endTimeIso, duration: durationStr },
      summary: `手动将部署 ${deployment.id.slice(0, 8)} 标记为 ${nextStatus}`,
    });

    return {
      success: true,
      deployment: {
        ...deployment,
        status: nextStatus,
        endTime: endTimeIso,
        duration: durationStr,
        output: nextOutput,
      },
    };
  }, {
    body: t.Object({
      status: t.Union([t.Literal('success'), t.Literal('failed')]),
    })
  })
  .post('/api/deployments/:id/rollback', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }

    const source = await db.deployments.findById(params.id);
    if (!source) { set.status = 404; return { error: 'Deployment not found' }; }
    if (!source.artifactPath) {
      set.status = 404;
      return { error: 'Artifact not archived for this deployment', code: 'ARTIFACT_NOT_FOUND' };
    }

    try {
      await fs.access(source.artifactPath);
    } catch {
      // file vanished on disk - clear DB pointer so it shows as un-rollbackable
      await db.deployments.clearArtifactPath(source.id);
      set.status = 404;
      return { error: 'Archive file missing on disk', code: 'ARTIFACT_NOT_FOUND' };
    }

    const project = await db.projects.findById(source.projectId);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }

    const reqTraceId = pickTraceId(headers as Record<string, string | undefined>);
    const rollbackTraceId = reqTraceId || randomUUID();
    const reqLog = deployLog.child({ traceId: rollbackTraceId, projectId: project.id, rollbackOf: source.id });
    reqLog.info('rollback start');

    const effectiveMode: CleanMode = normalizeMode(project.cleanMode);
    const effectiveProtect = parseProtectPaths(project.protectPaths);

    const newDeployId = randomUUID();
    const startedAt = new Date().toISOString();

    const deploymentRow = await db.deployments.insert({
      id: newDeployId,
      projectId: project.id,
      projectName: project.name,
      status: 'running',
      triggerSource: 'rollback',
      startTime: startedAt,
      output: '',
      rollbackOf: source.id,
      // Share the same artifact file (reference-counted GC handles unlink safely)
      artifactPath: source.artifactPath,
      artifactSize: source.artifactSize ?? null,
    });
    void deploymentRow;
    await db.projects.update(project.id, { status: 'running' });

    let fullOutput = '';
    const appendLog = async (text: string) => {
      fullOutput += text + '\n';
      await db.deployments.update(newDeployId, { output: fullOutput });
      broadcastToSubscribers(newDeployId, 'log', text);
    };

    const startTime = Date.now();
    const env: Record<string, string> = { KITE_DEPLOY_TRACE_ID: rollbackTraceId };
    const destPath = path.resolve(process.cwd(), project.deployPath);

    try {
      await appendLog(`[Kite Rollback] Restoring deploy ${source.id.slice(0, 8)} for ${project.name}`);
      await fs.mkdir(destPath, { recursive: true });

      // pre-deploy
      if (project.preDeployScript) {
        await appendLog(`[Kite Rollback] Running Pre-deploy: ${project.preDeployScript}`);
        let failed = false;
        for await (const line of runShellCommand(project.preDeployScript, destPath, env)) {
          if (line.startsWith('\x00EXIT:')) {
            if (parseInt(line.slice(6)) !== 0) failed = true;
          } else {
            await appendLog(line);
          }
        }
        if (failed) throw new Error('Pre-deploy failed');
      }

      if (effectiveMode !== 'merge') {
        await appendLog(`[Kite Rollback] Applying clean strategy: ${effectiveMode} (protect ${effectiveProtect.length} patterns)`);
        const cleanRes = await applyCleanStrategy(destPath, effectiveMode, effectiveProtect, { traceId: rollbackTraceId });
        await appendLog(`[Kite Rollback] Clean done: removed ${cleanRes.totalDeleteFiles} files (${(cleanRes.totalDeleteSize / 1024).toFixed(1)} KB), kept ${cleanRes.totalSkipFiles}`);
      }

      await appendLog(`[Kite Rollback] Extracting archive...`);
      new AdmZip(source.artifactPath).extractAllTo(destPath, true);

      if (project.postDeployScript) {
        await appendLog(`[Kite Rollback] Running Post-deploy: ${project.postDeployScript}`);
        let failed = false;
        for await (const line of runShellCommand(project.postDeployScript, destPath, env)) {
          if (line.startsWith('\x00EXIT:')) {
            if (parseInt(line.slice(6)) !== 0) failed = true;
          } else {
            await appendLog(line);
          }
        }
        if (failed) throw new Error('Post-deploy failed');
      }

      const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      await appendLog(`[Kite Rollback] Rollback completed successfully in ${durationStr}.`);
      await db.deployments.update(newDeployId, { status: 'success', duration: durationStr, endTime: new Date().toISOString() });
      await db.projects.update(project.id, { status: 'success' });
      broadcastToSubscribers(newDeployId, 'status', JSON.stringify({ status: 'success', duration: durationStr }));

      await writeAudit({ headers, traceId: rollbackTraceId }, {
        action: 'deployment.rollback',
        targetType: 'deployment',
        targetId: newDeployId,
        targetName: project.name,
        before: { deployId: source.id, startTime: source.startTime },
        after: { deployId: newDeployId, startTime: startedAt, duration: durationStr, status: 'success' },
        summary: `回滚项目 ${project.name} 到部署 ${source.id.slice(0, 8)}`,
      });

      reqLog.info({ ms: Date.now() - startTime }, 'rollback success');
      return {
        success: true,
        deployId: newDeployId,
        rollbackOf: source.id,
        duration: durationStr,
        traceId: rollbackTraceId,
      };
    } catch (err: any) {
      const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
      const failMsg = `[Kite Rollback] Rollback failed: ${err.message}`;
      await appendLog(failMsg);
      await db.deployments.update(newDeployId, { status: 'failed', duration: durationStr, endTime: new Date().toISOString() });
      await db.projects.update(project.id, { status: 'failed' });
      broadcastToSubscribers(newDeployId, 'status', JSON.stringify({ status: 'failed', duration: durationStr }));

      await writeAudit({ headers, traceId: rollbackTraceId }, {
        action: 'deployment.rollback',
        targetType: 'deployment',
        targetId: newDeployId,
        targetName: project.name,
        before: { deployId: source.id, startTime: source.startTime },
        after: { deployId: newDeployId, startTime: startedAt, duration: durationStr, status: 'failed' },
        summary: `回滚项目 ${project.name} 到部署 ${source.id.slice(0, 8)} 失败`,
        status: 'failed',
        errorMessage: err?.message,
      });

      reqLog.error({ ms: Date.now() - startTime, err: { name: err?.name, message: err?.message } }, 'rollback failed');
      set.status = 500;
      return { success: false, error: err?.message, deployId: newDeployId, traceId: rollbackTraceId };
    }
  });

// ---- helpers ---------------------------------------------------------------

interface CleanPreviewCacheEntry {
  expiresAt: number;
  payload: Record<string, unknown>;
}
const cleanPreviewCache = new Map<string, CleanPreviewCacheEntry>();
const CLEAN_PREVIEW_CACHE_MAX = 64;
function pruneCleanPreviewCache() {
  if (cleanPreviewCache.size <= CLEAN_PREVIEW_CACHE_MAX) return;
  const now = Date.now();
  for (const [k, v] of cleanPreviewCache) {
    if (v.expiresAt <= now) cleanPreviewCache.delete(k);
  }
  while (cleanPreviewCache.size > CLEAN_PREVIEW_CACHE_MAX) {
    const oldest = cleanPreviewCache.keys().next().value;
    if (oldest === undefined) break;
    cleanPreviewCache.delete(oldest);
  }
}
