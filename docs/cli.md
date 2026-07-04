# Kite CLI 使用文档

> Kite CLI 是一款轻量级的前后端项目极速部署工具，通过 HTTP + Token 方式一键将本地产物或代码打包上传到服务端执行部署。

## 一、安装与快速启动

*前提：需要 Node.js (v18+)。如果你习惯 Bun，也可以用 Bun 运行 CLI 源码。*

```bash
npm install -g @kitecd/cli
# 或者
bun add -g @kitecd/cli
```

启动内置 Web 管理端和 Server 后端：

```bash
kite serve
```

默认地址是 `http://127.0.0.1:5431`。终端会打印 Admin Token，用于登录 Web 管理端。

CLI 会把持久化数据保存到 `~/.kite`：

```txt
~/.kite/config.json
~/.kite/kite.db
~/.kite/deployments/
~/.kite/tmp/
```

升级 CLI 包不会覆盖这些数据。

## 二、运行时参数

内置服务使用 Node 标准 HTTP/FS/Child Process 能力实现，支持通过参数标记运行时：

```bash
kite serve --runtime auto
kite serve --runtime node
kite serve --runtime bun
kite serve --host 0.0.0.0 --port 5431
```

> 安全提示：`kite serve` 默认监听 `127.0.0.1`，仅本机可访问。若显式指定非本地地址（如 `--host 0.0.0.0` 或公网 IP），CLI 启动时会打印黄色 `[warn]` 提示，请务必在 Nginx/Caddy 等前置代理上配置 TLS 与限速。
>
> Admin Token 强度策略：长度 ≥ 24，且至少包含字母和数字，去重字符数 ≥ 8。当 `.env.local` 中的 `ADMIN_TOKEN` 不满足该策略时，`kite serve` 启动会打印 `[warn]` 但不会阻塞启动；建议执行 `kite reset-password --random` 重新生成强随机 Token，或手工替换为更强的随机字符串。
>
> 登录限流：管理端登录 (`POST /api/auth/login`) 与修改 Admin Token (`POST /api/settings/token`) 共享内存级限流，按客户端 IP（取 `X-Forwarded-For` / `X-Real-IP` 首项）累计失败次数；10 分钟内累计 8 次失败将锁定 5 分钟并返回 `429 Retry-After`。

### 后台运行 (pm2)

`kite serve` 支持通过 pm2 实现后台守护运行，适合部署在内网/云服务器上长期提供服务。

#### 前置条件：需要全局安装 pm2

`@kitecd/cli` **不会把 pm2 打包进 CLI**，也不会在安装时自动安装。`--pm2` 模式依赖系统里全局可用的 `pm2` 命令，使用前请先手动安装：

```bash
# 推荐：用 Node 自带的 npm 全局安装
npm install -g pm2

# 或用 yarn / pnpm
yarn global add pm2
pnpm add -g pm2
```

安装后可以验证一下：

```bash
pm2 --version    # 能输出版本号即说明 PATH 正常
```

如果提示 `command not found`，通常是 npm 全局 bin 目录没加入 `PATH`

> 如果没装 pm2 就直接运行 `kite serve --pm2`，CLI 会主动检测并报错退出：
>
> ```
> pm2 is not installed.
> Install it with: npm install -g pm2
> Or run without --pm2 for foreground mode.
> ```

#### 启动与停止

```bash
# 启动（由 pm2 守护到后台，关闭终端也不退出）
kite serve --pm2

# 停止 pm2 守护的 Kite 服务
kite serve --pm2 stop
```

> 注意 `--pm2` 和 `--pm2 stop` 含义不同：
>
> - `kite serve --pm2`：**启用** pm2 守护
> - `kite serve --pm2 stop`：**停止** pm2 守护的实例（内部调用 `pm2 delete kite-server`）

#### 查看日志与状态

启动成功后，Kite Server 会以名称 `kite-server` 注册到 pm2 进程列表。可以执行：

```bash
pm2 ls                       # 或 pm2 status，列出所有 pm2 进程
pm2 logs kite-server         # 实时跟踪输出日志和错误日志
pm2 logs kite-server --lines 200   # 查看最近 200 行
pm2 info kite-server         # 查看进程详情（重启次数、内存占用、cwd、日志路径等）
pm2 monit                    # 实时监控 CPU / 内存曲线
```

`pm2 ls` 输出中 `kite-server` 这一行的字段含义：

| 字段 | 含义 |
| --- | --- |
| `id` | pm2 给进程分配的自增 id |
| `mode` | 进程模式，Kite Server **固定运行在 `fork` 模式**（pm2 默认值），详见下方 |
| `↺` / `restarts` | 累计重启次数。CLI 配置中限制了 `max_restarts: 5`、`min_uptime: 10s`，超过后会停止自动拉起 |
| `status` | `online` 正常运行；`errored` 异常；`stopped` 已停止 |
| `cpu` / `memory` | 实时 CPU 与内存占用 |

**关于 `fork` 模式**：pm2 有两种 `exec_mode`——`fork`（默认，单实例）和 `cluster`（按 CPU 核数起多 worker）。Kite Server 走 fork 是有意为之，因为：

1. 它监听固定端口 `5431`，cluster 多 worker 会端口冲突
2. 持久化用的是本地 libSQL 文件锁 (`~/.kite/kite.db`)，多实例并发写会锁竞争
3. 它是管理控制面，不是 CPU 密集型业务，不需要多核利用

**日志文件位置**（在 pm2 生成的 `ecosystem.config.cjs` 中指定）：

```
~/.kite/pm2/error.log     # 错误输出
~/.kite/pm2/out.log       # 标准输出
~/.kite/pm2/ecosystem.config.cjs   # pm2 启动配置（CLI 自动生成）
```

#### 常用维护命令

```bash
pm2 restart kite-server    # 重启
pm2 reload kite-server     # 0-downtime 重载（fork 模式下等同于 restart）
pm2 delete kite-server     # 从 pm2 列表移除
```

> 重新执行 `kite serve --pm2` 时，CLI 会先调用 `pm2 delete kite-server` 清理旧实例，再写入新配置并启动，所以反复运行是安全的。

#### 与前台模式的对比

| 维度 | 前台 `kite serve` | pm2 守护 `kite serve --pm2` |
| --- | --- | --- |
| 关闭终端后 | 进程退出 | 继续运行 |
| 崩溃自动重启 | 否 | 是（最多 5 次，10s 内稳定） |
| 日志 | 终端直显 | 落到 `~/.kite/pm2/*.log` |
| 适用场景 | 本地调试、临时测试 | 服务器长期运行 |

#### 完全卸载

```bash
kite serve --pm2 stop    # 停止 Kite Server
pm2 delete kite-server   # 清理 pm2 列表条目（可省略）
pm2 unstartup            # 取消开机自启（如果之前配过）
pm2 kill                 # 杀掉 pm2 守护进程本身

# 可选：卸载 pm2 本身
npm uninstall -g pm2
```

> pm2 配置和日志保留在 `~/.kite/pm2/` 目录下，删除 Kite 数据目录（`rm -rf ~/.kite`）时才会一并清理。

## 三、重置管理端密码

管理端登录密码本质上是存储在 `~/.kite/kite.db` 中的 Admin Token。运行中的 `kite serve` 会在每次请求时读取该文件，因此修改后无需重启后端服务。

交互式重置：

```bash
kite admin reset-password
```

命令会询问你使用随机密码，还是手动输入新密码。

也可以非交互式执行：

```bash
# 生成随机 Admin Token
kite admin reset-password --random

# 手动指定 Admin Token
kite admin reset-password --password "your-new-admin-password"
```

也可以使用短命令别名：

```bash
kite reset-password --random
```

重置后，用命令输出的新 Admin Token 重新登录 Web 管理端即可。

## 四、打包验证 (kite build)

`kite build` 命令可以打包项目文件但不上传，用于验证打包结果是否符合预期：

```bash
kite build
kite build --env staging
kite build --out ./build
```

`--env` 参数用于多环境场景，指定使用哪个环境的配置文件。`--out` 可临时覆盖输出目录。

## 五、查看 Kite 目录 (kite home)

打印 Kite 数据目录路径：

```bash
kite home
# 输出: /Users/yourname/.kite
```

可通过环境变量 `KITE_HOME` 自定义数据目录。

## 六、查看当前生效配置 (kite config)

`kite config` 命令（不带子命令）会显示当前项目合并后的生效配置，包括来自全局配置、`.env.local` 和 `kite.config.json` 的所有值：

```bash
kite config
kite config --env staging
```

输出示例：

```
Effective config:
  env:         staging
  serverUrl:   http://127.0.0.1:5431
  projectId:   proj_abc123
  token:       ****a2b3
  outputDir:   ./dist
  preDeploy:   npm run build
  postDeploy:  pm2 restart my-service
  files:       **/*

Sources:
  global:  /Users/yourname/.kite/config.json
  project: /path/to/kite.config.staging.json
  env:     /path/to/.env.local
```

## 七、配置管理

首次使用前，建议配置服务端的访问地址。Deploy Token 可以保存到全局配置，也可以保存到当前项目的 `.env.local`。

```bash
# 配置部署服务器地址（项目目录下优先写入 kite.config.json，否则写入全局配置）
kite config:set serverUrl http://127.0.0.1:5431

# 将 Deploy Token 保存到 ~/.kite/config.json（项目目录下按项目存储）
kite config:set token kt_1a2b3c4d5e...

# 强制写入全局配置
kite config:set serverUrl http://127.0.0.1:5431 --global

# 查看当前全局配置
kite config:list
```

如果不希望 token 进入全局配置，可以放在当前项目的 `.env.local`：

```bash
printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\n" >> .env.local
```

## 八、初始化项目配置

推荐使用 `kite init` 创建不包含 Token 的 `kite.config.json`：

```bash
kite init --project proj_1a2b3c4d5e --out ./dist --server http://127.0.0.1:5431
```

如果需要在初始化时保存 Token，可以显式指定保存位置：

```bash
kite init --project proj_1a2b3c4d5e --token <DEPLOY_TOKEN> --token-store global
kite init --project proj_1a2b3c4d5e --token <DEPLOY_TOKEN> --token-store local
```

`--token-store global` 会写入 `~/.kite/config.json`，`--token-store local` 会写入当前项目 `.env.local`。

## 九、项目级配置

在你要部署的前端或后端项目的根目录，创建一个 `kite.config.json` 文件：

```json
{
  "projectId": "proj_1a2b3c4d5e", 
  "outputDir": "./dist",
  "files": ["index.html", "assets"],
  "serverUrl": "https://deploy.example.com",
  "env": {
    "NODE_ENV": "production",
    "API_URL": "https://api.example.com"
  },
  "preDeploy": "npm run build",
  "postDeploy": "pm2 restart kite-web"
}
```

### 配置项说明：
*   `projectId` (必填): 对应 Web 管理面板中生成的项目唯一 ID。
*   `outputDir` (可选): 要打包的根目录（相对路径），默认是 `./`。如果是前端项目通常是 `./dist`。
*   `files` (可选): 字符串数组。指定**仅上传**该目录下的哪些特定文件或子目录。如果为空或不传，默认打包 `outputDir` 下所有文件（自动忽略 `.git` 和 `node_modules` 等）。
*   `ignore` (可选): 字符串数组，glob 模式。在内置忽略规则之外**追加**的自定义忽略模式。仅作用于通配打包（`files` 留空或写 glob 时），对 `files` 中点名的真实文件/目录**不生效**——明确指定即视为需要。
*   `ignoreBuiltin` (可选): 布尔。设为 `true` 时**禁用**内置忽略规则（默认 `false`，保留内置规则）。等价于命令行 `--no-ignore-builtin`。
*   `serverUrl` (可选): 部署服务地址。优先级：CLI `--server` > `.env.local` `KITE_SERVER_URL` > **`kite.config.json`** > 全局配置。
*   `env` (可选): 键值对对象，部署时注入到 `preDeploy` / `postDeploy` 脚本的环境变量。CLI `--set-env` 可覆盖。
*   `preDeploy` (可选): 在**服务端**解压前执行的前置脚本（注意：不是本地构建）。适合做清理、备份等准备工作。
*   `postDeploy` (可选): 在**服务端**解压完成后，在目标部署目录执行的后置脚本（例如重启服务、构建、nginx reload 等）。
*   `postDeployAsync` (可选): 布尔，默认 `false`（沿用旧行为：等待 `postDeploy` 跑完）。设为 `true` 时，`postDeploy` 改为"fire-and-forget"：服务端 spawn 子进程后立刻返回 success，子进程输出仍会落到该次部署日志，CLI/Web 端不再阻塞等待。  
    适用场景：`postDeploy` 中包含会重启自身或长时间运行的命令（如 `kite serve --runtime bun --pm2 restart`、PM2 重启自己、热重载守护进程），同步等待会让上传请求挂死。  
    优先级：CLI `--post-deploy-async` > 环境变量 `KITE_POST_DEPLOY_ASYNC=true|false|1|0` > 项目配置 `postDeployAsync` > Web 端项目设置 > 默认 `false`。  
    **注意**：异步模式下若子进程崩溃，本次 deployment 仍标记成功，失败会落到 `audit_logs` 的 `deploy.post_deploy_failed`，可在 Web "审计日志"中查看。

> **关于忽略规则**
>
> 内置忽略集（默认启用）：`.git/**`、`node_modules/**`、`.next/**`、`.nuxt/**`、`.turbo/**`、`.cache/**`、`.vite/**`、`coverage/**`、`.DS_Store`、`*.log`、`.env*`、`.deploy-archive.zip` 等。
>
> 优先级：CLI `--ignore <patterns>` > 项目 `ignore` 字段 > 内置默认。
>
> **关键语义**：`files` 中写**真实存在的文件/目录路径**（如 `".env"`、`"src"`）会被原样打包，不应用任何忽略规则；只有 glob 通配（如 `"**/*"`、`".env*"`）才会经过 `ignore` 过滤。这意味着如果你确实需要打包 `.env`，把它写到 `files` 即可，无需关闭内置规则。

> **执行顺序与解压行为**
>
> 1. 保存上传的 zip 到临时目录
> 2. 确认目标部署目录存在
> 3. **执行 `preDeploy`**（在目标目录下）
> 4. 解压 zip 到目标目录（覆盖同名文件，但**不会删除**旧目录中已存在但新 zip 中没有的文件）
> 5. **执行 `postDeploy`**（在目标目录下）
> 6. 清理临时 zip
>
> 注意：解压采用覆盖模式，不会先清空目标目录。如果需要保证部署结果与本地完全一致，可在 `preDeploy` 中手动清理目标目录。

*注：`kite.config.json` 不应包含 Deploy Token。*

### 多环境配置

Kite 支持多环境部署。在项目根目录下创建多个配置文件即可：

```
kite.config.json          # 默认环境
kite.config.staging.json  # staging 环境
kite.config.prod.json     # production 篰境
```

使用 `--env` 参数指定环境：

```bash
kite push --env staging
kite push --env prod
kite build --env staging
kite init --project proj_abc --env staging
```

当项目中存在多个环境配置文件时，如果不传 `--env`，CLI 会弹出交互式选择器让你选择目标环境。

Token 也可以按环境存储。`kite config:set token <token> --env staging` 会将 token 存储为 `projectId:staging` 的 key，部署时自动匹配。

## 十、执行部署

在包含 `kite.config.json` 的项目根目录下执行：

```bash
kite push
```

CLI 默认读取：

- `~/.kite/config.json` 中的 `serverUrl`、`token`
- 当前项目 `.env.local` 中的 `KITE_SERVER_URL`、`KITE_DEPLOY_TOKEN`、`KITE_TOKEN`
- 当前项目 `kite.config.json` 中的项目配置

### 命令行参数覆盖

你可以通过附加参数临时覆盖配置（这在 CI/CD 流水线中非常有用）：

```bash
kite push --token "YOUR_TEMP_TOKEN" --server "http://test-env:5431" --out "./build" --post "npm run reload"
```

## 十一、配置优先级

部署配置优先级为：

1. CLI 参数：`--token`、`--server`、`--project`、`--out`、`--pre`、`--post`、`--command`、`--post-deploy-async`、`--ignore`、`--no-ignore-builtin`
2. 本地环境变量：`.env.local`（`KITE_SERVER_URL`、`KITE_TOKEN`、`KITE_POST_DEPLOY_ASYNC` 等）
3. 项目配置：`kite.config.json`（`serverUrl`、`projectId`、`outputDir`、`postDeployAsync`、`ignore`、`ignoreBuiltin` 等）
4. 全局配置：`~/.kite/config.json`（`serverUrl`、`token`、`projectToken`）

## 十二、部署流程示例

1.  运行 `kite push`。
2.  CLI 自动读取当前目录的 `.env.local` 和 `kite.config.json`。
3.  打包 `outputDir` 下指定的文件为 Zip 压缩包（自动忽略冗余文件）。
4.  携带 Token 将 Zip 发送至配置的 `serverUrl`。
5.  服务端接收并校验 Token 成功后，自动解压至该项目预先设定的服务器绝对路径。
6.  服务端在解压目录下执行 `postDeploy` 指令（如 `pm2 restart` 或 `nginx -s reload`）。
7.  部署完成，CLI 终端打印出服务端返回的执行日志。你可以登录 Web 管理后台查看详细的流式日志记录。

## 十三、数据迁移 (kite export / kite import)

当你需要把 Kite 从一台机器迁到另一台机器（例如换服务器、灾备恢复），可以用 `kite export` / `kite import` 把整套元数据、部署历史与线上产物打包搬运。导入端会自动写回 CLI 全局 token 配置，开发机仅需修改 `serverUrl` 即可继续使用原有 token 部署。

### 导出 (kite export)

在**源机器**执行（前提：该机器跑过 `kite serve`，`~/.kite/kite.db` 已存在）：

```bash
# 完整迁移包：默认包含项目元数据 + 部署历史 + 每个项目 deployPath 的产物
kite export --out kite-backup.zip

# 仅迁移指定项目（仍默认包含 artifacts/logs）
kite export --projects proj_abc,proj_def --out kite-backup.zip

# 不需要产物（最小元数据包，体积最小）
kite export --no-include-artifacts --no-include-logs --out kite-backup.zip
```

可选参数：

| 选项 | 说明 |
|---|---|
| `--out <file>` | 输出文件路径，默认 `./kite-export-<时间戳>.zip` |
| `--no-include-artifacts` | 不打包每个项目的 `deployPath` 目录（默认包含） |
| `--no-include-logs` | 不包含 `deployments` 表（默认包含） |
| `--projects <ids>` | 逗号分隔的 projectId，只导出这些项目（同时过滤 deployments） |
| `--ignore <patterns>` | artifacts 打包时的额外忽略模式 |
| `--no-ignore-builtin` | artifacts 打包时禁用内置忽略规则 |

导出包结构（zip）：

```
kite-export/
├── manifest.json     # 版本号 / 时间戳 / 包含项 / 项目 id 列表 / artifacts 索引
├── settings.json     # settings 表
├── projects.json     # projects 表（含 token）
├── deployments.json  # （默认包含；--no-include-logs 时省略）
└── artifacts/        # （默认包含；--no-include-artifacts 时省略）
    ├── proj_abc.zip
    └── proj_def.zip
```

### 导入 (kite import)

在**目标机器**执行：

```bash
# 先 dry-run 看摘要
kite import kite-backup.zip --dry-run

# 默认 skip-existing：仅写入目标库不存在的记录；包内有 artifacts 时自动恢复 deployPath
kite import kite-backup.zip

# 只导入元数据，不解压 deployPath
kite import kite-backup.zip --no-restore-artifacts

# 完整覆盖目标库（强制要求 --yes）
kite import kite-backup.zip --strategy overwrite --yes
```

可选参数：

| 选项 | 说明 |
|---|---|
| `--strategy <mode>` | 冲突策略：`merge` / `overwrite` / `skip-existing`（默认） |
| `--no-restore-artifacts` | 不解压 `artifacts/<projectId>.zip` 到对应 `deployPath`（默认在包内有 artifacts 时自动恢复） |
| `--dry-run` | 仅打印摘要，不写库不解压 |
| `--yes` | 配合 `--strategy overwrite` 二次确认 |

冲突策略语义：

- **skip-existing**（默认）：同 `id` 的 project / 同 `key` 的 setting / 同 `id` 的 deployment 跳过，不做修改。最稳。
- **merge**：行为上等同 `skip-existing`，仅写入目标库不存在的记录。
- **overwrite**：使用 `INSERT ... ON CONFLICT DO UPDATE` 完整覆盖目标库已有记录。**会改写目标机器的现有 token 等数据**，必须显式 `--yes`。

### 自动恢复 CLI 全局配置

`kite import` 在写完 DB 之后，会把每个新导入的项目 token 自动写回 `~/.kite/config.json` 的 `projectToken`（key 为 `projectId`），让开发机执行 `kite push` 时无需再 `kite config:set token`：

- `skip-existing` / `merge`：仅写入目标机器全局配置中**不存在**的项目 token，已有同 key 的值保留。
- `overwrite`：覆盖目标机器同 key 的 token。
- 若目标机器的 `~/.kite/config.json` 中没有 `serverUrl`，会写入默认本地地址 `http://127.0.0.1:5431`（适配"刚装好 CLI + `kite serve` 本地部署"的最常见场景）。需要指向远端 server 时执行 `kite config:set serverUrl <url>` 覆盖。

### 迁移自检 (kite verify)

`kite import` 完成后，可在目标机器执行 `kite verify` 做一次完整性自检：

```bash
kite verify                  # 只查本地 db / config / 各 project deploy_path
kite verify --check-server   # 额外探活 serverUrl（要求 server 已启动）
```

检查项：

| 项 | 说明 |
|---|---|
| `kite.db` 三表结构 | `projects` 表存在；`deployments` 引用的 `project_id` 不孤立 |
| 各项目 `deploy_path` | 路径存在且是目录（artifacts 已正确还原） |
| 全局 `projectToken` | `~/.kite/config.json` 中每个 project 都有 token；与 DB token 一致 |
| 全局 `serverUrl` | 已配置 |
| Server 健康 | `--check-server` 时 GET `serverUrl/`，5xx / 网络错误视为失败 |

退出码：错误 = `exit 1`；仅警告 = `exit 0`；纯通过 = `exit 0`。

### 健康诊断 (kite doctor)

`kite doctor` 在 `kite verify` 之外补一份「实时探活」视角：本地段验 Node 版本/Kite Home/磁盘/全局配置，远端段直接打 `/api/health` 与 `/api/health/detail`。

```bash
kite doctor                                           # 用全局配置的 serverUrl + token
kite doctor --server http://localhost:5431            # 仅探活，不需要 token
kite doctor --server http://localhost:5431 --token x  # 显式覆盖
```

输出示例：

```
[Local]
  ✓ Node.js                v24.16.0 (>=18 required)
  ✓ Kite Home              ~/.kite
  ✓ Disk free              276.68 GB free (40% used)
  ✓ Global config          serverUrl=http://127.0.0.1:5431

[Remote http://127.0.0.1:5431]
  ✓ GET /api/health        status=ok uptime=239s version=dev
  ✓ Remote DB              ~/.kite/kite.db (14.3ms)
  ✓ Remote Kite Home       ~/.kite writable=true tmp=true
  ✓ Remote Disk            276.68 GB free (40% used)
  ! Recent deploys         last 0 success rate=n/a
  ✓ Remote runtime         node v24.16.0 uptime=239s

Doctor: passed with warnings.
```

退出码：任一 `✗` → `exit 1`；只有 `!` → `exit 0`；全 `✓` → `exit 0`。Web 后台的 *系统设置 → 服务健康* 卡片调用同一接口（仅远端段）。

### 典型迁移流程

```bash
# 1. 源机器
kite export --out kite-backup.zip
scp kite-backup.zip user@new-server:/tmp/

# 2. 目标机器
npm install -g @kitecd/cli
kite serve            # 首次启动会初始化 ~/.kite/kite.db
# Ctrl+C 退出 server 后导入
kite import /tmp/kite-backup.zip --dry-run
kite import /tmp/kite-backup.zip
kite verify           # 自检三表 + deploy_path + token 完备
kite serve            # 再次启动，dashboard 即可看到所有项目和历史

# 3. 开发机（无需重发 token）
kite config:set serverUrl https://new-server.example.com
kite push
```

### 注意事项

- 导入时若目标机器上某 project 的 `deployPath` 与源机器不同，请用 `--strategy overwrite --yes` 或先手动调整目标机器的项目配置后再重新导入。
- artifacts 还原**只覆盖同名文件，不删除目标目录多余文件**，避免误删。如需完全镜像，请先手动清空 `deployPath`。
- `manifest.schemaVersion` 当前为 `1`。未来若 schema 升级，旧 CLI 拒绝导入更高版本的包，请升级 CLI 后重试。

### Web 端数据迁移

除了 CLI，Web 管理端也内置了导入/导出面板，入口在左侧菜单 **数据迁移**（路由 `/migration`）。适合不想登录服务器执行命令的场景：

- **导出**：勾选要迁移的项目，可选择是否包含 artifacts、是否包含部署日志，日志多时还能设置"每项目最近 N 条"。点击"导出选中项目"即可下载 `kite-export-<timestamp>.zip`。
- **导入**：选择本地 zip，选择冲突策略（`skip-existing` / `merge` / `overwrite`）和是否还原 artifacts；`overwrite` 会触发二次确认并要求请求头带 `X-Confirm-Overwrite: yes`。导入完成后面板会展示项目 / 设置 / 部署日志 / artifacts 的逐项摘要。

Web 端与 CLI 共用 `manifest.schemaVersion=1` 的 zip 格式，因此 CLI 导出的包可以从 Web 导入，反之亦然。与 CLI `kite import` 不同的是，Web 导入不会改写 `~/.kite/config.json`（server 本身就是目标端），开发机的 `kite push` 仍按现有 token 工作。

## 十四、运维命令 (kite list / status / logs / rollback)

无需打开浏览器即可查看服务端上项目、部署历史和实时日志，并支持回滚到上一个成功版本。这些命令均通过 admin token 与 server 通信，配置链与 `kite doctor` 一致：`--token` 参数 > `KITE_TOKEN` > `~/.kite/config.json` 中的 `token`。

| 命令 | 说明 |
|------|------|
| `kite list` | 列出 server 上所有项目（ID / 名称 / env / 状态 / 更新时间）。`--env <name>` 过滤；`--json` 输出 JSON 便于 CI 消费。 |
| `kite status [projectId]` | 查看指定项目最近若干次部署。不传 `projectId` 时读取当前目录 `kite.config*.json`。`--limit <n>` 默认 5、上限 50；`--json` 输出原始 JSON。 |
| `kite logs <deployId>` | 打印一次部署的完整输出。加 `-f / --follow` 通过 SSE 实时跟随，直到部署结束（success 退出码 0、failed 退出码 1）。 |
| `kite rollback [projectId]` | 回滚到指定历史部署。`--to <deployId>` 指定目标；不传时自动取最近一次有归档的成功部署。`--yes` 跳过二次确认（非 TTY 必填）。 |

```bash
# 列出所有项目，过滤生产环境
kite list --env prod

# 查看某项目最近 10 条部署
kite status proj_abcdef --limit 10

# 实时跟随某次部署的日志（CI 中常用）
kite logs 1f2a3b4c-... -f

# 一键回滚到上一次成功部署（开发机交互模式）
kite rollback proj_abcdef
# CI 中必须显式 --yes，否则退出码 1
kite rollback proj_abcdef --to 1f2a3b4c-... --yes
```

> `rollback` 走 server 端 `POST /api/deployments/:id/rollback` 接口，自动复用源部署的归档 zip（Web 管理端「存储」页面的引用计数会保护这些 zip 不被误删）。失败会保留新的 `triggerSource=rollback` 部署记录，可用 `kite logs <newDeployId>` 排查。

## 十五、匿名使用统计 (kite telemetry)

可选的匿名使用统计，**默认完全关闭**。设计与字段细节见[使用统计说明](https://docs.kite.sugarat.top/guide/telemetry)。

| 命令 | 说明 |
|------|------|
| `kite telemetry on` | 开启匿名使用统计（首次开启会在 `~/.kite/config.json` 生成一个匿名 `telemetryInstanceId`）。 |
| `kite telemetry off` | 关闭匿名使用统计；之后 `kite serve` / `kite push` 不再发出任何 telemetry 请求。 |
| `kite telemetry status` | 查看当前开关状态、匿名 ID 前 8 位，以及当前生效的上报地址与来源（env / config / default）。 |
| `kite telemetry endpoint <url>` | 覆盖上报地址，写入 `~/.kite/config.json` 的 `telemetryEndpoint` 字段；传 `default` / `reset` 可恢复为内置默认地址。也可用环境变量 `KITE_TELEMETRY_ENDPOINT` 在单次运行时覆盖（优先级最高）。 |

开启后仅在两个时刻各上报一次（`kite.serve.startup` / `kite.push.start`），字段包含 `event` / `ts` / `kiteVersion` / `instanceId` / `os` / `arch`，**不包含**项目名、路径、Token、push 结果、耗时等任何敏感或运行期信息。请求 3 秒超时，失败完全静默，不影响 CLI 正常执行。

公开聚合面板：[/stats](/stats)；聚合 JSON API：`GET /api/public/telemetry/overview?days=30`（无鉴权 + CORS，可直接跨域消费）。

