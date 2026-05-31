import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";
import { settingsRoutes } from "./routes/settings.js";
import { staticPlugin } from "./static.js";
import { ensureDbReady } from "./db/index.js";
import http from "node:http";

await ensureDbReady();

const port = Number(process.env.PORT) || 5430;
const host = process.env.HOST || '0.0.0.0';

// Detect runtime and configure adapter
const isBun = typeof globalThis.Bun !== 'undefined';
const runtimeName = isBun ? 'bun' : 'node';

let adapter = undefined;
if (!isBun) {
  const { node } = await import("@elysiajs/node");
  adapter = node();
}

const app = new Elysia({ adapter })
  .derive({ as: 'global' }, () => ({ _start: performance.now() }))
  .onAfterHandle({ as: 'global' }, ({ request, set, _start }) => {
    const ms = (performance.now() - _start).toFixed(0);
    const status = (set as any).status ?? 200;
    console.log(`${request.method} ${new URL(request.url).pathname} ${status} ${ms}ms`);
  })
  .use(deployRoutes)
  .use(settingsRoutes)
  .use(staticPlugin);

if (isBun) {
  app.listen({ port, hostname: host });
  console.log(`🦊 Server is running on ${runtimeName} at http://${app.server?.hostname}:${app.server?.port}`);
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

    const request = new Request(url.toString(), {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req as unknown as BodyInit : undefined,
    });

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
    console.log(`🦊 Server is running on ${runtimeName} at http://${host}:${port}`);
  });
}

console.log(`🔑 Login Token: ${process.env.ADMIN_TOKEN || '未设置 (请通过 .env.local 配置)'}`);
