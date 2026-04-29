---
layout: home

hero:
  name: Kite
  text: 自动化项目部署工具
  tagline: 用 Web 管理项目，用 CLI 上传资源，用 Server 解压并执行部署命令。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: 查看示例
      link: /examples/

features:
  - title: Web 管理端
    details: 创建项目、维护部署目录、管理项目 Token、配置默认脚本、查看部署日志。
  - title: Server 部署服务
    details: 接收 CLI 上传的 Zip 包，校验项目 Token，解压到目标目录并执行部署命令。
  - title: CLI 工具
    details: 读取 kite.config.json，打包目标资源，上传到部署服务，支持命令行覆盖配置。
---

## 适合什么场景

Kite 适合个人服务器、内网环境、小团队项目和测试环境的快速部署。它不要求你在每个项目里维护复杂 SSH 脚本，而是通过 HTTP + Token 完成打包上传和服务端命令执行。

典型流程：

1. 在 Web 管理端创建项目，复制项目 ID 和 Deploy Token。
2. 在待部署项目里创建 `kite.config.json`。
3. 运行 `kite push` 或传入 `--server`、`--token`、`--project` 等参数。
4. 回到 Web 管理端查看部署状态和终端日志。
