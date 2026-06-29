import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { eq, desc, asc, and, gte, lte, inArray } from 'drizzle-orm';
import path from 'node:path';

// Initialize libSQL client (using local file for now, can be swapped to Turso URL)
const dbPath = path.join(process.env.KITE_DB_DIR || process.cwd(), 'kite.db');
const client = createClient({ url: `file:${dbPath}` });
const ormDb = drizzle({ client, schema });

// Helper to initialize tables if they don't exist
const initDb = async () => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      deploy_path TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      pre_deploy_script TEXT,
      post_deploy_script TEXT,
      post_deploy_async INTEGER DEFAULT 0,
      env TEXT,
      status TEXT DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration: add env column if missing (for existing databases)
  try {
    await client.execute(`ALTER TABLE projects ADD COLUMN env TEXT`);
  } catch { /* column already exists */ }

  // Migration: add clean_mode / protect_paths for rollback feature (#1)
  try { await client.execute(`ALTER TABLE projects ADD COLUMN clean_mode TEXT`); } catch { /* exists */ }
  try { await client.execute(`ALTER TABLE projects ADD COLUMN protect_paths TEXT`); } catch { /* exists */ }

  // Migration: add category_id for project categorization
  try { await client.execute(`ALTER TABLE projects ADD COLUMN category_id TEXT`); } catch { /* exists */ }
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id);`);

  // Migration: add post_deploy_async (default 0 = sync, keep current behavior)
  try { await client.execute(`ALTER TABLE projects ADD COLUMN post_deploy_async INTEGER DEFAULT 0`); } catch { /* exists */ }

  // Migration: add pm2_app_name for PM2 process resource binding
  try { await client.execute(`ALTER TABLE projects ADD COLUMN pm2_app_name TEXT`); } catch { /* exists */ }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories(sort_order);`);

  // Tags & project_tags (项目标签多对多)
  await client.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_tags_sort_order ON tags(sort_order);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_tags (
      project_id TEXT NOT NULL REFERENCES projects(id),
      tag_id TEXT NOT NULL REFERENCES tags(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, tag_id)
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_project_tags_project_id ON project_tags(project_id);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_project_tags_tag_id ON project_tags(tag_id);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Seed default settings
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    args: ['webhook_url', '']
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    args: ['webhook_events', 'deploy_success,deploy_failure']
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    args: ['default_deploy_path', '.deployments']
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    args: ['max_upload_size', '50']
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    args: ['global_deploy_token', '']
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    args: ['artifact_keep_n', '10']
  });

  // Seed built-in tags (only on first init, gated by settings flag so 用户删除后不会复活)
  const seededRow = await client.execute({
    sql: 'SELECT value FROM settings WHERE key = ?',
    args: ['tags.seeded'],
  });
  if (!seededRow.rows[0]) {
    const now = new Date().toISOString();
    const seedTags: Array<{ name: string; color: string }> = [
      { name: '前端', color: 'blue' },
      { name: '后端', color: 'green' },
      { name: 'Node', color: 'green' },
      { name: 'Java', color: 'yellow' },
      { name: 'Go', color: 'cyan' },
      { name: 'Python', color: 'purple' },
      { name: 'PM2', color: 'pink' },
      { name: 'Docker', color: 'cyan' },
      { name: 'SSR', color: 'purple' },
      { name: '静态站点', color: 'gray' },
    ];
    for (let i = 0; i < seedTags.length; i++) {
      const t = seedTags[i];
      await client.execute({
        sql: `INSERT OR IGNORE INTO tags (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        args: ['tag_' + randomUUID().replace(/-/g, '').substring(0, 12), t.name, t.color, i, now, now],
      });
    }
    await client.execute({
      sql: `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`,
      args: ['tags.seeded', '1'],
    });
  }

  await client.execute(`
    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      project_name TEXT NOT NULL,
      status TEXT NOT NULL,
      trigger_source TEXT NOT NULL,
      duration TEXT,
      output TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT
    );
  `);

  // Migration: rollback artifact columns (#1)
  try { await client.execute(`ALTER TABLE deployments ADD COLUMN artifact_path TEXT`); } catch { /* exists */ }
  try { await client.execute(`ALTER TABLE deployments ADD COLUMN artifact_size INTEGER`); } catch { /* exists */ }
  try { await client.execute(`ALTER TABLE deployments ADD COLUMN rollback_of TEXT`); } catch { /* exists */ }
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_deployments_artifact_path ON deployments(artifact_path);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_deployments_project_id ON deployments(project_id);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_deployments_start_time ON deployments(start_time);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_ip TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      target_name TEXT,
      before TEXT,
      after TEXT,
      summary TEXT,
      status TEXT NOT NULL,
      error_message TEXT
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_audit_logs_target_id ON audit_logs(target_id);`);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS project_log_sources (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      label TEXT NOT NULL,
      file_path TEXT NOT NULL,
      kind TEXT DEFAULT 'plain',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_project_log_sources_project_id ON project_log_sources(project_id);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_project_log_sources_sort_order ON project_log_sources(sort_order);`);

  // Seed a demo project on first run (no existing projects)
  if (process.env.KITE_SEED_DEMO_PROJECT !== 'false') {
    const existing = await client.execute('SELECT COUNT(*) as count FROM projects');
    const count = existing.rows[0]?.count ?? 0;
    if (count === 0) {
      const now = new Date().toISOString();
      const demoId = 'proj_' + randomUUID().replace(/-/g, '').substring(0, 12);
      const demoToken = 'kt_' + randomUUID().replace(/-/g, '');
      await client.execute({
        sql: `
          INSERT INTO projects (
            id, name, description, deploy_path, token,
            pre_deploy_script, post_deploy_script, status,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          demoId,
          'Kite Demo Project',
          '本地开发演示项目',
          `.deployments/${demoId}`,
          demoToken,
          '',
          'echo "demo deployment finished"',
          'idle',
          now,
          now
        ]
      });
    }
  }
};

const dbReady = initDb();

export async function ensureDbReady() {
  await dbReady;
}

export const db = {
  settings: {
    async get(key: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1);
      return result[0]?.value ?? null;
    },
    async getAll() {
      await ensureDbReady();
      const rows = await ormDb.select().from(schema.settings);
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    },
    async set(key: string, value: string) {
      await ensureDbReady();
      await client.execute({
        sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, value]
      });
    },
    async setMany(entries: Record<string, string>) {
      await ensureDbReady();
      for (const [key, value] of Object.entries(entries)) {
        await client.execute({
          sql: `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          args: [key, value]
        });
      }
    }
  },
  projects: {
    async findByToken(token: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.projects).where(eq(schema.projects.token, token)).limit(1);
      return result[0] || null;
    },
    async findAll() {
      await ensureDbReady();
      return await ormDb.select().from(schema.projects);
    },
    async findAllWithMeta() {
      await ensureDbReady();
      const rows = await ormDb.select().from(schema.projects);
      if (rows.length === 0) return [];
      const aggRes = await client.execute(
        `SELECT project_id AS pid, MAX(start_time) AS last
           FROM deployments
           GROUP BY project_id`,
      );
      const map = new Map<string, string | null>();
      for (const r of aggRes.rows) {
        const pid = r.pid == null ? '' : String(r.pid);
        const last = r.last == null ? null : String(r.last);
        if (pid) map.set(pid, last);
      }
      return rows.map((p) => ({ ...p, lastDeployAt: map.get(p.id) ?? null }));
    },
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
      return result[0] || null;
    },
    async findManyByIds(ids: string[]) {
      await ensureDbReady();
      if (ids.length === 0) return [];
      return await ormDb.select().from(schema.projects).where(inArray(schema.projects.id, ids));
    },
    async create(data: any) {
      await ensureDbReady();
      const now = new Date().toISOString();
      const newProject = {
        ...data,
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      };
      await ormDb.insert(schema.projects).values(newProject);
      return newProject;
    },
    async update(id: string, data: any) {
      await ensureDbReady();
      const now = new Date().toISOString();
      await ormDb.update(schema.projects)
        .set({ ...data, updatedAt: now })
        .where(eq(schema.projects.id, id));
      return this.findById(id);
    },
    async remove(id: string) {
      await ensureDbReady();
      // Find the project first
      const project = await this.findById(id);
      if (!project) return false;

      // Simultaneously delete related deployment records
      await ormDb.delete(schema.deployments).where(eq(schema.deployments.projectId, id));
      await ormDb.delete(schema.projectLogSources).where(eq(schema.projectLogSources.projectId, id));
      await ormDb.delete(schema.projectTags).where(eq(schema.projectTags.projectId, id));
      await ormDb.delete(schema.projects).where(eq(schema.projects.id, id));
      return true;
    }
  },
  logSources: {
    async findByProject(projectId: string) {
      await ensureDbReady();
      return await ormDb.select().from(schema.projectLogSources)
        .where(eq(schema.projectLogSources.projectId, projectId))
        .orderBy(asc(schema.projectLogSources.sortOrder), asc(schema.projectLogSources.label));
    },
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.projectLogSources)
        .where(eq(schema.projectLogSources.id, id)).limit(1);
      return result[0] || null;
    },
    async create(data: { projectId: string; label: string; filePath: string; kind?: string | null; sortOrder?: number | null }) {
      await ensureDbReady();
      const now = new Date().toISOString();
      const row = {
        id: 'lsrc_' + randomUUID().replace(/-/g, '').substring(0, 12),
        projectId: data.projectId,
        label: data.label,
        filePath: data.filePath,
        kind: data.kind ?? 'plain',
        sortOrder: data.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      await ormDb.insert(schema.projectLogSources).values(row);
      return row;
    },
    async update(id: string, data: { label?: string; kind?: string | null; sortOrder?: number | null }) {
      await ensureDbReady();
      const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
      if (data.label !== undefined) patch.label = data.label;
      if (data.kind !== undefined) patch.kind = data.kind;
      if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
      await ormDb.update(schema.projectLogSources).set(patch).where(eq(schema.projectLogSources.id, id));
      return this.findById(id);
    },
    async remove(id: string) {
      await ensureDbReady();
      const existing = await this.findById(id);
      if (!existing) return false;
      await ormDb.delete(schema.projectLogSources).where(eq(schema.projectLogSources.id, id));
      return true;
    },
    async findManyByIds(ids: string[]) {
      await ensureDbReady();
      if (ids.length === 0) return [];
      return await ormDb.select().from(schema.projectLogSources)
        .where(inArray(schema.projectLogSources.id, ids));
    },
  },
  categories: {
    async findAll() {
      await ensureDbReady();
      return await ormDb.select().from(schema.categories)
        .orderBy(asc(schema.categories.sortOrder), asc(schema.categories.name));
    },
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.categories).where(eq(schema.categories.id, id)).limit(1);
      return result[0] || null;
    },
    async findByName(name: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.categories).where(eq(schema.categories.name, name)).limit(1);
      return result[0] || null;
    },
    async create(data: { id?: string; name: string; color?: string | null; sortOrder?: number | null }) {
      await ensureDbReady();
      const now = new Date().toISOString();
      const row = {
        id: data.id || 'cat_' + randomUUID().replace(/-/g, '').substring(0, 12),
        name: data.name,
        color: data.color ?? null,
        sortOrder: data.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      await ormDb.insert(schema.categories).values(row);
      return row;
    },
    async update(id: string, data: { name?: string; color?: string | null; sortOrder?: number | null }) {
      await ensureDbReady();
      const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
      if (data.name !== undefined) patch.name = data.name;
      if (data.color !== undefined) patch.color = data.color;
      if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
      await ormDb.update(schema.categories).set(patch).where(eq(schema.categories.id, id));
      return this.findById(id);
    },
    async remove(id: string) {
      await ensureDbReady();
      const cat = await this.findById(id);
      if (!cat) return false;
      // Detach projects: NULL = 默认
      await ormDb.update(schema.projects)
        .set({ categoryId: null })
        .where(eq(schema.projects.categoryId, id));
      await ormDb.delete(schema.categories).where(eq(schema.categories.id, id));
      return true;
    },
    async countProjects(id: string) {
      await ensureDbReady();
      const result = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM projects WHERE category_id = ?',
        args: [id],
      });
      return Number(result.rows[0]?.count ?? 0);
    },
  },
  tags: {
    async findAll() {
      await ensureDbReady();
      return await ormDb.select().from(schema.tags)
        .orderBy(asc(schema.tags.sortOrder), asc(schema.tags.name));
    },
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.tags).where(eq(schema.tags.id, id)).limit(1);
      return result[0] || null;
    },
    async findByName(name: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.tags).where(eq(schema.tags.name, name)).limit(1);
      return result[0] || null;
    },
    async create(data: { id?: string; name: string; color?: string | null; sortOrder?: number | null }) {
      await ensureDbReady();
      const now = new Date().toISOString();
      const row = {
        id: data.id || 'tag_' + randomUUID().replace(/-/g, '').substring(0, 12),
        name: data.name,
        color: data.color ?? null,
        sortOrder: data.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      await ormDb.insert(schema.tags).values(row);
      return row;
    },
    async update(id: string, data: { name?: string; color?: string | null; sortOrder?: number | null }) {
      await ensureDbReady();
      const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
      if (data.name !== undefined) patch.name = data.name;
      if (data.color !== undefined) patch.color = data.color;
      if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
      await ormDb.update(schema.tags).set(patch).where(eq(schema.tags.id, id));
      return this.findById(id);
    },
    async remove(id: string) {
      await ensureDbReady();
      const tag = await this.findById(id);
      if (!tag) return false;
      await ormDb.delete(schema.projectTags).where(eq(schema.projectTags.tagId, id));
      await ormDb.delete(schema.tags).where(eq(schema.tags.id, id));
      return true;
    },
    async countProjects(id: string) {
      await ensureDbReady();
      const result = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM project_tags WHERE tag_id = ?',
        args: [id],
      });
      return Number(result.rows[0]?.count ?? 0);
    },
  },
  projectTags: {
    async listByProject(projectId: string): Promise<string[]> {
      await ensureDbReady();
      const rows = await ormDb.select().from(schema.projectTags)
        .where(eq(schema.projectTags.projectId, projectId));
      return rows.map(r => r.tagId);
    },
    async listAllPairs(): Promise<Array<{ projectId: string; tagId: string }>> {
      await ensureDbReady();
      const rows = await ormDb.select().from(schema.projectTags);
      return rows.map(r => ({ projectId: r.projectId, tagId: r.tagId }));
    },
    async setForProject(projectId: string, tagIds: string[]) {
      await ensureDbReady();
      const now = new Date().toISOString();
      await ormDb.delete(schema.projectTags).where(eq(schema.projectTags.projectId, projectId));
      const unique = Array.from(new Set(tagIds.filter(Boolean)));
      for (const tagId of unique) {
        try {
          await ormDb.insert(schema.projectTags).values({ projectId, tagId, createdAt: now });
        } catch { /* ignore unknown tag id */ }
      }
    },
    async projectIdsHavingAll(tagIds: string[]): Promise<string[]> {
      await ensureDbReady();
      const ids = Array.from(new Set(tagIds.filter(Boolean)));
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      const res = await client.execute({
        sql: `SELECT project_id AS pid FROM project_tags
              WHERE tag_id IN (${placeholders})
              GROUP BY project_id
              HAVING COUNT(DISTINCT tag_id) = ?`,
        args: [...ids, ids.length],
      });
      return res.rows.map(r => String(r.pid));
    },
    async clearProject(projectId: string) {
      await ensureDbReady();
      await ormDb.delete(schema.projectTags).where(eq(schema.projectTags.projectId, projectId));
    },
    async addPair(projectId: string, tagId: string) {
      await ensureDbReady();
      const now = new Date().toISOString();
      try {
        await ormDb.insert(schema.projectTags).values({ projectId, tagId, createdAt: now });
        return true;
      } catch {
        return false;
      }
    },
    async removePair(projectId: string, tagId: string) {
      await ensureDbReady();
      await ormDb.delete(schema.projectTags)
        .where(and(eq(schema.projectTags.projectId, projectId), eq(schema.projectTags.tagId, tagId)));
    },
  },
  deployments: {
    async insert(data: any) {
      await ensureDbReady();
      const newLog = {
        ...data,
        id: data.id || randomUUID(),
      };
      await ormDb.insert(schema.deployments).values(newLog);
      return newLog;
    },
    async update(id: string, data: any) {
      await ensureDbReady();
      await ormDb.update(schema.deployments).set(data).where(eq(schema.deployments.id, id));
    },
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.deployments).where(eq(schema.deployments.id, id)).limit(1);
      return result[0] || null;
    },
    async findAll() {
      await ensureDbReady();
      return await ormDb.select().from(schema.deployments).orderBy(desc(schema.deployments.startTime));
    },
    async countByProject(projectId: string) {
      await ensureDbReady();
      const result = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM deployments WHERE project_id = ?',
        args: [projectId]
      });
      return Number(result.rows[0]?.count ?? 0);
    },
    async findByProject(projectId: string) {
      await ensureDbReady();
      return await ormDb.select().from(schema.deployments)
        .where(eq(schema.deployments.projectId, projectId))
        .orderBy(desc(schema.deployments.startTime));
    },
    async countByArtifactPath(artifactPath: string) {
      await ensureDbReady();
      const result = await client.execute({
        sql: 'SELECT COUNT(*) as count FROM deployments WHERE artifact_path = ?',
        args: [artifactPath]
      });
      return Number(result.rows[0]?.count ?? 0);
    },
    async clearArtifactPath(id: string) {
      await ensureDbReady();
      await ormDb.update(schema.deployments)
        .set({ artifactPath: null, artifactSize: null })
        .where(eq(schema.deployments.id, id));
    },
  },
  auditLogs: {
    async create(data: {
      action: string;
      actor?: string;
      actorIp?: string | null;
      targetType?: string | null;
      targetId?: string | null;
      targetName?: string | null;
      before?: string | null;
      after?: string | null;
      summary?: string | null;
      status?: 'success' | 'failed';
      errorMessage?: string | null;
    }) {
      await ensureDbReady();
      const row = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        actor: data.actor || 'admin',
        actorIp: data.actorIp ?? null,
        action: data.action,
        targetType: data.targetType ?? null,
        targetId: data.targetId ?? null,
        targetName: data.targetName ?? null,
        before: data.before ?? null,
        after: data.after ?? null,
        summary: data.summary ?? null,
        status: data.status || 'success',
        errorMessage: data.errorMessage ?? null,
      };
      await ormDb.insert(schema.auditLogs).values(row);
      return row;
    },
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, id)).limit(1);
      return result[0] || null;
    },
    async list(filters: {
      action?: string;
      targetId?: string;
      targetType?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {}) {
      await ensureDbReady();
      const conds: any[] = [];
      if (filters.action) conds.push(eq(schema.auditLogs.action, filters.action));
      if (filters.targetId) conds.push(eq(schema.auditLogs.targetId, filters.targetId));
      if (filters.targetType) conds.push(eq(schema.auditLogs.targetType, filters.targetType));
      if (filters.from) conds.push(gte(schema.auditLogs.createdAt, filters.from));
      if (filters.to) conds.push(lte(schema.auditLogs.createdAt, filters.to));

      const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
      const offset = Math.max(filters.offset ?? 0, 0);

      const baseQuery = ormDb.select().from(schema.auditLogs);
      const query = conds.length > 0 ? baseQuery.where(and(...conds)) : baseQuery;
      const rows = await query.orderBy(desc(schema.auditLogs.createdAt)).limit(limit).offset(offset);

      // Count total separately (avoid pulling all rows just to count)
      const whereParts: string[] = [];
      const whereArgs: any[] = [];
      if (filters.action) { whereParts.push('action = ?'); whereArgs.push(filters.action); }
      if (filters.targetId) { whereParts.push('target_id = ?'); whereArgs.push(filters.targetId); }
      if (filters.targetType) { whereParts.push('target_type = ?'); whereArgs.push(filters.targetType); }
      if (filters.from) { whereParts.push('created_at >= ?'); whereArgs.push(filters.from); }
      if (filters.to) { whereParts.push('created_at <= ?'); whereArgs.push(filters.to); }
      const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
      const totalRes = await client.execute({
        sql: `SELECT COUNT(*) as count FROM audit_logs ${whereSql}`,
        args: whereArgs
      });
      const total = Number(totalRes.rows[0]?.count ?? 0);

      return { rows, total, limit, offset };
    }
  },
  search: {
    async run(q: string, types: Array<'project' | 'deployment' | 'audit' | 'logsource'>, limit: number) {
      await ensureDbReady();
      const trimmed = (q || '').trim();
      const empty = {
        q: trimmed,
        groups: [] as Array<{ type: string; total: number; items: any[] }>,
        truncated: false,
      };
      if (trimmed.length < 1 || trimmed.length > 64) return empty;
      const cap = Math.min(Math.max(limit | 0, 1), 20);

      // Escape SQL LIKE meta chars ( % _ \ ) under ESCAPE '\\'
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const like = `%${escaped}%`;
      const wantedSet = new Set(types);
      const groups: Array<{ type: string; total: number; items: any[] }> = [];
      let truncated = false;

      if (wantedSet.has('project')) {
        const r = await client.execute({
          sql: `SELECT id, name, description, deploy_path, env, status, updated_at
                FROM projects
                WHERE name LIKE ? ESCAPE '\\'
                   OR IFNULL(description,'') LIKE ? ESCAPE '\\'
                   OR deploy_path LIKE ? ESCAPE '\\'
                   OR IFNULL(env,'') LIKE ? ESCAPE '\\'
                   OR id LIKE ? ESCAPE '\\'
                ORDER BY updated_at DESC
                LIMIT ?`,
          args: [like, like, like, like, like, cap + 1],
        });
        const rows = r.rows.slice(0, cap).map(row => ({
          type: 'project' as const,
          id: String(row.id),
          name: String(row.name),
          description: row.description == null ? null : String(row.description),
          status: row.status == null ? null : String(row.status),
          href: `/projects/${String(row.id)}`,
        }));
        if (r.rows.length > cap) truncated = true;
        groups.push({ type: 'project', total: rows.length, items: rows });
      }

      if (wantedSet.has('deployment')) {
        const r = await client.execute({
          sql: `SELECT id, project_id, project_name, status, start_time, output
                FROM deployments
                WHERE project_name LIKE ? ESCAPE '\\'
                   OR IFNULL(output,'') LIKE ? ESCAPE '\\'
                   OR id LIKE ? ESCAPE '\\'
                ORDER BY start_time DESC
                LIMIT ?`,
          args: [like, like, like, cap + 1],
        });
        const rows = r.rows.slice(0, cap).map(row => {
          const output = row.output == null ? null : String(row.output);
          let snippet: string | null = null;
          if (output) {
            const idx = output.toLowerCase().indexOf(trimmed.toLowerCase());
            if (idx >= 0) {
              const start = Math.max(0, idx - 20);
              snippet = output.slice(start, start + 80).replace(/\s+/g, ' ');
            } else {
              snippet = output.slice(0, 80).replace(/\s+/g, ' ');
            }
          }
          return {
            type: 'deployment' as const,
            id: String(row.id),
            projectId: String(row.project_id),
            projectName: String(row.project_name),
            status: String(row.status),
            startTime: String(row.start_time),
            href: `/projects/${String(row.project_id)}`,
            snippet,
          };
        });
        if (r.rows.length > cap) truncated = true;
        groups.push({ type: 'deployment', total: rows.length, items: rows });
      }

      if (wantedSet.has('audit')) {
        const r = await client.execute({
          sql: `SELECT id, action, target_name, target_id, status, summary, created_at
                FROM audit_logs
                WHERE action LIKE ? ESCAPE '\\'
                   OR IFNULL(target_name,'') LIKE ? ESCAPE '\\'
                   OR IFNULL(target_id,'') LIKE ? ESCAPE '\\'
                   OR IFNULL(summary,'') LIKE ? ESCAPE '\\'
                ORDER BY created_at DESC
                LIMIT ?`,
          args: [like, like, like, like, cap + 1],
        });
        const rows = r.rows.slice(0, cap).map(row => ({
          type: 'audit' as const,
          id: String(row.id),
          action: String(row.action),
          targetName: row.target_name == null ? null : String(row.target_name),
          createdAt: String(row.created_at),
          status: String(row.status),
          href: `/audit?focus=${encodeURIComponent(String(row.id))}`,
        }));
        if (r.rows.length > cap) truncated = true;
        groups.push({ type: 'audit', total: rows.length, items: rows });
      }

      if (wantedSet.has('logsource')) {
        const r = await client.execute({
          sql: `SELECT id, project_id, label, file_path
                FROM project_log_sources
                WHERE label LIKE ? ESCAPE '\\'
                   OR file_path LIKE ? ESCAPE '\\'
                ORDER BY updated_at DESC
                LIMIT ?`,
          args: [like, like, cap + 1],
        });
        const rows = r.rows.slice(0, cap).map(row => ({
          type: 'logsource' as const,
          id: String(row.id),
          projectId: String(row.project_id),
          label: String(row.label),
          filePath: String(row.file_path),
          href: `/projects/${String(row.project_id)}/logs?source=${encodeURIComponent(String(row.id))}`,
        }));
        if (r.rows.length > cap) truncated = true;
        groups.push({ type: 'logsource', total: rows.length, items: rows });
      }

      return { q: trimmed, groups, truncated };
    }
  },
  stats: {
    async heatmap(sinceIso: string) {
      await ensureDbReady();
      const res = await client.execute({
        sql: `SELECT substr(start_time, 1, 10) AS d, COUNT(*) AS c
              FROM deployments
              WHERE start_time >= ?
              GROUP BY d`,
        args: [sinceIso],
      });
      return res.rows.map(r => ({ date: String(r.d), count: Number(r.c) }));
    },
    async successRate(sinceIso: string) {
      await ensureDbReady();
      const res = await client.execute({
        sql: `SELECT substr(start_time, 1, 10) AS d,
                     SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS s,
                     SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) AS f,
                     COUNT(*) AS total
              FROM deployments
              WHERE start_time >= ? AND status IN ('success','failed')
              GROUP BY d`,
        args: [sinceIso],
      });
      return res.rows.map(r => ({
        date: String(r.d),
        success: Number(r.s),
        failed: Number(r.f),
        total: Number(r.total),
      }));
    },
    async failureTop(sinceIso: string, limit: number, minTotal: number) {
      await ensureDbReady();
      const res = await client.execute({
        sql: `SELECT project_id AS pid, project_name AS pname,
                     SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
                     COUNT(*) AS total
              FROM deployments
              WHERE start_time >= ? AND status IN ('success','failed')
              GROUP BY project_id, project_name
              HAVING total >= ?
              ORDER BY (CAST(failed AS REAL) / total) DESC, failed DESC
              LIMIT ?`,
        args: [sinceIso, minTotal, limit],
      });
      return res.rows.map(r => {
        const failed = Number(r.failed);
        const total = Number(r.total);
        return {
          projectId: String(r.pid),
          projectName: String(r.pname),
          failed,
          total,
          rate: total > 0 ? Math.round((failed / total) * 10000) / 10000 : 0,
        };
      });
    },
  },
};
