# 2026-06-16 仪表盘平均耗时 & 最近活动跳转

## 1. 背景与目标

用户反馈仪表盘（[Dashboard.vue](../apps/web/src/views/Dashboard.vue)）两个问题：

1. **平均构建耗时**指标卡始终显示 `-`（[Dashboard.vue#L20](../apps/web/src/views/Dashboard.vue#L20) 硬编码）。
2. **最近部署活动**列表条目带 `cursor-pointer` 但没有点击行为，无法跳转到 [LogBoard.vue](../apps/web/src/views/LogBoard.vue) 查看对应详情。

用户补充：

3. **`startTime` 应当反映 CLI 执行 `kite push` 的时间**，而不是 Server 接收上传完毕的时间（现状见 [deploy.ts#L222](../apps/server/src/routes/deploy.ts#L222)）。

**目标**：

- CLI 在 `push` 命令开头记录本地时间戳并随上传请求发送给 Server，Server 入库时以该时间为 `startTime`（带回退）。
- 仪表盘平均耗时使用 `endTime - startTime` 客户端聚合（成功 + 失败都算，进行中不计入），从而自然包含"打包 + 上传"耗时。
- 最近活动条目可点击，跳转到 `/logs?id=<deployId>` 并自动选中对应记录、滚动到可视区。

**不在范围内**：

- 不动 DB schema（`startTime` 已是 text）。
- 不洗历史数据（旧记录平均耗时偏短可接受）。
- 不改 `duration` 字段口径（仍由 Server 计算执行耗时，避免与终端日志末行 "completed in X.Xs" 不一致）。
- 不为 LogBoard 引入搜索/过滤等新交互；不改色板。

## 2. 影响范围

| 文件 | 改动 |
|---|---|
| [packages/cli/src/index.ts](../packages/cli/src/index.ts) `push` action | 在命令 action 开头记录 `pushStartedAt = new Date().toISOString()`，传入 `uploadZip` |
| [packages/cli/src/upload.ts](../packages/cli/src/upload.ts) | `UploadOptions` 新增 `startedAt?: string`；FormData 追加 `startedAt` 字段 |
| [apps/server/src/routes/deploy.ts](../apps/server/src/routes/deploy.ts) `/api/deploy/upload` | 读取 body.startedAt；校验通过则替换 `new Date().toISOString()`，否则回退 |
| [apps/web/src/views/Dashboard.vue](../apps/web/src/views/Dashboard.vue) | 计算并展示平均耗时；列表条目改为 `@click + router.push` 跳转 `/logs?id=<deployId>` |
| [apps/web/src/views/LogBoard.vue](../apps/web/src/views/LogBoard.vue) | 读取路由 query `id`，加载后自动选中并滚动到对应条目 |
| DB schema | **不改** |
| store | **不改** |

## 3. 方案

### 3.1 后端：以 CLI 的 push 时间作为 startTime

- CLI：`push` action 开头取 `pushStartedAt = new Date().toISOString()`，这里包含"打包 + 上传"全过程。
- Upload：`form.append('startedAt', pushStartedAt)`。
- Server 校验：
  ```ts
  let startTime = new Date().toISOString();
  if (typeof body.startedAt === 'string') {
    const t = new Date(body.startedAt).getTime();
    const now = Date.now();
    // 合法 ISO，且不晚于当前服务端时间（允许 10s 容差，防 CLI/Server 时钟略偏）
    if (!Number.isNaN(t) && t <= now + 10_000 && t >= now - 24 * 60 * 60 * 1000) {
      startTime = new Date(t).toISOString();
    }
  }
  ```
- `duration` 仍用 Server 内部 `Date.now() - startTimeMs` 计算，保持与终端日志一致。
- 老 CLI（不带 `startedAt`）→ 走回退路径，行为与现状一致，**向后兼容**。

### 3.2 前端：平均耗时

- 在 [Dashboard.vue](../apps/web/src/views/Dashboard.vue) `<script setup>` 内新增：
  ```ts
  const avgDurationText = computed(() => {
    const finished = projectStore.logs.filter(
      l => l.status !== 'running' && l.endTime && l.startTime
    );
    if (finished.length === 0) return '-';
    const totalMs = finished.reduce((sum, l) => {
      return sum + (new Date(l.endTime!).getTime() - new Date(l.startTime).getTime());
    }, 0);
    return formatDuration(Math.round(totalMs / finished.length));
  });
  ```
- `formatDuration(ms)`：`< 1s` → `<ms>ms`；`< 60s` → `(ms/1000).toFixed(1)+'s'`；否则 `<m>m <s>s`。
- 该工具函数只在 Dashboard 用一次，**直接放在 `<script setup>` 内**，不抽 utils（AGENTS.md §4.1）。
- `store/project.ts` 的 `DeploymentLog.endTime` 已声明为可选 string，无需类型调整。

### 3.3 前端：列表跳转 + 自动选中

- Dashboard `<li>` 加 `@click="$router.push({ name: 'LogBoard', query: { id: log.id } })"`；保留现有 `cursor-pointer` 样式。
- LogBoard：
  - 引入 `useRoute()`；
  - `onMounted` 中先 `await fetchLogs()`，再尝试根据 `route.query.id` 选中；
  - `watch(() => route.query.id, ...)` 处理同页内连续跳转；
  - 给列表条目加 `:ref="el => (listItemRefs[log.id] = el as HTMLElement)"`，选中后 `nextTick + scrollIntoView({ block: 'nearest' })`。
- LogBoard 自身的列表点击 **不写回 URL**，避免与外部跳转的语义混淆（已通过 `selectLog` 现有行为保持简单）。

### 3.4 备选与拒绝

- **A**：在 Server 用 `request.headers['x-kite-pushed-at']` 替代 FormData 字段。
  - **拒绝**：FormData 字段与现有 `preDeploy` / `postDeploy` 风格统一，且更易调试。
- **B**：让 CLI 在打包**完成后** 才取 `startedAt`，只算"上传 + 执行"。
  - **拒绝**：用户原话是"CLI 执行 `kite push` 的时间"，应包含打包阶段。
- **C**：把 `selectedLog` 放进 store。
  - **拒绝**：只一个页面用，徒增耦合。

## 4. 拆解步骤

1. **CLI `push` 增加 `startedAt`**
   - [packages/cli/src/index.ts](../packages/cli/src/index.ts) `push` action 开头记录 `pushStartedAt`，传入 `uploadZip`。
   - [packages/cli/src/upload.ts](../packages/cli/src/upload.ts) `UploadOptions` 加可选 `startedAt`，FormData 追加。
   - 验证：`bun packages/cli/bin/kite.js push --token ... --server ...`，并 `curl /api/logs` 看新记录的 `startTime` 与 CLI 启动时间是否对齐。
2. **Server 接收并校验 `startedAt`**
   - [deploy.ts](../apps/server/src/routes/deploy.ts) `/api/deploy/upload` body schema 加 `startedAt: t.Optional(t.String())`；插入前按 §3.1 校验逻辑覆盖 `startTime`。
   - 验证：
     - 老 CLI（不带字段） → 行为同现状；
     - 新 CLI → DB 中 `startTime ≈ CLI 启动时间`；
     - 伪造未来时间 → 走回退。
3. **Dashboard 平均耗时**
   - 加 `formatDuration` / `avgDurationText` computed，替换硬编码 `-`。
   - 验证：仪表盘指标卡显示 `Xs` / `Xm Ys`。
4. **Dashboard 列表跳转**
   - `<li>` 加 `@click` 跳转 `/logs?id=...`。
   - 验证：点击 → URL 正确、LogBoard 选中。
5. **LogBoard 自动选中 + 滚动**
   - `useRoute` + watch + ref map + `scrollIntoView`。
   - 验证：
     - Dashboard 点击任一条目 → LogBoard 自动选中，左侧列表滚到可视区；
     - 打开 `/logs?id=不存在` → 保持"等待选择..."，不报错；
     - 同页内 `/logs?id=A` → `/logs?id=B` → 自动切换选中。
6. **构建与回归**
   - `bun run build`（含 `vue-tsc` 与 `bun build`）通过。
   - `node packages/cli/bin/kite.js serve --runtime node` 与 `bun packages/cli/bin/kite.js serve --runtime bun` 都能正常起服并接收 deploy。

## 5. 验证策略

- 本地 `bun run dev` 起 web + server；另起一终端跑 `bun packages/cli/bin/kite.js push ...`。
- 至少 3 次部署（混合成功 / 失败）。
- 用例：
  - DB / `/api/logs` 中 `startTime` 接近 CLI 启动时间；`endTime - startTime > duration`（差值即上传 + 打包耗时）。
  - 仪表盘"平均耗时"显示形如 `3.2s` 或 `1m 4s`。
  - 0 条完成记录 → 显示 `-`。
  - 仪表盘最近活动点击 → 跳到 `/logs?id=xxx` → 左侧高亮该条、终端展示输出 → 列表滚动到可视区。
  - 老 CLI（构建前的二进制）行为不变。
- 红线核对（AGENTS.md §6）：
  - 不改包管理器、不改构建顺序；
  - DB schema 未变；
  - 同时支持 Bun / Node 双运行时。

## 6. 风险与回滚

- **风险 1**：CLI / Server 时钟漂移可能导致 `startTime > Server now`。
  - 缓解：Server 校验加 10s 容差，超出则回退到 Server 当前时间。
- **风险 2**：FormData 中字符串字段被 Elysia schema 当成必填。
  - 缓解：`t.Optional(t.String())`，并在解析后判类型再用。
- **风险 3**：`<li>` 上 `@click` 与子元素的事件冒泡可能影响（无子按钮）→ 无实际影响。
- **风险 4**：`scrollIntoView` 在 List 容器 `overflow-y-auto` 内会触发整页滚动？
  - 用 `block: 'nearest'`，仅在该 scroll container 内移动。
- **回滚**：
  - 前端改动 → 还原两个 `.vue` 文件即可。
  - CLI/Server 改动向后兼容（不带 `startedAt` 时行为同现状），可单独回滚 CLI 或 Server 而不破坏对方。
