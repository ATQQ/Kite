import { Elysia, t } from 'elysia';
import { db } from '../db/index.js';
import { verifyAdminToken } from '../lib/auth.js';

const ALL_TYPES = ['project', 'deployment', 'audit', 'logsource'] as const;
type SearchType = (typeof ALL_TYPES)[number];

const parseLimit = (v: string | undefined) => {
  if (v === undefined || v === null || v === '') return 5;
  const n = Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.min(Math.max(Math.floor(n), 1), 20);
};

const parseTypes = (v: string | undefined): SearchType[] => {
  if (!v) return [...ALL_TYPES];
  const parts = v.split(',').map(s => s.trim()).filter(Boolean);
  const allowed = parts.filter((s): s is SearchType => (ALL_TYPES as readonly string[]).includes(s));
  return allowed.length > 0 ? allowed : [...ALL_TYPES];
};

export const searchRoutes = new Elysia()
  .get('/api/search', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const q = (query.q ?? '').toString();
    const types = parseTypes(query.types);
    const limit = parseLimit(query.limit);
    const result = await db.search.run(q, types, limit);
    return result;
  }, {
    query: t.Object({
      q: t.Optional(t.String()),
      types: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    })
  });
