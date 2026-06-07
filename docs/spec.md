# 自动化项目部署工具 技术方案（v4.0 CLI 全局配置版）

## 一、 项目定位与核心特性
本项目是一个轻量级、云原生的前后端项目自动化部署工具。
*   **全栈与多端**：不仅支持纯静态前端项目（Vue/React）的产物上传，还支持后端项目（Node.js/Bun/Go 等）的代码上传、依赖安装与服务重启。提供 Web 可视化面板与 CLI 极客工具。
*   **HTTP + Token 驱动**：摒弃复杂的 SSH 配置，基于 HTTP 协议与专属 Token 实现极简且安全的跨网络文件传输和指令下发。
*   **灵活指令覆盖**：支持 CLI 参数 > 本地配置 > 平台云端配置的三级覆盖机制，适用于各种部署场景。
*   **全局 CLI 配置**：CLI 支持持久化保存服务地址 (Server URL) 和身份令牌 (Token)，无需每次输入。

## 二、 CLI 命令行工具设计细节

CLI 需要管理两类配置：**全局/用户级配置**（用于连接服务端）和**项目级配置**（用于指定打包目录、覆盖脚本等）。

### 1. 全局配置管理 (Global Config)

为了让开发者无需在每个项目中重复配置服务地址和 Token，CLI 提供专门的命令来管理这些信息，并将其持久化存储在用户的主目录。

**涉及的 CLI 命令：**
*   **`config:set <key> <value>`**：设置全局配置。
    *   示例：`kite config:set serverUrl https://deploy.yourdomain.com`
    *   示例：`kite config:set token abcdef1234567890`
*   **`config:get <key>`**：读取全局配置。
*   **`config:list`**：查看当前所有全局配置。

### 2. 项目级配置管理 (Project Config)

在要部署的本地项目根目录下，使用 `kite.config.json` 来管理项目特有的配置。

**配置文件结构示例 (`kite.config.json`)：**
```json
{
  "projectId": "proj_abc123",  // 对应 Web 平台上创建的项目 ID（必填）
  "outputDir": "./dist",       // 要打包上传的目录
  "serverUrl": "https://deploy.example.com", // 部署服务地址（可选）
  "env": {                     // 部署时注入的环境变量（可选）
    "NODE_ENV": "production"
  },
  "preDeploy": "npm run build", // 部署前本地执行的构建命令（可选）
  "postDeploy": "pm2 restart api-server" // 部署后服务端执行的命令（可选，覆盖平台配置）
}
```

### 3. 配置优先级合并策略

当执行部署命令 `kite push` 时，CLI 会按照以下优先级合并配置并发起请求：

1.  **服务端连接信息 (Server URL & Token)**：
    *   优先级：CLI 参数 (`--server`, `--token`) > `.env.local` > 项目配置 (`kite.config.json`) > 全局配置 (`~/.kite/config.json`)。
2.  **部署相关指令 (Output Dir, Pre/Post Scripts)**：
    *   优先级：CLI 参数 (`--out`, `--pre`, `--post`) > 项目级配置 (`kite.config.json`) > 平台云端默认配置。

### 4. 完整的部署工作流 (CLI 视角)

1.  **准备阶段**：
    *   配置服务端环境：`kite config:set serverUrl http://...` 和 `kite config:set token xxxx`
2.  **执行部署 (`kite push`)**：
    *   **读取配置**：合并全局配置、项目配置和命令行参数。
    *   **本地前置执行**：如果配置了 `preDeploy`，调用本地 Shell 执行（例如 `npm run build`）。
    *   **打包压缩**：使用 `archiver` 将 `outputDir` 打包为 `.zip`（忽略 `.git`, `node_modules` 等）。
    *   **发起 HTTP 请求**：将压缩包和可选的覆盖指令（`postDeploy`）作为 FormData，携带 Token 请求服务端的 `/api/deploy/upload` 接口。
    *   **终端反馈**：显示 Loading 动画，并在请求返回后打印成功或失败信息（包含服务端执行 `postDeploy` 的日志）。

## 三、 ElysiaJS 服务端执行引擎设计

由于要执行后端项目的重启命令，ElysiaJS 后端需要具备调用系统 Shell 的能力。

### 1. 指令执行模块 (Shell Executor)
依托后端 Bun 运行时，使用 Bun 提供的极速 Shell 原生能力（`Bun.$` 或 `Bun.spawn`）：
```typescript
import { $ } from "bun";

async function executeDeploy(zipFile, destPath, postDeployCmd) {
  // ... 解压文件 ...
  if (postDeployCmd) {
    const { stdout, stderr, exitCode } = await $`cd ${destPath} && sh -c ${postDeployCmd}`;
    if (exitCode !== 0) throw new Error(`执行失败: ${stderr.toString()}`);
    return stdout.toString();
  }
}
```

### 2. API 接口定义扩展
上传接口不仅接收文件，还接收覆盖指令：
*   **POST** `/api/deploy/upload`
*   **Headers**: `Authorization: Bearer <Token>`
*   **Body (FormData)**:
    *   `file`: zip 压缩包
    *   `projectId`: 项目唯一标识
    *   `preDeploy` (可选): 覆盖的前置指令
    *   `postDeploy` (可选): 覆盖的后置指令

## 四、 安全性考量 (Security)

1.  **Token 严格校验**：只允许携带合法 Token 的请求执行操作。
2.  **权限降级**：运行 ElysiaJS 服务的 Linux 用户不应是 `root`，建议创建一个专用的 `deployer` 用户，只赋予目标部署目录的读写权限。
3.  **操作审计**：每次部署触发的指令、执行日志、触发时间、Token ID 都要完整写入 Turso 数据库的 `deployments` 日志表中。

## 五、 全局技术栈清单

| 模块 | 技术栈 | 职责描述 |
| :--- | :--- | :--- |
| **Monorepo** | Bun Workspaces | 统一管理多包，极速安装依赖 |
| **Server (后端)** | ElysiaJS + Bun | 提供极速 API，接收文件，执行 Shell 重启服务 |
| **Database** | Turso + Drizzle ORM | 存储项目信息、平台默认部署指令及历史日志 |
| **Web (前端)** | Vue 3 + Vite + Pinia | 管理面板：创建项目、生成 Token、配置默认指令、看日志 |
| **CLI (命令行)** | Node.js + cac + conf | 管理全局 Token/URL，读取配置，打包，发送 HTTP 请求 |
