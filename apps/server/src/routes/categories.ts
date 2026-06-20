import { Elysia, t } from 'elysia';
import { db } from '../db/index.js';
import { writeAudit, diffFields, sanitize } from '../lib/audit.js';
import { verifyAdminToken } from '../lib/auth.js';

const ALLOWED_COLORS = new Set(['blue', 'green', 'yellow', 'purple', 'pink', 'cyan', 'gray']);
const COLOR_PALETTE = ['blue', 'green', 'yellow', 'purple', 'pink', 'cyan', 'gray'];

function normalizeColor(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string') return null;
  return ALLOWED_COLORS.has(input) ? input : null;
}

async function pickFreeColor(): Promise<string> {
  const list = await db.categories.findAll();
  const used = new Set<string>();
  for (const c of list) {
    if (c.color) used.add(c.color);
  }
  for (const color of COLOR_PALETTE) {
    if (!used.has(color)) return color;
  }
  return COLOR_PALETTE[list.length % COLOR_PALETTE.length];
}

function normalizeName(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.trim();
}

export const categoryRoutes = new Elysia()
  .get('/api/categories', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    return await db.categories.findAll();
  })
  .post('/api/categories', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const name = normalizeName(body.name);
    if (!name) { set.status = 400; return { error: '分类名不能为空' }; }
    if (name.length > 50) { set.status = 400; return { error: '分类名过长（最多 50 字符）' }; }
    const exist = await db.categories.findByName(name);
    if (exist) { set.status = 409; return { error: '分类名已存在', conflictCategory: exist.name }; }
    let color = normalizeColor(body.color);
    if (!color) color = await pickFreeColor();
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;
    const created = await db.categories.create({ name, color, sortOrder });
    await writeAudit({ headers }, {
      action: 'category.create',
      targetType: 'category',
      targetId: created.id,
      targetName: created.name,
      before: null,
      after: sanitize(created),
      summary: `创建分类 ${created.name}`,
    });
    return { success: true, category: created };
  }, {
    body: t.Object({
      name: t.String(),
      color: t.Optional(t.Union([t.String(), t.Null()])),
      sortOrder: t.Optional(t.Number()),
    }),
  })
  .put('/api/categories/:id', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.categories.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Category not found' }; }

    const patch: { name?: string; color?: string | null; sortOrder?: number } = {};
    if (body.name !== undefined) {
      const name = normalizeName(body.name);
      if (!name) { set.status = 400; return { error: '分类名不能为空' }; }
      if (name.length > 50) { set.status = 400; return { error: '分类名过长（最多 50 字符）' }; }
      if (name !== before.name) {
        const conflict = await db.categories.findByName(name);
        if (conflict && conflict.id !== params.id) {
          set.status = 409;
          return { error: '分类名已存在', conflictCategory: conflict.name };
        }
      }
      patch.name = name;
    }
    if (body.color !== undefined) patch.color = normalizeColor(body.color);
    if (body.sortOrder !== undefined && typeof body.sortOrder === 'number') {
      patch.sortOrder = body.sortOrder;
    }

    const after = await db.categories.update(params.id, patch);
    if (!after) { set.status = 404; return { error: 'Category not found' }; }
    const diff = diffFields(before as any, after as any, Object.keys(patch));
    if (Object.keys(diff.after).length > 0) {
      await writeAudit({ headers }, {
        action: 'category.update',
        targetType: 'category',
        targetId: params.id,
        targetName: after.name,
        before: diff.before,
        after: diff.after,
        summary: `更新分类配置：${Object.keys(diff.after).join(', ')}`,
      });
    }
    return { success: true, category: after };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      color: t.Optional(t.Union([t.String(), t.Null()])),
      sortOrder: t.Optional(t.Number()),
    }),
  })
  .delete('/api/categories/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.categories.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Category not found' }; }
    const projectCount = await db.categories.countProjects(params.id);
    const success = await db.categories.remove(params.id);
    if (!success) { set.status = 404; return { error: 'Category not found' }; }
    await writeAudit({ headers }, {
      action: 'category.delete',
      targetType: 'category',
      targetId: before.id,
      targetName: before.name,
      before: { ...sanitize(before) as any, projectCount },
      after: null,
      summary: `删除分类 ${before.name}（${projectCount} 个项目已回落到默认）`,
    });
    return { success: true, detachedProjects: projectCount };
  });
