# Changelog


## v1.2.0

[compare changes](https://github.com/ATQQ/Kite/compare/v1.1.0...feature/v1.2)

### 🚀 Enhancements

- **cli, server, docs:** 新增部署脚本环境变量注入支持 ([6e62e7d](https://github.com/ATQQ/Kite/commit/6e62e7d))
- 新增部署启动时间追踪、仪表盘平均耗时与日志跳转功能 ([5f93f15](https://github.com/ATQQ/Kite/commit/5f93f15))
- **cli:** Add export/import/verify for full service migration ([f6ccdb2](https://github.com/ATQQ/Kite/commit/f6ccdb2))
- 添加Web端数据迁移功能 ([69d168b](https://github.com/ATQQ/Kite/commit/69d168b))
- **web:** Add project deployment log viewing feature ([51901ad](https://github.com/ATQQ/Kite/commit/51901ad))
- **project-detail:** Add project delete confirmation modal ([c7d6b9f](https://github.com/ATQQ/Kite/commit/c7d6b9f))
- 添加操作日志审计功能 ([8c06082](https://github.com/ATQQ/Kite/commit/8c06082))
- Add toast notification and confirm dialog components, replace alert/confirm ([ee35d85](https://github.com/ATQQ/Kite/commit/ee35d85))
- 新增健康检查、部署归档与运维诊断能力 ([a1b0129](https://github.com/ATQQ/Kite/commit/a1b0129))
- 添加部署清理策略与归档回滚功能 ([9a0f9a6](https://github.com/ATQQ/Kite/commit/9a0f9a6))
- Add storage management page and related APIs ([83d8ece](https://github.com/ATQQ/Kite/commit/83d8ece))
- **cli:** 新增运维命令list/status/logs/rollback ([fa5b437](https://github.com/ATQQ/Kite/commit/fa5b437))
- Add deployment stats dashboard with heatmap and success rate charts ([4ef19b2](https://github.com/ATQQ/Kite/commit/4ef19b2))
- **project-detail:** Add deployment history and rollback feature ([35d18d3](https://github.com/ATQQ/Kite/commit/35d18d3))
- Add filesystem browser and batch project creation via folder selection ([7b2a6c3](https://github.com/ATQQ/Kite/commit/7b2a6c3))
- 新增项目重命名、文件查看功能，完善错误处理与校验 ([0ceb9a7](https://github.com/ATQQ/Kite/commit/0ceb9a7))
- **folderPicker:** Add last visited directory persistence ([bcd93fc](https://github.com/ATQQ/Kite/commit/bcd93fc))
- Add project categorization system ([a527d56](https://github.com/ATQQ/Kite/commit/a527d56))
- 实现分类颜色自动分配，添加批量项目分类筛选 ([83d887f](https://github.com/ATQQ/Kite/commit/83d887f))
- **DefaultLayout:** Add theme toggle button in sidebar and header ([d35681f](https://github.com/ATQQ/Kite/commit/d35681f))

### 🩹 Fixes

- **artifact,web:** 修复部署归档清理逻辑并添加复制ID与当前版本标识 ([164c743](https://github.com/ATQQ/Kite/commit/164c743))
- 优化项目操作的冲突错误提示 ([a2adf07](https://github.com/ATQQ/Kite/commit/a2adf07))
- **web:** 优化批量项目表单校验与UI样式 ([4596212](https://github.com/ATQQ/Kite/commit/4596212))

### 💅 Refactors

- **ProjectList:** 优化批量创建项目弹窗表格布局与样式 ([ab1f63f](https://github.com/ATQQ/Kite/commit/ab1f63f))
- **server:** 抽离鉴权逻辑到公共auth模块，统一管理admin鉴权 ([31c5c51](https://github.com/ATQQ/Kite/commit/31c5c51))

### 📖 Documentation

- 完善官方文档，更新各类指南与API说明 ([7632e2d](https://github.com/ATQQ/Kite/commit/7632e2d))
- **cli:** 补充完善pm2后台运行的文档说明 ([496f4ea](https://github.com/ATQQ/Kite/commit/496f4ea))
- Add AGENTS.md and plan/ directory specification ([1368a82](https://github.com/ATQQ/Kite/commit/1368a82))

### 📦 Build

- 移除@tursodatabase/database依赖 ([8bf0c86](https://github.com/ATQQ/Kite/commit/8bf0c86))

### 🏡 Chore

- **release:** 升级包版本至v1.1.0并更新变更日志 ([de6fd6a](https://github.com/ATQQ/Kite/commit/de6fd6a))

### ❤️ Contributors

- Sugar ([@ATQQ](https://github.com/ATQQ))

## v1.1.0

[compare changes](https://github.com/ATQQ/Kite/compare/v1.0.0...v1.1.0)

### 🚀 Enhancements

- 添加项目级 serverUrl 配置支持并更新相关文档 ([129674c](https://github.com/ATQQ/Kite/commit/129674c))

### 📖 Documentation

- 优化全站文档，调整默认配置并移除示例文档 ([66d9ebd](https://github.com/ATQQ/Kite/commit/66d9ebd))

### ❤️ Contributors

- Sugar ([@ATQQ](https://github.com/ATQQ))

## v1.0.0

[compare changes](https://github.com/ATQQ/Kite/compare/v1.0.0)

### 🚀 Enhancements

- 初始化 kite 自动化部署工具项目 ([91ef2ba](https://github.com/ATQQ/Kite/commit/91ef2ba))
- **web:** 实现管理后台前端基础框架与核心功能 ([11c6f45](https://github.com/ATQQ/Kite/commit/11c6f45))
- 增强自动化部署工具功能与文档 ([5335a95](https://github.com/ATQQ/Kite/commit/5335a95))
- 更新 CLI 工具与文档，增强用户体验 ([20af19b](https://github.com/ATQQ/Kite/commit/20af19b))
- 添加重置管理端密码功能与相关文档更新 ([e8746bb](https://github.com/ATQQ/Kite/commit/e8746bb))
- **web:** 新增系统设置页面并支持深色主题 ([7df9742](https://github.com/ATQQ/Kite/commit/7df9742))
- 添加全局部署令牌支持 ([a6d9474](https://github.com/ATQQ/Kite/commit/a6d9474))
- CLI 优化 ([5860770](https://github.com/ATQQ/Kite/commit/5860770))
- **server:** 添加入站请求日志与响应延迟统计 ([5a4a393](https://github.com/ATQQ/Kite/commit/5a4a393))
- **project:** 新增项目文件浏览与预览功能 ([12003c7](https://github.com/ATQQ/Kite/commit/12003c7))
- **deploy, cli, web:** 新增部署实时日志流与Web日志渲染，优化CLI部署输出 ([14a8d08](https://github.com/ATQQ/Kite/commit/14a8d08))
- **serve,backend:** 重构本地开发服务，新增pm2与静态文件支持 ([f1d5162](https://github.com/ATQQ/Kite/commit/f1d5162))
- **cli, store, web:** 优化日志时间显示、修复API 401认证处理并新增CLI配置查看命令 ([593f97d](https://github.com/ATQQ/Kite/commit/593f97d))
- **backend, web, cli:** 支持项目多环境部署功能 ([4d35e53](https://github.com/ATQQ/Kite/commit/4d35e53))
- 添加项目logo，完善文档与站点配置 ([a340b80](https://github.com/ATQQ/Kite/commit/a340b80))
- **cli:** 为 serve 命令添加 --runtime 选项并支持 node/bun 运行时 ([5151134](https://github.com/ATQQ/Kite/commit/5151134))
- **cli:** 替换部署令牌存储提示为交互式选择菜单 ([8259aa4](https://github.com/ATQQ/Kite/commit/8259aa4))

### 🩹 Fixes

- Serve 终止异常的问题 ([ad306eb](https://github.com/ATQQ/Kite/commit/ad306eb))
- Node serve run error ([6d9a284](https://github.com/ATQQ/Kite/commit/6d9a284))
- Static source 404 ([525dbd7](https://github.com/ATQQ/Kite/commit/525dbd7))
- Serve kite push error ([7622198](https://github.com/ATQQ/Kite/commit/7622198))
- Type error ([959b953](https://github.com/ATQQ/Kite/commit/959b953))
- **server, build:** 修复 Node.js 核心模块导入并更新构建配置 ([6874497](https://github.com/ATQQ/Kite/commit/6874497))

### 📖 Documentation

- 更新包名从 @kite/cli 到 @kitecd/cli ([1da420b](https://github.com/ATQQ/Kite/commit/1da420b))
- 更新 CLI 配置命令格式，统一使用 `config:set` 和 `config:get` 语法 ([f2c4110](https://github.com/ATQQ/Kite/commit/f2c4110))
- 完善部署文档，补充解压行为和执行流程说明 ([c5fb2fa](https://github.com/ATQQ/Kite/commit/c5fb2fa))

### 📦 Build

- **server:** 为服务端应用添加tsconfig.json配置文件 ([4f33049](https://github.com/ATQQ/Kite/commit/4f33049))
- 添加release脚本并更新发布相关依赖 ([5254fe1](https://github.com/ATQQ/Kite/commit/5254fe1))
- **cli:** 配置 bumpp + changelogen 发版流程 ([3420836](https://github.com/ATQQ/Kite/commit/3420836))

### 🏡 Chore

- 更新 .gitignore 文件以排除数据库文件 ([a9d88a6](https://github.com/ATQQ/Kite/commit/a9d88a6))

### ❤️ Contributors

- Sugar ([@ATQQ](https://github.com/ATQQ))
