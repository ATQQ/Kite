import { Elysia, t } from 'elysia';
import { db } from '../db/index.js';
import { verifyAdminToken } from '../lib/auth.js';

const QUICK_VIEWS = new Set(['all', 'pinned', 'recent', 'undeployed', 'abnormal']);
const SORT_VALUES = new Set(['updated', 'created', 'name', 'lastDeploy']);
const GROUP_VALUES = new Set(['none', 'category', 'env']);
const LAYOUT_VALUES = new Set(['card', 'list']);
const MAX_SAVED_VIEWS = 20;

type ProjectViewConfig = {
  quickView: string;
  q: string;
  category: string;
  env: string;
  tags: string[];
  sort: string;
  group: string;
  layout: string;
};

type SavedViewRow = {
  id: string;
  name: string;
  config: string;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_VIEW_CONFIG: ProjectViewConfig = {
  quickView: 'all',
  q: '',
  category: 'all',
  env: 'all',
  tags: [],
  sort: 'updated',
  group: 'none',
  layout: 'card',
};

function cleanString(input: unknown, fallback: string, maxLength = 64): string {
  if (typeof input !== 'string') return fallback;
  const value = input.trim();
  if (!value) return fallback;
  return value.slice(0, maxLength);
}

function normalizeViewConfig(input: unknown): ProjectViewConfig {
  const raw = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const quickView = cleanString(raw.quickView, DEFAULT_VIEW_CONFIG.quickView, 20);
  const sort = cleanString(raw.sort, DEFAULT_VIEW_CONFIG.sort, 20);
  const group = cleanString(raw.group, DEFAULT_VIEW_CONFIG.group, 20);
  const layout = cleanString(raw.layout, DEFAULT_VIEW_CONFIG.layout, 20);
  const tags = Array.isArray(raw.tags)
    ? Array.from(new Set(raw.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 50)))
    : [];

  return {
    quickView: QUICK_VIEWS.has(quickView) ? quickView : DEFAULT_VIEW_CONFIG.quickView,
    q: cleanString(raw.q, '', 64),
    category: cleanString(raw.category, DEFAULT_VIEW_CONFIG.category),
    env: cleanString(raw.env, DEFAULT_VIEW_CONFIG.env),
    tags,
    sort: SORT_VALUES.has(sort) ? sort : DEFAULT_VIEW_CONFIG.sort,
    group: GROUP_VALUES.has(group) ? group : DEFAULT_VIEW_CONFIG.group,
    layout: LAYOUT_VALUES.has(layout) ? layout : DEFAULT_VIEW_CONFIG.layout,
  };
}

function parseStoredConfig(raw: string): ProjectViewConfig {
  try {
    return normalizeViewConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VIEW_CONFIG };
  }
}

function serializeView(row: SavedViewRow) {
  return {
    ...row,
    config: parseStoredConfig(row.config),
  };
}

function normalizeName(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export const projectWorkspaceRoutes = new Elysia()
  .put('/api/projects/:id/pin', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.projects.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Project not found' }; }
    const pinnedAt = body.pinned ? new Date().toISOString() : null;
    const project = await db.projects.setPinnedAt(params.id, pinnedAt);
    return { success: true, project };
  }, {
    body: t.Object({
      pinned: t.Boolean(),
    }),
  })
  .put('/api/projects/:id/last-opened', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.projects.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Project not found' }; }
    const lastOpenedAt = new Date().toISOString();
    const project = await db.projects.setLastOpenedAt(params.id, lastOpenedAt);
    return { success: true, project };
  })
  .get('/api/project-views', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const rows = await db.projectSavedViews.findAll();
    return rows.map(serializeView);
  })
  .post('/api/project-views', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const name = normalizeName(body.name);
    if (!name) { set.status = 400; return { error: '视图名称不能为空' }; }
    if (name.length > 50) { set.status = 400; return { error: '视图名称过长（最多 50 字符）' }; }
    const exists = await db.projectSavedViews.findByName(name);
    if (exists) { set.status = 409; return { error: '视图名称已存在', conflictView: exists.name }; }
    const existingCount = await db.projectSavedViews.count();
    if (existingCount >= MAX_SAVED_VIEWS) {
      set.status = 400;
      return { error: `最多保存 ${MAX_SAVED_VIEWS} 个视图` };
    }
    const config = normalizeViewConfig(body.config);
    const view = await db.projectSavedViews.create({
      name,
      config: JSON.stringify(config),
      sortOrder: existingCount,
    });
    return { success: true, view: serializeView(view) };
  }, {
    body: t.Object({
      name: t.String(),
      config: t.Optional(t.Any()),
    }),
  })
  .put('/api/project-views/:id', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.projectSavedViews.findById(params.id);
    if (!before) { set.status = 404; return { error: 'View not found' }; }
    const patch: { name?: string; config?: string } = {};
    if (body.name !== undefined) {
      const name = normalizeName(body.name);
      if (!name) { set.status = 400; return { error: '视图名称不能为空' }; }
      if (name.length > 50) { set.status = 400; return { error: '视图名称过长（最多 50 字符）' }; }
      const conflict = await db.projectSavedViews.findByName(name);
      if (conflict && conflict.id !== params.id) {
        set.status = 409;
        return { error: '视图名称已存在', conflictView: conflict.name };
      }
      patch.name = name;
    }
    if (body.config !== undefined) {
      patch.config = JSON.stringify(normalizeViewConfig(body.config));
    }
    const view = await db.projectSavedViews.update(params.id, patch);
    return { success: true, view: serializeView(view!) };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      config: t.Optional(t.Any()),
    }),
  })
  .delete('/api/project-views/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const removed = await db.projectSavedViews.remove(params.id);
    if (!removed) { set.status = 404; return { error: 'View not found' }; }
    return { success: true };
  });
