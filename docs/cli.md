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

默认地址是 `http://127.0.0.1:3000`。终端会打印 Admin Token，用于登录 Web 管理端。

CLI 会把持久化数据保存到 `~/.kite`：

```txt
~/.kite/config.json
~/.kite/kite.db.json
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
kite serve --host 0.0.0.0 --port 3000
```

## 三、重置管理端密码

管理端登录密码本质上是 `~/.kite/kite.db.json` 中的 Admin Token。运行中的 `kite serve` 会在每次请求时读取该文件，因此修改后无需重启后端服务。

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

## 四、全局配置

首次使用前，建议配置服务端的访问地址。Deploy Token 可以保存到全局配置，也可以保存到当前项目的 `.env.local`。

```bash
# 配置部署服务器地址
kite config:set serverUrl http://127.0.0.1:3000

# 将 Deploy Token 保存到 ~/.kite/config.json
kite config:set token kt_1a2b3c4d5e...

# 查看当前全局配置
kite config:list
```

如果不希望 token 进入全局配置，可以放在当前项目的 `.env.local`：

```bash
printf "KITE_DEPLOY_TOKEN=<DEPLOY_TOKEN>\n" >> .env.local
```

## 五、初始化项目配置

推荐使用 `kite init` 创建不包含 Token 的 `kite.config.json`：

```bash
kite init --project proj_1a2b3c4d5e --out ./dist --server http://127.0.0.1:3000
```

如果需要在初始化时保存 Token，可以显式指定保存位置：

```bash
kite init --project proj_1a2b3c4d5e --token <DEPLOY_TOKEN> --token-store global
kite init --project proj_1a2b3c4d5e --token <DEPLOY_TOKEN> --token-store local
```

`--token-store global` 会写入 `~/.kite/config.json`，`--token-store local` 会写入当前项目 `.env.local`。

## 六、项目级配置

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

*注：`kite.config.json` 不应包含 Deploy Token。*

## 七、执行部署

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
kite push --token "YOUR_TEMP_TOKEN" --server "http://test-env:3000" --out "./build" --post "npm run reload"
```

## 八、配置优先级

部署配置优先级为：

1. CLI 参数：`--token`、`--server`、`--project`、`--out`、`--pre`、`--post`、`--command`
2. 本地配置：`.env.local` 和 `kite.config.json`
3. 服务端项目默认配置：Web 管理端保存的默认部署目录与脚本

## 九、部署流程示例

1.  运行 `kite push`。
2.  CLI 自动读取当前目录的 `.env.local` 和 `kite.config.json`。
3.  打包 `outputDir` 下指定的文件为 Zip 压缩包（自动忽略冗余文件）。
4.  携带 Token 将 Zip 发送至配置的 `serverUrl`。
5.  服务端接收并校验 Token 成功后，自动解压至该项目预先设定的服务器绝对路径。
6.  服务端在解压目录下执行 `postDeploy` 指令（如 `pm2 restart` 或 `nginx -s reload`）。
7.  部署完成，CLI 终端打印出服务端返回的执行日志。你可以登录 Web 管理后台查看详细的流式日志记录。
