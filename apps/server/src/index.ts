import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";

const app = new Elysia()
  .use(deployRoutes)
  .get("/", () => "Deploy Server is running!")
  .listen(3000);

console.log(`🦊 Server is running at http://${app.server?.hostname}:${app.server?.port}`);
console.log(`🔑 Login Token: ${process.env.ADMIN_TOKEN || '未设置 (请通过 .env.local 配置)'}`);
