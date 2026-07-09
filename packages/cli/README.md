<p align="center">
  <img src="https://docs.kite.sugarat.top/logo.svg" alt="Kite Logo" width="160">
</p>

<h1 align="center">@kitecd/cli</h1>

<p align="center">
  一款"安装 CLI 即可体验"的云原生自动化部署工具。
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@kitecd/cli"><img src="https://img.shields.io/npm/v/@kitecd/cli.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@kitecd/cli"><img src="https://img.shields.io/npm/dm/@kitecd/cli.svg" alt="npm downloads"></a>
</p>

`@kitecd/cli` 把 **Web 管理端静态产物** 与 **Server 代理后端** 一起打进 CLI，通过 HTTP + Token 完成资源上传、目标目录解压与部署命令执行。安装一次，即可拿到一整套「管理面板 + 部署 CLI」。

- 📘 完整文档：<https://docs.kite.sugarat.top>
- 🚀 快速开始：<https://docs.kite.sugarat.top/guide/quick-start>
- 🧰 CLI 命令详解：<https://docs.kite.sugarat.top/cli>

## 快速开始

### 1. 安装 CLI

要求 Node.js **v18+**（或 Bun）。

```bash
npm install -g @kitecd/cli
# 或使用 bun
bun add -g @kitecd/cli
```

后续所有命令均来自 `@kitecd/cli`。

### 2. 启动内置服务

`kite serve` 会同时拉起 Web 管理端与 Server 后端，并把数据持久化到 `~/.kite/`。首次启动会打印 **Admin Token**，用于登录 Web 管理端。

```bash
kite serve
# 默认监听 http://127.0.0.1:5431，Ctrl+C 结束
```

打开 <http://127.0.0.1:5431> 并使用启动日志中的 Admin Token 登录即可。

服务器长期运行推荐 **pm2 守护 + Nginx 反代**：

```bash
npm install -g pm2                                       # 首次
kite serve --pm2 --host 127.0.0.1 --port 5431            # 后台守护
kite serve --pm2 stop                                    # 停止守护
```

如果要挂在已有站点的子路径下（例如 `https://ops.example.com/kite/`）：

```bash
kite serve --pm2 --host 127.0.0.1 --port 5431 --base kite
```

Nginx 反代示例、`--base` 规范化规则详见 [Quick Start · 启动内置服务](https://docs.kite.sugarat.top/guide/quick-start#_2-启动内置服务)。

### 3. 在 Web 管理端创建项目

登录管理端后，在 **项目管理 → 新建项目** 中填写：

- **项目名称**
- **部署目录**：服务器上的绝对路径（会作为解压根目录）

创建后进入「项目详情」页面，会实时生成对应的 `kite init` / `kite push` 命令，自带 `--server` 与 `--project`，复制即用。

### 4. 初始化项目并部署

在你要部署的项目根目录执行（命令来自 Web 详情页）：

```bash
kite init --project <PROJECT_ID> --out ./dist --server http://127.0.0.1:5431
```

会生成一份不含 Token 的 `kite.config.json`。Deploy Token 可以保存到全局配置或 `.env.local`：

```bash
# 保存到 ~/.kite/config.json（按项目存储）
kite config:set token <DEPLOY_TOKEN>

# 或者放到当前项目的 .env.local，不进入全局
printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\n" >> .env.local
```

然后一键部署：

```bash
kite push
```

`kite push` 会打包 `outputDir`、上传到 Server，依次执行 `preDeploy` → 解压 → `postDeploy`，日志实时回显并落到 Web 管理端「部署日志」页。

也可以完全通过参数覆盖配置（适合 CI/CD）：

```bash
kite push \
  --server http://127.0.0.1:5431 \
  --token  <DEPLOY_TOKEN> \
  --project <PROJECT_ID> \
  --out ./dist \
  --command "pm2 restart api-server"
```

## 数据目录

CLI 与 Server 的所有状态都保存在 `~/.kite`，**升级 CLI 不会覆盖**：

```txt
~/.kite/
  config.json        # CLI 全局配置（serverUrl、token 等）
  kite.db            # Server 侧项目/日志/设置（libSQL 单文件）
  deployments/       # 默认部署根目录
  tmp/               # 上传、解压临时文件
  pm2/               # pm2 守护模式下的配置和日志
```

可通过环境变量 `KITE_HOME` 自定义：

```bash
KITE_HOME=/data/kite kite serve
```

打印当前 Kite Home：

```bash
kite home
```

## 常用命令速查

| 分类 | 命令 | 说明 |
| ---- | ---- | ---- |
| 服务 | `kite serve` | 启动内置 Web + Server，支持 `--runtime auto\|node\|bun`、`--host`、`--port`、`--base`、`--pm2` |
| 服务 | `kite admin reset-password [--random\|--password ...]` | 重置 Web 管理端 Admin Token，无需重启服务 |
| 配置 | `kite init` | 生成 `kite.config.json`（默认不写入 Token） |
| 配置 | `kite config` | 查看当前项目合并后的生效配置 |
| 配置 | `kite config:set <key> <value>` / `config:get` / `config:list` | 读写全局/项目配置，支持 `--global`、`--env <name>` |
| 部署 | `kite build [--env] [--out]` | 打包但不上传，用于验证打包结果 |
| 部署 | `kite push [--env] [--server] [--token] [--project] [--out] ...` | 一键打包 + 上传 + 部署 |
| 运维 | `kite list [--env] [--json]` | 列出 Server 上所有项目 |
| 运维 | `kite status [projectId] [--limit] [--json]` | 查看项目最近部署 |
| 运维 | `kite logs <deployId> [-f]` | 打印/跟随一次部署日志 |
| 运维 | `kite rollback [projectId] [--to <deployId>] [--yes]` | 回滚到指定历史部署 |
| 迁移 | `kite export [--out] [--projects] [--no-include-artifacts] [--no-include-logs]` | 导出元数据 + 部署历史 + 产物 |
| 迁移 | `kite import <file> [--strategy] [--no-restore-artifacts] [--dry-run] [--yes]` | 在目标机器导入并可选还原产物 |
| 诊断 | `kite verify [--check-server]` | 迁移/安装完整性自检 |
| 诊断 | `kite doctor [--server] [--token]` | 本地 + 远端实时健康诊断 |
| 统计 | `kite telemetry:on\|off\|status\|endpoint <url>` | 管理匿名使用统计（默认开启，可关闭） |

完整参数与行为说明请查阅 [CLI 使用文档](https://docs.kite.sugarat.top/cli)。

## 项目配置示例

在要部署的项目根目录创建 `kite.config.json`：

```json
{
  "projectId": "proj_1a2b3c4d5e",
  "outputDir": "./dist",
  "files": ["**/*"],
  "serverUrl": "http://127.0.0.1:5431",
  "env": {
    "NODE_ENV": "production"
  },
  "preDeploy":  "echo before extract",
  "postDeploy": "pm2 restart api-server"
}
```

- 多环境：并存 `kite.config.staging.json` / `kite.config.prod.json`，使用 `--env staging` 切换。
- 优先级：CLI 参数 > `.env.local` > `kite.config[.<env>].json` > `~/.kite/config.json`。
- 不要把 Deploy Token 写进 `kite.config*.json`，使用 `kite config:set token` 或 `.env.local`。

字段完整定义参见 [CLI 文档 · 项目级配置](https://docs.kite.sugarat.top/cli#九-项目级配置)。

## 运行时

CLI 内置服务同时支持 Node 与 Bun 运行时：

```bash
kite serve --runtime auto     # 默认，自动探测
kite serve --runtime node
kite serve --runtime bun
```

## 相关链接

- 官方文档：<https://docs.kite.sugarat.top>
- 仓库地址：<https://github.com/ATQQ/kite>
- 更新日志：见仓库根目录 `CHANGELOG.md`

## License

MIT
