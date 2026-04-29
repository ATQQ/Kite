# Kite Examples

这里放置用于测试 Kite 部署链路的示例项目。

- `frontend-basic`: 静态前端项目，构建后上传 `dist`。
- `backend-api`: Bun HTTP API 项目，上传服务端代码。
- `ssr-basic`: Bun SSR 项目，上传 SSR 服务入口。

通用测试方式：

```bash
bun run dev:server
cd examples/frontend-basic
bun run build
bun ../../packages/cli/bin/kite.js push --server http://localhost:3000 --token test-token
```

默认 `kite.config.json` 使用开发种子项目 `proj_abc123`。如果你在 Web 管理端创建了自己的项目，请替换 `projectId` 和 Token。
