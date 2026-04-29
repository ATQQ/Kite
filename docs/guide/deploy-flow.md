# 部署流程

Kite 的部署链路由 Web、Server、CLI 三端协作完成。

## 配置阶段

1. 管理员使用 `ADMIN_TOKEN` 登录 Web 管理端。
2. 在项目管理页创建项目，填写名称、描述和服务端部署目录。
3. Web 端为项目生成 Deploy Token。
4. 可选：在项目详情页配置默认 `preDeployScript` 和 `postDeployScript`。

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

执行 `kite push` 后，CLI 会：

1. 打包 `outputDir` 下的资源。
2. 携带项目 Deploy Token 请求 `/api/deploy/upload`。
3. 将 `projectId`、Zip 文件和可选脚本提交给 Server。

## 服务端部署阶段

Server 会：

1. 校验 Deploy Token 是否属于该项目。
2. 创建部署日志并标记为 `running`。
3. 在目标目录执行前置命令。
4. 解压上传包到项目部署目录。
5. 在目标目录执行后置命令。
6. 将状态更新为 `success` 或 `failed`，并记录完整终端输出。

## 命令覆盖优先级

部署命令按以下优先级生效：

1. CLI 参数：`--pre`、`--post`、`--command`
2. 本地 `kite.config.json`
3. Web 管理端项目默认配置

`--command` 是 `--post` 的别名，适合测试时快速指定服务端部署命令。
