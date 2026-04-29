# SSR 项目示例

路径：`examples/ssr-basic`

这是一个极简 Bun SSR 示例。它会在服务端生成 HTML，并通过 HTTP 返回。

## 本地运行

```bash
cd examples/ssr-basic
bun run dev
```

访问 `http://localhost:4302` 查看 SSR 页面。

## 构建并上传

```bash
bun run build
bun ../../packages/cli/bin/kite.js push --server http://localhost:3000 --token test-token
```

示例默认上传 `dist` 目录。真实部署时，后置命令可以替换成进程管理命令，例如：

```json
{
  "postDeploy": "pm2 restart kite-ssr-example || pm2 start server.js --name kite-ssr-example"
}
```
