# Kite CLI 使用文档

> Kite CLI 是一款轻量级的前后端项目极速部署工具，通过 HTTP + Token 方式一键将本地产物或代码打包上传到服务端执行部署。

## 一、安装

*前提：需要 Node.js (v18+) 并且服务端需要使用 bun 运行。*

```bash
npm install -g @kite/cli
# 或者
bun add -g @kite/cli
```

*(如果是当前 Monorepo 项目中调试，可以直接进入 `packages/cli` 目录执行 `bun link`，然后全局即可使用 `kite` 命令。)*

## 二、服务端启动说明

Kite 后端服务强依赖 `ADMIN_TOKEN` 环境变量进行管理后台的登录与接口鉴权。请在服务端创建 `.env.local` 文件并配置你的 Token（例如：`ADMIN_TOKEN=your_secure_token_here`）。
然后使用 Bun 原生内置的能力通过 CLI 参数加载环境变量来启动：

```bash
bun run --env-file=.env.local src/index.ts
```

## 三、全局配置

首次使用前，建议配置服务端的访问地址和你的全局默认身份令牌 (Admin Token 或专属 Project Token)。

```bash
# 配置部署服务器地址
kite config set serverUrl http://your-server-ip:3000

# 配置部署凭证 Token
kite config set token kt_1a2b3c4d5e...

# 查看当前全局配置
kite config list
```

## 四、项目级配置

在你要部署的前端或后端项目的根目录，创建一个 `kite.config.json` 文件：

```json
{
  "projectId": "proj_1a2b3c4d5e", 
  "outputDir": "./dist",
  "files": ["index.html", "assets"],
  "preDeploy": "npm run build",
  "postDeploy": "pm2 restart kite-web"
}
```

### 配置项说明：
*   `projectId` (必填): 对应 Web 管理面板中生成的项目唯一 ID。
*   `outputDir` (可选): 要打包的根目录（相对路径），默认是 `./`。如果是前端项目通常是 `./dist`。
*   `files` (可选): 字符串数组。指定**仅上传**该目录下的哪些特定文件或子目录。如果为空或不传，默认打包 `outputDir` 下所有文件（自动忽略 `.git` 和 `node_modules` 等）。
*   `preDeploy` (可选): 在**服务端**解压前执行的前置脚本（注意：不是本地构建）。
*   `postDeploy` (可选): 在**服务端**解压完成后，在目标部署目录执行的后置脚本（例如重启服务）。

*注：`preDeploy` 和 `postDeploy` 优先级高于 Web 面板上配置的默认指令。*

## 五、执行部署

在包含 `kite.config.json` 的项目根目录下执行：

```bash
kite push
```

### 命令行参数覆盖

你可以通过附加参数临时覆盖配置（这在 CI/CD 流水线中非常有用）：

```bash
kite push --token "YOUR_TEMP_TOKEN" --server "http://test-env:3000" --out "./build" --post "npm run reload"
```

## 六、部署流程示例

1.  运行 `kite push`。
2.  CLI 自动读取当前目录的 `kite.config.json`。
3.  打包 `outputDir` 下指定的文件为 Zip 压缩包（自动忽略冗余文件）。
4.  携带 Token 将 Zip 发送至配置的 `serverUrl`。
5.  服务端接收并校验 Token 成功后，自动解压至该项目预先设定的服务器绝对路径。
6.  服务端在解压目录下执行 `postDeploy` 指令（如 `pm2 restart` 或 `nginx -s reload`）。
7.  部署完成，CLI 终端打印出服务端返回的执行日志。你可以登录 Web 管理后台查看详细的流式日志记录。
