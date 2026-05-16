import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";
import { settingsRoutes } from "./routes/settings.js";
import { ensureDbReady } from "./db/index.js";

await ensureDbReady();

const app = new Elysia()
  .derive({ as: 'global' }, () => ({ _start: performance.now() }))
  .onAfterHandle({ as: 'global' }, ({ request, set, _start }) => {
    const ms = (performance.now() - _start).toFixed(0);
    const status = (set as any).status ?? 200;
    console.log(`${request.method} ${new URL(request.url).pathname} ${status} ${ms}ms`);
  })
  .use(deployRoutes)
  .use(settingsRoutes)
  .get("/", () => "Deploy Server is running!")
  .listen(5430);

console.log(`🦊 Server is running at http://${app.server?.hostname}:${app.server?.port}`);
console.log(`🔑 Login Token: ${process.env.ADMIN_TOKEN || '未设置 (请通过 .env.local 配置)'}`);
