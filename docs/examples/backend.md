# 后端项目示例

路径：`examples/backend-api`

这是一个 Bun HTTP API 示例，构建脚本会把入口文件和 `package.json` 复制到 `dist`。

## 本地运行

```bash
cd examples/backend-api
bun run dev
```

访问 `http://localhost:4301/health` 可以看到健康检查响应。

## 构建并上传

```bash
bun run build
bun ../../packages/cli/bin/kite.js push --server http://localhost:3000 --token test-token
```

示例中的 `postDeploy` 默认只输出提示，不会真的启动常驻进程。真实部署时可以改成：

```json
{
  "postDeploy": "bun install --production && pm2 restart kite-backend-example || pm2 start src/index.js --name kite-backend-example"
}
```
