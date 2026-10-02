import { db } from '../db/index.js';
import { ipAllowed } from './ip-allowlist.js';
import { resolveActorIp } from './client-ip.js';

// 单一 IP 白名单：同时约束 Web 终端、CLI push 部署与回滚。
// 空数组 = 不启用；启用后无法解析来源 IP 一律拒绝（fail closed）。
export const IP_ALLOWLIST_KEY = 'terminal.ipAllowlist';

export async function loadIpAllowlist(): Promise<string[]> {
  try {
    const raw = await db.settings.get(IP_ALLOWLIST_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

export async function saveIpAllowlist(entries: string[]): Promise<void> {
  await db.settings.set(IP_ALLOWLIST_KEY, JSON.stringify(entries));
}

export interface AllowlistCheck {
  enabled: boolean;
  ip: string | null;
  allowed: boolean;
}

export async function checkIpAllowlist(
  headers: Record<string, string | string[] | undefined> | undefined | null,
): Promise<AllowlistCheck> {
  const allowlist = await loadIpAllowlist();
  const ip = resolveActorIp(headers);
  if (allowlist.length === 0) return { enabled: false, ip, allowed: true };
  if (!ip) return { enabled: true, ip: null, allowed: false };
  return { enabled: true, ip, allowed: ipAllowed(ip, allowlist) };
}
