import { Elysia, t } from 'elysia';
import { db } from '../db/index.js';
import { verifyAdminToken } from '../lib/auth.js';

const parseNum = (v: string | undefined, fallback: number) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const auditRoutes = new Elysia()
  .get('/api/audit-logs', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const limit = Math.min(Math.max(parseNum(query.limit, 50), 1), 200);
    const offset = Math.max(parseNum(query.offset, 0), 0);
    const result = await db.auditLogs.list({
      action: query.action || undefined,
      targetId: query.targetId || undefined,
      targetType: query.targetType || undefined,
      from: parseNum(query.from, 0) || undefined,
      to: parseNum(query.to, 0) || undefined,
      limit,
      offset,
    });
    return result;
  }, {
    query: t.Object({
      action: t.Optional(t.String()),
      targetId: t.Optional(t.String()),
      targetType: t.Optional(t.String()),
      from: t.Optional(t.String()),
      to: t.Optional(t.String()),
      limit: t.Optional(t.String()),
      offset: t.Optional(t.String()),
    })
  })
  .get('/api/audit-logs/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const row = await db.auditLogs.findById(params.id);
    if (!row) { set.status = 404; return { error: 'Audit log not found' }; }
    return row;
  });
