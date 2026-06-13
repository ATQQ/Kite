# 快速开始

> 目标：用最少步骤把任意一个前端/后端项目部署到本地或内网的 Kite 服务。

## 1. 安装 CLI

Kite 把 Web 管理端、Server 后端和上传/部署执行都打包在一个 CLI 里，安装一次即可：

```bash
npm install -g @kitecd/cli
# 或使用 bun
bun add -g @kitecd/cli
```

要求 Node.js v18+（或 Bun）。后续所有命令都来自 `@kitecd/cli`。

## 2. 启动内置服务

```bash
kite serve
```

`kite serve` 会同时拉起：

- **Web 管理端**：浏览器中创建项目、查看日志
- **Server 后端**：提供 HTTP API、接收 CLI 上传、执行解压与脚本
- **持久化存储**：项目、Token、部署日志都落在 `~/.kite/`

默认监听 `http://127.0.0.1:5431`。首次启动会生成 Admin Token 并打印在终端里，复制它登录 Web 管理端。

`kite serve` 支持的常用参数：

```bash
kite serve --host 0.0.0.0 --port 5431   # 监听所有网卡
kite serve --runtime bun                # 显式指定运行时
kite serve --runtime node               # 强制使用 Node 运行
kite serve --pm2                        # 由 pm2 守护到后台
kite serve --pm2 stop                   # 停止 pm2 守护的实例
```

> `--pm2` 模式依赖系统里**全局安装的 pm2**（`@kitecd/cli` 不会自动安装）。使用前请执行 `npm install -g pm2`，否则会报错退出。详细说明见 [CLI 文档 - 后台运行 (pm2)](/cli#后台运行-pm2)。

## 3. 数据目录

CLI 与 Server 的所有状态都保存在 `~/.kite`，**升级 CLI 不会覆盖**：

```txt
~/.kite/
  config.json        # CLI 全局配置（serverUrl、token 等）
  kite.db            # Server 侧项目/日志/设置（libSQL 单文件）
  deployments/       # 默认部署根目录
  tmp/               # 上传、解压临时文件
  pm2/               # pm2 守护模式下的配置和日志
```

可以通过环境变量 `KITE_HOME` 自定义数据目录：

```bash
KITE_HOME=/data/kite kite serve
```

## 4. 在 Web 管理端创建项目

1. 浏览器打开 `http://127.0.0.1:5431`，用启动时打印的 Admin Token 登录。
2. 在「项目管理」页点击「新建项目」，填写：
   - **项目名称**：仅用于在 Web 端展示
   - **部署目录**：服务器上的**绝对路径**，Server 会把压缩包解压到这里
   - **描述 / 环境标识**（可选）
3. 创建完成后进入项目详情，复制 **项目 ID**（形如 `proj_xxx`）和 **Deploy Token**。
4. （可选）在项目详情中设置默认的 `preDeploy` / `postDeploy` 脚本。

> Web 端的 pre/post 脚本是**默认值**，本地 `kite.config.json` 或 `kite push --pre/--post` 都可以覆盖它。

## 5. 在待部署项目中初始化

进入你想要部署的前端/后端项目根目录，运行 `kite init` 生成 `kite.config.json`：

```bash
kite init --project proj_xxx --server http://127.0.0.1:5431
```

该命令会：

- 创建 `kite.config.json`，写入 `projectId`、`serverUrl`、`outputDir`、`files` 等
- **不会**把 Deploy Token 写进源码仓库，Deploy Token 单独存到全局配置或 `.env.local`

接着把 Deploy Token 保存到合适的位置（二选一）：

```bash
# 方式 A：保存到全局配置（推荐）
kite config:set token <DEPLOY_TOKEN>

# 方式 B：保存到当前项目 .env.local（推荐团队/CI 场景）
printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\n" >> .env.local
```

## 6. 执行部署

在项目根目录运行：

```bash
kite push
```

CLI 会：

1. 读取 `kite.config.json`、`.env.local`、全局 `~/.kite/config.json`，合并出最终配置
2. 把 `outputDir` 下的文件打包成 zip（自动忽略 `.git` / `node_modules`）
3. 携带项目 Deploy Token 调用 Server 的 `/api/deploy/upload`
4. Server 校验 Token 后，在项目部署目录里依次执行 `preDeploy` → 解压 → `postDeploy`
5. 把终端日志和最终状态写回日志表，CLI 实时回显

部署完成后，在 Web 端「部署日志」页可以查看完整执行流。

> **解压行为**：采用覆盖模式。同名文件会被新包覆盖，但目标目录里**已存在但新 zip 中没有的文件不会被删除**。如果需要保证部署结果与本地完全一致，可以在 `preDeploy` 脚本里清理目标目录内容。

## 7. 常用 CLI 命令一览

| 命令 | 作用 |
| --- | --- |
| `kite serve` | 启动内置 Web + Server |
| `kite init` | 在当前目录生成 `kite.config.json` |
| `kite push` | 打包并部署当前项目 |
| `kite build` | 仅打包不上传，用于验证打包结果 |
| `kite config` | 查看当前生效的合并配置 |
| `kite config:set <key> <value>` | 写入全局配置 / 项目内 `serverUrl` |
| `kite config:list` | 查看全局配置 |
| `kite home` | 打印 Kite 数据目录 |
| `kite admin reset-password` | 重置 Web 管理端 Admin Token（不需重启服务） |

更详细的命令说明请查看 [CLI 文档](/cli)，部署细节请查看 [部署流程](/guide/deploy-flow)。
