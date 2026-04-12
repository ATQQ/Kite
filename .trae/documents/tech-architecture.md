## 1. 架构设计
```mermaid
graph TD
    subgraph "前端应用 (Vue 3 + Vite)"
        A["页面视图层 (Views/Pages)"]
        B["组件层 (UI Components)"]
        C["状态管理 (Pinia)"]
        D["前端路由 (Vue Router)"]
        E["API 客户端 (Axios/Fetch)"]
        A --> B
        A --> C
        A --> D
        C --> E
        B --> E
    end
    subgraph "部署服务端 (ElysiaJS)"
        F["RESTful API"]
        G["Shell 执行引擎"]
    end
    E -->|HTTP (带 Token)| F
    F --> G
```

## 2. 技术栈说明
- **前端核心框架**: Vue 3 (Composition API, `<script setup>`)
- **构建工具**: Vite
- **状态管理**: Pinia
- **路由管理**: Vue Router 4
- **CSS 框架**: Tailwind CSS 3
- **组件库与图标**: 推荐使用基于 Tailwind 的无头组件库（如 shadcn-vue 或 Headless UI）以及 Lucide Vue 图标
- **API 请求**: axios 或原生 fetch
- **包管理器**: npm 或 bun (项目中已有 package.json 和 bun.lock)

## 3. 路由定义
| 路由路径 | 页面名称 | 用途 |
|-------|---------|---------|
| `/` | 仪表盘 | 项目概览与统计数据入口 |
| `/projects` | 项目列表页 | 管理和展示所有部署项目 |
| `/projects/:id` | 项目详情页 | 针对某个特定项目的指令配置与 Token 管理 |
| `/logs` | 全局日志 | 集中查看平台上所有项目的部署记录与终端日志 |

## 4. API 接口定义 (前端所需视图)
以下为部署管理后台调用服务端的预设接口规范：
- `GET /api/projects` - 获取项目列表
- `POST /api/projects` - 创建新的部署项目
- `GET /api/projects/:id` - 获取项目详细信息
- `PUT /api/projects/:id` - 更新项目的预设前后置指令
- `POST /api/projects/:id/token` - 重新生成该项目的 Token
- `GET /api/logs` - 获取部署历史记录列表
- `GET /api/logs/:deployId` - 获取某次部署的详细终端输出日志

## 5. 数据模型设计 (前端状态类型定义)
```typescript
interface Project {
  id: string; // 例如: proj_abc123
  name: string;
  description?: string;
  preDeploy?: string; // 部署前置脚本
  postDeploy?: string; // 部署后置脚本
  token?: string; // 仅在创建或生成时由后端完整返回，前端供复制
  createdAt: string;
  updatedAt: string;
}

interface DeploymentLog {
  id: string; // 部署任务的唯一 ID
  projectId: string;
  projectName: string;
  status: 'success' | 'failed' | 'running';
  triggerSource: 'cli' | 'webhook'; // 触发来源
  startTime: string;
  endTime?: string;
  output: string; // 真实的 Shell 执行日志，支持 ANSI 换行符等终端渲染
}
```
