# Kite Examples

这里放置用于测试 Kite 部署链路的示例项目。

- `frontend-basic`: 静态前端项目，构建后上传 `dist`。
- `backend-api`: Bun HTTP API 项目，上传服务端代码。
- `ssr-basic`: Bun SSR 项目，上传 SSR 服务入口。

`kite.config.json` 的 `projectId` 对应本机平台上的演示项目，deploy token 存放在 `~/.kite/config.json` 的 `projectToken` 中，不写入仓库：

| Example | Project ID | 平台项目名 |
|---------|------------|------------|
| `frontend-basic` | `proj_92ee1ab5b928` | `frontend-basic` |
| `backend-api` | `proj_50c343d70149` | `example-api` |
| `ssr-basic` | `proj_eda397bca7a8` | `ssr-basic` |

三个项目已关联 examples Workspace `ws_c4c0111c94f24a11`。通用测试方式：

```bash
node packages/cli/bin/kite.js serve --runtime node
cd examples/frontend-basic
bun run build
node ../../packages/cli/bin/kite.js push --server http://127.0.0.1:5431
```

用 `--server` 显式指定服务地址，避免依赖全局 `serverUrl`（可能被其它环境的 `workspace init` 覆盖）。如需换成自己的项目，替换 `kite.config.json` 的 `projectId`，并通过 `kite init` 或 Web 管理端为该 projectId 配置 deploy token。
