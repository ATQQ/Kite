# Kite - 自动化项目部署工具

这是一个“安装 CLI 即可体验”的云原生自动化部署工具。
CLI 包内置 **Web 管理端静态产物** 和 **Server 代理后端**，基于 HTTP + Token 完成资源上传、目标目录解压和部署命令执行。

## 📦 架构概览

本项目采用 **Bun Monorepo (Workspaces)** 组织：
- `packages/cli`: 发布给用户的核心入口，内置 `kite serve`、`kite push`、Web 静态产物和本地 Server。
- `apps/web`: Vue 3 + Vite 管理后台源码，构建后会复制到 CLI 包的 `dist/web`。
- `apps/server`: Bun/Elysia 版本的服务端源码，保留用于开发与后续服务端拆分。
- `.trae/documents/` (产品与技术文档): 包含 PRD 与技术架构说明。

## 🚀 快速开始

### 1. 用户快速体验

安装 CLI：

```bash
npm install -g @kite/cli
```

启动内置 Web + Server：

```bash
kite serve
```

默认访问 `http://127.0.0.1:3000`。启动日志会打印 Admin Token。

CLI 会把持久化数据放在用户目录：

```txt
~/.kite/
  config.json
  kite.db.json
  deployments/
  tmp/
```

升级 CLI 包不会删除这些数据。

### 2. 本仓库开发

```bash
bun install
bun run build
node packages/cli/bin/kite.js serve --runtime node
```

也可以用 Bun 运行源码 CLI：

```bash
bun packages/cli/bin/kite.js serve --runtime bun
```

### 3. 运行时参数

```bash
kite serve --runtime auto
kite serve --runtime node
kite serve --runtime bun
kite serve --host 0.0.0.0 --port 3000
```

## 🛠️ CLI 使用示例

假设你已经通过 `kite serve` 启动了内置服务，可以通过 CLI 将任意项目部署到该服务。

1. **设置全局服务器与 Token**
```bash
kite config set serverUrl http://127.0.0.1:3000
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
kite push --server http://127.0.0.1:3000 --token <项目 Deploy Token> --project <项目 ID> --out ./dist --command "pm2 restart api-server"
```

## 📖 更多文档
- VitePress 文档站：
  ```bash
  bun run docs:dev
  ```
- 示例项目：见 [`examples/`](./examples/README.md)，包含前端、后端和 SSR 三类可部署样例。
- [产品需求文档](./.trae/documents/prd.md)
- [技术架构文档](./.trae/documents/tech-architecture.md)
