# Provider logos

Agent provider 品牌图标，取自 [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)（MIT License, Copyright (c) 2023 LobeHub）。

| 文件 | 来源图标 | 说明 |
|------|----------|------|
| `cursor.svg` | `icons/cursor.svg` | 单色，继承 `currentColor` |
| `claude.svg` | `icons/claudecode-color.svg` | Claude Code 品牌色 |
| `codex.svg` | `icons/codex.svg` | 单色版本，继承 `currentColor`；早期误用 `codex-color` 在白底/深色场景显示异常 |
| `trae.svg` | `icons/trae-color.svg` | TRAE 品牌色 |
| `workbuddy.svg` | `juejin-usage/packages/dashboard/src/assets/brand-logos/workbuddy.svg` | 项目自有 WorkBuddy 图标，id 已加 `kite-wb-` 前缀避免内联冲突 |

单色图标继承 `currentColor`，因此会跟随 Kite 明暗主题自动反色；缺失或未知的 provider 由 `ProviderLogo` 回退到 lucide 通用图标。
