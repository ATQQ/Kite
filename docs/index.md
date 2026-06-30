---
layout: home

hero:
  name: Kite
  text: 自动化项目部署工具
  tagline: 安装一个 CLI，就能启动 Web 管理端、Server 代理后端和部署上传能力。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start

features:
  - title: 一条命令启动
    details: kite serve 会启动内置 Web 和 Server，首次运行自动创建 ~/.kite 数据目录。
  - title: 升级不丢数据
    details: 项目、Token、日志和默认部署目录都保存在用户 home 下，不跟随 npm 包更新被覆盖。
  - title: Node/Bun 友好
    details: 内置服务使用标准 HTTP/FS/Child Process 能力，并提供 --runtime 参数标记 node 或 bun。
---

<HomeStats />

## 适合什么场景

Kite 适合个人服务器、内网环境、小团队项目和测试环境的快速部署。它不要求你在每个项目里维护复杂 SSH 脚本，也不要求先分别部署前端和后端服务。

典型流程：

1. 安装 `@kitecd/cli`。
2. 运行 `kite serve` 打开内置管理后台。
3. 在 Web 管理端创建项目，复制项目 ID 和 Deploy Token。
4. 在待部署项目里创建 `kite.config.json`。
5. 运行 `kite push`，回到 Web 管理端查看部署状态和终端日志。
