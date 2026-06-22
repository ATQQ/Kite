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
    "name": "string",          // 必填，项目名称
    "description": "string",   // 可选，项目描述
    "deployPath": "string",    // 必填，服务器上的部署目录绝对路径
    "env": "string"            // 可选，环境标识
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
* **Response**: 返回单个项目对象，如不存在则返回 404。

### 2.4 更新项目配置
* **URL**: `/api/projects/:id`
* **Method**: `PUT`
* **Body**:
  ```json
  {
    "preDeployScript": "string",   // 可选
    "postDeployScript": "string",  // 可选
    "deployPath": "string"         // 可选
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
  * `preDeploy`: CLI 覆盖的前置脚本 (String, 可选)
  * `postDeploy`: CLI 覆盖的后置脚本 (String, 可选)
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

