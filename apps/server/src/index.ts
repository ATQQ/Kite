import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";
import { settingsRoutes } from "./routes/settings.js";
import { ensureDbReady } from "./db/index.js";

await ensureDbReady();

const app = new Elysia()
  .use(deployRoutes)
  .use(settingsRoutes)
  .get("/", () => "Deploy Server is running!")
  .listen(5430);

console.log(`🦊 Server is running at http://${app.server?.hostname}:${app.server?.port}`);
console.log(`🔑 Login Token: ${process.env.ADMIN_TOKEN || '未设置 (请通过 .env.local 配置)'}`);
