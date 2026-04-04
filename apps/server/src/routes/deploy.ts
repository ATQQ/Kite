import { Elysia, t } from 'elysia';
import fs from 'fs/promises';
import path from 'path';
import AdmZip from 'adm-zip';
import { $ } from 'bun';
import { db } from '../db/index.js';

export const deployRoutes = new Elysia()
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
      
      // 1. 保存 zip 到临时目录
      const tempDir = path.join(process.cwd(), '.temp_deploy');
      await fs.mkdir(tempDir, { recursive: true });
      const tempZipPath = path.join(tempDir, `${Date.now()}.zip`);
      
      // bun 中直接读写 ArrayBuffer
      await Bun.write(tempZipPath, await file.arrayBuffer());
      console.log(`[Deploy] Saved temp zip to: ${tempZipPath}`);

      // 2. 准备解压目录
      const destPath = path.resolve(process.cwd(), project.deployPath);
      await fs.mkdir(destPath, { recursive: true });

      // 3. 执行前置脚本（在解压之前）
      if (preDeployCmd) {
        console.log(`[Deploy] Running Pre-deploy: ${preDeployCmd}`);
        const { stdout, stderr, exitCode } = await $`cd ${destPath} && sh -c ${preDeployCmd}`;
        if (exitCode !== 0) throw new Error(`Pre-deploy failed: ${stderr.toString()}`);
      }

      // 4. 解压
      console.log(`[Deploy] Extracting to: ${destPath}`);
      const zip = new AdmZip(tempZipPath);
      zip.extractAllTo(destPath, true); // true=覆盖文件

      // 5. 执行后置脚本（解压之后）
      let postDeployLog = '';
      if (postDeployCmd) {
        console.log(`[Deploy] Running Post-deploy: ${postDeployCmd}`);
        const { stdout, stderr, exitCode } = await $`cd ${destPath} && sh -c ${postDeployCmd}`;
        if (exitCode !== 0) {
          throw new Error(`Post-deploy failed: ${stderr.toString()}`);
        }
        postDeployLog = stdout.toString();
      }

      // 清理临时文件
      await fs.unlink(tempZipPath);

      return { 
        success: true, 
        message: 'Deployed successfully',
        postDeployLog 
      };

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
