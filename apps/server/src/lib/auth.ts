import { timingSafeEqual } from 'node:crypto';

export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function extractBearerToken(headers: Record<string, string | undefined>): string | null {
  const authHeader = headers.authorization || headers.Authorization as any;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  return token.length > 0 ? token : null;
}

export function verifyAdminToken(headers: Record<string, string | undefined>): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const token = extractBearerToken(headers);
  if (!token) return false;
  return safeEqual(token, expected);
}

export function verifyAdminTokenValue(candidate: string | undefined | null): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  return safeEqual(candidate ?? '', expected);
}

// ---------------------------------------------------------------------------
// Token strength policy
// ---------------------------------------------------------------------------

export interface TokenPolicyResult {
  ok: boolean;
  reason?: string;
}

export function validateAdminTokenStrength(token: unknown): TokenPolicyResult {
  if (typeof token !== 'string') return { ok: false, reason: 'token 必须是字符串' };
  if (token.length < 24) return { ok: false, reason: 'token 长度至少 24 个字符' };
  const hasLetter = /[A-Za-z]/.test(token);
  const hasDigit = /[0-9]/.test(token);
  if (!hasLetter || !hasDigit) return { ok: false, reason: 'token 需同时包含字母和数字' };
  if (new Set(token).size < 8) return { ok: false, reason: 'token 字符多样性不足（去重字符数需 ≥ 8）' };
  return { ok: true };
}

export function validateDeployTokenStrength(token: unknown): TokenPolicyResult {
  if (token === '') return { ok: true };
  return validateAdminTokenStrength(token);
}

// ---------------------------------------------------------------------------
// Login rate limiter (in-memory, sliding window + exponential backoff)
// ---------------------------------------------------------------------------

interface Bucket {
  fails: number;
  firstFailAt: number;
  lockUntil: number;
}

// 登录失败限流（按 IP 维度的滑动窗口 + 锁定）
// 触发路由：/api/auth/login、/api/settings/admin-token
// 行为：同一 IP 在 WINDOW_MS 内累计 LOCK_AFTER 次失败 → 锁 LOCK_MS；
//      每次失败按指数退避延迟下一次响应（BASE_DELAY_MS × 2^n，封顶 MAX_DELAY_MS）。
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 4096;          // 内存桶上限，超过会强制 GC，防止恶意 IP 喷洒导致 OOM
const WINDOW_MS = 5 * 60_000;      // 失败计数滑动窗口：5 分钟
const BASE_DELAY_MS = 250;         // 退避基础值：第 1 次失败后延迟 250ms
const MAX_DELAY_MS = 8000;         // 单次退避上限：8s（避免请求被挂太久）
const LOCK_AFTER = 5;              // 窗口内累计失败 5 次即触发锁定
const LOCK_MS = 15 * 60_000;       // 锁定时长：15 分钟，期间返回 429 + Retry-After

function gcBuckets(now: number) {
  if (buckets.size <= MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.lockUntil > now) continue;
      if (now - v.firstFailAt > WINDOW_MS) buckets.delete(k);
    }
    return;
  }
  for (const [k, v] of buckets) {
    if (v.lockUntil <= now && now - v.firstFailAt > WINDOW_MS) buckets.delete(k);
    if (buckets.size <= MAX_BUCKETS) return;
  }
  while (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

export interface LoginGuardResult {
  locked: boolean;
  retryAfterMs: number;
  delayMs: number;
}

export async function loginGuard(rawKey: string | null | undefined): Promise<LoginGuardResult> {
  const key = (rawKey && rawKey.length > 0) ? rawKey : '__global__';
  const now = Date.now();
  const bucket = buckets.get(key);

  if (bucket && bucket.lockUntil > now) {
    return { locked: true, retryAfterMs: bucket.lockUntil - now, delayMs: 0 };
  }

  if (bucket && now - bucket.firstFailAt > WINDOW_MS) {
    buckets.delete(key);
    return { locked: false, retryAfterMs: 0, delayMs: 0 };
  }

  if (!bucket || bucket.fails === 0) {
    return { locked: false, retryAfterMs: 0, delayMs: 0 };
  }

  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * Math.pow(2, bucket.fails - 1));
  if (exp > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, exp));
  }
  return { locked: false, retryAfterMs: 0, delayMs: exp };
}

export function loginFailure(rawKey: string | null | undefined): void {
  const key = (rawKey && rawKey.length > 0) ? rawKey : '__global__';
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.firstFailAt > WINDOW_MS) {
    bucket = { fails: 0, firstFailAt: now, lockUntil: 0 };
    buckets.set(key, bucket);
  }
  bucket.fails += 1;
  if (bucket.fails >= LOCK_AFTER) {
    bucket.lockUntil = now + LOCK_MS;
  }
  gcBuckets(now);
}

export function loginSuccess(rawKey: string | null | undefined): void {
  const key = (rawKey && rawKey.length > 0) ? rawKey : '__global__';
  buckets.delete(key);
}

export function pickClientKey(
  headers: Record<string, string | undefined>,
  fallback?: string,
): string {
  const xff = headers['x-forwarded-for'] || headers['X-Forwarded-For' as any];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  const real = headers['x-real-ip'] || headers['X-Real-IP' as any];
  if (typeof real === 'string' && real.length > 0) return real;
  if (fallback) return fallback;
  return '__global__';
}

// For tests
export function __resetLoginBuckets() {
  buckets.clear();
}
