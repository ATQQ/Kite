import { db } from '../db/index.js';
import { moduleLogger, isValidTraceId } from './logger.js';

const auditLog = moduleLogger('audit');

// 字段脱敏白名单（不区分大小写）
const SENSITIVE_KEYS = new Set([
  'token',
  'tokens',
  'password',
  'secret',
  'authorization',
  'auth',
  'admin_token',
  'adminToken',
  'global_deploy_token',
  'deployToken',
  'cookie',
]);

const MAX_FIELD_LENGTH = 16 * 1024; // 16KB safety cap per before/after json

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lower)) return true;
  // common suffixes like "deployToken" / "myPassword"
  return /token|secret|password/i.test(key);
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(v => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(k)) {
        out[k] = v === null || v === undefined || v === '' ? v : '****';
      } else {
        out[k] = sanitize(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

// Compute a diff for project.update style payloads:
// keys come from the user-supplied body; only return keys whose value actually changed.
export function diffFields<T extends Record<string, any>>(
  before: T | null | undefined,
  after: T | null | undefined,
  keys: string[]
): { before: Partial<T>; after: Partial<T> } {
  const beforeDiff: Partial<T> = {};
  const afterDiff: Partial<T> = {};
  for (const k of keys) {
    const b = before?.[k];
    const a = after?.[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      (beforeDiff as any)[k] = b ?? null;
      (afterDiff as any)[k] = a ?? null;
    }
  }
  return { before: beforeDiff, after: afterDiff };
}

function serialize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    let json = JSON.stringify(sanitize(value));
    if (json.length > MAX_FIELD_LENGTH) {
      json = json.slice(0, MAX_FIELD_LENGTH - 20) + '..."[truncated]"';
    }
    return json;
  } catch {
    return null;
  }
}

export interface AuditContext {
  headers?: Record<string, string | undefined>;
  request?: Request;
  ip?: string;
  traceId?: string;
}

export interface AuditPayload {
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  before?: unknown;
  after?: unknown;
  summary?: string;
  status?: 'success' | 'failed';
  errorMessage?: string;
}

function pickIp(ctx: AuditContext): string | null {
  if (ctx.ip) return ctx.ip;
  const h = ctx.headers || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For' as any];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  const real = h['x-real-ip'] || h['X-Real-IP' as any];
  if (typeof real === 'string' && real.length > 0) return real;
  return null;
}

function pickTraceIdFromCtx(ctx: AuditContext): string | null {
  if (isValidTraceId(ctx.traceId)) return ctx.traceId;
  const h = ctx.headers || {};
  const raw = h['x-kite-trace-id'] || h['X-Kite-Trace-Id' as any];
  return isValidTraceId(raw) ? raw : null;
}

// Best-effort audit writer. Must never throw to caller.
export async function writeAudit(ctx: AuditContext, payload: AuditPayload): Promise<void> {
  const traceId = pickTraceIdFromCtx(ctx);
  const summary = traceId && payload.summary
    ? `[trace:${traceId.slice(0, 8)}] ${payload.summary}`
    : payload.summary ?? null;
  try {
    await db.auditLogs.create({
      action: payload.action,
      targetType: payload.targetType ?? null,
      targetId: payload.targetId ?? null,
      targetName: payload.targetName ?? null,
      before: serialize(payload.before),
      after: serialize(payload.after),
      summary,
      status: payload.status || 'success',
      errorMessage: payload.errorMessage ?? null,
      actorIp: pickIp(ctx),
    });
    auditLog.info(
      {
        traceId: traceId || undefined,
        action: payload.action,
        targetType: payload.targetType,
        targetId: payload.targetId,
        status: payload.status || 'success',
      },
      payload.summary || payload.action,
    );
  } catch (err) {
    auditLog.error({ traceId: traceId || undefined, err }, 'failed to write audit log');
  }
}
