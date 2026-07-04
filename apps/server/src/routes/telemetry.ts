import { Elysia } from 'elysia';
import { db } from '../db/index.js';
import { moduleLogger } from '../lib/logger.js';

const log = moduleLogger('telemetry');

const ALLOWED_EVENTS = new Set(['kite.serve.startup', 'kite.push.start']);
const MAX_STRING_LEN = 64;

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

function applyCors(set: { headers: Record<string, string> }) {
  const h = set.headers || {};
  h['Access-Control-Allow-Origin'] = '*';
  h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  h['Access-Control-Allow-Headers'] = 'Content-Type';
  h['Access-Control-Max-Age'] = '86400';
  set.headers = h;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_STRING_LEN;
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

export const telemetryRoutes = new Elysia()
  .options('/api/telemetry', ({ set }) => {
    applyCors(set as any);
    set.status = 204;
    return '';
  })
  .post('/api/telemetry', async ({ body, set }) => {
    applyCors(set as any);
    try {
      const b = (body ?? {}) as Record<string, unknown>;
      const event = typeof b.event === 'string' ? b.event : '';
      const ts = Number(b.ts);
      const kiteVersion = typeof b.kiteVersion === 'string' ? b.kiteVersion : '';
      const instanceId = typeof b.instanceId === 'string' ? b.instanceId : '';
      const os = typeof b.os === 'string' ? b.os : '';
      const arch = typeof b.arch === 'string' ? b.arch : '';

      if (
        !ALLOWED_EVENTS.has(event) ||
        !Number.isFinite(ts) ||
        !isNonEmptyString(kiteVersion) ||
        !isNonEmptyString(instanceId) ||
        !isNonEmptyString(os) ||
        !isNonEmptyString(arch)
      ) {
        set.status = 204;
        return '';
      }

      await db.telemetry.insertEvent({ event, ts, kiteVersion, instanceId, os, arch });
      return { ok: true };
    } catch (err) {
      log.warn({ err: (err as any)?.message }, 'telemetry ingest failed');
      return { ok: true };
    }
  })
  .options('/api/public/telemetry/overview', ({ set }) => {
    applyCors(set as any);
    set.status = 204;
    return '';
  })
  .get('/api/public/telemetry/overview', async ({ query, set }) => {
    applyCors(set as any);
    const days = clampInt((query as any)?.days, 1, 90, 30);
    const cacheKey = `overview:${days}`;
    const cached = cacheGet<any>(cacheKey);
    if (cached) return { ...cached, cached: true };

    const { since, dates } = buildDateRange(days);
    const sinceIso = since.toISOString();

    const [totals, dailyRows, versionRows, osRows, archRows] = await Promise.all([
      db.telemetry.totals(sinceIso),
      db.telemetry.daily(sinceIso),
      db.telemetry.groupBy('kite_version', sinceIso, 20),
      db.telemetry.groupBy('os', sinceIso, 10),
      db.telemetry.groupBy('arch', sinceIso, 10),
    ]);

    const dailyMap = new Map(dailyRows.map(r => [r.date, r]));
    const daily = dates.map(d => {
      const r = dailyMap.get(d);
      return {
        date: d,
        serveStartup: r?.serveStartup ?? 0,
        pushStart: r?.pushStart ?? 0,
        activeInstances: r?.activeInstances ?? 0,
      };
    });

    const result = {
      days,
      generatedAt: new Date().toISOString(),
      totals,
      daily,
      versions: versionRows.map(r => ({ kiteVersion: r.key, events: r.events })),
      os: osRows.map(r => ({ os: r.key, events: r.events })),
      arch: archRows.map(r => ({ arch: r.key, events: r.events })),
    };
    cacheSet(cacheKey, result);
    return result;
  });
