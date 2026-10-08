import { Elysia, t } from 'elysia';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../db/index.js';
import { workspaceStore } from '../db/workspace-store.js';
import { extractBearerToken, verifyAdminToken } from '../lib/auth.js';
import {
  deriveAgentState,
  deriveRequirementStatus,
  normalizeAgentProvider,
  normalizeDocumentKind,
  normalizeRequirementStatus,
  normalizeTaskStatus,
  normalizeWorkspaceRole,
  AGENT_PROVIDERS,
} from '../lib/workspace.js';

type WorkspaceContext = Awaited<ReturnType<typeof workspaceContext>>;
const subscribers = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

function broadcast(workspaceId: string, type: string, payload: Record<string, unknown> = {}) {
  const set = subscribers.get(workspaceId);
  if (!set?.size) return;
  const line = new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  for (const controller of set) {
    try { controller.enqueue(line); } catch { set.delete(controller); }
  }
}

function asRows<T = Record<string, any>>(rows: any[]): T[] {
  return rows as T[];
}

export type AgentStateCounts = { working: number; blocked: number; stalled: number; idle: number };

function aggregateAgentStates(perAgent: Array<{ agentId: string; taskStatuses: Array<{ status: string; lastActivityAt: string | null }> }>): AgentStateCounts {
  const counts: AgentStateCounts = { working: 0, blocked: 0, stalled: 0, idle: 0 };
  for (const agent of perAgent) {
    const state = deriveAgentState({ taskStatuses: agent.taskStatuses });
    counts[state] += 1;
  }
  return counts;
}

// 首页 3D 预览：只暴露渲染所需的最小字段
function previewAgents(
  agents: any[],
  perAgent: Array<{ agentId: string; taskStatuses: Array<{ status: string; lastActivityAt: string | null }> }>,
) {
  const byId = new Map(perAgent.map((entry) => [String(entry.agentId), entry.taskStatuses]));
  return agents.map((agent) => ({
    id: String(agent.id),
    provider: agent.provider,
    displayName: agent.displayName,
    state: deriveAgentState({ taskStatuses: byId.get(String(agent.id)) || [] }),
  }));
}

function normalizeText(value: unknown, max = 100000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
    : [];
}

const DOCUMENT_CONTENT_LIMIT = 50 * 1024 * 1024;

function documentContentTooLarge(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') > DOCUMENT_CONTENT_LIMIT;
}

function workspaceToken() {
  return `wst_${randomUUID().replace(/-/g, '')}`;
}

async function workspaceContext(headers: Record<string, any>, workspaceId: string) {
  const admin = verifyAdminToken(headers);
  if (admin) {
    return {
      admin: true,
      actor: { type: 'human' as const, id: 'admin', provider: null },
      agent: null,
    };
  }
  const raw = extractBearerToken(headers);
  if (!raw) return null;
  const token = await workspaceStore.tokens.findByRaw(raw);
  if (!token || token.workspaceId !== workspaceId) return null;
  await workspaceStore.tokens.touch(String(token.id));
  const provider = normalizeAgentProvider(headers['x-kite-agent'] || headers['X-Kite-Agent']);
  const agent = await workspaceStore.agents.ensure(workspaceId, provider);
  return {
    admin: false,
    actor: { type: 'agent' as const, id: String((agent as any).id), provider },
    agent,
  };
}

async function contextOrError(headers: Record<string, any>, workspaceId: string) {
  return await workspaceContext(headers, workspaceId);
}

async function requirementWithStatus(requirement: any) {
  const statuses = await workspaceStore.requirements.taskStatuses(requirement.id);
  const derivedStatus = deriveRequirementStatus({
    statusMode: requirement.statusMode,
    manualStatus: requirement.manualStatus,
    taskStatuses: asRows(statuses).map((row) => row.status),
  });
  const projects = asRows(await workspaceStore.requirements.listProjects(requirement.id)).map((row) => String(row.projectId));
  const tags = await workspaceStore.requirements.listTags(requirement.id);
  return {
    ...requirement,
    derivedStatus,
    effectiveStatus: derivedStatus,
    projectIds: projects,
    tags,
  };
}

async function taskWithActivities(task: any) {
  if (!task) return null;
  return {
    ...task,
    activities: await workspaceStore.tasks.listActivities(task.id),
  };
}

async function documentWithLinks(document: any) {
  if (!document) return null;
  const [links, revisions, assets] = await Promise.all([
    workspaceStore.documents.listLinks(document.id),
    workspaceStore.documents.listRevisions(document.id),
    workspaceStore.assets.listByDocument(document.id),
  ]);
  const latest = revisions[0] || null;
  return {
    ...document,
    links,
    revisions,
    assets,
    latestRevision: latest,
    contentMarkdown: latest?.contentMarkdown || '',
  };
}

function decorateAgents(agents: any[], tasks: any[]) {
  return agents.map((agent) => {
    const assigned = tasks.filter((task) =>
      task.claimedAgentId === agent.id || task.assignedProvider === agent.provider,
    );
    return {
      ...agent,
      state: deriveAgentState({ taskStatuses: assigned as any }),
      openTaskIds: assigned
        .filter((task) => !['done', 'cancelled'].includes(String(task.status)))
        .map((task) => task.id),
      taskCount: assigned.length,
    };
  });
}

async function boardSnapshot(workspaceId: string) {
  const [agents, tasks, requirements] = await Promise.all([
    workspaceStore.agents.list(workspaceId),
    workspaceStore.tasks.list(workspaceId),
    workspaceStore.requirements.list(workspaceId),
  ]);
  const decoratedRequirements = [] as any[];
  for (const requirement of requirements) {
    decoratedRequirements.push(await requirementWithStatus(requirement));
  }
  const agentStates = decorateAgents(agents, tasks);
  return {
    generatedAt: new Date().toISOString(),
    workspaceId,
    agents: agentStates,
    tasks,
    requirements: decoratedRequirements,
    unassigned: tasks.filter((task) => !task.assignedProvider && task.status === 'todo'),
    counts: {
      requirements: decoratedRequirements.length,
      tasks: tasks.length,
      unassigned: tasks.filter((task) => !task.assignedProvider && task.status === 'todo').length,
      documents: (await workspaceStore.documents.list(workspaceId)).length,
      projects: (await workspaceStore.projects.listByWorkspace(workspaceId)).length,
    },
  };
}

export const workspaceRoutes = new Elysia()
  .get('/api/workspaces', async ({ headers, set, query }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const includeArchived = query.includeArchived === 'true';
    const rows = asRows<any>(await workspaceStore.workspaces.list(includeArchived));
    const ids = rows.map((row) => String(row.id));
    const [inputs, agentsByWorkspace] = await Promise.all([
      workspaceStore.agents.stateInputs(ids),
      workspaceStore.agents.listByWorkspaces(ids),
    ]);
    return rows.map((row) => ({
      ...row,
      agentStates: aggregateAgentStates(inputs.get(String(row.id)) || []),
      agents: previewAgents(agentsByWorkspace.get(String(row.id)) || [], inputs.get(String(row.id)) || []),
    }));
  }, {
    query: t.Object({ includeArchived: t.Optional(t.String()) }),
  })
  .post('/api/workspaces', async ({ headers, body, set }) => {
    if (!verifyAdminToken(headers)) { set.status = 401; return { error: 'Unauthorized' }; }
    const name = normalizeText(body.name, 80);
    if (!name) { set.status = 400; return { error: 'Workspace 名称不能为空' }; }
    if (await workspaceStore.workspaces.findByName(name)) {
      set.status = 409;
      return { error: 'Workspace 名称已存在' };
    }
    const workspace = await workspaceStore.workspaces.create({
      name,
      description: normalizeText(body.description),
    });
    for (const provider of AGENT_PROVIDERS) {
      await workspaceStore.agents.ensure(workspace.id, provider);
    }
    const rawToken = workspaceToken();
    await workspaceStore.tokens.rotate(workspace.id, rawToken);
    broadcast(workspace.id, 'workspace.created', { workspaceId: workspace.id });
    return { success: true, workspace, token: rawToken };
  }, {
    body: t.Object({ name: t.String(), description: t.Optional(t.String()) }),
  })
  .get('/api/workspaces/:id', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const workspace = await workspaceStore.workspaces.findById(params.id);
    if (!workspace || workspace.archivedAt) { set.status = 404; return { error: 'Workspace not found' }; }
    const [projects, requirements, documents, agents, tasks] = await Promise.all([
      workspaceStore.projects.listByWorkspace(params.id),
      workspaceStore.requirements.list(params.id),
      workspaceStore.documents.list(params.id),
      workspaceStore.agents.list(params.id),
      workspaceStore.tasks.list(params.id),
    ]);
    const [decoratedRequirements, decoratedDocuments] = await Promise.all([
      Promise.all(requirements.map((requirement) => requirementWithStatus(requirement))),
      Promise.all(documents.map((document) => documentWithLinks(document))),
    ]);
    return {
      ...workspace,
      projects,
      requirements: decoratedRequirements,
      documents: decoratedDocuments,
      agents: decorateAgents(agents, tasks),
    };
  })
  .put('/api/workspaces/:id', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const workspace = await workspaceStore.workspaces.findById(params.id);
    if (!workspace || workspace.archivedAt) { set.status = 404; return { error: 'Workspace not found' }; }
    const name = body.name !== undefined ? normalizeText(body.name, 80) : undefined;
    if (name !== undefined && !name) { set.status = 400; return { error: 'Workspace 名称不能为空' }; }
    const conflict = name ? await workspaceStore.workspaces.findByName(name) : null;
    if (conflict && conflict.id !== params.id) { set.status = 409; return { error: 'Workspace 名称已存在' }; }
    const updated = await workspaceStore.workspaces.update(params.id, {
      name: name || undefined,
      description: body.description !== undefined ? normalizeText(body.description) : undefined,
    });
    broadcast(params.id, 'workspace.updated', { workspaceId: params.id });
    return { success: true, workspace: updated };
  }, {
    body: t.Object({ name: t.Optional(t.String()), description: t.Optional(t.Union([t.String(), t.Null()])) }),
  })
  .delete('/api/workspaces/:id', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const ok = await workspaceStore.workspaces.archive(params.id);
    if (!ok) { set.status = 404; return { error: 'Workspace not found' }; }
    broadcast(params.id, 'workspace.archived', { workspaceId: params.id });
    return { success: true };
  })
  .post('/api/workspaces/:id/token/rotate', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const workspace = await workspaceStore.workspaces.findById(params.id);
    if (!workspace || workspace.archivedAt) { set.status = 404; return { error: 'Workspace not found' }; }
    const token = workspaceToken();
    await workspaceStore.tokens.rotate(params.id, token);
    broadcast(params.id, 'token.rotated', { workspaceId: params.id });
    return { success: true, token };
  })
  .put('/api/workspaces/:id/projects/:projectId', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const project = await db.projects.findById(params.projectId);
    if (!project) { set.status = 404; return { error: 'Project not found' }; }
    const link = await workspaceStore.projects.link(
      params.id,
      params.projectId,
      normalizeWorkspaceRole(body.role),
      body.sortOrder ?? 0,
    );
    broadcast(params.id, 'project.linked', { workspaceId: params.id, projectId: params.projectId });
    return { success: true, link };
  }, {
    body: t.Object({ role: t.Optional(t.String()), sortOrder: t.Optional(t.Number()) }),
  })
  .delete('/api/workspaces/:id/projects/:projectId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const ok = await workspaceStore.projects.unlink(params.id, params.projectId);
    if (!ok) { set.status = 404; return { error: 'Project link not found' }; }
    broadcast(params.id, 'project.unlinked', { workspaceId: params.id, projectId: params.projectId });
    return { success: true };
  })
  .get('/api/workspaces/:id/requirements', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const requirements = asRows(await workspaceStore.requirements.list(params.id));
    return await Promise.all(requirements.map((requirement) => requirementWithStatus(requirement)));
  })
  .post('/api/workspaces/:id/requirements', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const projectIds = parseStringArray(body.projectIds);
    if (!ctx.admin && projectIds.length > 0) {
      set.status = 403;
      return { error: 'Agents cannot set requirement project scope' };
    }
    const title = normalizeText(body.title, 200);
    if (!title) { set.status = 400; return { error: '需求标题不能为空' }; }
    const created = await workspaceStore.requirements.create({
      workspaceId: params.id,
      title,
      description: normalizeText(body.description),
      priority: normalizeText(body.priority, 8),
      statusMode: body.statusMode,
      manualStatus: body.manualStatus,
      acceptanceCriteria: normalizeText(body.acceptanceCriteria),
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
    });
    const tagNames = parseStringArray(body.tags);
    const tagIds: string[] = [];
    for (const tagName of tagNames) {
      const tag = await workspaceStore.tags.ensure(params.id, tagName);
      if (tag?.id) tagIds.push(String(tag.id));
    }
    await workspaceStore.requirements.setProjects(created.id, projectIds);
    await workspaceStore.requirements.setTags(created.id, tagIds);
    broadcast(params.id, 'requirement.created', { requirementId: created.id });
    return { success: true, requirement: await requirementWithStatus(created) };
  }, {
    body: t.Object({
      title: t.String(),
      description: t.Optional(t.String()),
      priority: t.Optional(t.String()),
      statusMode: t.Optional(t.String()),
      manualStatus: t.Optional(t.String()),
      acceptanceCriteria: t.Optional(t.String()),
      projectIds: t.Optional(t.Array(t.String())),
      tags: t.Optional(t.Array(t.String())),
    }),
  })
  .get('/api/workspaces/:id/requirements/:requirementId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const requirement = await workspaceStore.requirements.findById(params.requirementId);
    if (!requirement || requirement.workspaceId !== params.id || requirement.archivedAt) {
      set.status = 404;
      return { error: 'Requirement not found' };
    }
    const tasks = await workspaceStore.tasks.list(params.id, { requirementId: params.requirementId });
    return { ...(await requirementWithStatus(requirement)), tasks };
  })
  .put('/api/workspaces/:id/requirements/:requirementId', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const requirement = await workspaceStore.requirements.findById(params.requirementId);
    if (!requirement || requirement.workspaceId !== params.id || requirement.archivedAt) {
      set.status = 404;
      return { error: 'Requirement not found' };
    }
    if (!ctx.admin && body.projectIds !== undefined) {
      set.status = 403;
      return { error: 'Agents cannot change requirement project scope' };
    }
    const updated = await workspaceStore.requirements.update(params.requirementId, {
      title: body.title,
      description: body.description,
      priority: body.priority,
      statusMode: body.statusMode,
      manualStatus: body.manualStatus,
      acceptanceCriteria: body.acceptanceCriteria,
    });
    if (body.projectIds !== undefined && ctx.admin) {
      await workspaceStore.requirements.setProjects(params.requirementId, parseStringArray(body.projectIds));
    }
    if (body.tags !== undefined) {
      const tagIds: string[] = [];
      for (const tagName of parseStringArray(body.tags)) {
        const tag = await workspaceStore.tags.ensure(params.id, tagName);
        if (tag?.id) tagIds.push(String(tag.id));
      }
      await workspaceStore.requirements.setTags(params.requirementId, tagIds);
    }
    broadcast(params.id, 'requirement.updated', { requirementId: params.requirementId });
    return { success: true, requirement: updated ? await requirementWithStatus(updated) : null };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.Union([t.String(), t.Null()])),
      priority: t.Optional(t.String()),
      statusMode: t.Optional(t.String()),
      manualStatus: t.Optional(t.Union([t.String(), t.Null()])),
      acceptanceCriteria: t.Optional(t.Union([t.String(), t.Null()])),
      projectIds: t.Optional(t.Array(t.String())),
      tags: t.Optional(t.Array(t.String())),
    }),
  })
  .delete('/api/workspaces/:id/requirements/:requirementId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const ok = await workspaceStore.requirements.archive(params.requirementId);
    if (!ok) { set.status = 404; return { error: 'Requirement not found' }; }
    broadcast(params.id, 'requirement.archived', { requirementId: params.requirementId });
    return { success: true };
  })
  .get('/api/workspaces/:id/tasks', async ({ headers, params, query, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    return await workspaceStore.tasks.list(params.id, {
      requirementId: query.requirementId,
      status: query.status,
      provider: query.provider,
      assignee: query.assignee,
    });
  }, {
    query: t.Object({
      requirementId: t.Optional(t.String()),
      status: t.Optional(t.String()),
      provider: t.Optional(t.String()),
      assignee: t.Optional(t.String()),
    }),
  })
  .post('/api/workspaces/:id/tasks', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const requirement = await workspaceStore.requirements.findById(body.requirementId);
    if (!requirement || requirement.workspaceId !== params.id || requirement.archivedAt) {
      set.status = 404;
      return { error: 'Requirement not found' };
    }
    const title = normalizeText(body.title, 200);
    if (!title) { set.status = 400; return { error: 'Task 标题不能为空' }; }
    const task = await workspaceStore.tasks.create({
      workspaceId: params.id,
      requirementId: body.requirementId,
      title,
      description: normalizeText(body.description),
      assignedProvider: ctx.admin ? body.assignedProvider : undefined,
      progress: body.progress,
      status: 'todo',
    });
    await workspaceStore.tasks.addActivity({
      workspaceId: params.id,
      taskId: task.id,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      provider: ctx.actor.provider,
      kind: 'created',
      statusTo: 'todo',
      summary: 'Task created',
    });
    broadcast(params.id, 'task.created', { taskId: task.id });
    return { success: true, task: await taskWithActivities(task) };
  }, {
    body: t.Object({
      requirementId: t.String(),
      title: t.String(),
      description: t.Optional(t.String()),
      assignedProvider: t.Optional(t.String()),
      progress: t.Optional(t.Number()),
    }),
  })
  .get('/api/workspaces/:id/tasks/:taskId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const task = await workspaceStore.tasks.findById(params.taskId);
    if (!task || task.workspaceId !== params.id || task.archivedAt) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    return await taskWithActivities(task);
  })
  .put('/api/workspaces/:id/tasks/:taskId', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await workspaceStore.tasks.findById(params.taskId);
    if (!before || before.workspaceId !== params.id || before.archivedAt) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    if (!ctx.admin) {
      if (before.claimedAgentId !== ctx.actor.id) {
        set.status = 403;
        return { error: 'Agent can only update its own claimed task' };
      }
      if (body.assignedProvider !== undefined) {
        set.status = 403;
        return { error: 'Agents cannot reassign tasks' };
      }
    }
    const updated = await workspaceStore.tasks.update(params.taskId, {
      title: body.title,
      description: body.description,
      status: body.status,
      assignedProvider: body.assignedProvider,
      progress: body.progress,
    });
    if (before.status !== updated?.status || body.summary || body.progress !== undefined) {
      await workspaceStore.tasks.addActivity({
        workspaceId: params.id,
        taskId: params.taskId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.id,
        provider: ctx.actor.provider,
        kind: 'updated',
        statusFrom: before.status ? String(before.status) : null,
        statusTo: updated?.status ? String(updated.status) : null,
        summary: normalizeText(body.summary, 2000) || `Progress updated`,
        documentId: body.documentId,
      });
    }
    broadcast(params.id, 'task.updated', { taskId: params.taskId });
    return { success: true, task: await taskWithActivities(updated) };
  }, {
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.Union([t.String(), t.Null()])),
      status: t.Optional(t.String()),
      assignedProvider: t.Optional(t.Union([t.String(), t.Null()])),
      progress: t.Optional(t.Union([t.Number(), t.Null()])),
      summary: t.Optional(t.String()),
      documentId: t.Optional(t.String()),
    }),
  })
  .post('/api/workspaces/:id/tasks/:taskId/assign', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const before = await workspaceStore.tasks.findById(params.taskId);
    if (!before || before.workspaceId !== params.id || before.archivedAt) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    const updated = await workspaceStore.tasks.update(params.taskId, {
      assignedProvider: body.provider,
    });
    await workspaceStore.tasks.addActivity({
      workspaceId: params.id,
      taskId: params.taskId,
      actorType: 'human',
      actorId: 'admin',
      kind: 'assigned',
      summary: body.provider ? `Assigned to ${body.provider}` : 'Assignment cleared',
    });
    broadcast(params.id, 'task.assigned', { taskId: params.taskId });
    return { success: true, task: updated };
  }, {
    body: t.Object({ provider: t.Union([t.String(), t.Null()]) }),
  })
  .post('/api/workspaces/:id/tasks/:taskId/claim', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await workspaceStore.tasks.findById(params.taskId);
    if (!before || before.workspaceId !== params.id || before.archivedAt) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    const provider = ctx.actor.provider || normalizeAgentProvider(headers as any);
    const agent = ctx.agent || await workspaceStore.agents.ensure(params.id, provider);
    const result = await workspaceStore.tasks.claim(params.taskId, String((agent as any).id), provider);
    if (!result.ok) {
      set.status = 409;
      return { error: 'Task is already claimed or assigned to another agent' };
    }
    await workspaceStore.tasks.addActivity({
      workspaceId: params.id,
      taskId: params.taskId,
      actorType: 'agent',
      actorId: String((agent as any).id),
      provider,
      kind: 'claimed',
      statusFrom: before.status ? String(before.status) : null,
      statusTo: result.task?.status ? String(result.task.status) : null,
      summary: `${provider} claimed task`,
    });
    broadcast(params.id, 'task.claimed', { taskId: params.taskId });
    return { success: true, task: await taskWithActivities(result.task) };
  })
  .post('/api/workspaces/:id/tasks/:taskId/release', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await workspaceStore.tasks.findById(params.taskId);
    if (!before || before.workspaceId !== params.id || before.archivedAt) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    const agent = ctx.agent || await workspaceStore.agents.ensure(params.id, ctx.actor.provider || 'codex');
    const result = await workspaceStore.tasks.release(params.taskId, String((agent as any).id));
    if (!result.ok) { set.status = 409; return { error: 'Task is not owned by this agent' }; }
    await workspaceStore.tasks.addActivity({
      workspaceId: params.id,
      taskId: params.taskId,
      actorType: 'agent',
      actorId: String((agent as any).id),
      provider: String((agent as any).provider),
      kind: 'released',
      statusFrom: before.status ? String(before.status) : null,
      statusTo: result.task?.status ? String(result.task.status) : null,
      summary: `${String((agent as any).provider)} released task`,
    });
    broadcast(params.id, 'task.released', { taskId: params.taskId });
    return { success: true, task: await taskWithActivities(result.task) };
  })
  .post('/api/workspaces/:id/tasks/:taskId/activities', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const task = await workspaceStore.tasks.findById(params.taskId);
    if (!task || task.workspaceId !== params.id || task.archivedAt) {
      set.status = 404;
      return { error: 'Task not found' };
    }
    if (!ctx.admin && task.claimedAgentId !== ctx.actor.id) {
      set.status = 403;
      return { error: 'Agent can only update its own claimed task' };
    }
    const activity = await workspaceStore.tasks.addActivity({
      workspaceId: params.id,
      taskId: params.taskId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      provider: ctx.actor.provider,
      kind: body.kind || 'note',
      statusFrom: body.statusFrom,
      statusTo: body.statusTo,
      summary: normalizeText(body.summary, 4000),
      documentId: body.documentId,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    });
    await workspaceStore.tasks.update(params.taskId, { lastActivityAt: new Date().toISOString() });
    broadcast(params.id, 'task.activity', { taskId: params.taskId });
    return { success: true, activity };
  }, {
    body: t.Object({
      kind: t.Optional(t.String()),
      statusFrom: t.Optional(t.String()),
      statusTo: t.Optional(t.String()),
      summary: t.Optional(t.String()),
      documentId: t.Optional(t.String()),
      metadata: t.Optional(t.Any()),
    }),
  })
  .delete('/api/workspaces/:id/tasks/:taskId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const ok = await workspaceStore.tasks.archive(params.taskId);
    if (!ok) { set.status = 404; return { error: 'Task not found' }; }
    broadcast(params.id, 'task.archived', { taskId: params.taskId });
    return { success: true };
  })
  .get('/api/workspaces/:id/documents', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    return await workspaceStore.documents.list(params.id);
  })
  .post('/api/workspaces/:id/documents', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const title = normalizeText(body.title, 200);
    if (!title) { set.status = 400; return { error: '文档标题不能为空' }; }
    const contentMarkdown = typeof body.contentMarkdown === 'string' ? body.contentMarkdown : '';
    if (documentContentTooLarge(contentMarkdown)) {
      set.status = 413;
      return { error: 'Document content exceeds 50 MiB limit' };
    }
    const document = await workspaceStore.documents.create({
      workspaceId: params.id,
      title,
      kind: normalizeDocumentKind(body.kind, 'note'),
      contentMarkdown,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
    });
    for (const link of Array.isArray(body.links) ? body.links : []) {
      if (link?.targetType === 'requirement' || link?.targetType === 'task') {
        await workspaceStore.documents.addLink(String(document.id), link.targetType as 'requirement' | 'task', String(link.targetId));
      }
    }
    broadcast(params.id, 'document.created', { documentId: document.id });
    return { success: true, document: await documentWithLinks(document) };
  }, {
    body: t.Object({
      title: t.String(),
      kind: t.Optional(t.String()),
      contentMarkdown: t.Optional(t.String()),
      links: t.Optional(t.Array(t.Object({ targetType: t.String(), targetId: t.String() }))),
    }),
  })
  .get('/api/workspaces/:id/documents/:documentId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const document = await workspaceStore.documents.findById(params.documentId);
    if (!document || document.workspaceId !== params.id || document.archivedAt) {
      set.status = 404;
      return { error: 'Document not found' };
    }
    return await documentWithLinks(document);
  })
  .delete('/api/workspaces/:id/documents/:documentId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    if (!ctx.admin) { set.status = 403; return { error: 'Admin token required' }; }
    const document = await workspaceStore.documents.findById(params.documentId);
    if (!document || document.workspaceId !== params.id || document.archivedAt) {
      set.status = 404;
      return { error: 'Document not found' };
    }
    const ok = await workspaceStore.documents.archive(params.documentId);
    if (!ok) { set.status = 404; return { error: 'Document not found' }; }
    broadcast(params.id, 'document.archived', { documentId: params.documentId });
    return { success: true };
  })
  .put('/api/workspaces/:id/documents/:documentId', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const before = await workspaceStore.documents.findById(params.documentId);
    if (!before || before.workspaceId !== params.id || before.archivedAt) {
      set.status = 404;
      return { error: 'Document not found' };
    }
    const document = await workspaceStore.documents.update(params.documentId, {
      title: body.title,
      kind: body.kind,
    });
    broadcast(params.id, 'document.updated', { documentId: params.documentId });
    return { success: true, document: await documentWithLinks(document) };
  }, {
    body: t.Object({ title: t.Optional(t.String()), kind: t.Optional(t.String()) }),
  })
  .post('/api/workspaces/:id/documents/:documentId/revisions', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const document = await workspaceStore.documents.findById(params.documentId);
    if (!document || document.workspaceId !== params.id || document.archivedAt) {
      set.status = 404;
      return { error: 'Document not found' };
    }
    if (typeof body.contentMarkdown !== 'string') {
      set.status = 400;
      return { error: 'contentMarkdown is required' };
    }
    if (documentContentTooLarge(body.contentMarkdown)) {
      set.status = 413;
      return { error: 'Document content exceeds 50 MiB limit' };
    }
    const result = await workspaceStore.documents.addRevision({
      documentId: params.documentId,
      workspaceId: params.id,
      contentMarkdown: body.contentMarkdown,
      baseRevisionId: body.baseRevisionId ?? null,
      createdByType: ctx.actor.type,
      createdById: ctx.actor.id,
    });
    if (result.conflict) {
      set.status = 409;
      return { error: 'Revision conflict', latest: result.latest };
    }
    broadcast(params.id, 'document.revision', { documentId: params.documentId });
    return { success: true, revision: result.revision };
  }, {
    body: t.Object({ contentMarkdown: t.String(), baseRevisionId: t.Optional(t.Union([t.String(), t.Null()])) }),
  })
  .post('/api/workspaces/:id/documents/:documentId/links', async ({ headers, params, body, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const document = await workspaceStore.documents.findById(params.documentId);
    if (!document || document.workspaceId !== params.id || document.archivedAt) {
      set.status = 404;
      return { error: 'Document not found' };
    }
    if (body.targetType !== 'requirement' && body.targetType !== 'task') {
      set.status = 400;
      return { error: 'targetType must be requirement or task' };
    }
    await workspaceStore.documents.addLink(params.documentId, body.targetType, body.targetId);
    broadcast(params.id, 'document.link', { documentId: params.documentId });
    return { success: true };
  }, {
    body: t.Object({ targetType: t.String(), targetId: t.String() }),
  })
  .delete('/api/workspaces/:id/documents/:documentId/links/:targetType/:targetId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const ok = await workspaceStore.documents.removeLink(params.documentId, params.targetType, params.targetId);
    if (!ok) { set.status = 404; return { error: 'Document link not found' }; }
    broadcast(params.id, 'document.unlink', { documentId: params.documentId });
    return { success: true };
  })
  .post('/api/workspaces/:id/documents/:documentId/assets', async ({ headers, params, request, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const document = await workspaceStore.documents.findById(params.documentId);
    if (!document || document.workspaceId !== params.id || document.archivedAt) {
      set.status = 404;
      return { error: 'Document not found' };
    }
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) { set.status = 400; return { error: 'file is required' }; }
    const allowed = new Map([
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ]);
    if (!allowed.has(file.type)) { set.status = 400; return { error: 'Only PNG/JPEG/WebP/GIF images are supported' }; }
    if (file.size > 10 * 1024 * 1024) { set.status = 413; return { error: 'Image exceeds 10 MiB limit' }; }
    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = await workspaceStore.assets.findByHash(params.id, sha256);
    if (existing) return { success: true, asset: existing };
    const ext = allowed.get(file.type)!;
    const root = path.join(process.env.KITE_DB_DIR || process.cwd(), 'workspaces', params.id, 'assets');
    const storagePath = path.join(root, `${sha256.slice(0, 2)}`, `${sha256}.${ext}`);
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(storagePath, buffer);
    const asset = await workspaceStore.assets.create({
      workspaceId: params.id,
      documentId: params.documentId,
      sha256,
      mime: file.type,
      size: file.size,
      originalName: path.basename(file.name || `image.${ext}`),
      storagePath,
    });
    broadcast(params.id, 'document.asset', { documentId: params.documentId, assetId: asset.id });
    return { success: true, asset };
  })
  .get('/api/workspaces/:id/assets/:assetId', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const asset = await workspaceStore.assets.findById(params.assetId);
    if (!asset || asset.workspaceId !== params.id || asset.archivedAt) {
      set.status = 404;
      return { error: 'Asset not found' };
    }
    const file = await fs.readFile(String(asset.storagePath));
    return new Response(file, {
      headers: {
        'Content-Type': String(asset.mime),
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  })
  .get('/api/workspaces/:id/agents', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    const [agents, tasks] = await Promise.all([
      workspaceStore.agents.list(params.id),
      workspaceStore.tasks.list(params.id),
    ]);
    return decorateAgents(agents, tasks);
  })
  .get('/api/workspaces/:id/board', async ({ headers, params, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    return await boardSnapshot(params.id);
  })
  .get('/api/workspaces/:id/events', async ({ headers, params, request, set }) => {
    const ctx = await contextOrError(headers, params.id);
    if (!ctx) { set.status = 401; return { error: 'Unauthorized' }; }
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        const set = subscribers.get(params.id) || new Set();
        set.add(controller);
        subscribers.set(params.id, set);
        controller.enqueue(new TextEncoder().encode(`event: ready\ndata: ${JSON.stringify({ workspaceId: params.id })}\n\n`));
        const heartbeat = setInterval(() => {
          try { controller.enqueue(new TextEncoder().encode(`: ping\n\n`)); } catch { clearInterval(heartbeat); }
        }, 15000);
        request.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          subscribers.get(params.id)?.delete(controller);
          try { controller.close(); } catch { /* already closed */ }
        }, { once: true });
      },
      cancel() {
        if (controllerRef) subscribers.get(params.id)?.delete(controllerRef);
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  });
