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

const runShellCommand = async (command: string, cwd: string) => {
  const proc = Bun.spawn(['sh', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe'
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  return { stdout, stderr, exitCode };
};

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
  .post('/api/deploy/upload', async ({ body, headers, set }) => {
    try {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        set.status = 401;
        return { error: 'Missing or invalid Authorization header' };
      }
      
      const token = authHeader.split(' ')[1];
      const project = await db.projects.findByToken(token);
      
      if (!project) {
        set.status = 403;
        return { error: 'Invalid Token' };
      }

      // 获取 body 中的字段
      const file = body.file as File;
      const projectId = body.projectId;
      
      if (projectId !== project.id) {
        set.status = 403;
        return { error: 'Project ID mismatch' };
      }

      // 覆盖指令：CLI > 平台
      const preDeployCmd = body.preDeploy || project.preDeployScript;
      const postDeployCmd = body.postDeploy || project.postDeployScript;

      console.log(`[Deploy] Received zip for project: ${projectId}`);
      
      const deployLog = await db.deployments.insert({
        projectId: project.id,
        projectName: project.name,
        status: 'running',
        triggerSource: 'cli',
        startTime: new Date().toISOString(),
        output: `[Kite Deploy] Starting deployment for ${project.name}...\n`
      });

      await db.projects.update(project.id, { status: 'running' });

      let fullOutput = deployLog.output;
      const appendLog = async (text: string) => {
        fullOutput += text + '\n';
        await db.deployments.update(deployLog.id, { output: fullOutput });
      };

      const startTime = Date.now();

      try {
        // 1. 保存 zip 到临时目录
        const tempDir = path.join(process.cwd(), '.temp_deploy');
        await fs.mkdir(tempDir, { recursive: true });
        const tempZipPath = path.join(tempDir, `${Date.now()}.zip`);
        
        // bun 中直接读写 ArrayBuffer
        await Bun.write(tempZipPath, await file.arrayBuffer());
        await appendLog(`[Kite Deploy] Saved temp zip to: ${tempZipPath}`);

        // 2. 准备解压目录
        const destPath = path.resolve(process.cwd(), project.deployPath);
        await fs.mkdir(destPath, { recursive: true });
        await appendLog(`[Kite Deploy] Target deploy path: ${destPath}`);

        // 3. 执行前置脚本（在解压之前）
        if (preDeployCmd) {
          await appendLog(`[Kite Deploy] Running Pre-deploy: ${preDeployCmd}`);
          const { stdout, stderr, exitCode } = await runShellCommand(preDeployCmd, destPath);
          if (stdout) await appendLog(stdout.trimEnd());
          if (exitCode !== 0) {
             if (stderr) await appendLog(stderr.trimEnd());
             throw new Error(`Pre-deploy failed`);
          }
        }

        // 4. 解压
        await appendLog(`[Kite Deploy] Extracting files...`);
        const zip = new AdmZip(tempZipPath);
        zip.extractAllTo(destPath, true); // true=覆盖文件

        // 5. 执行后置脚本（解压之后）
        if (postDeployCmd) {
          await appendLog(`[Kite Deploy] Running Post-deploy: ${postDeployCmd}`);
          const { stdout, stderr, exitCode } = await runShellCommand(postDeployCmd, destPath);
          if (stdout) await appendLog(stdout.trimEnd());
          if (exitCode !== 0) {
            if (stderr) await appendLog(stderr.trimEnd());
            throw new Error(`Post-deploy failed`);
          }
        }

        // 清理临时文件
        await fs.unlink(tempZipPath);

        const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
        await appendLog(`[Kite Deploy] Deployment completed successfully in ${durationStr}.`);
        
        await db.deployments.update(deployLog.id, { 
          status: 'success', 
          duration: durationStr,
          endTime: new Date().toISOString()
        });
        await db.projects.update(project.id, { status: 'success' });

        return { 
          success: true, 
          message: 'Deployed successfully'
        };

      } catch (err: any) {
        const durationStr = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
        await appendLog(`[Kite Deploy] Deployment failed: ${err.message}`);
        
        await db.deployments.update(deployLog.id, { 
          status: 'failed', 
          duration: durationStr,
          endTime: new Date().toISOString()
        });
        await db.projects.update(project.id, { status: 'failed' });
        
        set.status = 500;
        return { error: err.message };
      }

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
  });
