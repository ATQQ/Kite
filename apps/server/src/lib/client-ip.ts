import { normalizeIp } from './ip-allowlist.js';

export interface ClientIpInput {
  socketRemoteAddress?: string | null;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ClientIpResult {
  socketIp: string;
  forwardedIp: string | null;
  trusted: string;
}

export const CLIENT_IP_HEADER = 'x-kite-client-ip';

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function firstForwardedIp(headers: Record<string, string | string[] | undefined>): string | null {
  const xff = headerString(headers['x-forwarded-for']) || headerString(headers['X-Forwarded-For' as any]);
  if (typeof xff === 'string' && xff.length > 0) {
    const ip = normalizeIp(xff.split(',')[0].trim());
    if (ip) return ip;
  }
  const realIp = headerString(headers['x-real-ip']) || headerString(headers['X-Real-IP' as any]);
  if (typeof realIp === 'string' && realIp.length > 0) {
    const ip = normalizeIp(realIp.trim());
    if (ip) return ip;
  }
  return null;
}

// 日志用：优先代理转发值（反代后的真实客户端），回退 TCP socket 地址。
export function detectClientIp(input: ClientIpInput): string | null {
  return firstForwardedIp(input.headers || {}) || normalizeIp(input.socketRemoteAddress || '') || null;
}

// 读取 HTTP 层注入的 x-kite-client-ip，缺失时回退原始转发头（best-effort）。
export function resolveActorIp(headers: Record<string, string | string[] | undefined> | undefined | null): string | null {
  if (!headers) return null;
  const injected = headerString(headers[CLIENT_IP_HEADER]) || headerString(headers['X-Kite-Client-Ip' as any]);
  if (typeof injected === 'string' && injected.length > 0) {
    const ip = normalizeIp(injected);
    if (ip) return ip;
  }
  return firstForwardedIp(headers);
}

export function resolveClientIp(input: ClientIpInput): ClientIpResult {
  const socketIp = normalizeIp(input.socketRemoteAddress || '');
  const headers = input.headers || {};
  const injected = headerString(headers[CLIENT_IP_HEADER]) || headerString(headers['X-Kite-Client-Ip' as any]);
  const xff = headerString(headers['x-forwarded-for']) || headerString(headers['X-Forwarded-For' as any]);
  const realIp = headerString(headers['x-real-ip']) || headerString(headers['X-Real-IP' as any]);

  let forwardedIp: string | null = null;
  if (typeof xff === 'string' && xff.length > 0) {
    forwardedIp = normalizeIp(xff.split(',')[0].trim());
  } else if (typeof realIp === 'string' && realIp.length > 0) {
    forwardedIp = normalizeIp(realIp.trim());
  }

  // 与白名单校验（resolveActorIp）保持一致：优先使用 HTTP 层注入的客户端 IP，
  // 否则本地直连（无反向代理）时 whoami 会解析为空，导致“当前访问 IP 未知”。
  const injectedIp = typeof injected === 'string' && injected.length > 0 ? normalizeIp(injected) : '';

  return {
    socketIp,
    forwardedIp,
    trusted: injectedIp || socketIp || forwardedIp || '',
  };
}
