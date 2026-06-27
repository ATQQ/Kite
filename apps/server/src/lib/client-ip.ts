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

function headerString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function resolveClientIp(input: ClientIpInput): ClientIpResult {
  const socketIp = normalizeIp(input.socketRemoteAddress || '');
  const headers = input.headers || {};
  const xff = headerString(headers['x-forwarded-for']) || headerString(headers['X-Forwarded-For' as any]);
  const realIp = headerString(headers['x-real-ip']) || headerString(headers['X-Real-IP' as any]);

  let forwardedIp: string | null = null;
  if (typeof xff === 'string' && xff.length > 0) {
    forwardedIp = normalizeIp(xff.split(',')[0].trim());
  } else if (typeof realIp === 'string' && realIp.length > 0) {
    forwardedIp = normalizeIp(realIp.trim());
  }

  return {
    socketIp,
    forwardedIp,
    trusted: socketIp || forwardedIp || '',
  };
}
