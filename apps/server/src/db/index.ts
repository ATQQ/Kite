import { randomUUID } from 'node:crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { eq, desc, and, gte, lte } from 'drizzle-orm';
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
    async findById(id: string) {
      await ensureDbReady();
      const result = await ormDb.select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
      return result[0] || null;
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
      await ormDb.delete(schema.projects).where(eq(schema.projects.id, id));
      return true;
    }
  },
  deployments: {
    async insert(data: any) {
      await ensureDbReady();
      const newLog = {
        ...data,
        id: randomUUID(),
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
    }
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
  }
};
