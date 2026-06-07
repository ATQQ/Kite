# 源码开发

如果你想参与 Kite 开发或从源码构建运行，可以参考以下步骤。

## 1. 构建源码

```bash
git clone https://github.com/ATQQ/Kite.git
cd kite
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

- 使用 `bun run dev` 启动开发模式，代码变更会自动重新构建
- 测试部署流程时，可以使用内置的示例项目（`examples/` 目录）
- 提交 PR 前请确保所有测试通过：`bun run test`

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
