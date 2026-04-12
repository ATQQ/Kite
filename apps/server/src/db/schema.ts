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
  status: text('status').default('idle'), // 'idle' | 'success' | 'failed' | 'running'
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// 部署历史表
export const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  projectName: text('project_name').notNull(),
  status: text('status').notNull(), // 'success' | 'failed' | 'running'
  triggerSource: text('trigger_source').notNull(), // 'cli' | 'webhook'
  duration: text('duration'),
  output: text('output'),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
});
