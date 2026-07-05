import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";
import { settingsRoutes } from "./routes/settings.js";
import { migrationRoutes } from "./routes/migration.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";
import { diskRoutes } from "./routes/disk.js";
import { statsRoutes } from "./routes/stats.js";
import { telemetryRoutes } from "./routes/telemetry.js";
import { fsRoutes } from "./routes/fs.js";
import { categoryRoutes } from "./routes/categories.js";
import { logSourceRoutes } from "./routes/log-sources.js";
import { systemRoutes } from "./routes/system.js";
import { pm2Routes } from "./routes/pm2.js";
import { tagRoutes } from "./routes/tags.js";
import { searchRoutes } from "./routes/search.js";
import {
  terminalRoutes,
  decideTerminalUpgrade,
  attachTerminalSocket,
  TERMINAL_SUBPROTOCOL,
} from "./routes/terminal.js";
import { shutdownAllSessions } from "./lib/terminal.js";
import { staticPlugin } from "./static.js";
import { ensureDbReady } from "./db/index.js";
import { moduleLogger, pickTraceId, rootLogger } from "./lib/logger.js";
import { randomUUID } from "node:crypto";
import http from "node:http";

await ensureDbReady();

function normalizeBase(input?: string): string {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (!trimmed || trimmed === '/' || trimmed === '.') return '';
  const stripped = trimmed.replace(/^\/+|\/+$/g, '');
  if (!stripped) return '';
  if (!/^[A-Za-z0-9._~\-\/]+$/.test(stripped)) {
    throw new Error(`Invalid KITE_BASE value: "${input}"`);
  }
  if (stripped.includes('//') || stripped.includes('..')) {
    throw new Error(`Invalid KITE_BASE value: "${input}"`);
  }
  return '/' + stripped;
}

const port = Number(process.env.PORT) || 5430;
const host = process.env.HOST || '127.0.0.1';
const serverVersion = process.env.KITE_SERVER_VERSION || 'dev';
const basePath = normalizeBase(process.env.KITE_BASE);

// Detect runtime and configure adapter
const isBun = typeof globalThis.Bun !== 'undefined';
const runtimeName = isBun ? 'bun' : 'node';

let adapter = undefined;
if (!isBun) {
  const { node } = await import("@elysiajs/node");
  adapter = node();
}

const httpLog = moduleLogger('http');
const wsLog = moduleLogger('ws');

async function buildTerminalWss() {
  try {
    const { WebSocketServer } = await import('ws');
    return new WebSocketServer({ noServer: true });
  } catch (err) {
    wsLog.warn({ err: (err as any)?.message }, '加载 ws 包失败，终端 WebSocket 将不可用');
    return null;
  }
}

const terminalWss = await buildTerminalWss();

function headersFromIncoming(req: http.IncomingMessage): Record<string, string | string[] | undefined> {
  return req.headers as any;
}

async function handleTerminalUpgrade(
  req: http.IncomingMessage,
  socket: any,
  head: Buffer,
  expectedOrigin: string,
) {
  if (!terminalWss) {
    socket.destroy();
    return;
  }
  const url = new URL(req.url || '/', `http://${req.headers.host || expectedOrigin}`);
  const subs = (req.headers['sec-websocket-protocol'] as string | undefined)?.split(',').map(s => s.trim()).filter(Boolean) || [];
  const decision = await decideTerminalUpgrade({
    url,
    headers: headersFromIncoming(req),
    socketRemoteAddress: (req.socket as any)?.remoteAddress || null,
    origin: (req.headers.origin as string) || null,
    expectedOrigin,
    subprotocols: subs,
  });
  if (!decision.ok) {
    const status = decision.status || 400;
    const reason = decision.reason || 'rejected';
    wsLog.warn({ status, reason, path: url.pathname }, 'terminal upgrade rejected');
    socket.write(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
    return;
  }
  terminalWss.handleUpgrade(req, socket, head, (ws) => {
    void attachTerminalSocket({
      socket: ws as any,
      ip: decision.ip!,
      cwd: decision.cwd!,
      projectId: decision.projectId ?? null,
      cols: decision.cols!,
      rows: decision.rows!,
      headers: headersFromIncoming(req),
    });
  });
}

const app = new Elysia({ adapter })
  .derive({ as: 'global' }, ({ request: _request, headers, set }) => {
    const traceId = pickTraceId(headers as Record<string, string | undefined>) || randomUUID();
    // expose traceId to clients (echo back so CLI can correlate failures)
    (set.headers as any) = { ...(set.headers || {}), 'x-kite-trace-id': traceId };
    return { _start: performance.now(), traceId };
  })
  .onAfterHandle({ as: 'global' }, ({ request, set, _start, traceId }) => {
    const ms = Number((performance.now() - _start).toFixed(0));
    const status = (set as any).status ?? 200;
    httpLog.info(
      { traceId, method: request.method, path: new URL(request.url).pathname, status, ms },
      `${request.method} ${new URL(request.url).pathname} ${status} ${ms}ms`,
    );
  })
  .onError({ as: 'global' }, ({ request, error, traceId }) => {
    httpLog.error(
      { traceId, method: request?.method, path: request ? new URL(request.url).pathname : undefined, err: { name: (error as any)?.name, message: (error as any)?.message, stack: (error as any)?.stack } },
      'request error',
    );
  })
  .use(deployRoutes)
  .use(settingsRoutes)
  .use(migrationRoutes)
  .use(auditRoutes)
  .use(healthRoutes)
  .use(diskRoutes)
  .use(statsRoutes)
  .use(telemetryRoutes)
  .use(fsRoutes)
  .use(categoryRoutes)
  .use(logSourceRoutes)
  .use(systemRoutes)
  .use(pm2Routes)
  .use(tagRoutes)
  .use(searchRoutes)
  .use(terminalRoutes)
  .use(staticPlugin);

// Both runtimes use node:http to create server for WebSocket upgrade support
const fetchHandler = app.fetch;

// Strip basePath prefix from incoming request URL before passing to Elysia.
// This lets all registered routes stay `/api/xxx` while externally being `/<base>/api/xxx`.
function stripBaseFromPath(pathname: string): { matched: boolean; stripped: string } {
  if (!basePath) return { matched: true, stripped: pathname };
  if (pathname === basePath) return { matched: true, stripped: '/' };
  if (pathname.startsWith(basePath + '/')) {
    return { matched: true, stripped: pathname.slice(basePath.length) };
  }
  return { matched: false, stripped: pathname };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Base path enforcement: reject anything outside /<base>/
  const { matched, stripped } = stripBaseFromPath(url.pathname);
  if (!matched) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not Found', hint: basePath ? `Kite is mounted at ${basePath}/` : undefined }));
    return;
  }
  const forwardUrl = new URL(url.toString());
  forwardUrl.pathname = stripped;

  // Create Request object
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
  }

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(forwardUrl.toString(), {
    method: req.method,
    headers,
    body: hasBody ? new ReadableStream({
      start(controller) {
        req.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        req.on('end', () => controller.close());
        req.on('error', (err) => controller.error(err));
      },
    }) : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit);

  // Get response from Elysia
  const response = await fetchHandler(request);

  // Send response
  res.writeHead(response.status, Object.fromEntries(response.headers));

  if (response.body) {
    const reader = response.body.getReader();
    const pump = async () => {
      const { done, value } = await reader.read();
      if (done) {
        res.end();
        return;
      }
      res.write(value);
      await pump();
    };
    await pump();
  } else {
    res.end();
  }
});

if (terminalWss) {
  const expectedWsPath = `${basePath}/api/terminal/ws`;
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    if (url.pathname !== expectedWsPath && !url.pathname.startsWith(expectedWsPath + '/')) {
      socket.destroy();
      return;
    }
    const reqHost = req.headers.host || `${host}:${port}`;
    const expectedOrigin = `http://${reqHost}`;
    // Rewrite URL to strip basePath so downstream URL parsing sees /api/terminal/ws
    if (basePath) {
      const stripped = url.pathname.slice(basePath.length);
      req.url = stripped + (url.search || '');
    }
    void handleTerminalUpgrade(req, socket, head, expectedOrigin);
  });
} else {
  rootLogger.warn({ module: 'terminal' }, 'ws 包不可用，终端 WebSocket 已关闭');
}

server.listen(port, host, () => {
  rootLogger.info(
    { module: 'boot', runtime: runtimeName, version: serverVersion, host, port, base: basePath || '/' },
    `Kite server listening on http://${host}:${port}${basePath || ''}`,
  );
});

const adminTokenPreview = process.env.ADMIN_TOKEN
  ? `${process.env.ADMIN_TOKEN.slice(0, 4)}****${process.env.ADMIN_TOKEN.slice(-4)}`
  : '未设置 (请通过 .env.local 配置)';
rootLogger.info({ module: 'boot' }, `Admin token: ${adminTokenPreview}`);

// silence unused symbol for runtime-only export
void TERMINAL_SUBPROTOCOL;

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    try { shutdownAllSessions(sig); } catch {}
    process.exit(0);
  });
}
