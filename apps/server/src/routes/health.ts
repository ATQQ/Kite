import { Elysia } from 'elysia';
import { collectHealth, getBasicHealth, isHealthDegraded } from '../lib/health.js';

const verifyAdminToken = (headers: Record<string, string | undefined>) => {
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  return token === process.env.ADMIN_TOKEN;
};

export const healthRoutes = new Elysia()
  .get('/api/health', ({ set }) => {
    const summary = getBasicHealth();
    set.status = summary.status === 'ok' ? 200 : 503;
    return summary;
  })
  .get('/api/health/detail', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const detail = await collectHealth();
    if (isHealthDegraded(detail)) set.status = 503;
    return detail;
  });
