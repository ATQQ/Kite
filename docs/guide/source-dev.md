# 源码开发

如果你想参与 Kite 开发或从源码构建运行，可以参考以下步骤。

## 1. 构建源码

```bash
git clone https://github.com/ATQQ/Kite.git
cd Kite
bun install
bun run build
```

构建完成后，可以直接使用源码中的 CLI：

```bash
node packages/cli/bin/kite.js --help
```

## 2. 使用源码启动服务

```bash
node packages/cli/bin/kite.js serve
```

选择运行时：

```bash
node packages/cli/bin/kite.js serve --runtime node
bun packages/cli/bin/kite.js serve --runtime bun
```

## 3. 本地开发建议

- 使用 `bun run dev` 启动开发模式，同时拉起 Server 与 Web，代码变更会自动重新构建
- 提交 PR 前请确保在对应工作区执行 `bun run build` 能成功构建：根目录 `bun run build` 会依次构建 Web、Server、CLI
- 调试一次完整部署链路可使用仓库内置脚本 `bun run deploy:test`（在 `apps/web` 中构建后用 `packages/cli/bin/kite.js push` 推到本地服务）

## 4. 项目结构

```
kite/
├── packages/
│   └── cli/          # CLI 命令行工具
├── apps/
│   ├── server/       # 后端 API 服务
│   └── web/          # Web 管理端
├── examples/         # 示例项目
└── docs/             # 文档源码
```

更多技术细节请参考 [技术方案](/spec)。
