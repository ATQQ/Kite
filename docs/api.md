# Kite Deploy API Documentation

> 本文档描述了 Kite 后端部署服务（ElysiaJS）提供的所有 RESTful API 接口，供前端面板或 CLI 使用。

## 全局鉴权 (Authentication)
所有请求都必须在 Header 中携带生成的 `ADMIN_TOKEN`：
```http
Authorization: Bearer <YOUR_ADMIN_TOKEN>
```
*注：管理员的 `ADMIN_TOKEN` 需通过配置 `.env.local` 文件获得。在运行后端服务时，使用 Bun 提供的参数加载环境变量文件：`bun run --env-file=.env.local src/index.ts`。*

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
      "token": "test-token",
      "preDeployScript": "bun run build",
      "postDeployScript": "pm2 restart kite-web",
      "status": "success",
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
    "id": "string",            // 必填，唯一标识
    "name": "string",          // 必填，项目名称
    "description": "string",   // 可选，项目描述
    "deployPath": "string"     // 必填，服务器上的部署目录绝对路径
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

### 2.5 重新生成项目的专属 Token
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

## 3. 日志与部署接口

### 3.1 获取部署历史记录
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
      "duration": "1.2s",
      "output": "[Kite Deploy] Starting deployment..."
    }
  ]
  ```

### 3.2 接收 CLI 上传与执行部署
该接口通常由 CLI 调用。CLI 请求时，需在 Header 携带 **该项目专属的 Token**。

* **URL**: `/api/deploy/upload`
* **Method**: `POST`
* **Headers**: `Authorization: Bearer <PROJECT_SPECIFIC_TOKEN>`
* **Content-Type**: `multipart/form-data`
* **FormData 参数**:
  * `file`: 压缩包文件 (File)
  * `projectId`: 项目 ID (String)
  * `preDeploy`: CLI 覆盖的前置脚本 (String, 可选)
  * `postDeploy`: CLI 覆盖的后置脚本 (String, 可选)
* **Response**:
  ```json
  {
    "success": true,
    "message": "Deployed successfully",
    "postDeployLog": "..."
  }
  ```