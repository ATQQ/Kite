import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";
import { settingsRoutes } from "./routes/settings.js";
import { staticPlugin } from "./static.js";
import { ensureDbReady } from "./db/index.js";

await ensureDbReady();

const port = Number(process.env.PORT) || 5430;
const host = process.env.HOST || '0.0.0.0';

const app = new Elysia()
  .derive({ as: 'global' }, () => ({ _start: performance.now() }))
  .onAfterHandle({ as: 'global' }, ({ request, set, _start }) => {
    const ms = (performance.now() - _start).toFixed(0);
    const status = (set as any).status ?? 200;
    console.log(`${request.method} ${new URL(request.url).pathname} ${status} ${ms}ms`);
  })
  .use(deployRoutes)
  .use(settingsRoutes)
  .use(staticPlugin)
  .listen({ port, hostname: host });

console.log(`🦊 Server is running at http://${app.server?.hostname}:${app.server?.port}`);
console.log(`🔑 Login Token: ${process.env.ADMIN_TOKEN || '未设置 (请通过 .env.local 配置)'}`);
