import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";
import { settingsRoutes } from "./routes/settings.js";
import { migrationRoutes } from "./routes/migration.js";
import { auditRoutes } from "./routes/audit.js";
import { healthRoutes } from "./routes/health.js";
import { staticPlugin } from "./static.js";
import { ensureDbReady } from "./db/index.js";
import { moduleLogger, pickTraceId, rootLogger } from "./lib/logger.js";
import { randomUUID } from "node:crypto";
import http from "node:http";

await ensureDbReady();

const port = Number(process.env.PORT) || 5430;
const host = process.env.HOST || '0.0.0.0';
const serverVersion = process.env.KITE_SERVER_VERSION || 'dev';

// Detect runtime and configure adapter
const isBun = typeof globalThis.Bun !== 'undefined';
const runtimeName = isBun ? 'bun' : 'node';

let adapter = undefined;
if (!isBun) {
  const { node } = await import("@elysiajs/node");
  adapter = node();
}

const httpLog = moduleLogger('http');

const app = new Elysia({ adapter })
  .derive({ as: 'global' }, ({ request, headers, set }) => {
    const traceId = pickTraceId(headers as Record<string, string | undefined>) || randomUUID();
    // expose traceId to clients (echo back so CLI can correlate failures)
    set.headers = { ...(set.headers || {}), 'x-kite-trace-id': traceId };
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
  .use(staticPlugin);

if (isBun) {
  app.listen({ port, hostname: host });
  rootLogger.info(
    { module: 'boot', runtime: runtimeName, version: serverVersion, host: app.server?.hostname, port: app.server?.port },
    `Kite server listening on http://${app.server?.hostname}:${app.server?.port}`,
  );
} else {
  // For Node.js, use native HTTP module
  const fetchHandler = app.fetch;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // Create Request object
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const request = new Request(url.toString(), {
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

  server.listen(port, host, () => {
    rootLogger.info(
      { module: 'boot', runtime: runtimeName, version: serverVersion, host, port },
      `Kite server listening on http://${host}:${port}`,
    );
  });
}

const adminTokenPreview = process.env.ADMIN_TOKEN
  ? `${process.env.ADMIN_TOKEN.slice(0, 4)}****${process.env.ADMIN_TOKEN.slice(-4)}`
  : '未设置 (请通过 .env.local 配置)';
rootLogger.info({ module: 'boot' }, `Admin token: ${adminTokenPreview}`);
