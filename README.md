# Kite - 自动化项目部署工具

这是一个支持 **Web 管理端**、**Server 部署服务** 与 **CLI 命令行** 的云原生自动化部署工具。
基于 HTTP + Token 驱动，摒弃复杂的 SSH 配置，帮助你将本地前端、后端项目一键极速打包并部署到远程服务器。

## 📦 架构概览

本项目采用 **Bun Monorepo (Workspaces)** 组织：
- `apps/server` (后端服务): 基于 ElysiaJS + Bun + LibSQL/Drizzle 的文件接收、解压、命令执行与日志记录引擎。
- `apps/web` (前端控制台): 基于 Vue 3 + Vite 的可视化管理后台，支持项目、Token、部署脚本和日志管理。
- `packages/cli` (命令行工具): 基于 Node.js 的本地部署助手，支持配置缓存、项目打包和 HTTP 推送。
- `.trae/documents/` (产品与技术文档): 包含 PRD 与技术架构说明。

## 🚀 快速开始

### 1. 安装依赖

请确保你已经安装了 [Bun](https://bun.sh/) 运行时（v1.0+）。
在根目录下执行：

```bash
bun install
```

### 2. 启动服务与前端 (一键启动)

在根目录执行以下命令，将同时启动 `apps/server` (后端 API) 和 `apps/web` (Vue 前端)：

```bash
bun run dev
```

- **Server (API)** 运行在: `http://localhost:3000`
- **Web (UI)** 运行在: `http://localhost:5173`
- **默认 Admin Token** 位于: `apps/server/.env.local`

开发环境会默认初始化一个演示项目：
- Project ID: `proj_abc123`
- Deploy Token: `test-token`
- 目标目录: `apps/server/.deployments/proj_abc123`

### 3. 构建项目

```bash
bun run build
```

### 4. 构建与链接 CLI 工具

如果你需要全局使用 `kite` 命令，请先构建 CLI，再进入 `packages/cli` 目录链接：

```bash
bun run build:cli
cd packages/cli && npm link
```

## 🛠️ CLI 使用示例

假设你已经在服务端启动了 `http://localhost:3000`，你可以通过 CLI 将任意项目部署到该服务器。

### 方式一：使用测试配置一键体验
先启动 Server，然后在根目录执行：

```bash
bun run deploy:test
```

该命令会构建 Web 端，将 `apps/web/dist` 打包上传到演示项目，并在服务端目标目录执行配置的部署命令。

### 方式二：在你的真实项目中使用
1. **设置全局服务器与 Token**
```bash
kite config set serverUrl http://localhost:3000
kite config set token <项目 Deploy Token>
```

2. **在项目根目录创建 `kite.config.json`**
```json
{
  "projectId": "<Web 管理端中的项目 ID>",
  "outputDir": "./dist",
  "files": ["**/*"],
  "preDeploy": "echo before extract",
  "postDeploy": "pm2 restart api-server"
}
```

3. **执行一键部署**
```bash
kite push
```

也可以直接通过参数覆盖配置：

```bash
kite push --server http://localhost:3000 --token <项目 Deploy Token> --project <项目 ID> --out ./dist --command "pm2 restart api-server"
```

## 📖 更多文档
- VitePress 文档站：
  ```bash
  bun run docs:dev
  ```
- 示例项目：见 [`examples/`](./examples/README.md)，包含前端、后端和 SSR 三类可部署样例。
- [产品需求文档](./.trae/documents/prd.md)
- [技术架构文档](./.trae/documents/tech-architecture.md)
