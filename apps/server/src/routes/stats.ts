import { Elysia } from 'elysia';
import { db } from '../db/index.js';

const verifyAdminToken = (headers: Record<string, string | undefined>) => {
  const authHeader = headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split(' ')[1];
  return token === process.env.ADMIN_TOKEN;
};

interface CacheEntry<T> { value: T; expireAt: number }
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry<any>>();

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expireAt < Date.now()) { cache.delete(key); return null; }
  return entry.value as T;
}
function cacheSet<T>(key: string, value: T) {
  cache.set(key, { value, expireAt: Date.now() + CACHE_TTL_MS });
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

function todayUtcDate(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildDateRange(days: number): { since: Date; dates: string[] } {
  const today = todayUtcDate();
  const since = new Date(today.getTime() - (days - 1) * 86400_000);
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    dates.push(isoDate(new Date(since.getTime() + i * 86400_000)));
  }
  return { since, dates };
}

export const statsRoutes = new Elysia()
  .get('/api/stats/heatmap', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const days = clampInt((query as any)?.days, 1, 90, 30);
    const cacheKey = `heatmap:${days}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { since, dates } = buildDateRange(days);
    const rows = await db.stats.heatmap(since.toISOString());
    const map = new Map(rows.map(r => [r.date, r.count]));
    const cells = dates.map(d => ({ date: d, count: map.get(d) ?? 0 }));
    const result = { days, cells };
    cacheSet(cacheKey, result);
    return result;
  })
  .get('/api/stats/success-rate', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const days = clampInt((query as any)?.days, 1, 60, 14);
    const cacheKey = `success-rate:${days}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { since, dates } = buildDateRange(days);
    const rows = await db.stats.successRate(since.toISOString());
    const map = new Map(rows.map(r => [r.date, r]));
    const points = dates.map(d => {
      const r = map.get(d);
      const success = r?.success ?? 0;
      const failed = r?.failed ?? 0;
      const total = success + failed;
      const rate = total > 0 ? Math.round((success / total) * 10000) / 10000 : null;
      return { date: d, success, failed, total, rate };
    });
    const result = { days, points };
    cacheSet(cacheKey, result);
    return result;
  })
  .get('/api/stats/failure-top', async ({ headers, query, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const days = clampInt((query as any)?.days, 1, 90, 30);
    const limit = clampInt((query as any)?.limit, 1, 20, 5);
    const minTotal = clampInt((query as any)?.minTotal, 1, 100, 3);
    const cacheKey = `failure-top:${days}:${limit}:${minTotal}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { since } = buildDateRange(days);
    const items = await db.stats.failureTop(since.toISOString(), limit, minTotal);
    const result = { days, limit, minTotal, items };
    cacheSet(cacheKey, result);
    return result;
  });
