import { randomUUID } from 'crypto';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema.js';
import { eq, desc } from 'drizzle-orm';
import path from 'path';

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
      status TEXT DEFAULT 'idle',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

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
    }
  }
};
