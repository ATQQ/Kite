import { Elysia } from "elysia";
import { deployRoutes } from "./routes/deploy.js";

const app = new Elysia()
  .use(deployRoutes)
  .get("/", () => "Deploy Server is running!")
  .listen(3000);

console.log(`🦊 Server is running at ${app.server?.hostname}:${app.server?.port}`);
