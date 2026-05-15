# 快速开始

## 1. 安装 CLI

```bash
npm install -g @kitecd/cli
```

本地开发仓库内也可以先构建再直接使用源码 CLI：

```bash
bun install
bun run build
node packages/cli/bin/kite.js --help
```

## 2. 启动内置 Kite 服务

```bash
kite serve
```

`kite serve` 会同时启动：

- Web 管理端
- Server API
- CLI 上传接收与部署执行服务

默认地址是 `http://127.0.0.1:3000`。首次启动会自动创建 `~/.kite`：

```txt
~/.kite/
  config.json        # CLI 全局配置
  kite.db.json       # 项目、Token、部署日志
  deployments/       # 默认部署目录
  tmp/               # 上传临时文件
```

启动日志会打印 Admin Token，用它登录 Web 管理端。

## 3. 选择运行时

内置服务使用 Node 标准 HTTP/FS/Child Process 能力实现，因此可以被 Node 或 Bun 运行。CLI 提供 `--runtime` 参数用于显式标记和后续扩展：

```bash
kite serve --runtime node
kite serve --runtime bun
kite serve --host 0.0.0.0 --port 3000
```

如果通过源码测试：

```bash
node packages/cli/bin/kite.js serve --runtime node
bun packages/cli/bin/kite.js serve --runtime bun
```

## 4. 重置管理端密码

运行中的 `kite serve` 不需要重启即可切换管理端登录密码：

```bash
kite admin reset-password
```

你可以在交互中选择随机生成，或手动输入。也可以直接传参：

```bash
kite admin reset-password --random
kite admin reset-password --password "your-new-admin-password"
```

## 5. 部署示例项目

CLI 内置服务会初始化一个演示项目：

```txt
Project ID: proj_abc123
Deploy Token: test-token
```

进入任一示例后运行：

```bash
bun run build
kite push --server http://127.0.0.1:3000 --token test-token
```

真实项目中不建议把 Deploy Token 写入 `kite.config.json`。可以保存到全局配置：

```bash
kite config:set token <DEPLOY_TOKEN>
```

也可以保存到当前项目 `.env.local`：

```bash
printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\n" >> .env.local
```

示例项目位于：

- `examples/frontend-basic`
- `examples/backend-api`
- `examples/ssr-basic`

如果你在 Web 端创建了自己的项目，请把示例里的 `projectId` 改成新项目 ID，并使用对应的 Deploy Token。
