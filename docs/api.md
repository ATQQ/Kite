# Kite Deploy API Documentation

> 本文档描述了 Kite 后端部署服务（ElysiaJS）提供的所有 RESTful API 接口，供前端面板或 CLI 使用。

## 全局鉴权 (Authentication)

管理端接口需要在 Header 中携带 `ADMIN_TOKEN`：
```http
Authorization: Bearer <YOUR_ADMIN_TOKEN>
```

*注：通过 `kite serve` 启动时，CLI 会自动生成 Admin Token 并打印在终端中。也可以通过 `kite admin reset-password` 重置。*

---

## 1. 认证接口

### 1.1 登录验证
验证前端输入的 Token 是否为合法的 Admin Token。

* **URL**: `/api/auth/login`
* **Method**: `POST`
* **Body**:
  ```json
  {
    "token": "string"
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "message": "Login successful"
  }
  ```

---

## 2. 项目管理接口

### 2.1 获取所有项目列表
* **URL**: `/api/projects`
* **Method**: `GET`
* **Query (可选)**: `tagIds=<id1>,<id2>` — 按标签筛选，多个 id 之间为「与」逻辑（项目必须同时关联所有 id）
* **Response**:
  ```json
  [
    {
      "id": "proj_kite_web",
      "name": "Kite Web",
      "description": "The frontend panel...",
      "deployPath": "/var/www/kite-web",
      "token": "kt_xxxxxxxx",
      "preDeployScript": "bun run build",
      "postDeployScript": "pm2 restart kite-web",
      "env": "production",
      "categoryId": "cat_frontend",
      "pm2AppName": "kite-web",
      "tagIds": ["tag_frontend", "tag_pm2"],
      "status": "success",
      "createdAt": "2026-04-12T10:00:00Z",
      "updatedAt": "2026-04-12T10:45:00Z"
    }
  ]
  ```

### 2.2 创建新项目
* **URL**: `/api/projects`
* **Method**: `POST`
* **Body**:
  ```json
  {
    "name": "string",            // 必填，项目名称
    "description": "string",     // 可选，项目描述
    "deployPath": "string",      // 必填，服务器上的部署目录绝对路径
    "env": "string",             // 可选，环境标识
    "categoryId": "string|null", // 可选，分类 id
    "pm2AppName": "string|null", // 可选，绑定的 PM2 应用名
    "tagIds": ["string"]         // 可选，标签 id 列表
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "project": { /* 新创建的项目对象 */ }
  }
  ```

### 2.3 获取单个项目详情
* **URL**: `/api/projects/:id`
* **Method**: `GET`
* **Response**: 返回单个项目对象（含 `categoryId / pm2AppName / tagIds`），如不存在则返回 404。

### 2.4 更新项目配置
* **URL**: `/api/projects/:id`
* **Method**: `PUT`
* **Body**:
  ```json
  {
    "preDeployScript": "string",   // 可选
    "postDeployScript": "string",  // 可选
    "deployPath": "string",        // 可选
    "postDeployAsync": false,      // 可选；true 时 postDeploy 异步执行（fire-and-forget），默认 false 保留旧行为
    "categoryId": "string|null",   // 可选
    "pm2AppName": "string|null",   // 可选；传空字符串等同于解绑（null）
    "tagIds": ["string"]           // 可选；传入即覆盖该项目的全部标签关联
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "project": { /* 更新后的项目对象 */ }
  }
  ```

### 2.5 删除项目
删除项目及其所有部署记录。

* **URL**: `/api/projects/:id`
* **Method**: `DELETE`
* **Response**:
  ```json
  {
    "success": true,
    "message": "Project deleted successfully"
  }
  ```

### 2.6 重新生成项目的专属 Token
该 Token 用于 CLI 上传时的独立身份认证，与全局 ADMIN_TOKEN 不同。
* **URL**: `/api/projects/:id/token`
* **Method**: `POST`
* **Response**:
  ```json
  {
    "success": true,
    "token": "kt_1a2b3c4d5e6f7g8h"
  }
  ```

---

## 3. 文件浏览接口

### 3.1 浏览项目部署目录
* **URL**: `/api/projects/:id/files?path=<相对路径>`
* **Method**: `GET`
* **Query**: `path` (可选) - 相对于部署目录的子路径
* **Response**:
  ```json
  [
    {
      "name": "index.html",
      "path": "index.html",
      "isDir": false,
      "size": 1234,
      "mtime": "2026-04-12T10:45:00Z"
    },
    {
      "name": "assets",
      "path": "assets",
      "isDir": true,
      "size": 0,
      "mtime": "2026-04-12T10:45:00Z"
    }
  ]
  ```

### 3.2 读取文件内容
* **URL**: `/api/projects/:id/file?path=<相对路径>`
* **Method**: `GET`
* **Query**: `path` (必填) - 相对于部署目录的文件路径
* **Response** (文本文件):
  ```json
  {
    "type": "text",
    "content": "<!DOCTYPE html>...",
    "language": "html"
  }
  ```
* **Response** (二进制文件或超过 1MB 的文件):
  ```json
  {
    "type": "binary",
    "size": 2048000,
    "message": "File too large to preview"
  }
  ```

---

## 4. 日志与部署接口

### 4.1 获取部署历史记录
* **URL**: `/api/logs`
* **Method**: `GET`
* **Response**:
  ```json
  [
    {
      "id": "log_9x8f7a",
      "projectId": "proj_kite_server",
      "projectName": "Kite Server",
      "status": "failed",
      "triggerSource": "cli",
      "startTime": "2026-04-12T10:45:00Z",
      "endTime": "2026-04-12T10:45:01.2Z",
      "duration": "1.2s",
      "output": "[Kite Deploy] Starting deployment..."
    }
  ]
  ```

### 4.2 获取单条部署记录
* **URL**: `/api/logs/:deployId`
* **Method**: `GET`
* **Response**: 返回单条部署记录对象，如不存在则返回 404。

### 4.3 部署日志 SSE 流
通过 Server-Sent Events 实时推送部署日志。适用于 Web 管理端实时查看部署进度。

* **URL**: `/api/logs/:deployId/stream`
* **Method**: `GET`
* **Response**: SSE 流，事件类型：
  * `log` - 日志输出行
  * `status` - 部署状态变更（包含 `status`、`duration` 字段）

### 4.4 接收 CLI 上传与执行部署
该接口通常由 CLI 调用。CLI 请求时，需在 Header 携带 **该项目专属的 Token** 或 **全局 Deploy Token**。

* **URL**: `/api/deploy/upload`
* **Method**: `POST`
* **Headers**: `Authorization: Bearer <PROJECT_SPECIFIC_TOKEN>`
* **Content-Type**: `multipart/form-data`
* **FormData 参数**:
  * `file`: 压缩包文件 (File)
  * `projectId`: 项目 ID (String)
  * `preDeploy`: 前置脚本，**当项目未配置 `preDeployScript` 时才生效** (String, 可选)。项目在 Web 端配置了 `preDeployScript` 时，本字段被忽略，部署日志会打印 `Pre-deploy: using platform script (CLI-provided script ignored)`。
  * `postDeploy`: 后置脚本，**当项目未配置 `postDeployScript` 时才生效** (String, 可选)。覆盖规则同 `preDeploy`。
  * `postDeployAsync`: 单次部署的 async 覆盖 (String, 可选；接受 `"true"|"false"|"1"|"0"`)。**当 Web 端项目设置未开启 `postDeployAsync` 时才生效**：CLI 传 `true` 时本次部署异步执行；CLI 传 `false` 同步执行。Web 端开启 `postDeployAsync`（true）时强制异步，CLI `false` 被忽略（部署日志会打印 `Post-deploy async: forced by platform config (CLI flag ignored)`）。
  * `env`: 部署时注入到 pre/post 脚本的环境变量，**JSON 字符串** 形式 (String, 可选)
* **Response**: NDJSON 流（`Content-Type: application/x-ndjson`），每行一个 JSON 对象：

  ```json
  {"event":"log","data":"[Kite Deploy] Starting deployment..."}
  {"event":"log","data":"[Kite Deploy] Extracting files..."}
  {"event":"status","status":"success","duration":"1.2s","deployId":"log_9x8f7a"}
  ```

  事件类型：
  * `log` - 部署过程中的日志输出
  * `status` - 部署最终状态（`success` 或 `failed`），附带 `duration` 和 `deployId`

---

## 5. 系统设置接口

### 5.1 获取所有设置
* **URL**: `/api/settings`
* **Method**: `GET`
* **Response**: 返回所有设置项的键值对。

### 5.2 更新设置
* **URL**: `/api/settings`
* **Method**: `PUT`
* **Body**:
  ```json
  {
    "webhook_url": "string",          // 可选
    "webhook_events": "string",       // 可选
    "default_deploy_path": "string",  // 可选
    "max_upload_size": "string",      // 可选，单位 MB
    "global_deploy_token": "string"   // 可选，全局部署 Token
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "message": "Settings updated"
  }
  ```

### 5.3 修改 Admin Token
* **URL**: `/api/settings/token`
* **Method**: `POST`
* **Body**:
  ```json
  {
    "oldToken": "string",   // 当前 Token
    "newToken": "string"    // 新 Token（至少 8 位）
  }
  ```
* **Response**:
  ```json
  {
    "success": true,
    "message": "Token 已更新，下次登录请使用新 Token"
  }
  ```

### 5.4 服务器状态
* **URL**: `/api/settings/status`
* **Method**: `GET`
* **Response**:
  ```json
  {
    "version": "1.0.0",
    "uptime": "2h 30m",
    "projectCount": 5,
    "deploymentCount": 42,
    "successCount": 38,
    "failedCount": 4,
    "successRate": 90
  }
  ```

### 5.5 测试 Webhook
* **URL**: `/api/settings/webhook-test`
* **Method**: `POST`
* **Body**: 无（读取当前已保存的 `webhook_url`）
* **行为**: 使用当前 `webhook_url` 同步发送一次测试消息，按 host 自动选择 payload 形态（飞书 / 钉钉 / 通用 JSON），5 秒超时 + 至多 1 次重试，等待结果后返回。
* **Response**:
  ```json
  {
    "success": true,
    "statusCode": 200,
    "durationMs": 234,
    "attempts": 1
  }
  ```
* **URL 未配置**: `400`，`{ "success": false, "error": "webhook_url 未配置，..." }`

### 5.6 出站 Webhook 通知（通知形态参考）

`kite serve` 内置在 6 个时机向用户配置的 `webhook_url` 发送 POST 通知，**fire-and-forget**，不阻塞部署主流程；失败/超时会写入 `audit_logs`（`action=webhook.send`），URL 仅以 host 形式记录。

**触发时机**

| trigger | event | 说明 |
|---|---|---|
| `cli` | `deploy_success` | 普通部署（含 `kite push` 与 Web 端上传）成功 |
| `cli` | `deploy_failure` | 普通部署失败（含 `postDeploy` 同步异常） |
| `async_post_deploy` | `deploy_failure` | 异步 `postDeploy` 子进程非 0 退出 |
| `rollback` | `deploy_success` | 回滚成功（`deployment.rollbackOf` 指向被回滚的部署 id） |
| `rollback` | `deploy_failure` | 回滚失败 |
| `manual` | `deploy_success` / `deploy_failure` | 在 Web 端「标记为成功 / 失败」手动修正状态 |

只有事件 key 命中 `webhook_events`（默认 `deploy_success,deploy_failure`）才会发送。

**Payload 形态（按 URL host 自动判定）**

* **飞书** (`*.feishu.cn` / `*.larksuite.com`)：`msg_type=post` 富文本，标题/正文均含 "Kite"。
* **钉钉** (`*.dingtalk.com`)：`msgtype=markdown`，`title` 与 `text` 均强制带 "Kite" 关键词，便于配置「自定义关键词 Kite」放行。
* **其它 URL**：通用 JSON，示例：

```json
{
  "event": "deploy_success",
  "trigger": "cli",
  "timestamp": "2026-06-27T09:00:00.000Z",
  "project": { "id": "proj_demo", "name": "demo-app", "deployPath": "/srv/demo" },
  "deployment": {
    "id": "deploy-1",
    "status": "success",
    "duration": "1.5s",
    "startTime": "2026-06-27T08:59:58.500Z",
    "endTime": "2026-06-27T09:00:00.000Z",
    "rollbackOf": null
  },
  "errorMessage": null
}
```

**投递策略**

* 超时：单次请求 5 秒（基于 `AbortSignal`）。
* 重试：服务端 5xx / 网络错误 / 超时 → 重试 1 次（共 2 次尝试）；4xx（除 408/429）不重试。
* 安全：日志与 `audit_logs` 中 URL 仅保留 host，**不输出 token / query**。

## 6. 健康检查接口

### 6.1 公开健康探针
* **URL**: `/api/health`
* **Method**: `GET`
* **鉴权**: 无（供 LB / 容器探活）
* **Response 200**:
  ```json
  { "status": "ok", "uptime": 1234, "version": "dev" }
  ```
* **Response 503**: 同结构，`status` 非 `ok` 时下游应判定为不健康。

### 6.2 管理员健康详情
* **URL**: `/api/health/detail`
* **Method**: `GET`
* **鉴权**: `Authorization: Bearer <ADMIN_TOKEN>`
* **Response 200**（节选）:
  ```json
  {
    "version": "dev",
    "runtime": { "name": "node", "version": "v24.16.0" },
    "uptimeSec": 263,
    "serverTime": "2026-06-17T07:06:20.818Z",
    "db": { "ok": true, "latencyMs": 9.6, "path": "~/.kite/kite.db" },
    "disk": { "freeBytes": 298276696064, "totalBytes": 494384795648, "percentUsed": 40 },
    "kiteHome": { "path": "~/.kite", "writable": true, "tmpWritable": true },
    "deploy": { "last5": [], "successRate": null },
    "memoryMB": { "rss": 65, "heapUsed": 85 }
  }
  ```
* **Response 503**: 同结构，触发条件：`db.ok=false` / `kiteHome.writable=false` / `disk.percentUsed>=95`。
* **平台说明**: Windows 下 `disk` 字段全部为 `null`。

## 7. 日志源接口（项目运行日志）

> 用于让前端把 PM2 / Nginx / 自定义服务的日志文件挂接到指定项目，提供「实时跟随 / 历史翻页 / 关键词搜索」三种视图。所有接口均需 `Authorization: Bearer <ADMIN_TOKEN>`。

### 7.1 列出项目的日志源
* **URL**: `GET /api/projects/:id/log-sources`
* **Response**:
  ```json
  {
    "items": [
      {
        "id": "lsrc_xxx",
        "projectId": "proj_xxx",
        "label": "pm2-out.log",
        "filePath": "/Users/me/.pm2/logs/api-out.log",
        "kind": "plain",
        "sortOrder": 0,
        "createdAt": "...",
        "updatedAt": "..."
      }
    ]
  }
  ```

### 7.2 批量添加日志源
* **URL**: `POST /api/projects/:id/log-sources`
* **Body**:
  ```json
  { "items": [ { "filePath": "/abs/path.log", "label": "可选展示名", "kind": "plain" } ] }
  ```
* **限制**: 单次最多 50 个；路径必须为绝对路径；不能命中黑名单（`~/.kite/config.json`、`~/.kite/kite.db`、`/etc/shadow` 等）。

### 7.3 修改日志源
* **URL**: `PATCH /api/log-sources/:sourceId`
* **Body**: 允许更新 `label / kind / sortOrder`。`filePath` 不可更改。

### 7.4 删除日志源
* **URL**: `DELETE /api/log-sources/:sourceId`
* **说明**: 仅解除关联，**不会**删除磁盘上的日志文件。

### 7.5 获取元数据
* **URL**: `GET /api/log-sources/:sourceId/meta`
* **Response**:
  ```json
  { "id": "lsrc_xxx", "label": "...", "filePath": "...", "resolvedPath": "...", "kind": "plain", "size": 102400 }
  ```

### 7.6 字节窗口翻页
* **URL**: `GET /api/log-sources/:sourceId/range`
* **Query**:
  * `offset`: 起始字节偏移（默认尾部）
  * `size`: 窗口字节数，默认 64KB，最大 1MB
  * `direction`: `forward | backward | tail`（默认根据是否传 `offset` 自动判断）
* **Response**:
  ```json
  {
    "startOffset": 0,
    "endOffset": 65536,
    "fileSize": 102400,
    "lines": ["...", "..."],
    "truncatedHead": false,
    "truncatedTail": true,
    "binary": false
  }
  ```
* **说明**: 返回前后均自动对齐到换行符；二进制文件直接 `binary: true` 且 `lines` 为空。

### 7.7 实时流（SSE）
* **URL**: `GET /api/log-sources/:sourceId/stream`
* **Query**: `tailLines`（初始尾部行数，默认 200，最大 5000）
* **Headers**: `Content-Type: text/event-stream`
* **事件**:
  * `snapshot` — `{ "lines": ["..."], "size": 12345, "binary": false }`，初次连接 / 文件轮转后下发
  * `lines` — `{ "lines": ["..."] }`，500ms 批量节流推送追加行
  * `rotated` — `{ "at": "ISO8601" }`，检测到文件轮转
  * `error` — `{ "message": "..." }`
  * 心跳: `:keep-alive`（注释行，15s 一次）
* **说明**: 基于 `fs.watch` + 1.5s `stat.size` 兜底轮询，可兼容 `logrotate copytruncate` / NFS 等场景。

### 7.8 关键词搜索（SSE 流式 grep）
* **URL**: `GET /api/log-sources/:sourceId/search`
* **Query**:
  * `q`（必填）: 搜索关键词或正则
  * `regex`: `true / 1` 表示正则模式
  * `caseInsensitive`: `true / 1` 表示忽略大小写
  * `maxHits`: 最多命中数，默认 500，最大 5000
  * `context`: 上下文行数，默认 2，最大 20
  * `fromOffset` / `toOffset`: 限定字节范围
* **事件**:
  * `hit` — `{ "offset": 1024, "text": "...", "before": ["..."], "after": ["..."] }`
  * `truncated` — `{ "maxHits": 500 }`，命中数达上限
  * `done` — `{ "scannedBytes": 102400 }`，结束
  * `error` — `{ "message": "..." }`

---

## 8. 分类与标签接口

### 8.1 分类（Categories）
项目分类是「单选 + 互斥」的归属概念，常用于「前端 / 后端 / 测试环境」等粗粒度分组。一个项目最多归属一个分类。

* `GET /api/categories` — 列出全部分类
* `POST /api/categories` — 新建分类
  * Body: `{ "name": "string", "color": "blue|green|yellow|purple|pink|cyan|gray", "sortOrder": 0 }`
* `PUT /api/categories/:id` — 修改分类
* `DELETE /api/categories/:id` — 删除分类（相关项目会回落到「默认」）

### 8.2 标签（Tags）
标签是「多对多 + 可叠加」的属性概念，适合表达技术栈或运行时（前端 / Node / Java / PM2 / Docker 等）。一个项目可同时关联多个标签。

* `GET /api/tags` — 列出全部标签，含 `projectCount`
* `POST /api/tags` — 新建标签
  * Body: `{ "name": "string", "color": "blue|green|yellow|purple|pink|cyan|gray", "sortOrder": 0 }`
  * 颜色枚举与分类相同
* `PUT /api/tags/:id` — 修改标签（名称、颜色、排序）
* `DELETE /api/tags/:id` — 删除标签；返回 `{ success, detachedProjects }`，表示有多少个项目被解除关联

> 在「项目筛选」场景下，使用 `GET /api/projects?tagIds=a,b` 实现 AND 逻辑（同时含有所有指定标签的项目）。

---

## 9. 服务器资源与 PM2 接口

### 9.1 获取服务器资源快照
* **URL**: `GET /api/system/resources`
* **说明**: 一次性返回整机 CPU/内存/磁盘 + Kite 进程自身的资源占用。前端「概览页」每 5 秒轮询一次。
* **Response**:
  ```json
  {
    "collectedAt": "2026-06-24T10:00:00Z",
    "host": {
      "hostname": "kite-prod-01",
      "platform": "linux",
      "arch": "arm64",
      "cpuModel": "Apple M2",
      "cpuCount": 8,
      "loadAvg": [0.42, 0.55, 0.62],
      "uptimeSec": 86400
    },
    "cpu": { "percent": 12.4 },
    "memory": { "totalBytes": 17179869184, "freeBytes": 268435456, "availableBytes": 4294967296, "usedBytes": 12884901888, "percentUsed": 75 },
    "disk": { "freeBytes": 21474836480, "totalBytes": 107374182400, "percentUsed": 80 },
    "process": {
      "pid": 1234,
      "runtime": "node",
      "runtimeVersion": "v20.10.0",
      "uptimeSec": 3600,
      "cpuPercent": 0.8,
      "memoryRssBytes": 134217728,
      "memoryHeapUsedBytes": 67108864
    }
  }
  ```

> 内存口径说明：`freeBytes` 是 `os.freemem()` 的「纯空闲页」，在 macOS / Linux 上通常远小于用户直觉中的可用内存；`availableBytes` 才是「可立即回收并复用的内存」（macOS 解析 `vm_stat`，Linux 读取 `/proc/meminfo` 的 `MemAvailable`，Windows 退回到 `freeBytes`），`usedBytes / percentUsed` 都基于它计算，前端建议优先使用 `availableBytes` 展示。

### 9.2 PM2 可用性检测
* **URL**: `GET /api/pm2/available`
* **Response**: `{ "available": true }` 或 `{ "available": false }`
* **说明**: 服务端会探测 `pm2 jlist` 是否可执行（PATH 中以及 `~/.local/bin/pm2`、`/usr/local/bin/pm2`、`/opt/homebrew/bin/pm2` 等常见路径）。

### 9.3 列出当前机器上的 PM2 应用
* **URL**: `GET /api/pm2/apps`
* **Response**:
  ```json
  {
    "apps": [
      { "name": "kite-web", "pmId": 0, "status": "online" },
      { "name": "kite-api", "pmId": 1, "status": "stopped" }
    ]
  }
  ```

### 9.4 获取项目绑定的 PM2 应用状态
* **URL**: `GET /api/projects/:id/pm2`
* **Response (已绑定且找到应用)**:
  ```json
  {
    "bound": true,
    "found": true,
    "name": "kite-web",
    "pmId": 0,
    "pid": 12345,
    "status": "online",
    "uptimeMs": 3600000,
    "restarts": 2,
    "unstableRestarts": 0,
    "cpuPercent": 1.2,
    "memoryBytes": 67108864,
    "execMode": "cluster_mode",
    "instances": 2,
    "errorLogPath": "/Users/u/.pm2/logs/kite-web-error.log",
    "outLogPath": "/Users/u/.pm2/logs/kite-web-out.log",
    "createdAt": 1719200000000
  }
  ```
* **Response (未绑定 / PM2 不可用 / 未找到应用)**:
  ```json
  { "bound": false, "message": "PM2 not detected on this server" }
  ```
  或
  ```json
  { "bound": true, "found": false, "name": "kite-web" }
  ```
* **说明**: cluster 模式多实例会自动聚合（cpu/memory 求和，uptime 取最大）。结果在服务端有 1.5 秒短缓存，避免高频拉取。

