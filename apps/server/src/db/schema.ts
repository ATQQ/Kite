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
  env: text('env'),                          // optional environment label, e.g. 'test', 'prod'
  status: text('status').default('idle'), // 'idle' | 'success' | 'failed' | 'running'
  cleanMode: text('clean_mode'),             // 'merge' (default/null) | 'clean' | 'clean-all'
  protectPaths: text('protect_paths'),       // JSON string array of globs
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
