# AGENTS.md

本文件用于规范 AI Agent（Claude Code、Cursor、Trae 等）在本仓库中的工作方式，避免 AI 跑偏、过度修改或破坏项目约定。

> 通用编码行为准则请参见 [CLAUDE.md](./CLAUDE.md)（先思考、简单优先、精准修改、目标驱动）。本文件聚焦于 **本项目特有的上下文与红线**。

---

## 1. 项目速览

**Kite** 是一款"安装 CLI 即可体验"的云原生自动化部署工具。CLI 包内置 Web 管理端静态产物与 Server 代理后端，通过 HTTP + Token 完成资源上传、目标目录解压与部署命令执行。

- 入口产物：`@kitecd/cli`（用户只需 `npm i -g @kitecd/cli` + `kite serve`）
- 用户数据目录：`~/.kite/`（`config.json` / `kite.db` / `deployments/` / `tmp/`），**升级 CLI 不会清理这些数据**
- 执行计划存档：所有新增功能 / 较大改动的方案请先落到 [plan/](./plan)，与用户确认后再编码
- 历史文档（仅供参考，**不代表现状**）：[prd.md](./.trae/documents/prd.md)、[tech-architecture.md](./.trae/documents/tech-architecture.md)

---

## 2. 仓库结构（Bun Monorepo）

| 路径 | 角色 | 关键技术栈 |
|------|------|------------|
| [packages/cli](./packages/cli) | **对外发布包** `@kitecd/cli`，承载 `kite serve` / `kite push` / `kite init` 等命令 | Node ≥ 18，TypeScript，cac、ora、chalk、archiver、busboy |
| [apps/web](./apps/web) | 管理后台前端源码，构建产物会被复制到 `packages/cli/dist/web` | Vue 3 + `<script setup>`、Vite、Pinia、Vue Router 4、Tailwind CSS 3、lucide-vue-next |
| [apps/server](./apps/server) | 部署服务端源码，构建后内嵌进 CLI；也保留作为独立服务的开发入口 | Elysia + `@elysiajs/node`、Bun/Node 双运行时、Drizzle ORM + libSQL（SQLite） |
| [docs](./docs) | VitePress 用户文档站 | VitePress 1.x |
| [examples](./examples) | 可部署样例：`frontend-basic` / `backend-api` / `ssr-basic` | — |
| [plan](./plan) | 后续功能/重构的执行计划存档（Markdown），由 AI 在动手前先生成、与用户确认 | — |
| [.trae/documents](./.trae/documents) | 项目最初版的 PRD 与技术架构文档（**仅供历史参考，不再作为现状依据**） | — |

### 主要源码入口
- CLI 命令注册：[packages/cli/src/index.ts](./packages/cli/src/index.ts)
- 启动内置服务：[packages/cli/src/serve.ts](./packages/cli/src/serve.ts)
- 服务端入口：[apps/server/src/index.ts](./apps/server/src/index.ts)
- 数据库 schema：[apps/server/src/db/schema.ts](./apps/server/src/db/schema.ts)
- 前端路由：[apps/web/src/router/index.ts](./apps/web/src/router/index.ts)
- 前端 Vite 配置：[apps/web/vite.config.ts](./apps/web/vite.config.ts)

---

## 3. 包管理与命令

### 包管理器
- **统一使用 Bun**，锁文件为 [bun.lock](./bun.lock)。
- 镜像源已在 [bunfig.toml](./bunfig.toml) 中配置为 `npmmirror`，**禁止**改为其它源或切换到 npm/yarn/pnpm。
- 安装依赖：`bun install`（不要执行 `npm install` / `pnpm install`，会污染锁文件）。

### 常用脚本（在仓库根目录执行）
| 命令 | 用途 |
|------|------|
| `bun install` | 安装全部 workspaces 依赖 |
| `bun run dev` | 并行启动 web + server 开发（端口 web=5429，server=5430） |
| `bun run dev:web` / `bun run dev:server` | 单独启动前端或后端 |
| `bun run build` | 完整构建：web → server → cli（顺序敏感，不要拆分） |
| `bun run docs:dev` / `bun run docs:build` | VitePress 文档站 |
| `bun run deploy:test` | 用本地 CLI 部署 web 包做 e2e 验证 |
| `node packages/cli/bin/kite.js serve --runtime node` | 用 Node 运行 CLI |
| `bun packages/cli/bin/kite.js serve --runtime bun` | 用 Bun 运行 CLI |

### 端口与运行时约定
- 前端开发服务：**5429**，并已配置 `/api` 代理到 `5430`
- 后端开发服务：**5430**
- CLI 启动的内置服务默认端口：**5431**（`kite serve`）
- CLI 支持 `--runtime auto|node|bun`，**两种运行时都必须保持可用**（见 [apps/server/src/index.ts](./apps/server/src/index.ts#L13-L21)，Bun 用原生 `app.listen`，Node 用 `http` 适配 `app.fetch`）。

---

## 4. 编码约定（按子项目）

### 4.1 通用
- **TypeScript 优先**，新文件使用 `.ts` / `.vue` + `<script setup lang="ts">`。
- **ESM**：`packages/cli`、`apps/server`、`apps/web` 的 `package.json` 均为 `"type": "module"`，import 时本地相对路径需带 `.js` 后缀（CLI/Server 的 TS 文件互引用都遵循该约定，见 [packages/cli/src/index.ts](./packages/cli/src/index.ts#L8-L12)）。
- **不要随意加注释**。沿用现有文件的注释密度（多数函数无注释）。
- **不要"顺便重构"** 相邻代码、格式或命名。

### 4.2 CLI（[packages/cli](./packages/cli)）
- 命令通过 `cac` 注册，错误退出统一 `chalk.red` + `process.exit(1)`。
- 用户输出风格：成功 `chalk.green`、提示 `chalk.gray`、警告 `chalk.yellow`、错误 `chalk.red`，长任务用 `ora` spinner。
- 配置加载链优先级（**修改鉴权/配置逻辑务必保持**）：
  `CLI 参数 > .env.local > kite.config[.<env>].json > 全局 ~/.kite/config.json`
- 多环境支持：`kite.config.<env>.json`，token 按 `envTokenKey(projectId, env)` 存储。
- 不要将 token 写入项目源码内的 `kite.config*.json`（见 `kite init` 注释：*Deploy token is intentionally not written to kite config file*）。
- 新增 CLI 命令时务必在 [docs/cli.md](./docs/cli.md) 同步说明。

### 4.3 Server（[apps/server](./apps/server)）
- 框架 = Elysia，路由按域拆分到 [routes/](./apps/server/src/routes)。
- ORM = Drizzle + libSQL，**所有表结构变更必须同步** [schema.ts](./apps/server/src/db/schema.ts)，并考虑老数据库迁移（用户的 `~/.kite/kite.db` 不能被破坏）。
- 现有表：`projects` / `settings` / `deployments`，新增字段优先 `nullable / default`，避免破坏性变更。
- Bun / Node 双运行时支持是硬性要求，**禁止**使用仅 Bun 独占且无 polyfill 的 API（如 `Bun.serve` 直接耦合）。
- RESTful 命名遵循现有路由风格（`/api/<resource>` + 动词由 HTTP method 表达）。

### 4.4 Web（[apps/web](./apps/web)）
- Vue 3 Composition API，**统一 `<script setup lang="ts">`**。
- 状态管理 = Pinia，store 放 [store/](./apps/web/src/store)。
- 路由 = Vue Router 4，受保护路由通过 `meta.requiresAuth` + `adminToken` 校验（见 [router/index.ts](./apps/web/src/router/index.ts#L54-L62)）。
- UI = Tailwind CSS 3 + lucide-vue-next，**禁止引入 Element Plus、Ant Design Vue 等大型组件库**，需要无头组件优先选 shadcn-vue / Headless UI。
- 设计风格：极客深色模式（`#09090B` 主背景 + 蓝/绿高亮 + 红色错误，等宽字体用于代码/Token），不要随意修改 [tailwind.config.js](./apps/web/tailwind.config.js) 的色板。
- 图标统一从 `lucide-vue-next` 引入，不要混用其它图标库。
- 与后端通信走 `/api/*`（Vite dev 已代理至 5430），不要硬编码全 URL。

---

## 5. 构建与发布

- 构建顺序在 [package.json](./package.json#L14-L16) 中固化：`web build → server build → cli build`。
- `apps/server` 的产物由 `bun build` 输出到 `packages/cli/dist/server`，且**显式 external** `@libsql/*` 与 `drizzle-orm/*`（这两个包必须由 CLI 在用户机器上以依赖形式安装）。
- `apps/web` 的产物会被 `packages/cli/package.json` 的 `build` 脚本拷贝到 `packages/cli/dist/web`。
- CLI 包的 `files` 字段只包含 `bin` 与 `dist`；**新增运行时必需文件务必加入 `files`**。
- 发布：`bun run release`（封装 `bumpp` + `changelogen`），**只在 [packages/cli](./packages/cli) 下发布**。
- 不要手动修改 [CHANGELOG.md](./CHANGELOG.md)，由 `changelogen` 自动生成。

---

## 6. AI Agent 红线（Hard Rules）

> 触发以下任一项视为"跑偏"，必须停下来澄清或回滚：

1. **禁止改包管理器**：不要把 Bun 换成 npm/yarn/pnpm；不要删 [bun.lock](./bun.lock)；不要改 [bunfig.toml](./bunfig.toml) 的 registry。
2. **禁止破坏运行时双跑**：所有 server / CLI 改动都要保证 `--runtime node` 与 `--runtime bun` 同时可用。
3. **禁止破坏性 DB 迁移**：不要修改/删除现有列的语义；新增列优先可空，避免破坏用户的 `~/.kite/kite.db`。
4. **禁止把 token 写入源码配置**：CLI 的 `kite init` 明确把 token 留在全局配置或 `.env.local`，新增逻辑要遵循。
5. **禁止引入重型 UI 库**：架构定调 Tailwind + 无头组件，不要为单个页面拉入 Element / AntD / Naive 等。
6. **禁止越权清理**：不要删除你修改之外的"看似无用"的代码、文件、example 项目或文档。
7. **禁止改产品文案/品牌**：`Kite`、`@kitecd/cli`、logo、深色极客风格属于产品定义，调整需用户确认。
8. **禁止跳过构建顺序**：`bun run build` 是 web → server → cli 串行，不要并行化或裁剪步骤。
9. **禁止把工作目录数据当临时目录**：用户数据写到 `~/.kite/`（见 [home.ts](./packages/cli/src/home.ts)），临时文件用 `~/.kite/tmp/` 或当前工作目录的 `.deploy-archive.zip`。
10. **禁止泄漏密钥**：`ADMIN_TOKEN`、deploy token、日志中的 Token 字段在输出/日志/截图里要 mask（参考 CLI `config` 命令对 token 的 `****` 处理，见 [packages/cli/src/index.ts](./packages/cli/src/index.ts#L162)）。

---

## 7. 执行计划目录（[plan/](./plan)）

- **何时使用**：新增功能 / 较大重构 / 跨模块改动前，先在 [plan/](./plan) 下落一份 Markdown 计划文件，再与用户确认。
- **命名建议**：`YYYY-MM-DD-<short-slug>.md`，例如 `2026-06-16-webhook-trigger.md`。
- **建议结构**：
  1. **背景与目标**（要解决什么、不解决什么）
  2. **影响范围**（涉及哪些子项目、文件、API、DB 表）
  3. **方案**（关键设计决策 / 备选方案对比）
  4. **拆解步骤**（可独立验证的小步）
  5. **验证策略**（手动用例 / 自动测试 / `bun run build` 检查项）
  6. **风险与回滚**
- 简单改动（单文件单函数）不必走该流程，避免形式主义。
- 计划文档完成后再编码；编码过程中如发现方案需调整，**先回头改计划**。

---

## 8. 改动 Checklist（提交前自查）

在结束一个任务前，逐条对照：

- [ ] 改动范围是否仅限于用户需求？是否清理了自己引入的未使用 import / 变量？
- [ ] CLI / Server 改动是否在 `--runtime node` 和 `--runtime bun` 下都跑通？
- [ ] 是否运行 `bun run build` 验证完整链路构建？
- [ ] 涉及 DB？是否兼容老数据库？是否同步 [schema.ts](./apps/server/src/db/schema.ts)？
- [ ] 新增 CLI 命令/选项？是否同步 [docs/cli.md](./docs/cli.md) 与 README 示例？
- [ ] 新增 API？路由风格是否与现有 `/api/*` 一致？
- [ ] 前端新增 store/route？是否考虑了 `adminToken` 鉴权与 401 处理？
- [ ] 是否引入了被红线禁止的依赖（重型 UI、其它包管理器锁文件等）？
- [ ] 较大改动是否先在 [plan/](./plan) 留下计划并与用户确认？
- [ ] 是否在未询问的情况下 `git commit` / `git push`？（**默认不要**主动提交）

---

## 9. 何时必须停下来问用户

- 需求模糊到存在多种合理实现路径（如：是否要支持 Webhook 触发？是否要做权限分级？）。
- 改动会影响用户既有数据（`~/.kite/kite.db`、`~/.kite/config.json`）。
- 需要引入新依赖且非小工具库（>50KB 或带 native binding）。
- 需要修改设计风格（颜色、字体、布局基调）或品牌相关内容。
- 需要发布版本 / 改动 CI / 改动 `release` 流程。

---

## 10. 参考资料

- [README.md](./README.md) — 快速开始与 CLI 用法
- [CLAUDE.md](./CLAUDE.md) — 通用 LLM 编码行为准则
- [docs/](./docs) — 面向用户的 VitePress 文档（**现状以此为准**）
- [examples/README.md](./examples/README.md) — 三类可部署样例
- [plan/](./plan) — 执行计划存档
- [.trae/documents/prd.md](./.trae/documents/prd.md)、[.trae/documents/tech-architecture.md](./.trae/documents/tech-architecture.md) — **最初版**产品/架构文档，仅作历史参考
