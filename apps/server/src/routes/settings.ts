import { Elysia, t } from 'elysia';
import { db } from '../db/index.js';
import fs from 'fs/promises';
import path from 'path';

const verifyAdminToken = (headers: Record<string, string | undefined>) => {
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  return token === process.env.ADMIN_TOKEN;
};

const serverStartTime = Date.now();

const serverPkg = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf-8'));

export const settingsRoutes = new Elysia()
  .get('/api/settings', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const all = await db.settings.getAll();
    return all;
  })
  .put('/api/settings', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const allowed = ['webhook_url', 'webhook_events', 'default_deploy_path', 'max_upload_size'];
    const entries: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (allowed.includes(key)) {
        entries[key] = String(value);
      }
    }
    await db.settings.setMany(entries);
    return { success: true, message: 'Settings updated' };
  }, {
    body: t.Object({
      webhook_url: t.Optional(t.String()),
      webhook_events: t.Optional(t.String()),
      default_deploy_path: t.Optional(t.String()),
      max_upload_size: t.Optional(t.String()),
    })
  })
  .post('/api/settings/token', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const { oldToken, newToken } = body;
    if (oldToken !== process.env.ADMIN_TOKEN) {
      set.status = 400;
      return { error: '旧 Token 不正确' };
    }
    if (!newToken || newToken.length < 8) {
      set.status = 400;
      return { error: '新 Token 长度不能少于 8 位' };
    }
    // Update .env.local
    const envPath = path.join(process.cwd(), '.env.local');
    let envContent = '';
    try {
      envContent = await fs.readFile(envPath, 'utf-8');
    } catch {
      envContent = '';
    }
    const lines = envContent.split('\n').filter(l => !l.startsWith('ADMIN_TOKEN='));
    lines.push(`ADMIN_TOKEN=${newToken}`);
    await fs.writeFile(envPath, lines.join('\n') + '\n');
    // Update runtime env
    process.env.ADMIN_TOKEN = newToken;
    return { success: true, message: 'Token 已更新，下次登录请使用新 Token' };
  }, {
    body: t.Object({
      oldToken: t.String(),
      newToken: t.String(),
    })
  })
  .get('/api/settings/status', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const projects = await db.projects.findAll();
    const deployments = await db.deployments.findAll();
    const successCount = deployments.filter(d => d.status === 'success').length;
    const failedCount = deployments.filter(d => d.status === 'failed').length;
    const uptimeMs = Date.now() - serverStartTime;
    const uptimeHours = Math.floor(uptimeMs / 3600000);
    const uptimeMinutes = Math.floor((uptimeMs % 3600000) / 60000);
    return {
      version: serverPkg.version,
      uptime: uptimeHours > 0 ? `${uptimeHours}h ${uptimeMinutes}m` : `${uptimeMinutes}m`,
      projectCount: projects.length,
      deploymentCount: deployments.length,
      successCount,
      failedCount,
      successRate: deployments.length > 0 ? Math.round((successCount / deployments.length) * 100) : 0,
    };
  });
