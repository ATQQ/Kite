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
  const list = await db.tags.findAll();
  const used = new Set<string>();
  for (const t of list) {
    if (t.color) used.add(t.color);
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

export const tagRoutes = new Elysia()
  .get('/api/tags', async ({ headers, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const tags = await db.tags.findAll();
    const pairs = await db.projectTags.listAllPairs();
    const counts = new Map<string, number>();
    for (const p of pairs) counts.set(p.tagId, (counts.get(p.tagId) ?? 0) + 1);
    return tags.map(t => ({ ...t, projectCount: counts.get(t.id) ?? 0 }));
  })
  .post('/api/tags', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const name = normalizeName(body.name);
    if (!name) { set.status = 400; return { error: '标签名不能为空' }; }
    if (name.length > 30) { set.status = 400; return { error: '标签名过长（最多 30 字符）' }; }
    const exist = await db.tags.findByName(name);
    if (exist) { set.status = 409; return { error: '标签名已存在', conflictTag: exist.name }; }
    let color = normalizeColor(body.color);
    if (!color) color = await pickFreeColor();
    const sortOrder = typeof body.sortOrder === 'number' ? body.sortOrder : 0;
    const created = await db.tags.create({ name, color, sortOrder });
    await writeAudit({ headers }, {
      action: 'tag.create',
      targetType: 'tag',
      targetId: created.id,
      targetName: created.name,
      before: null,
      after: sanitize(created),
      summary: `创建标签 ${created.name}`,
    });
    return { success: true, tag: created };
  }, {
    body: t.Object({
      name: t.String(),
      color: t.Optional(t.Union([t.String(), t.Null()])),
      sortOrder: t.Optional(t.Number()),
    }),
  })
  .put('/api/tags/:id', async ({ headers, params, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.tags.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Tag not found' }; }

    const patch: { name?: string; color?: string | null; sortOrder?: number } = {};
    if (body.name !== undefined) {
      const name = normalizeName(body.name);
      if (!name) { set.status = 400; return { error: '标签名不能为空' }; }
      if (name.length > 30) { set.status = 400; return { error: '标签名过长（最多 30 字符）' }; }
      if (name !== before.name) {
        const conflict = await db.tags.findByName(name);
        if (conflict && conflict.id !== params.id) {
          set.status = 409;
          return { error: '标签名已存在', conflictTag: conflict.name };
        }
      }
      patch.name = name;
    }
    if (body.color !== undefined) patch.color = normalizeColor(body.color);
    if (body.sortOrder !== undefined && typeof body.sortOrder === 'number') {
      patch.sortOrder = body.sortOrder;
    }

    const after = await db.tags.update(params.id, patch);
    if (!after) { set.status = 404; return { error: 'Tag not found' }; }
    const diff = diffFields(before as any, after as any, Object.keys(patch));
    if (Object.keys(diff.after).length > 0) {
      await writeAudit({ headers }, {
        action: 'tag.update',
        targetType: 'tag',
        targetId: params.id,
        targetName: after.name,
        before: diff.before,
        after: diff.after,
        summary: `更新标签配置：${Object.keys(diff.after).join(', ')}`,
      });
    }
    return { success: true, tag: after };
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      color: t.Optional(t.Union([t.String(), t.Null()])),
      sortOrder: t.Optional(t.Number()),
    }),
  })
  .delete('/api/tags/:id', async ({ headers, params, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await db.tags.findById(params.id);
    if (!before) { set.status = 404; return { error: 'Tag not found' }; }
    const projectCount = await db.tags.countProjects(params.id);
    const success = await db.tags.remove(params.id);
    if (!success) { set.status = 404; return { error: 'Tag not found' }; }
    await writeAudit({ headers }, {
      action: 'tag.delete',
      targetType: 'tag',
      targetId: before.id,
      targetName: before.name,
      before: { ...sanitize(before) as any, projectCount },
      after: null,
      summary: `删除标签 ${before.name}（解除 ${projectCount} 个项目关联）`,
    });
    return { success: true, detachedProjects: projectCount };
  });
