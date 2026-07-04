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
  env: text('env'),                          // optional environment label, e.g. 'test', 'prod'
  status: text('status').default('idle'), // 'idle' | 'success' | 'failed' | 'running'
  cleanMode: text('clean_mode'),             // 'merge' (default/null) | 'clean' | 'clean-all'
  protectPaths: text('protect_paths'),       // JSON string array of globs
  categoryId: text('category_id'),           // nullable: NULL = 默认（未分类）
  pm2AppName: text('pm2_app_name'),          // nullable: 绑定的 PM2 应用名，用于拉取进程资源
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
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  artifactPath: text('artifact_path'),         // absolute path to ~/.kite/deployments/<projectId>/artifacts/<id>.zip (null = unarchived / cleaned)
  artifactSize: integer('artifact_size'),      // bytes
  rollbackOf: text('rollback_of'),             // source deployment id when this run is a rollback
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
