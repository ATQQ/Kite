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

> **解压行为说明**
>
> 解压采用覆盖模式：同名文件会被覆盖，但目标目录中已存在而新 zip 中没有的文件会保留。如果需要保证部署结果与本地完全一致，可在 `preDeploy` 中添加清理逻辑（如 `rm -rf` 目标目录内容）。

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
