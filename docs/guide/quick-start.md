# 快速开始

## 1. 安装依赖

```bash
bun install
```

项目已配置 Bun registry，安装依赖时会使用 `https://registry.npmmirror.com/`。

## 2. 启动 Kite

```bash
bun run dev
```

默认地址：

- Web 管理端：`http://localhost:5173`
- Server API：`http://localhost:3000`
- Admin Token：查看 `apps/server/.env.local`

开发环境会自动初始化一个演示项目：

```txt
Project ID: proj_abc123
Deploy Token: test-token
Deploy Path: apps/server/.deployments/proj_abc123
```

## 3. 构建 CLI

```bash
bun run build:cli
```

本仓库内可以直接通过 `packages/cli/bin/kite.js` 调试 CLI。如果需要全局命令：

```bash
cd packages/cli
npm link
```

## 4. 跑通内置部署测试

保持 Server 正在运行，然后执行：

```bash
bun run deploy:test
```

该命令会构建 `apps/web`，把 `dist` 目录打包上传到 Server，并在服务端执行项目配置里的部署命令。

## 5. 部署 examples

示例项目位于 `examples/`：

```bash
examples/frontend-basic
examples/backend-api
examples/ssr-basic
```

进入任一示例后，可以使用示例内的 `kite.config.json` 测试 CLI 上传：

```bash
bun run build
bun ../../packages/cli/bin/kite.js push --server http://localhost:3000 --token test-token
```

如果你在 Web 端创建了自己的项目，请把示例里的 `projectId` 改成新项目 ID，并使用对应的 Deploy Token。
