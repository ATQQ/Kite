// Runs in a dedicated bun process so the db singleton can be bound to an
// isolated, freshly migrated database. Invoked by project-workspace.test.ts.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createClient } from '@libsql/client';

const ADMIN_TOKEN = 'test-admin-token';
const HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'kite-workspace-'));

process.env.KITE_DB_DIR = HOME;
process.env.KITE_SEED_DEMO_PROJECT = 'false';
process.env.ADMIN_TOKEN = ADMIN_TOKEN;

// Full schema from the release before the workspace feature: no pinned_at,
// no last_opened_at and no project_saved_views table.
const legacy = createClient({ url: `file:${path.join(HOME, 'kite.db')}` });
await legacy.execute(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    deploy_path TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    pre_deploy_script TEXT,
    post_deploy_script TEXT,
    post_deploy_async INTEGER DEFAULT 0,
    allow_cli_hooks INTEGER DEFAULT 0,
    env TEXT,
    status TEXT DEFAULT 'idle',
    clean_mode TEXT,
    protect_paths TEXT,
    category_id TEXT,
    pm2_app_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
await legacy.execute(`
  INSERT INTO projects (id, name, deploy_path, token, env, status, created_at, updated_at)
  VALUES ('proj_legacy', 'Legacy App', '/tmp/legacy', 'kt_legacy', 'prod', 'idle',
          '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
`);
legacy.close();

const { db } = await import('../../src/db/index.js');
const { projectWorkspaceRoutes } = await import('../../src/routes/project-workspace.js');

function api(pathname: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${ADMIN_TOKEN}`,
    ...(init.headers as Record<string, string> | undefined),
  };
  return projectWorkspaceRoutes.handle(new Request(`http://localhost${pathname}`, { ...init, headers }));
}

// --- migration on a legacy database -----------------------------------------
const legacyRow = await db.projects.findById('proj_legacy');
assert.ok(legacyRow, 'legacy project should survive migration');
assert.equal(legacyRow!.name, 'Legacy App');
assert.equal(legacyRow!.pinnedAt ?? null, null);
assert.equal(legacyRow!.lastOpenedAt ?? null, null);
assert.equal(await db.projectSavedViews.count(), 0);

// --- pin / last-opened only touch their own column --------------------------
const created = await db.projects.create({
  id: 'proj_meta',
  name: 'Meta App',
  deployPath: '/tmp/meta',
  token: 'kt_meta',
});
const before = await db.projects.findById(created.id);
const pinned = await db.projects.setPinnedAt(created.id, '2026-10-03T10:00:00.000Z');
assert.equal(pinned!.pinnedAt, '2026-10-03T10:00:00.000Z');
assert.equal(pinned!.updatedAt, before!.updatedAt);
const opened = await db.projects.setLastOpenedAt(created.id, '2026-10-03T11:00:00.000Z');
assert.equal(opened!.lastOpenedAt, '2026-10-03T11:00:00.000Z');
assert.equal(opened!.pinnedAt, '2026-10-03T10:00:00.000Z');
assert.equal(opened!.updatedAt, before!.updatedAt);

// --- pin route --------------------------------------------------------------
const pinOn = await api('/api/projects/proj_meta/pin', { method: 'PUT', body: JSON.stringify({ pinned: true }) });
assert.equal(pinOn.status, 200);
const pinOnData: any = await pinOn.json();
assert.equal(pinOnData.success, true);
assert.equal(typeof pinOnData.project.pinnedAt, 'string');
const pinOff = await api('/api/projects/proj_meta/pin', { method: 'PUT', body: JSON.stringify({ pinned: false }) });
const pinOffData: any = await pinOff.json();
assert.equal(pinOffData.project.pinnedAt, null);

const openedRes = await api('/api/projects/proj_meta/last-opened', { method: 'PUT', body: JSON.stringify({}) });
assert.equal(openedRes.status, 200);
const openedData: any = await openedRes.json();
assert.equal(typeof openedData.project.lastOpenedAt, 'string');

const unauthorized = await projectWorkspaceRoutes.handle(new Request('http://localhost/api/projects/proj_meta/pin', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ pinned: true }),
}));
assert.equal(unauthorized.status, 401);
const missing = await api('/api/projects/proj_missing/pin', { method: 'PUT', body: JSON.stringify({ pinned: true }) });
assert.equal(missing.status, 404);

// --- saved views CRUD -------------------------------------------------------
const createdView = await api('/api/project-views', {
  method: 'POST',
  body: JSON.stringify({
    name: '待发布前端',
    config: { quickView: 'abnormal', q: 'web', tags: ['t1'], sort: 'name', group: 'category', layout: 'list' },
  }),
});
assert.equal(createdView.status, 200);
const createdViewData: any = await createdView.json();
const view = createdViewData.view;
assert.equal(view.name, '待发布前端');
assert.equal(view.config.quickView, 'abnormal');
assert.equal(view.config.sort, 'name');
assert.equal(view.config.group, 'category');
assert.equal(view.config.layout, 'list');

const listed: any = await (await api('/api/project-views')).json();
assert.ok(Array.isArray(listed));
assert.ok(listed.some((v: any) => v.id === view.id));

const renamed = await api(`/api/project-views/${view.id}`, { method: 'PUT', body: JSON.stringify({ name: '前端异常' }) });
assert.equal(renamed.status, 200);
assert.equal((await renamed.json() as any).view.name, '前端异常');

assert.equal((await api(`/api/project-views/${view.id}`, { method: 'DELETE' })).status, 200);
assert.equal((await api(`/api/project-views/${view.id}`, { method: 'DELETE' })).status, 404);

// --- config allow-list normalization ---------------------------------------
const normalized = await api('/api/project-views', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Normalize',
    config: { quickView: 'bogus', q: 123, category: 'cat_1', env: 'prod', tags: ['a', 'a', 5, ''], sort: 'nope', group: 'bad', layout: 'weird', sql: 'drop table' },
  }),
});
assert.equal(normalized.status, 200);
const normalizedConfig: any = (await normalized.json() as any).view.config;
assert.equal(normalizedConfig.quickView, 'all');
assert.equal(normalizedConfig.sort, 'updated');
assert.equal(normalizedConfig.group, 'none');
assert.equal(normalizedConfig.layout, 'card');
assert.equal(normalizedConfig.q, '');
assert.deepEqual(normalizedConfig.tags, ['a']);
assert.ok(!('sql' in normalizedConfig));

// --- name validation + 20-view cap -----------------------------------------
assert.equal((await api('/api/project-views', { method: 'POST', body: JSON.stringify({ name: '   ' }) })).status, 400);
assert.equal((await api('/api/project-views', { method: 'POST', body: JSON.stringify({ name: 'Duplicate' }) })).status, 200);
assert.equal((await api('/api/project-views', { method: 'POST', body: JSON.stringify({ name: 'Duplicate' }) })).status, 409);

const existing = await db.projectSavedViews.count();
for (let i = existing; i < 20; i++) {
  const r = await api('/api/project-views', { method: 'POST', body: JSON.stringify({ name: `view-${i}` }) });
  assert.equal(r.status, 200);
}
assert.equal((await api('/api/project-views', { method: 'POST', body: JSON.stringify({ name: 'view-over' }) })).status, 400);

await fs.rm(HOME, { recursive: true, force: true });
console.log('PROJECT_WORKSPACE_FIXTURE_OK');
