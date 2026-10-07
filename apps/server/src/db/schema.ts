import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// 项目表
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  deployPath: text('deploy_path').notNull(),
  token: text('token').notNull().unique(),
  preDeployScript: text('pre_deploy_script'),
  postDeployScript: text('post_deploy_script'),
  postDeployAsync: integer('post_deploy_async', { mode: 'boolean' }).default(false),
  allowCliHooks: integer('allow_cli_hooks', { mode: 'boolean' }).default(false), // 允许 CLI 内联提交 pre/post 脚本（默认关闭）
  env: text('env'),                          // optional environment label, e.g. 'test', 'prod'
  status: text('status').default('idle'), // 'idle' | 'success' | 'failed' | 'running'
  cleanMode: text('clean_mode'),             // 'merge' (default/null) | 'clean' | 'clean-all'
  protectPaths: text('protect_paths'),       // JSON string array of globs
  categoryId: text('category_id'),           // nullable: NULL = 默认（未分类）
  pm2AppName: text('pm2_app_name'),          // nullable: 绑定的 PM2 应用名，用于拉取进程资源
  pinnedAt: text('pinned_at'),               // nullable: 置顶时间，NULL = 未置顶
  lastOpenedAt: text('last_opened_at'),      // nullable: 最近一次进入详情页的时间
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 项目分类表（NULL category_id 视为默认/未分类，故无需种子默认行）
export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),                      // 前端枚举: blue|green|yellow|purple|pink|cyan|gray
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 系统设置表
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// 部署历史表
export const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  projectName: text('project_name').notNull(),
  status: text('status').notNull(), // 'success' | 'failed' | 'running'
  triggerSource: text('trigger_source').notNull(), // 'cli' | 'webhook' | 'rollback'
  duration: text('duration'),
  output: text('output'),
  preDeployScript: text('pre_deploy_script'),   // 本次实际生效的 pre 命令快照
  postDeployScript: text('post_deploy_script'), // 本次实际生效的 post 命令快照
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  artifactPath: text('artifact_path'),         // absolute path to ~/.kite/deployments/<projectId>/artifacts/<id>.zip (null = unarchived / cleaned)
  artifactSize: integer('artifact_size'),      // bytes
  rollbackOf: text('rollback_of'),             // source deployment id when this run is a rollback
  actorIp: text('actor_ip'),                   // 发起本次部署的来源 IP（best-effort，可能为 null）
});

// 项目日志源（PM2 / Nginx / 自定义文件路径）
export const projectLogSources = sqliteTable('project_log_sources', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  label: text('label').notNull(),
  filePath: text('file_path').notNull(),
  kind: text('kind').default('plain'),         // 'pm2' | 'nginx' | 'plain'
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 项目标签表（独立于分类，多对多）
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),                      // 前端枚举: blue|green|yellow|purple|pink|cyan|gray
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 项目 ↔ 标签关联表（复合主键 (project_id, tag_id)）
export const projectTags = sqliteTable('project_tags', {
  projectId: text('project_id').references(() => projects.id).notNull(),
  tagId: text('tag_id').references(() => tags.id).notNull(),
  createdAt: text('created_at').notNull(),
});

// 项目工作台自定义视图（搜索、筛选、排序与展示配置）
export const projectSavedViews = sqliteTable('project_saved_views', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  config: text('config').notNull(),          // JSON string
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// CLI 匿名遥测事件（来自 packages/cli/src/telemetry.ts 上报）
// 只允许上报 packages/cli/src/telemetry.ts 中 buildPayload 定义的字段。
export const telemetryEvents = sqliteTable('telemetry_events', {
  id: text('id').primaryKey(),
  event: text('event').notNull(),               // 'kite.serve.startup' | 'kite.push.start'
  ts: integer('ts').notNull(),                  // 客户端上报时间戳（毫秒）
  receivedAt: text('received_at').notNull(),    // 服务端接收 ISO 时间，聚合以此为准
  kiteVersion: text('kite_version').notNull(),
  instanceId: text('instance_id').notNull(),
  os: text('os').notNull(),
  arch: text('arch').notNull(),
});

// 操作日志（运维审计）表
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  actor: text('actor').notNull(),              // 当前固定 'admin'
  actorIp: text('actor_ip'),
  action: text('action').notNull(),            // e.g. 'project.update'
  targetType: text('target_type'),             // 'project' | 'settings' | 'migration' | 'auth'
  targetId: text('target_id'),
  targetName: text('target_name'),
  before: text('before'),                      // JSON string, nullable
  after: text('after'),                        // JSON string, nullable
  summary: text('summary'),
  status: text('status').notNull(),            // 'success' | 'failed'
  errorMessage: text('error_message'),
});

// Workspace: 产品级项目协作上下文
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceProjects = sqliteTable('workspace_projects', {
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  role: text('role').notNull().default('custom'),
  sortOrder: integer('sort_order').default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const workspaceTokens = sqliteTable('workspace_tokens', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  name: text('name').notNull().default('default'),
  tokenHash: text('token_hash').notNull().unique(),
  tokenPrefix: text('token_prefix').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
});

export const workspaceAgents = sqliteTable('workspace_agents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  provider: text('provider').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at').notNull(),
});

export const workspaceTags = sqliteTable('workspace_tags', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  name: text('name').notNull(),
  color: text('color'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const requirements = sqliteTable('requirements', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  priority: text('priority').notNull().default('P2'),
  statusMode: text('status_mode').notNull().default('auto'),
  manualStatus: text('manual_status'),
  acceptanceCriteria: text('acceptance_criteria'),
  archivedAt: text('archived_at'),
  createdByType: text('created_by_type').notNull().default('human'),
  createdById: text('created_by_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const requirementProjects = sqliteTable('requirement_projects', {
  requirementId: text('requirement_id').references(() => requirements.id).notNull(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  createdAt: text('created_at').notNull(),
});

export const requirementTags = sqliteTable('requirement_tags', {
  requirementId: text('requirement_id').references(() => requirements.id).notNull(),
  tagId: text('tag_id').references(() => workspaceTags.id).notNull(),
  createdAt: text('created_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  requirementId: text('requirement_id').references(() => requirements.id).notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('todo'),
  assignedProvider: text('assigned_provider'),
  claimedAgentId: text('claimed_agent_id').references(() => workspaceAgents.id),
  claimedAt: text('claimed_at'),
  progress: integer('progress'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  lastActivityAt: text('last_activity_at').notNull(),
});

export const taskActivities = sqliteTable('task_activities', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  taskId: text('task_id').references(() => tasks.id).notNull(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
  provider: text('provider'),
  kind: text('kind').notNull(),
  statusFrom: text('status_from'),
  statusTo: text('status_to'),
  summary: text('summary'),
  documentId: text('document_id'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
});

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('note'),
  currentRevisionId: text('current_revision_id'),
  archivedAt: text('archived_at'),
  createdByType: text('created_by_type').notNull().default('human'),
  createdById: text('created_by_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const documentRevisions = sqliteTable('document_revisions', {
  id: text('id').primaryKey(),
  documentId: text('document_id').references(() => documents.id).notNull(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  revisionNumber: integer('revision_number').notNull(),
  contentMarkdown: text('content_markdown').notNull(),
  contentHash: text('content_hash').notNull(),
  baseRevisionId: text('base_revision_id'),
  createdByType: text('created_by_type').notNull().default('human'),
  createdById: text('created_by_id'),
  createdAt: text('created_at').notNull(),
});

export const documentLinks = sqliteTable('document_links', {
  documentId: text('document_id').references(() => documents.id).notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const documentAssets = sqliteTable('document_assets', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id).notNull(),
  documentId: text('document_id').references(() => documents.id),
  sha256: text('sha256').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  originalName: text('original_name').notNull(),
  storagePath: text('storage_path').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
});
