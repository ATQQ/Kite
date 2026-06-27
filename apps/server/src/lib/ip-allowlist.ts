function normalizeIp(ip: string): string {
  if (!ip) return '';
  let s = ip.trim();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  // IPv4-mapped IPv6 ::ffff:127.0.0.1 → 127.0.0.1
  const v4mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (v4mapped) return v4mapped[1];
  if (s === '::1') return '::1';
  return s.toLowerCase();
}

function isIPv4(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

function ipv4ToInt(s: string): number {
  const parts = s.split('.').map((p) => Number(p));
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPv6(s: string): boolean {
  // Lightweight check; full validation done by expandIPv6.
  return s.includes(':') && /^[0-9a-fA-F:]+$/.test(s);
}

function expandIPv6(s: string): bigint | null {
  if (s === '::') return 0n;
  const dq = s.indexOf('::');
  let head: string[];
  let tail: string[];
  if (dq >= 0) {
    head = s.slice(0, dq) ? s.slice(0, dq).split(':') : [];
    tail = s.slice(dq + 2) ? s.slice(dq + 2).split(':') : [];
  } else {
    head = s.split(':');
    tail = [];
  }
  // Support trailing IPv4 (e.g. ::ffff:1.2.3.4) — convert to two 16-bit groups
  const last = tail.length ? tail[tail.length - 1] : (head.length ? head[head.length - 1] : '');
  if (last && last.includes('.')) {
    if (!isIPv4(last)) return null;
    const v4 = ipv4ToInt(last);
    const hi = (v4 >>> 16) & 0xffff;
    const lo = v4 & 0xffff;
    if (tail.length) {
      tail = tail.slice(0, -1).concat(hi.toString(16), lo.toString(16));
    } else {
      head = head.slice(0, -1).concat(hi.toString(16), lo.toString(16));
    }
  }
  const totalGroups = head.length + tail.length;
  if (totalGroups > 8) return null;
  if (dq < 0 && totalGroups !== 8) return null;
  const fill = 8 - totalGroups;
  const groups: string[] = [...head, ...Array.from({ length: fill }, () => '0'), ...tail];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const g of groups) {
    if (g.length === 0 || g.length > 4) return null;
    if (!/^[0-9a-fA-F]+$/.test(g)) return null;
    result = (result << 16n) | BigInt(parseInt(g, 16));
  }
  return result;
}

export interface ParsedAllowlistEntry {
  kind: 'v4' | 'v6';
  base: bigint;
  mask: bigint;
  prefixLen: number;
  raw: string;
}

export function parseAllowlistEntry(raw: string): ParsedAllowlistEntry | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf('/');
  let host = trimmed;
  let prefix: number | null = null;
  if (slash >= 0) {
    host = trimmed.slice(0, slash);
    const p = Number(trimmed.slice(slash + 1));
    if (!Number.isInteger(p) || p < 0) return null;
    prefix = p;
  }
  const norm = normalizeIp(host);
  if (isIPv4(norm)) {
    if (prefix === null) prefix = 32;
    if (prefix > 32) return null;
    const ipInt = BigInt(ipv4ToInt(norm));
    const mask = prefix === 0 ? 0n : ((0xffffffffn << BigInt(32 - prefix)) & 0xffffffffn);
    return { kind: 'v4', base: ipInt & mask, mask, prefixLen: prefix, raw: trimmed };
  }
  if (isIPv6(norm)) {
    if (prefix === null) prefix = 128;
    if (prefix > 128) return null;
    const ipInt = expandIPv6(norm);
    if (ipInt === null) return null;
    const full = (1n << 128n) - 1n;
    const mask = prefix === 0 ? 0n : (full << BigInt(128 - prefix)) & full;
    return { kind: 'v6', base: ipInt & mask, mask, prefixLen: prefix, raw: trimmed };
  }
  return null;
}

export function parseAllowlist(entries: string[] | undefined | null): {
  parsed: ParsedAllowlistEntry[];
  invalid: string[];
} {
  const parsed: ParsedAllowlistEntry[] = [];
  const invalid: string[] = [];
  if (!Array.isArray(entries)) return { parsed, invalid };
  for (const raw of entries) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const p = parseAllowlistEntry(trimmed);
    if (p) parsed.push(p);
    else invalid.push(trimmed);
  }
  return { parsed, invalid };
}

export function ipMatchesEntry(ip: string, entry: ParsedAllowlistEntry): boolean {
  const norm = normalizeIp(ip);
  if (entry.kind === 'v4') {
    if (!isIPv4(norm)) return false;
    const ipInt = BigInt(ipv4ToInt(norm));
    return (ipInt & entry.mask) === entry.base;
  }
  if (!isIPv6(norm)) return false;
  const ipInt = expandIPv6(norm);
  if (ipInt === null) return false;
  return (ipInt & entry.mask) === entry.base;
}

export function ipAllowed(ip: string, allowlist: string[] | undefined | null): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const { parsed } = parseAllowlist(allowlist);
  if (parsed.length === 0) return true;
  for (const entry of parsed) {
    if (ipMatchesEntry(ip, entry)) return true;
  }
  return false;
}

export { normalizeIp };
