# Kite 工作空间 / 需求 / Agent 协作层 验证 Checklist

> 目标：验证 Workspace、Requirement、Task、Document、Agent 与 Board 的完整闭环。
> 每条勾选项应能独立复现；涉及写操作时优先用临时 Workspace / 临时数据目录，避免污染 `~/.kite/kite.db`。

## 0. 测试准备

- [x] 使用旧版本数据库 fixture 或现有 `~/.kite/kite.db` 备份启动一次服务，确认旧 `projects` / `deployments` 数据完整。
- [x] 准备一个可用管理员 Token（`ADMIN_TOKEN`）。
- [ ] 准备至少 2 个已存在项目，用于 Workspace 多项目关联。
- [ ] 准备一个空仓库目录，用于 CLI `workspace init` 验证。
- [x] 确认运行环境同时具备 `--runtime node` 与 `--runtime bun` 条件。
- [ ] 记录当前 `~/.kite/config.json` 内容，验证后确认仅新增 `workspaceToken` 字段。

## 1. 数据模型与迁移

- [ ] 启动服务后，`workspaces`、`workspace_projects`、`workspace_tokens`、`workspace_agents`、`requirements`、`requirement_projects`、`workspace_tags`、`requirements_tags`、`tasks`、`task_activities`、`documents`、`document_revisions`、`document_links`、`document_assets` 均存在。
- [ ] 重复启动服务，迁移幂等，无报错、无重复索引。
- [ ] 旧 `projects` 与 `deployments` 表数据条数、内容在迁移前后一致。
- [ ] 现有 `project-workspace` 保存视图语义未被改写（pin / last-opened / saved-view 行为不变）。
- [ ] 新增列均可空或带默认值，旧数据库可直接打开。
- [ ] 删除/归档记录使用 `archive`，数据库中历史 revision 未被物理删除。

## 2. Workspace 与项目关联

- [ ] `POST /api/workspaces` 可创建 Workspace，返回 `id` 与一次性 Token。
- [ ] 创建时 Token 仅返回一次；数据库只存哈希与前缀，明文不落库。
- [ ] `GET /api/workspaces` 能看到新建 Workspace。
- [ ] `PUT /api/workspaces/:id` 可更新名称/描述。
- [ ] `PUT /api/workspaces/:id/projects/:projectId` 可关联项目，角色支持 `frontend|backend|docs|demo|custom`。
- [ ] 一个 Workspace 可关联多个项目，也可关联 0 个项目。
- [ ] `DELETE /api/workspaces/:id/projects/:projectId` 可解除关联且不删除项目本身。
- [ ] 重复关联同一项目时行为明确（幂等或明确 409），不产生重复关联行。
- [ ] `GET /api/workspaces/:id` 聚合返回关联项目及其部署状态，且不触发任何部署。
- [ ] Overview 中点击关联项目可跳转现有 ProjectDetail。
- [ ] `DELETE /api/workspaces/:id` 归档 Workspace，历史数据保留。

## 3. 鉴权与 Token

- [ ] 管理员 Token 可访问全部 `/api/workspaces` 读写接口。
- [ ] Workspace Token 可访问需求、任务、文档、Agent、Board 等授权读写接口。
- [ ] Workspace Token 可创建需求，且新建需求的项目范围为空（整个 Workspace）。
- [ ] Agent 可通过 `kite task list/show/create/claim/update/release` 完成任务闭环，无需直接查询数据库或调用 HTTP API。
- [ ] Agent 可通过 `kite doc show/update/revisions/link/unlink/push` 完成资料闭环。
- [ ] Workspace Token 不能管理 Workspace、项目关联、需求项目范围、Token 轮换、归档/删除。
- [ ] Workspace Token 不能删除或改派他人任务。
- [ ] `POST /api/workspaces/:id/token/rotate` 返回新 Token，旧 Token 立即失效（401/403）。
- [ ] 无 Token / 错误 Token 请求返回 401，且响应不泄漏 Token 内容。
- [ ] 日志、错误信息、UI 中出现的 Token 均被 mask。
- [ ] 跨 Workspace Token 访问其他 Workspace 资源被拒绝。

## 4. Requirement

- [ ] `POST /api/workspaces/:id/requirements` 可创建需求，字段含标题、Markdown 描述、P0-P3 优先级、标签、验收标准。
- [ ] 关联项目范围支持 `0..n`；0 个项目表示整个 Workspace。
- [ ] `GET /api/workspaces/:id/requirements` 列表返回标签与关联项目。
- [ ] `GET /api/workspaces/:id/requirements/:requirementId` 详情包含其任务、文档链接与汇总状态。
- [ ] `PUT /api/workspaces/:id/requirements/:requirementId` 可更新标题、描述、优先级、标签、验收标准、项目范围。
- [ ] `statusMode=manual` 时人工状态覆盖自动汇总，且不会被任务变化改写。
- [ ] `statusMode=auto` 时按规则汇总：
  - [ ] 全部任务取消 → `cancelled`
  - [ ] 全部有效任务完成 → `done`
  - [ ] 存在 active 任务（claimed/in_progress/review）→ `in_progress`
  - [ ] 无 active 但存在 blocked → `blocked`
  - [ ] 全部 todo → `ready`
  - [ ] 部分完成且其余为 todo（无 active / blocked）→ `in_progress`
  - [ ] 无任务 → `draft`
- [ ] 人工覆盖优先级高于自动规则。
- [ ] 归档需求后历史任务与文档链接仍可追溯，未物理删除。

## 5. Task 与认领

- [ ] `POST /api/workspaces/:id/tasks` 可在需求下拆任务。
- [ ] 任务状态支持 `todo|claimed|in_progress|blocked|review|done|cancelled`。
- [ ] `POST .../tasks/:taskId/assign` 可由 Web 预指派主责 Provider。
- [ ] `POST .../tasks/:taskId/claim` 使用条件更新保证原子性。
- [ ] 两个 Agent 并发认领同一未分配任务时，只有 1 个成功，另一个得到 409/明确失败。
- [ ] 未分配任务遵循先到先得。
- [ ] 已指派给他人的任务，其他 Provider 不能抢占。
- [ ] `POST .../tasks/:taskId/release` 仅任务主责可释放。
- [ ] `PUT .../tasks/:taskId` 可更新状态、进度，且 Agent 只能更新自己认领的任务。
- [ ] `POST .../tasks/:taskId/activities` 写入活动日志，返回含 Agent、动作、摘要、时间。
- [ ] 每次认领/释放/状态变更/进度更新都会生成活动记录。
- [ ] Agent 可创建子 Task，子 Task 挂在同一需求上下文。
- [ ] `GET .../tasks` 支持按状态 / 需求过滤（如实现）。
- [ ] 删除/归档任务后历史活动与文档链接保留。

## 6. Agent 身份与状态

- [ ] Agent 按 `Workspace + Provider` 自动建记录，Provider 支持 `cursor|claude|codex|workbuddy|trae|unknown`（历史值 `custom` 归一为 `unknown`）。
- [ ] Agent 无心跳机制，不会因长时间无请求被误判离线。
- [ ] 存在 `claimed/in_progress/review` 任务时状态为 `working`。
- [ ] 仅有 `blocked` 任务时状态为 `blocked`。
- [ ] 无未完成任务时状态为 `idle`。
- [ ] `working` 且超过 24 小时无活动显示 `stalled` 警告。
- [ ] `GET /api/workspaces/:id/agents` 返回每个 Provider 的状态、未完成任务数、最近活动。
- [ ] `GET /api/workspaces/:id/board` 返回同一数据源的 Agent + 待分配任务池。

## 7. Document 与 Revision

- [ ] `POST /api/workspaces/:id/documents` 可创建文档，`kind` 支持 `spec|design|handoff|report|note`。
- [ ] 文档可多对多关联 Requirement 与 Task。
- [ ] `POST .../documents/:documentId/revisions` 每次提交生成不可变 revision。
- [ ] 提交携带 `baseRevisionId` 时，若服务端已有更新则返回 409（并发冲突）。
- [ ] 冲突时可选择载入最新版本，或以当前内容强制生成新版本。
- [ ] `GET .../documents/:documentId` 返回当前 revision 与完整历史。
- [ ] 归档文档不物理删除 revision。
- [ ] `DELETE .../documents/:documentId/links/:targetType/:targetId` 可解除关联。
- [ ] 文档内容上限 50 MiB，超限返回 413。
- [ ] 文档中关联的图片可通过 `asset://<assetId>` 渲染。

## 8. 图片资产

- [ ] `POST .../documents/:documentId/assets` 允许 PNG / JPEG / WebP / GIF。
- [ ] 不支持的类型（如 SVG、PDF、可执行文件）被拒绝。
- [ ] 单图超过 10 MiB 返回 413。
- [ ] 资产落在 `~/.kite/workspaces/<workspaceId>/assets/`。
- [ ] `GET .../assets/:assetId` 需要鉴权，未授权不可读取。
- [ ] 资产原始文件名被安全处理（去除路径成分），不产生路径穿越。
- [ ] Web 端通过带鉴权的 fetch + blob URL 展示图片，不暴露原始 Token。

## 9. CLI

### 9.1 初始化与发现

- [ ] `kite workspace init --workspace <id> --token <token>` 在仓库根生成 `kite.workspace.json`。
- [ ] manifest 只包含 `workspaceId`、可选 `docsDir`、Agent 提示配置，不含任何 Token。
- [ ] Token 写入 `~/.kite/config.json` 的 `workspaceToken[workspaceId]`。
- [ ] `workspace init` 幂等，重复执行不破坏已有 manifest 与指令包。
- [ ] 默认创建 `.kite/workspace/`，且默认写入 `.gitignore`。
- [ ] 自定义 `docsDir` 时 `.gitignore` 使用该目录。
- [ ] 单仓根目录下向上查找 manifest 成功。
- [ ] monorepo 子目录下向上查找 manifest 成功。
- [ ] 无 manifest 时给出可操作报错，而不是静默串到错误 Workspace。
- [ ] `kite workspace status` 显示 Workspace、文档目录、Agent 身份。
- [ ] `kite workspace agents` 显示 Provider 状态与任务数。

### 9.2 指令文件

- [ ] `AGENTS.md` 写入受控 `kite-workspace` 区块。
- [ ] 不再生成 `CLAUDE.md`、`.claude/skills/kite-workspace/SKILL.md`、`.cursor/rules/kite-workspace.mdc`、`.trae/rules/project_rules.md`、`KITE_WORKSPACE_AGENT.md`。
- [ ] 仓库已有 `CLAUDE.md` 时内容保持不变（Claude Code 需自行加 `@AGENTS.md` 导入）。
- [ ] 指令内容只描述 CLI 调用，不含任何密钥。
- [ ] 重复 init 不会重复追加区块，也不会覆盖区块外的用户内容。

### 9.3 Requirement / Task

- [ ] `kite requirement list` 列出需求。
- [ ] `kite requirement show <id>` 显示详情与任务。
- [ ] `kite requirement create --title ... --priority P1 --tags ... --project ...` 创建成功。
- [ ] `kite requirement update <id> --status ... --status-mode ...` 更新成功。
- [ ] `kite task inbox` 只显示可认领/待处理任务。
- [ ] `kite task claim <id> --agent cursor` 认领成功。
- [ ] `kite task update <id> --status in_progress --progress 50 --summary ...` 更新成功并写活动。
- [ ] `kite task release <id>` 释放成功。
- [ ] `--agent` 优先于 `KITE_AGENT` 环境变量，两者都不存在时默认 `codex`；manifest 中的 Agent 提示不参与身份解析。
- [ ] 所有写操作携带 Agent 身份，服务端活动记录到正确 Provider。
- [ ] `--json` 输出可被脚本解析，且不含密钥。

### 9.4 Document 同步

- [ ] `kite doc list` 列出文档。
- [ ] `kite doc pull <id>` 拉取单个文档到本地 docsDir。
- [ ] `kite doc pull --all` 批量拉取。
- [ ] `kite doc push <path>` 新建/更新文档并生成 revision。
- [ ] `kite doc push` 带 `--doc <id>` 时更新已有文档。
- [ ] 本地图片相对路径在上传后被重写为 `asset://<assetId>`。
- [ ] 再次 pull 时 `asset://` 映射回本地相对路径。
- [ ] 本地文件未变化时 push 行为明确（跳过或生成等价 revision）。
- [ ] 服务端 revision 前进后，本地基于旧版本的 push 返回 409 并以非 0 退出码提示冲突。

## 10. Web UI

### 10.1 导航与列表

- [ ] 侧边栏出现「工作空间」入口，现有导航项无错位。
- [ ] `/workspaces` 列表可创建、查看、归档 Workspace。
- [ ] `/workspaces/:id` 可进入详情，Overview / Requirements / Documents / Agents 子视图可切换。
- [ ] 刷新深层路由不 404，深色极客风格与原产品一致。

### 10.2 交互

- [ ] Overview 展示关联项目与聚合部署状态，点击跳转 ProjectDetail。
- [ ] Requirements 可创建、编辑、切换 auto/manual 状态。
- [ ] Requirement 详情可查看其任务与关联文档。
- [ ] Task 可创建、Web 预指派、更新状态与进度。
- [ ] 活动记录随任务操作实时追加。
- [ ] Documents 可新建、编辑、预览、上传图片、关联 Requirement / Task。
- [ ] Markdown 预览经过 DOMPurify 消毒，脚本/危险标签不执行。
- [ ] 版本冲突时出现冲突提示，可选择载入最新或强制提交。
- [ ] Token 轮换有二次确认，轮换后旧 Token 立即失效。
- [ ] 归档 Workspace 有二次确认。

## 11. Board 与实时

- [x] 桌面端 Board 渲染 Three.js 低多边形办公室，每个 Agent 一张工位（办公桌 + 显示器 + 人偶 + 状态灯条）。
- [x] 显示器画面（`CanvasTexture`）展示状态色、Agent 名称、当前任务标题/状态/进度，并随任务变化重绘。
- [x] 工位颜色/状态与 `working|idle|blocked|stalled` 一致。
- [x] 待分配任务池可见，数量与 `/board` 数据一致。
- [x] 点击工位/显示器选中 Agent，点击待分配卡片选中任务，详情面板仍走 2D。
- [x] 拖拽旋转 / 滚轮缩放（触控旋转 + 双指缩放）可用，点击选择与拖拽互不干扰。
- [x] 窗口缩放后 canvas 不空白、不变形、无水平溢出。
- [x] 移动端同样渲染 3D 看板：窄屏自动切换两排错落布局并按容器宽高比反推相机距离，375px 下可见可交互。
- [x] 无活跃 Agent 时 Board 不报错，显示空状态。
- [x] `GET /api/workspaces/:id/events` 返回 `text/event-stream`，SSE 连接成功。
- [x] 任务状态、文档 revision、Agent 状态变化能通过 SSE 触发 UI 刷新。
- [ ] 断开 SSE 后 15 秒轮询兜底，UI 显示「轮询更新」。
- [x] SSE 在 `--runtime node` 与 `--runtime bun` 下均可用。
- [x] 实现未使用 Bun 专属 API 导致另一运行时失效。

## 12. 安全与边界

- [ ] Token、deploy token、ADMIN_TOKEN 在日志与截图中 mask。
- [x] Workspace Token 权限边界符合最小权限原则。
- [ ] 跨 Workspace 越权访问全部返回 401/403。
- [ ] 文档/资产路径不存在路径穿越。
- [ ] 超大文档/图片被拒绝，服务不 OOM。
- [ ] 并发认领、并发 revision 提交均有确定结果，无脏写。
- [ ] 归档操作不物理删除历史数据。
- [ ] 未引入被红线禁止的重型 UI 库或额外包管理器。

## 13. 自动化与构建

- [x] `bun test` 全绿（服务端 fixture、CLI、迁移、并发、权限、资产、冲突）。
- [x] `bun run build` 全绿（web → server → cli 顺序执行）。
- [x] `bun run docs:build` 全绿。
- [x] 使用 `--runtime node` 启动并验证 API + SSE。
- [x] 使用 `--runtime bun` 启动并验证 API + SSE。
- [x] Playwright 桌面视口验证 3D canvas 非空、像素渲染正确、无 console error。
- [x] Playwright 移动视口（375×812）验证 3D 看板可交互（点选 Agent、触摸拖拽旋转）、无水平溢出、无 console error；另回归 768/1280/1600 三个视口。
- [x] 验证结束后无残留 `kite serve` / `dist/server/index.js` 进程。
- [ ] 确认 `examples/ssr-basic/kite.config.json` 等无关改动未被误回滚。

## 14. 端到端验收场景

- [ ] 创建 Workspace → 关联 2 个项目。
- [ ] 录入 1 条需求（P0，含验收标准与标签）。
- [ ] Web 拆 2 个 Task，其中 1 个预指派给 `cursor`。
- [ ] CLI 以 `claude` 身份认领另一个 Task 并更新进度。
- [ ] 两个 Agent 各提交 1 份文档（含 1 张图片），并关联到需求/任务。
- [ ] Web 实时看到 Agent 状态、任务进度、文档入库。
- [ ] 轮换 Token，旧 Token 操作返回 401/403。
- [ ] 归档需求/文档，确认历史 revision 与活动仍可追溯。
- [ ] 桌面 Board 正确显示 working / idle / blocked / stalled 与待分配池。
- [x] 移动端 Board 使用同一数据源的 3D 看板展示。
