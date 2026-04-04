# Kite - 自动化项目部署工具

这是一个支持 **CLI 命令行** 与 **Web 网页端** 的云原生自动化部署工具。
基于 HTTP + Token 驱动，摒弃复杂的 SSH 配置，帮助你将本地前端、后端项目一键极速打包并部署到远程服务器。

## 📦 架构概览

本项目采用 **Bun Monorepo (Workspaces)** 组织：
- `apps/server` (后端服务): 基于 ElysiaJS + Bun + Turso (Drizzle ORM) 的高速文件接收与指令执行引擎。
- `apps/web` (前端控制台): 基于 Vue 3 + Vite 的可视化管理后台（规划中）。
- `packages/cli` (命令行工具): 基于 Node.js 的本地部署助手，支持配置缓存、项目打包和 HTTP 推送。
- `docs/` (技术文档): 包含详细的架构设计与实现方案 `spec.md`。

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

### 3. 构建与链接 CLI 工具

如果你需要全局使用 `kite` 命令，请进入 `packages/cli` 目录进行构建和链接：

```bash
# 1. 编译 CLI TypeScript 代码
bun run build:cli

# 2. 全局链接 (使得 kite 命令可用)
cd packages/cli && npm link
```

## 🛠️ CLI 使用示例

假设你已经在服务端启动了 `http://localhost:3000`，你可以通过 CLI 将任意项目部署到该服务器。

### 方式一：使用测试配置一键体验
我们在 `apps/web` 目录下准备了一个测试配置，你可以直接体验整个打包到上传的流程：
```bash
bun run deploy:test
```

### 方式二：在你的真实项目中使用
1. **设置全局服务器与 Token**
```bash
kite config set serverUrl http://localhost:3000
kite config set token test-token
```
*(注：当前后端代码中硬编码了测试用的 Token `test-token`，对应测试项目 ID 为 `proj_abc123`)*

2. **在项目根目录创建 `kite.config.json`**
```json
{
  "projectId": "proj_abc123",
  "outputDir": "./dist",
  "preDeploy": "npm run build",
  "postDeploy": "pm2 restart api-server"
}
```

3. **执行一键部署**
```bash
kite push
```

## 📖 更多文档
*   [技术方案与架构设计文档 (spec.md)](./docs/spec.md)
