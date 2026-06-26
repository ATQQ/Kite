import { Elysia } from 'elysia';
import { verifyAdminToken, verifyAdminTokenValue, safeEqual, loginGuard, loginFailure, loginSuccess } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { db } from '../db/index.js';
import { resolveClientIp } from '../lib/client-ip.js';
import { ipAllowed, parseAllowlist } from '../lib/ip-allowlist.js';
import {
  loadPty,
  isPlatformSupported,
  defaultShell,
  resolveCwd,
  spawnTerminalSession,
  listSessionsCounts,
  TERMINAL_LIMITS,
  type PtyHandle,
} from '../lib/terminal.js';
import os from 'node:os';
import { moduleLogger } from '../lib/logger.js';

const termLog = moduleLogger('terminal-route');

export const TERMINAL_ALLOWLIST_KEY = 'terminal.ipAllowlist';
export const TERMINAL_SUBPROTOCOL = 'kite-admin-token';

export async function loadTerminalAllowlist(): Promise<string[]> {
  try {
    const raw = await db.settings.get(TERMINAL_ALLOWLIST_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
    return [];
  } catch {
    return [];
  }
}

async function saveTerminalAllowlist(entries: string[]): Promise<void> {
  await db.settings.set(TERMINAL_ALLOWLIST_KEY, JSON.stringify(entries));
}

export const terminalRoutes = new Elysia()
  .get('/api/terminal/whoami', ({ request, headers, set }) => {
    if (!verifyAdminToken(headers as any)) { set.status = 401; return { error: 'Unauthorized' }; }
    const sockRemote = (request as any)?.socket?.remoteAddress
      || (headers as any)['x-kite-socket-ip']
      || null;
    const info = resolveClientIp({
      socketRemoteAddress: sockRemote || undefined,
      headers: headers as any,
    });
    return {
      socketIp: info.socketIp || null,
      forwardedIp: info.forwardedIp,
      trustedIp: info.trusted || null,
    };
  })
  .get('/api/terminal/info', async ({ headers, set }) => {
    if (!verifyAdminToken(headers as any)) { set.status = 401; return { error: 'Unauthorized' }; }
    const platformOk = isPlatformSupported();
    const load = platformOk ? await loadPty() : { available: false, error: `当前平台不支持终端能力：${process.platform}` };
    const allowlist = await loadTerminalAllowlist();
    const counts = listSessionsCounts();
    return {
      available: load.available,
      reason: load.available ? null : (load.error || 'unknown'),
      shell: defaultShell(),
      platform: process.platform,
      defaultCwd: os.homedir(),
      limits: TERMINAL_LIMITS,
      sessions: counts,
      allowlist,
      allowlistEnabled: allowlist.length > 0,
    };
  })
  .get('/api/terminal/allowlist', async ({ headers, set }) => {
    if (!verifyAdminToken(headers as any)) { set.status = 401; return { error: 'Unauthorized' }; }
    const allowlist = await loadTerminalAllowlist();
    const { invalid } = parseAllowlist(allowlist);
    return { entries: allowlist, invalid };
  })
  .put('/api/terminal/allowlist', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers as any)) { set.status = 401; return { error: 'Unauthorized' }; }
    const input = (body as any)?.entries;
    if (!Array.isArray(input)) { set.status = 400; return { error: 'entries 必须是字符串数组' }; }
    const normalized: string[] = [];
    const invalid: string[] = [];
    for (const raw of input) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const { parsed } = parseAllowlist([trimmed]);
      if (parsed.length === 1) normalized.push(trimmed);
      else invalid.push(trimmed);
    }
    if (invalid.length > 0) {
      set.status = 400;
      return { error: `存在无效的 IP / CIDR：${invalid.join(', ')}` };
    }
    const before = await loadTerminalAllowlist();
    await saveTerminalAllowlist(normalized);
    await writeAudit({ headers: headers as any }, {
      action: 'terminal.allowlist.update',
      targetType: 'settings',
      before: { entries: before },
      after: { entries: normalized },
      summary: `更新终端 IP 白名单（${normalized.length} 条）`,
    });
    return { success: true, entries: normalized };
  });

// =============================================================================
// WebSocket upgrade handler — used by both Bun and Node entrypoints.
// =============================================================================

export interface TerminalUpgradeContext {
  url: URL;
  headers: Record<string, string | string[] | undefined>;
  socketRemoteAddress: string | null;
  origin: string | null;
  expectedOrigin: string | null;
  subprotocols: string[];
}

export interface TerminalUpgradeDecision {
  ok: boolean;
  status?: number;
  reason?: string;
  selectedProtocol?: string;
  token?: string;
  ip?: string;
  cwd?: string;
  projectId?: string | null;
  cols?: number;
  rows?: number;
}

function parseSubprotocols(headerValue: string | string[] | undefined | null): string[] {
  if (!headerValue) return [];
  const raw = Array.isArray(headerValue) ? headerValue.join(',') : headerValue;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function decideTerminalUpgrade(ctx: TerminalUpgradeContext): Promise<TerminalUpgradeDecision> {
  // 1. Path check
  if (!ctx.url.pathname.startsWith('/api/terminal/ws')) {
    return { ok: false, status: 404, reason: 'not-terminal-route' };
  }
  // 2. Origin check (same site only). When called via Vite dev proxy the Origin
  //    points to localhost:5429 which is fine — only reject when present and mismatched.
  if (ctx.origin && ctx.expectedOrigin) {
    try {
      const a = new URL(ctx.origin);
      const b = new URL(ctx.expectedOrigin);
      if (a.host !== b.host) {
        // allow vite dev origin in development
        const isLocalDev = /(^|:)(localhost|127\.0\.0\.1)(:|$)/.test(a.host) && /(^|:)(localhost|127\.0\.0\.1)(:|$)/.test(b.host);
        if (!isLocalDev) return { ok: false, status: 403, reason: 'origin-mismatch' };
      }
    } catch {
      return { ok: false, status: 400, reason: 'invalid-origin' };
    }
  }
  // 3. Subprotocol token
  const subs = parseSubprotocols(ctx.subprotocols.length ? ctx.subprotocols.join(', ') : ctx.headers['sec-websocket-protocol'] as any);
  const protoIdx = subs.findIndex((s) => s === TERMINAL_SUBPROTOCOL);
  if (protoIdx < 0 || protoIdx + 1 >= subs.length) {
    return { ok: false, status: 401, reason: 'missing-token-protocol' };
  }
  const token = subs[protoIdx + 1];

  // 4. Resolve client IP
  const ipInfo = resolveClientIp({
    socketRemoteAddress: ctx.socketRemoteAddress || undefined,
    headers: ctx.headers,
  });
  const ip = ipInfo.socketIp || ipInfo.forwardedIp || 'unknown';

  // 5. Brute-force guard
  const guard = await loginGuard(ip);
  if (guard.locked) {
    return { ok: false, status: 429, reason: 'rate-limited' };
  }

  // 6. Token check
  const tokenValid = verifyAdminTokenValue(token) && safeEqual(token, process.env.ADMIN_TOKEN || '');
  if (!tokenValid) {
    loginFailure(ip);
    return { ok: false, status: 401, reason: 'invalid-token' };
  }
  loginSuccess(ip);

  // 7. IP allowlist check
  const allowlist = await loadTerminalAllowlist();
  if (allowlist.length > 0 && !ipAllowed(ip, allowlist)) {
    await writeAudit({ headers: ctx.headers as any }, {
      action: 'terminal.denied',
      targetType: 'terminal',
      summary: `终端访问被 IP 白名单拒绝：${ip}`,
      status: 'failed',
      errorMessage: `IP ${ip} 不在白名单中`,
    });
    termLog.warn({ ip }, 'terminal connection rejected by allowlist');
    return { ok: false, status: 403, reason: 'ip-not-allowed' };
  }

  // 8. Resolve cwd
  const projectId = ctx.url.searchParams.get('projectId');
  let cwd = os.homedir();
  if (projectId) {
    const proj = await db.projects.findById(projectId);
    if (proj && proj.deployPath) {
      cwd = resolveCwd(proj.deployPath);
    }
  } else {
    const cwdParam = ctx.url.searchParams.get('cwd');
    if (cwdParam) cwd = resolveCwd(cwdParam);
  }

  const cols = Number(ctx.url.searchParams.get('cols')) || 80;
  const rows = Number(ctx.url.searchParams.get('rows')) || 24;

  return {
    ok: true,
    status: 101,
    selectedProtocol: TERMINAL_SUBPROTOCOL,
    token,
    ip,
    cwd,
    projectId: projectId || null,
    cols,
    rows,
  };
}

export interface AttachTerminalSocketParams {
  socket: WebSocketLike;
  ip: string;
  cwd: string;
  projectId: string | null;
  cols: number;
  rows: number;
  headers: Record<string, string | string[] | undefined>;
}

export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: any, isBinary?: boolean) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: unknown) => void): void;
  readyState: number;
}

const OPEN = 1;

function safeJsonParse(value: string): any | null {
  try { return JSON.parse(value); } catch { return null; }
}

export async function attachTerminalSocket(params: AttachTerminalSocketParams): Promise<void> {
  const startedAt = Date.now();
  let handle: PtyHandle | null = null;
  let exitedCode: number | null = null;

  const sendJson = (obj: any) => {
    try {
      if (params.socket.readyState === OPEN) params.socket.send(JSON.stringify(obj));
    } catch {}
  };

  const spawnResult = await spawnTerminalSession({
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    ip: params.ip,
  });
  if (!spawnResult.ok || !spawnResult.handle) {
    sendJson({ type: 'error', reason: spawnResult.reason, message: spawnResult.message });
    try { params.socket.close(4000, spawnResult.message || 'spawn failed'); } catch {}
    return;
  }
  handle = spawnResult.handle;

  handle.onData((chunk) => {
    if (params.socket.readyState !== OPEN) return;
    // chunk is a string from node-pty; forward as utf-8 text frame.
    try { params.socket.send(JSON.stringify({ type: 'data', data: chunk })); } catch {}
  });

  handle.onExit((info) => {
    exitedCode = info.exitCode ?? 0;
    sendJson({ type: 'exit', exitCode: info.exitCode, signal: info.signal ?? null });
    try { params.socket.close(1000, 'pty exited'); } catch {}
  });

  sendJson({
    type: 'ready',
    sessionId: handle.id,
    pid: handle.pid,
    shell: handle.shell,
    cwd: handle.cwd,
    projectId: params.projectId,
  });

  void writeAudit({ headers: params.headers as any }, {
    action: 'terminal.open',
    targetType: 'terminal',
    targetId: handle.id,
    targetName: params.projectId ? `project:${params.projectId}` : 'global',
    summary: `打开终端 cwd=${handle.cwd} pid=${handle.pid}`,
  });

  params.socket.on('message', (data: any, isBinary?: boolean) => {
    if (!handle) return;
    let raw: string;
    if (typeof data === 'string') raw = data;
    else if (data instanceof Buffer) raw = data.toString('utf8');
    else if (data?.toString) raw = data.toString();
    else raw = '';
    if (isBinary === false || typeof data === 'string') {
      const msg = safeJsonParse(raw);
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'input' && typeof msg.data === 'string') {
        handle.write(msg.data);
      } else if (msg.type === 'resize') {
        const c = Number(msg.cols) || 80;
        const r = Number(msg.rows) || 24;
        handle.resize(c, r);
      } else if (msg.type === 'ping') {
        sendJson({ type: 'pong', ts: Date.now() });
      }
    }
  });

  const cleanup = async () => {
    if (handle) {
      const id = handle.id;
      const pid = handle.pid;
      try { handle.kill('SIGHUP'); } catch {}
      handle = null;
      await writeAudit({ headers: params.headers as any }, {
        action: 'terminal.close',
        targetType: 'terminal',
        targetId: id,
        summary: `关闭终端 pid=${pid} durationMs=${Date.now() - startedAt} exitCode=${exitedCode ?? 'n/a'}`,
      });
    }
  };

  params.socket.on('close', () => { void cleanup(); });
  params.socket.on('error', (err: unknown) => {
    termLog.warn({ err: (err as any)?.message }, 'terminal socket error');
    void cleanup();
  });
}
