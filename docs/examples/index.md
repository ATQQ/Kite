# 示例项目

仓库根目录的 `examples/` 提供三类测试项目，方便验证 Kite 的上传、解压和命令执行能力。

## 示例列表

| 示例 | 路径 | 用途 |
| --- | --- | --- |
| 前端项目 | `examples/frontend-basic` | 构建静态 HTML/CSS/JS，上传 `dist` 产物 |
| 后端项目 | `examples/backend-api` | 上传 Bun HTTP API 项目，模拟服务端部署命令 |
| SSR 项目 | `examples/ssr-basic` | 构建服务端渲染项目，上传 `dist` 和入口文件 |

## 通用测试方式

先启动 Kite Server：

```bash
bun run dev:server
```

然后进入任意示例项目：

```bash
bun run build
bun ../../packages/cli/bin/kite.js push --server http://localhost:3000 --token test-token
```

示例默认使用开发种子项目 `proj_abc123`。如果你在 Web 管理端创建了新项目，请修改示例目录中的 `kite.config.json`。
