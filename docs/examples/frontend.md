# 前端项目示例

路径：`examples/frontend-basic`

这是一个无框架静态前端示例，构建脚本会把 `src` 中的静态资源复制到 `dist`。

## 本地构建

```bash
cd examples/frontend-basic
bun run build
```

## 使用 Kite 上传

```bash
node ../../packages/cli/bin/kite.js push --server http://127.0.0.1:3000 --token test-token
```

默认配置：

```json
{
  "projectId": "proj_abc123",
  "outputDir": "./dist",
  "files": ["**/*"],
  "postDeploy": "echo frontend-basic deployed"
}
```

适合验证静态站点产物上传、服务端解压和部署日志。
