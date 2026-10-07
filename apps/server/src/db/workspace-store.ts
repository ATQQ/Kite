import { randomUUID } from 'node:crypto';
import { dbClient } from './index.js';
import {
  hashWorkspaceToken,
  normalizeAgentProvider,
  normalizeDocumentKind,
  normalizeRequirementStatus,
  normalizeTaskStatus,
  normalizeWorkspaceRole,
} from '../lib/workspace.js';

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function camelizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const nextKey = key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
    result[nextKey] = Array.isArray(value)
      ? value.map((item) => (item && typeof item === 'object' ? camelizeRow(item as Record<string, unknown>) : item))
      : value && typeof value === 'object' && !(value instanceof Date)
        ? camelizeRow(value as Record<string, unknown>)
        : value;
  }
  return result;
}

async function query(sql: string, args: any[] = []) {
  const result = await dbClient.execute({ sql, args });
  return result.rows.map((row) => camelizeRow(row as Record<string, unknown>));
}

async function one(sql: string, args: any[] = []) {
  const rows = await query(sql, args);
  return rows[0] || null;
}

async function run(sql: string, args: any[] = []) {
  return dbClient.execute({ sql, args });
}

function nowIso() {
  return new Date().toISOString();
}

export const workspaceStore = {
  workspaces: {
    async list(includeArchived = false) {
      const where = includeArchived ? '' : 'WHERE w.archived_at IS NULL';
      return query(`
        SELECT w.*,
          (SELECT COUNT(*) FROM workspace_projects wp WHERE wp.workspace_id = w.id) AS project_count,
          (SELECT COUNT(*) FROM requirements r WHERE r.workspace_id = w.id AND r.archived_at IS NULL) AS requirement_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.workspace_id = w.id AND t.archived_at IS NULL) AS task_count,
          (SELECT COUNT(*) FROM documents d WHERE d.workspace_id = w.id AND d.archived_at IS NULL) AS document_count
        FROM workspaces w
        ${where}
        ORDER BY w.updated_at DESC
      `);
    },
    async findById(workspaceId: string) {
      return one('SELECT * FROM workspaces WHERE id = ? LIMIT 1', [workspaceId]);
    },
    async findByName(name: string) {
      return one('SELECT * FROM workspaces WHERE name = ? LIMIT 1', [name]);
    },
    async create(data: { name: string; description?: string | null }) {
      const now = nowIso();
      const workspace = {
        id: id('ws'),
        name: data.name,
        description: data.description || null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await run(
        `INSERT INTO workspaces (id, name, description, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [workspace.id, workspace.name, workspace.description, null, now, now],
      );
      return workspace;
    },
    async update(workspaceId: string, data: { name?: string; description?: string | null }) {
      const current = await this.findById(workspaceId);
      if (!current) return null;
      const next = {
        name: data.name ?? current.name,
        description: data.description !== undefined ? data.description : current.description,
        updatedAt: nowIso(),
      };
      await run(
        `UPDATE workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
        [next.name, next.description, next.updatedAt, workspaceId],
      );
      return this.findById(workspaceId);
    },
    async archive(workspaceId: string) {
      const archivedAt = nowIso();
      const result = await run(
        `UPDATE workspaces SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`,
        [archivedAt, archivedAt, workspaceId],
      );
      return result.rowsAffected > 0;
    },
  },
  projects: {
    async listByWorkspace(workspaceId: string) {
      return query(`
        SELECT wp.workspace_id AS workspaceId, wp.project_id AS projectId, wp.role,
               wp.sort_order AS sortOrder, wp.created_at AS createdAt, wp.updated_at AS updatedAt,
               p.name, p.description, p.status, p.env, p.deploy_path AS deployPath,
               (SELECT MAX(start_time) FROM deployments d WHERE d.project_id = p.id) AS lastDeployAt
        FROM workspace_projects wp
        JOIN projects p ON p.id = wp.project_id
        WHERE wp.workspace_id = ?
        ORDER BY wp.sort_order ASC, p.name ASC
      `, [workspaceId]);
    },
    async link(workspaceId: string, projectId: string, role: string, sortOrder = 0) {
      const now = nowIso();
      await run(
        `INSERT INTO workspace_projects (workspace_id, project_id, role, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, project_id) DO UPDATE SET
           role = excluded.role,
           sort_order = excluded.sort_order,
           updated_at = excluded.updated_at`,
        [workspaceId, projectId, normalizeWorkspaceRole(role), sortOrder, now, now],
      );
      return one(
        `SELECT * FROM workspace_projects WHERE workspace_id = ? AND project_id = ?`,
        [workspaceId, projectId],
      );
    },
    async unlink(workspaceId: string, projectId: string) {
      const result = await run(
        `DELETE FROM workspace_projects WHERE workspace_id = ? AND project_id = ?`,
        [workspaceId, projectId],
      );
      return result.rowsAffected > 0;
    },
    async listProjectIds(workspaceId: string) {
      const rows = await query(
        `SELECT project_id AS projectId FROM workspace_projects WHERE workspace_id = ?`,
        [workspaceId],
      );
      return rows.map((row) => String(row.projectId));
    },
    async belongs(workspaceId: string, projectId: string) {
      const row = await one(
        `SELECT 1 AS ok FROM workspace_projects WHERE workspace_id = ? AND project_id = ? LIMIT 1`,
        [workspaceId, projectId],
      );
      return Boolean(row);
    },
  },
  tokens: {
    async rotate(workspaceId: string, rawToken: string, name = 'default') {
      const now = nowIso();
      await run(
        `UPDATE workspace_tokens SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL`,
        [now, workspaceId],
      );
      const token = {
        id: id('wst'),
        workspaceId,
        name,
        tokenHash: hashWorkspaceToken(rawToken),
        tokenPrefix: rawToken.slice(0, 10),
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      };
      await run(
        `INSERT INTO workspace_tokens
          (id, workspace_id, name, token_hash, token_prefix, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [token.id, workspaceId, name, token.tokenHash, token.tokenPrefix, now, null, null],
      );
      return token;
    },
    async findByRaw(rawToken: string) {
      const tokenHash = hashWorkspaceToken(rawToken);
      return one(
        `SELECT * FROM workspace_tokens
         WHERE token_hash = ? AND revoked_at IS NULL LIMIT 1`,
        [tokenHash],
      );
    },
    async touch(tokenId: string) {
      await run(`UPDATE workspace_tokens SET last_used_at = ? WHERE id = ?`, [nowIso(), tokenId]);
    },
  },
  agents: {
    async ensure(workspaceId: string, providerValue: unknown) {
      const provider = normalizeAgentProvider(providerValue);
      const existing = await one(
        `SELECT * FROM workspace_agents WHERE workspace_id = ? AND provider = ? LIMIT 1`,
        [workspaceId, provider],
      );
      const now = nowIso();
      if (existing) {
        await run(`UPDATE workspace_agents SET last_seen_at = ? WHERE id = ?`, [now, existing.id]);
        return { ...(existing as any), lastSeenAt: now };
      }
      const agent = {
        id: id('agent'),
        workspaceId,
        provider,
        displayName: provider,
        createdAt: now,
        lastSeenAt: now,
      };
      await run(
        `INSERT INTO workspace_agents (id, workspace_id, provider, display_name, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [agent.id, agent.workspaceId, agent.provider, agent.displayName, agent.createdAt, agent.lastSeenAt],
      );
      return agent;
    },
    async list(workspaceId: string) {
      return query(
        `SELECT * FROM workspace_agents WHERE workspace_id = ? ORDER BY provider ASC`,
        [workspaceId],
      );
    },
    async findProvider(workspaceId: string, provider: string) {
      return one(
        `SELECT * FROM workspace_agents WHERE workspace_id = ? AND provider = ? LIMIT 1`,
        [workspaceId, normalizeAgentProvider(provider)],
      );
    },
  },
  tags: {
    async list(workspaceId: string) {
      return query(
        `SELECT * FROM workspace_tags WHERE workspace_id = ? ORDER BY name ASC`,
        [workspaceId],
      );
    },
    async ensure(workspaceId: string, name: string, color?: string | null) {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = await one(
        `SELECT * FROM workspace_tags WHERE workspace_id = ? AND name = ? LIMIT 1`,
        [workspaceId, trimmed],
      );
      if (existing) return existing;
      const now = nowIso();
      const tag = { id: id('wtag'), workspaceId, name: trimmed, color: color || null, createdAt: now, updatedAt: now };
      await run(
        `INSERT INTO workspace_tags (id, workspace_id, name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tag.id, tag.workspaceId, tag.name, tag.color, tag.createdAt, tag.updatedAt],
      );
      return tag;
    },
  },
  requirements: {
    async list(workspaceId: string, includeArchived = false) {
      const where = includeArchived ? '' : 'AND r.archived_at IS NULL';
      return query(`
        SELECT r.*,
          (SELECT COUNT(*) FROM tasks t WHERE t.requirement_id = r.id AND t.archived_at IS NULL) AS task_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.requirement_id = r.id AND t.archived_at IS NULL AND t.status IN ('claimed','in_progress','review')) AS active_task_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.requirement_id = r.id AND t.archived_at IS NULL AND t.status = 'blocked') AS blocked_task_count,
          (SELECT COUNT(*) FROM tasks t WHERE t.requirement_id = r.id AND t.archived_at IS NULL AND t.status = 'done') AS done_task_count
        FROM requirements r
        WHERE r.workspace_id = ? ${where}
        ORDER BY
          CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
          r.updated_at DESC
      `, [workspaceId]);
    },
    async findById(requirementId: string) {
      return one(`SELECT * FROM requirements WHERE id = ? LIMIT 1`, [requirementId]);
    },
    async taskStatuses(requirementId: string) {
      return query(
        `SELECT status FROM tasks WHERE requirement_id = ? AND archived_at IS NULL`,
        [requirementId],
      );
    },
    async create(data: {
      workspaceId: string;
      title: string;
      description?: string | null;
      priority?: string | null;
      statusMode?: string | null;
      manualStatus?: string | null;
      acceptanceCriteria?: string | null;
      createdByType?: string;
      createdById?: string | null;
    }) {
      const now = nowIso();
      const row = {
        id: id('req'),
        workspaceId: data.workspaceId,
        title: data.title.trim(),
        description: data.description || null,
        priority: ['P0', 'P1', 'P2', 'P3'].includes(String(data.priority)) ? data.priority : 'P2',
        statusMode: data.statusMode === 'manual' ? 'manual' : 'auto',
        manualStatus: data.statusMode === 'manual'
          ? normalizeRequirementStatus(data.manualStatus, 'draft')
          : null,
        acceptanceCriteria: data.acceptanceCriteria || null,
        archivedAt: null,
        createdByType: data.createdByType || 'human',
        createdById: data.createdById || null,
        createdAt: now,
        updatedAt: now,
      };
      await run(
        `INSERT INTO requirements
          (id, workspace_id, title, description, priority, status_mode, manual_status,
           acceptance_criteria, archived_at, created_by_type, created_by_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.workspaceId, row.title, row.description, row.priority, row.statusMode,
          row.manualStatus, row.acceptanceCriteria, null, row.createdByType, row.createdById,
          row.createdAt, row.updatedAt,
        ],
      );
      return row;
    },
    async update(requirementId: string, data: Record<string, any>) {
      const current = await this.findById(requirementId);
      if (!current) return null;
      const patch = {
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : current.title,
        description: data.description !== undefined ? data.description : current.description,
        priority: ['P0', 'P1', 'P2', 'P3'].includes(String(data.priority)) ? data.priority : current.priority,
        statusMode: data.statusMode === 'manual' ? 'manual' : data.statusMode === 'auto' ? 'auto' : current.statusMode,
        manualStatus: data.manualStatus !== undefined
          ? (data.manualStatus ? normalizeRequirementStatus(data.manualStatus, 'draft') : null)
          : current.manualStatus,
        acceptanceCriteria: data.acceptanceCriteria !== undefined ? data.acceptanceCriteria : current.acceptanceCriteria,
        updatedAt: nowIso(),
      };
      await run(
        `UPDATE requirements SET title = ?, description = ?, priority = ?, status_mode = ?, manual_status = ?,
          acceptance_criteria = ?, updated_at = ? WHERE id = ?`,
        [
          patch.title, patch.description, patch.priority, patch.statusMode, patch.manualStatus,
          patch.acceptanceCriteria, patch.updatedAt, requirementId,
        ],
      );
      return this.findById(requirementId);
    },
    async archive(requirementId: string) {
      const archivedAt = nowIso();
      const result = await run(
        `UPDATE requirements SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`,
        [archivedAt, archivedAt, requirementId],
      );
      return result.rowsAffected > 0;
    },
    async listProjects(requirementId: string) {
      return query(
        `SELECT project_id AS projectId FROM requirement_projects WHERE requirement_id = ?`,
        [requirementId],
      );
    },
    async setProjects(requirementId: string, projectIds: string[]) {
      await run(`DELETE FROM requirement_projects WHERE requirement_id = ?`, [requirementId]);
      const now = nowIso();
      for (const projectId of Array.from(new Set(projectIds.filter(Boolean)))) {
        await run(
          `INSERT OR IGNORE INTO requirement_projects (requirement_id, project_id, created_at) VALUES (?, ?, ?)`,
          [requirementId, projectId, now],
        );
      }
    },
    async listTags(requirementId: string) {
      return query(
        `SELECT t.* FROM requirement_tags rt
         JOIN workspace_tags t ON t.id = rt.tag_id
         WHERE rt.requirement_id = ?
         ORDER BY t.name ASC`,
        [requirementId],
      );
    },
    async setTags(requirementId: string, tagIds: string[]) {
      await run(`DELETE FROM requirement_tags WHERE requirement_id = ?`, [requirementId]);
      const now = nowIso();
      for (const tagId of Array.from(new Set(tagIds.filter(Boolean)))) {
        await run(
          `INSERT OR IGNORE INTO requirement_tags (requirement_id, tag_id, created_at) VALUES (?, ?, ?)`,
          [requirementId, tagId, now],
        );
      }
    },
  },
  tasks: {
    async list(workspaceId: string, filters: { requirementId?: string; status?: string; provider?: string; assignee?: string } = {}) {
      const where = ['t.workspace_id = ?', 't.archived_at IS NULL'];
      const args: any[] = [workspaceId];
      if (filters.requirementId) {
        where.push('t.requirement_id = ?');
        args.push(filters.requirementId);
      }
      if (filters.status) {
        where.push('t.status = ?');
        args.push(normalizeTaskStatus(filters.status));
      }
      if (filters.provider) {
        where.push('t.assigned_provider = ?');
        args.push(normalizeAgentProvider(filters.provider));
      }
      if (filters.assignee === 'unassigned') {
        where.push('t.assigned_provider IS NULL');
      }
      return query(`
        SELECT t.*, r.title AS requirement_title, r.priority AS requirement_priority
        FROM tasks t
        JOIN requirements r ON r.id = t.requirement_id
        WHERE ${where.join(' AND ')}
        ORDER BY
          CASE t.status WHEN 'blocked' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'claimed' THEN 2
            WHEN 'review' THEN 3 WHEN 'todo' THEN 4 WHEN 'done' THEN 5 ELSE 6 END,
          t.updated_at DESC
      `, args);
    },
    async findById(taskId: string) {
      return one(
        `SELECT t.*, r.title AS requirement_title, r.priority AS requirement_priority
         FROM tasks t JOIN requirements r ON r.id = t.requirement_id
         WHERE t.id = ? LIMIT 1`,
        [taskId],
      );
    },
    async create(data: {
      workspaceId: string;
      requirementId: string;
      title: string;
      description?: string | null;
      assignedProvider?: string | null;
      progress?: number | null;
      status?: string | null;
    }) {
      const now = nowIso();
      const status = normalizeTaskStatus(data.status, 'todo');
      const row = {
        id: id('task'),
        workspaceId: data.workspaceId,
        requirementId: data.requirementId,
        title: data.title.trim(),
        description: data.description || null,
        status,
        assignedProvider: data.assignedProvider ? normalizeAgentProvider(data.assignedProvider) : null,
        claimedAgentId: null,
        claimedAt: null,
        progress: typeof data.progress === 'number' ? Math.max(0, Math.min(100, Math.round(data.progress))) : null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      };
      await run(
        `INSERT INTO tasks
          (id, workspace_id, requirement_id, title, description, status, assigned_provider,
           claimed_agent_id, claimed_at, progress, archived_at, created_at, updated_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.workspaceId, row.requirementId, row.title, row.description, row.status,
          row.assignedProvider, null, null, row.progress, null, row.createdAt, row.updatedAt, row.lastActivityAt,
        ],
      );
      return row;
    },
    async update(taskId: string, data: Record<string, any>) {
      const current = await this.findById(taskId);
      if (!current) return null;
      const status = data.status !== undefined ? normalizeTaskStatus(data.status, current.status as any) : current.status;
      const next = {
        title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : current.title,
        description: data.description !== undefined ? data.description : current.description,
        status,
        assignedProvider: data.assignedProvider !== undefined
          ? (data.assignedProvider ? normalizeAgentProvider(data.assignedProvider) : null)
          : current.assignedProvider,
        claimedAgentId: data.claimedAgentId !== undefined ? data.claimedAgentId : current.claimedAgentId,
        claimedAt: data.claimedAt !== undefined ? data.claimedAt : current.claimedAt,
        progress: data.progress !== undefined
          ? (data.progress == null ? null : Math.max(0, Math.min(100, Math.round(Number(data.progress)))))
          : current.progress,
        lastActivityAt: nowIso(),
        updatedAt: nowIso(),
      };
      await run(
        `UPDATE tasks SET title = ?, description = ?, status = ?, assigned_provider = ?,
          claimed_agent_id = ?, claimed_at = ?, progress = ?, updated_at = ?, last_activity_at = ?
         WHERE id = ?`,
        [
          next.title, next.description, next.status, next.assignedProvider, next.claimedAgentId,
          next.claimedAt, next.progress, next.updatedAt, next.lastActivityAt, taskId,
        ],
      );
      return this.findById(taskId);
    },
    async archive(taskId: string) {
      const archivedAt = nowIso();
      const result = await run(
        `UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`,
        [archivedAt, archivedAt, taskId],
      );
      return result.rowsAffected > 0;
    },
    async claim(taskId: string, agentId: string, provider: string) {
      const now = nowIso();
      const result = await run(
        `UPDATE tasks
         SET status = CASE WHEN status = 'todo' THEN 'claimed' ELSE status END,
             claimed_agent_id = ?, assigned_provider = COALESCE(assigned_provider, ?),
             claimed_at = ?, updated_at = ?, last_activity_at = ?
         WHERE id = ? AND archived_at IS NULL
           AND status IN ('todo','claimed')
           AND (assigned_provider IS NULL OR assigned_provider = ?)
           AND (claimed_agent_id IS NULL OR claimed_agent_id = ?)`,
        [agentId, normalizeAgentProvider(provider), now, now, now, taskId, normalizeAgentProvider(provider), agentId],
      );
      return { ok: result.rowsAffected > 0, task: await this.findById(taskId) };
    },
    async release(taskId: string, agentId: string) {
      const now = nowIso();
      const result = await run(
        `UPDATE tasks
         SET claimed_agent_id = NULL, claimed_at = NULL,
             status = CASE WHEN status IN ('claimed','in_progress','review') THEN 'todo' ELSE status END,
             updated_at = ?, last_activity_at = ?
         WHERE id = ? AND claimed_agent_id = ? AND archived_at IS NULL`,
        [now, now, taskId, agentId],
      );
      return { ok: result.rowsAffected > 0, task: await this.findById(taskId) };
    },
    async listActivities(taskId: string) {
      return query(
        `SELECT * FROM task_activities WHERE task_id = ? ORDER BY created_at DESC LIMIT 200`,
        [taskId],
      );
    },
    async addActivity(data: {
      workspaceId: string;
      taskId: string;
      actorType: string;
      actorId?: string | null;
      provider?: string | null;
      kind: string;
      statusFrom?: string | null;
      statusTo?: string | null;
      summary?: string | null;
      documentId?: string | null;
      metadata?: string | null;
    }) {
      const row = {
        id: id('act'),
        workspaceId: data.workspaceId,
        taskId: data.taskId,
        actorType: data.actorType,
        actorId: data.actorId || null,
        provider: data.provider ? normalizeAgentProvider(data.provider) : null,
        kind: data.kind,
        statusFrom: data.statusFrom || null,
        statusTo: data.statusTo || null,
        summary: data.summary || null,
        documentId: data.documentId || null,
        metadata: data.metadata || null,
        createdAt: nowIso(),
      };
      await run(
        `INSERT INTO task_activities
          (id, workspace_id, task_id, actor_type, actor_id, provider, kind,
           status_from, status_to, summary, document_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.workspaceId, row.taskId, row.actorType, row.actorId, row.provider,
          row.kind, row.statusFrom, row.statusTo, row.summary, row.documentId, row.metadata, row.createdAt,
        ],
      );
      return row;
    },
  },
  documents: {
    async list(workspaceId: string, includeArchived = false) {
      const where = includeArchived ? '' : 'AND d.archived_at IS NULL';
      return query(`
        SELECT d.*,
          (SELECT COUNT(*) FROM document_revisions dr WHERE dr.document_id = d.id) AS revision_count,
          (SELECT content_markdown FROM document_revisions dr WHERE dr.id = d.current_revision_id) AS content_markdown,
          (SELECT created_at FROM document_revisions dr WHERE dr.id = d.current_revision_id) AS revision_created_at
        FROM documents d
        WHERE d.workspace_id = ? ${where}
        ORDER BY d.updated_at DESC
      `, [workspaceId]);
    },
    async findById(documentId: string) {
      return one(`SELECT * FROM documents WHERE id = ? LIMIT 1`, [documentId]);
    },
    async create(data: {
      workspaceId: string;
      title: string;
      kind?: string | null;
      contentMarkdown?: string | null;
      createdByType?: string;
      createdById?: string | null;
    }) {
      const now = nowIso();
      const documentId = id('doc');
      const revisionId = id('rev');
      const kind = normalizeDocumentKind(data.kind, 'note');
      const content = data.contentMarkdown || '';
      await run(
        `INSERT INTO documents
          (id, workspace_id, title, kind, current_revision_id, archived_at,
           created_by_type, created_by_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          documentId, data.workspaceId, data.title.trim(), kind, revisionId, null,
          data.createdByType || 'human', data.createdById || null, now, now,
        ],
      );
      await run(
        `INSERT INTO document_revisions
          (id, document_id, workspace_id, revision_number, content_markdown, content_hash,
           base_revision_id, created_by_type, created_by_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionId, documentId, data.workspaceId, 1, content, hashWorkspaceToken(content),
          null, data.createdByType || 'human', data.createdById || null, now,
        ],
      );
      return this.findById(documentId);
    },
    async update(documentId: string, data: Record<string, any>) {
      const current = await this.findById(documentId);
      if (!current) return null;
      const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : current.title;
      const kind = data.kind !== undefined ? normalizeDocumentKind(data.kind, current.kind as any) : current.kind;
      await run(
        `UPDATE documents SET title = ?, kind = ?, updated_at = ? WHERE id = ?`,
        [title, kind, nowIso(), documentId],
      );
      return this.findById(documentId);
    },
    async archive(documentId: string) {
      const archivedAt = nowIso();
      const result = await run(
        `UPDATE documents SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`,
        [archivedAt, archivedAt, documentId],
      );
      return result.rowsAffected > 0;
    },
    async latestRevision(documentId: string) {
      return one(
        `SELECT * FROM document_revisions WHERE document_id = ? ORDER BY revision_number DESC LIMIT 1`,
        [documentId],
      );
    },
    async listRevisions(documentId: string) {
      return query(
        `SELECT * FROM document_revisions WHERE document_id = ? ORDER BY revision_number DESC`,
        [documentId],
      );
    },
    async findRevision(revisionId: string) {
      return one(`SELECT * FROM document_revisions WHERE id = ? LIMIT 1`, [revisionId]);
    },
    async addRevision(data: {
      documentId: string;
      workspaceId: string;
      contentMarkdown: string;
      baseRevisionId?: string | null;
      createdByType?: string;
      createdById?: string | null;
    }) {
      const latest = await this.latestRevision(data.documentId);
      if (!latest) return { conflict: true, latest: null };
      const expectedBase = data.baseRevisionId || null;
      const currentBase = latest.id;
      if (expectedBase !== currentBase) {
        return { conflict: true, latest };
      }
      const now = nowIso();
      const revision = {
        id: id('rev'),
        documentId: data.documentId,
        workspaceId: data.workspaceId,
        revisionNumber: Number(latest.revisionNumber) + 1,
        contentMarkdown: data.contentMarkdown,
        contentHash: hashWorkspaceToken(data.contentMarkdown),
        baseRevisionId: currentBase,
        createdByType: data.createdByType || 'human',
        createdById: data.createdById || null,
        createdAt: now,
      };
      await run(
        `INSERT INTO document_revisions
          (id, document_id, workspace_id, revision_number, content_markdown, content_hash,
           base_revision_id, created_by_type, created_by_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          revision.id, revision.documentId, revision.workspaceId, revision.revisionNumber,
          revision.contentMarkdown, revision.contentHash, revision.baseRevisionId,
          revision.createdByType, revision.createdById, revision.createdAt,
        ],
      );
      await run(
        `UPDATE documents SET current_revision_id = ?, updated_at = ? WHERE id = ?`,
        [revision.id, now, data.documentId],
      );
      return { conflict: false, revision };
    },
    async listLinks(documentId: string) {
      return query(
        `SELECT * FROM document_links WHERE document_id = ? ORDER BY created_at ASC`,
        [documentId],
      );
    },
    async addLink(documentId: string, targetType: 'requirement' | 'task', targetId: string) {
      await run(
        `INSERT OR IGNORE INTO document_links (document_id, target_type, target_id, created_at)
         VALUES (?, ?, ?, ?)`,
        [documentId, targetType, targetId, nowIso()],
      );
    },
    async removeLink(documentId: string, targetType: string, targetId: string) {
      const result = await run(
        `DELETE FROM document_links WHERE document_id = ? AND target_type = ? AND target_id = ?`,
        [documentId, targetType, targetId],
      );
      return result.rowsAffected > 0;
    },
  },
  assets: {
    async create(data: {
      workspaceId: string;
      documentId?: string | null;
      sha256: string;
      mime: string;
      size: number;
      originalName: string;
      storagePath: string;
    }) {
      const row = {
        id: id('asset'),
        workspaceId: data.workspaceId,
        documentId: data.documentId || null,
        sha256: data.sha256,
        mime: data.mime,
        size: data.size,
        originalName: data.originalName,
        storagePath: data.storagePath,
        createdAt: nowIso(),
        archivedAt: null,
      };
      await run(
        `INSERT INTO document_assets
          (id, workspace_id, document_id, sha256, mime, size, original_name, storage_path, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id, row.workspaceId, row.documentId, row.sha256, row.mime, row.size,
          row.originalName, row.storagePath, row.createdAt, null,
        ],
      );
      return row;
    },
    async findById(assetId: string) {
      return one(`SELECT * FROM document_assets WHERE id = ? AND archived_at IS NULL LIMIT 1`, [assetId]);
    },
    async findByHash(workspaceId: string, sha256: string) {
      return one(
        `SELECT * FROM document_assets WHERE workspace_id = ? AND sha256 = ? AND archived_at IS NULL LIMIT 1`,
        [workspaceId, sha256],
      );
    },
    async listByDocument(documentId: string) {
      return query(
        `SELECT * FROM document_assets WHERE document_id = ? AND archived_at IS NULL ORDER BY created_at ASC`,
        [documentId],
      );
    },
  },
};
