import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

// 项目表
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  deployPath: text('deploy_path').notNull(),
  token: text('token').notNull().unique(),
  preDeployScript: text('pre_deploy_script'),
  postDeployScript: text('post_deploy_script'),
  createdAt: integer('created_at').notNull(),
});

// 部署历史表
export const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id),
  version: text('version'),
  status: text('status').notNull(), // 'success' | 'failed' | 'deploying'
  logs: text('logs'),
  createdAt: integer('created_at').notNull(),
});
