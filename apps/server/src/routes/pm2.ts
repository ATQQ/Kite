import { Elysia } from 'elysia';
import { db } from '../db/index.js';
import { verifyAdminToken } from '../lib/auth.js';
import { getPm2AppStatus, isPm2Available, listPm2Apps } from '../lib/pm2.js';

export const pm2Routes = new Elysia()
  .get('/api/pm2/available', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const available = await isPm2Available();
    return { available };
  })
  .get('/api/pm2/apps', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const apps = await listPm2Apps();
    return { apps };
  })
  .get('/api/projects/:id/pm2', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const project = await db.projects.findById(params.id);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    if (!project.pm2AppName) {
      return { bound: false, message: 'project has no pm2 app bound' };
    }
    const status = await getPm2AppStatus(project.pm2AppName);
    return { bound: true, ...status };
  });
