import { Elysia } from 'elysia';
import { verifyAdminToken } from '../lib/auth.js';
import { collectSystemResources } from '../lib/system-metrics.js';

export const systemRoutes = new Elysia()
  .get('/api/system/resources', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    return await collectSystemResources();
  });
