# Changelog


## ...feature/v1


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
- Static source  404 ([525dbd7](https://github.com/ATQQ/Kite/commit/525dbd7))
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

- 更新 .gitignore 文件以排除 数据库文件 ([a9d88a6](https://github.com/ATQQ/Kite/commit/a9d88a6))
- Release v1.0.0 ([1859591](https://github.com/ATQQ/Kite/commit/1859591))

### ❤️ Contributors

- Sugar ([@ATQQ](https://github.com/ATQQ))

