# 部署流程

Kite 的部署链路由 CLI 内置的 Web、Server 和上传命令协作完成。用户只需要安装 CLI 包，然后运行 `kite serve`。

## 本地持久化

内置服务会把数据保存在 `~/.kite`：

```txt
~/.kite/
  config.json
  kite.db
  deployments/
  tmp/
```

这意味着更新 CLI npm 包不会覆盖项目配置、Token、部署日志和默认部署目录。

## 配置阶段

1. 运行 `kite serve`，从终端复制 Admin Token。
2. 管理员使用 Admin Token 登录 Web 管理端。
3. 在项目管理页创建项目，填写名称、描述和服务端部署目录。
4. Web 端为项目生成 Deploy Token。
5. 可选：在项目详情页配置默认 `preDeployScript` 和 `postDeployScript`。
6. 在项目详情页复制 CLI 帮助指令，选择将 Deploy Token 保存到全局配置或当前项目 `.env.local`。

## 上传阶段

CLI 会读取当前目录的 `kite.config.json`：

```json
{
  "projectId": "proj_abc123",
  "outputDir": "./dist",
  "files": ["**/*"],
  "postDeploy": "pm2 restart my-service"
}
```

Deploy Token 不应写入 `kite.config.json`。推荐二选一：

```bash
kite config:set token <DEPLOY_TOKEN>
printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\n" >> .env.local
```

执行 `kite push` 后，CLI 会：

1. 打包 `outputDir` 下的资源。
2. 携带项目 Deploy Token 请求 `kite serve` 暴露的 `/api/deploy/upload`。
3. 将 `projectId`、Zip 文件和可选脚本提交给 Server。

## 服务端部署阶段

Server 会：

1. 校验 Deploy Token 是否属于该项目。
2. 创建部署日志并标记为 `running`。
3. 确认目标部署目录存在（不存在则创建）。
4. 在目标目录执行 `preDeploy` 前置命令。
5. 解压上传包到项目部署目录（覆盖同名文件，但**不会删除**旧目录中已存在但新 zip 中没有的文件）。
6. 在目标目录执行 `postDeploy` 后置命令。
7. 将状态更新为 `success` 或 `failed`，并记录完整终端输出。

> **`postDeploy` 同步 / 异步执行**
>
> 默认情况下，第 6 步会**阻塞等待** `postDeploy` 全部子进程结束。当 `postDeploy` 中包含「重启自身」「PM2 重启 Kite 自己」「热重载守护进程」等会让 stdout/stderr 一直挂起的命令时，可在项目设置中开启「postDeploy 异步执行」，或在 CLI 用 `kite push --post-deploy-async` 单次覆盖。开启后服务端 spawn 之后立即返回 success，子进程输出仍会落到该次部署日志，崩溃会落到 `audit_logs` 的 `deploy.post_deploy_failed`。详见 [CLI 文档 `postDeployAsync`](../cli.md#九、配置文件详解)。

> **解压行为说明**
>
> 解压采用覆盖模式：同名文件会被覆盖，但目标目录中已存在而新 zip 中没有的文件会保留。如果需要保证部署结果与本地完全一致，可在 `preDeploy` 中添加清理逻辑（如 `rm -rf` 目标目录内容）。

## 运行日志与 PM2 应用

Web 管理端的「运行日志」页面用于查看项目关联的日志文件（PM2 stdout/stderr、自定义日志等），支持实时跟随、历史分页浏览与关键词/正则搜索。

- **PM2 日志自动关联**：项目在设置里绑定 `pm2AppName` 后，进入日志页时会自动从 `pm2 jlist` 读取该应用当前所有实例的 `pm_out_log_path` / `pm_err_log_path`，未导入的会以 `kind='pm2'` 记录到日志源列表。cluster 模式下每个实例会分别列出。
- **自动清理旧 PM2 日志源**：工具栏上的「自动清理旧 PM2 日志」开关（默认开启，偏好保存在浏览器 `localStorage`）会在每次刷新/进入日志页时调用 `POST /api/projects/:id/log-sources/prune-pm2`，把 `kind='pm2'` 但不再出现在最新 `pm2 jlist` 中的日志源自动从列表移除。**只删除记录，不会删除磁盘上的日志文件**；手动添加（`kind !== 'pm2'`）的日志源不受影响；只有在 PM2 中确实找到该应用（`found === true`）时才会执行清理，避免 pm2 未就绪时误删。
- **分屏对比（Split View）**：在左侧日志源列表勾选 2~4 个日志源后，点击顶部「分屏对比」按钮即可并排查看多个日志，每个面板独立维护实时/历史/搜索模式与滚动/搜索状态；单个面板可点击右上角的 × 关闭；勾选数不足 2 会自动退出分屏。分屏最多同时展示 4 个日志源。

## 运行时

`kite serve` 的内置服务使用 Node 标准能力实现，既可以被 Node 运行，也可以被 Bun 运行：

```bash
kite serve --runtime node
kite serve --runtime bun
```

当前 `--runtime` 用于显式标记运行方式和后续扩展；真正执行取决于你用 `node` 还是 `bun` 启动 CLI。

## 命令覆盖优先级

部署命令按以下优先级生效：

1. CLI 参数：`--token`、`--server`、`--project`、`--out`、`--pre`、`--post`、`--command`
2. 本地配置：`.env.local` 和 `kite.config.json`
3. Web 管理端项目默认配置

`--command` 是 `--post` 的别名，适合测试时快速指定服务端部署命令。

## 反向代理（Nginx）配置建议

如果你把 `kite serve` 放在 Nginx 反向代理之后（例如通过 `https://kite.example.com` 访问），请务必按下面的模板配置，否则可能出现以下典型问题：

- `kite push` 报 `Upload failed: fetch failed`，但服务端实际部署已经成功。
- 长时间无输出后连接被中间层掐断。
- 大 zip 上传返回 `413 Request Entity Too Large`。
- Web 管理端的终端 WebSocket 无法建立或频繁断开。

根因是 `POST /api/deploy/upload` 使用 **NDJSON 流式响应** 逐行推送日志，一旦 Nginx 缓冲了响应体或过早触发 idle 超时，CLI 侧读流就会失败。下面这一份"通用配置"能同时覆盖：普通 HTTP、NDJSON 流式部署、大文件上传、WebSocket 终端。

```nginx
server {
    # listen / ssl / server_name 略

    # 大 zip 包上传不被 413 卡住
    client_max_body_size 1024m;

    location ^~ / {
        proxy_pass http://127.0.0.1:5431;

        proxy_set_header Host              $http_host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Real-Port       $remote_port;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;
        proxy_set_header REMOTE-HOST       $remote_addr;

        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Sec-WebSocket-Protocol $http_sec_websocket_protocol;

        # ────────── 关键三件套：修复 NDJSON 流被缓冲 / fetch failed ──────────
        proxy_buffering         off;   # 不缓冲上游响应，日志实时透传给 CLI
        proxy_request_buffering off;   # 大 zip 请求体直接透传，避免二次落盘
        proxy_cache             off;   # 关闭响应缓存
        # ────────────────────────────────────────────────────────────────

        # 超时放宽，兼顾 pre/postDeploy 长任务与 WebSocket 长连
        proxy_connect_timeout   60s;
        proxy_send_timeout      1800s;
        proxy_read_timeout      1800s;
        send_timeout            1800s;
    }
}
```

### 关键点说明

| 配置 | 作用 | 不加会怎样 |
|------|------|-----------|
| `proxy_buffering off` | 上游写一行 NDJSON，Nginx 立刻转发给客户端 | CLI 长时间无输出，连接被判 idle 后断开，报 `fetch failed` |
| `proxy_request_buffering off` | 大 zip 请求体直接透传 | 大项目上传会先在 Nginx 磁盘上二次落盘，慢且占空间 |
| `client_max_body_size 1024m` | 允许上传大 zip | 触发 `413 Request Entity Too Large` |
| `Upgrade` / `Connection "upgrade"` | 透传给上游，让 Web 管理端的终端 WebSocket 能握手 | 管理端 web terminal 无法建立或频繁断开 |
| `proxy_read_timeout 1800s` | 允许 pre/postDeploy 长任务 | 默认 60s 时长任务会被 Nginx 掐断连接 |

### 应用与验证

```bash
# 服务器上
nginx -t && nginx -s reload

# 开发机上再跑一次
kite push --env docs
```

正常情况下你能看到服务端日志一行一行实时流式输出，最后以 `Deployed successfully! (xxx)` 收尾。
