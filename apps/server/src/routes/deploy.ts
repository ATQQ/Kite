import { Elysia, t } from 'elysia';
import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { db } from '../db/index.js';
import { randomUUID } from 'crypto';

// Token verification helper
const verifyAdminToken = (headers: Record<string, string | undefined>) => {
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];

  // Verify against the ADMIN_TOKEN loaded via Bun env
  return token === process.env.ADMIN_TOKEN;
};

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
async function* runShellCommand(command: string, cwd: string) {
  const proc = Bun.spawn(['sh', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

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
  .post('/api/auth/login', async ({ body, set }) => {
    const { token } = body;
    if (token === process.env.ADMIN_TOKEN) {
      return { success: true, message: 'Login successful' };
    }
    set.status = 401;
    return { success: false, message: 'Invalid token' };
  }, {
    body: t.Object({ token: t.String() })
  })
  .get('/api/projects', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    return await db.projects.findAll();
  })
  .post('/api/projects', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.create({
      ...body,
      id: 'proj_' + randomUUID().replace(/-/g, '').substring(0, 12),
      token: 'kt_' + randomUUID().replace(/-/g, ''),
    });
    return { success: true, project };
  }, {
    body: t.Object({
      name: t.String(),
      description: t.Optional(t.String()),
      deployPath: t.String()
    })
  })
  .get('/api/projects/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    return project;
  })
  .put('/api/projects/:id', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.update(params.id, body);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    return { success: true, project };
  }, {
    body: t.Object({
      preDeployScript: t.Optional(t.String()),
      postDeployScript: t.Optional(t.String()),
      deployPath: t.Optional(t.String())
    })
  })
  .delete('/api/projects/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    
    // params.id 会获取 URL 路径参数，比如 "proj_xxxxx"
    const success = await db.projects.remove(params.id);
    if (!success) { set.status = 404; return { error: 'Project not found' }; }
    
    return { success: true, message: 'Project deleted successfully' };
  })
  .post('/api/projects/:id/token', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.update(params.id, { token: 'kt_' + randomUUID().replace(/-/g, '') });
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
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
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }

      const token = authHeader.split(' ')[1];
      let project = await db.projects.findByToken(token);

      const file = body.file as File;
      const projectId = body.projectId;

      if (!project) {
        const globalToken = await db.settings.get('global_deploy_token');
        if (!globalToken || token !== globalToken) {
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

      console.log(`[Deploy] Received zip for project: ${projectId}`);

      const deployLog = await db.deployments.insert({
        projectId: project.id,
        projectName: project.name,
        status: 'running',
        triggerSource: 'cli',
        startTime: new Date().toISOString(),
        output: ''
      });

      await db.projects.update(project.id, { status: 'running' });

      let fullOutput = '';
      const appendLog = async (text: string) => {
        fullOutput += text + '\n';
        await db.deployments.update(deployLog.id, { output: fullOutput });
        broadcastToSubscribers(deployLog.id, 'log', text);
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

            await Bun.write(tempZipPath, await file.arrayBuffer());
            sendEvent(controller, 'log', { data: `[Kite Deploy] Saved temp zip` });
            await appendLog(`[Kite Deploy] Saved temp zip`);

            const destPath = path.resolve(process.cwd(), project.deployPath);
            await fs.mkdir(destPath, { recursive: true });
            sendEvent(controller, 'log', { data: `[Kite Deploy] Target deploy path: ${destPath}` });
            await appendLog(`[Kite Deploy] Target deploy path: ${destPath}`);

            // Pre-deploy
            if (preDeployCmd) {
              sendEvent(controller, 'log', { data: `[Kite Deploy] Running Pre-deploy: ${preDeployCmd}` });
              await appendLog(`[Kite Deploy] Running Pre-deploy: ${preDeployCmd}`);
              let failed = false;
              for await (const line of runShellCommand(preDeployCmd, destPath)) {
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

            // Extract
            sendEvent(controller, 'log', { data: `[Kite Deploy] Extracting files...` });
            await appendLog(`[Kite Deploy] Extracting files...`);
            new AdmZip(tempZipPath).extractAllTo(destPath, true);

            // Post-deploy
            if (postDeployCmd) {
              sendEvent(controller, 'log', { data: `[Kite Deploy] Running Post-deploy: ${postDeployCmd}` });
              await appendLog(`[Kite Deploy] Running Post-deploy: ${postDeployCmd}`);
              let failed = false;
              for await (const line of runShellCommand(postDeployCmd, destPath)) {
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

            await fs.unlink(tempZipPath);

            const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
            const successMsg = `[Kite Deploy] Deployment completed successfully in ${durationStr}.`;
            sendEvent(controller, 'log', { data: successMsg });
            await appendLog(successMsg);

            await db.deployments.update(deployLog.id, { status: 'success', duration: durationStr, endTime: new Date().toISOString() });
            await db.projects.update(project.id, { status: 'success' });

            sendEvent(controller, 'status', { status: 'success', duration: durationStr, deployId: deployLog.id });
            broadcastToSubscribers(deployLog.id, 'status', JSON.stringify({ status: 'success', duration: durationStr }));

          } catch (err: any) {
            const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
            const failMsg = `[Kite Deploy] Deployment failed: ${err.message}`;
            sendEvent(controller, 'log', { data: failMsg });
            await appendLog(failMsg);

            await db.deployments.update(deployLog.id, { status: 'failed', duration: durationStr, endTime: new Date().toISOString() });
            await db.projects.update(project.id, { status: 'failed' });

            sendEvent(controller, 'status', { status: 'failed', duration: durationStr, deployId: deployLog.id });
            broadcastToSubscribers(deployLog.id, 'status', JSON.stringify({ status: 'failed', duration: durationStr }));
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
      console.error('[Deploy] Error:', error);
      set.status = 500;
      return { error: error.message };
    }
  }, {
    body: t.Object({
      file: t.File(),
      projectId: t.String(),
      preDeploy: t.Optional(t.String()),
      postDeploy: t.Optional(t.String())
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
        entries
          .filter(e => !e.name.startsWith('.'))
          .map(async (entry) => {
            const fullPath = path.join(targetPath, entry.name);
            const relativePath = subPath ? `${subPath}/${entry.name}` : entry.name;
            const stat = await fs.stat(fullPath);
            return {
              name: entry.name,
              path: relativePath,
              isDir: entry.isDirectory(),
              size: stat.size,
              mtime: stat.mtime.toISOString()
            };
          })
      );

      // 目录排前，文件排后，按名称排序
      items.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
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
  });
