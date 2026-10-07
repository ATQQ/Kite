import { createHash } from 'node:crypto';

export const WORKSPACE_ROLES = ['frontend', 'backend', 'docs', 'demo', 'custom'] as const;
export const REQUIREMENT_STATUSES = ['draft', 'ready', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export const TASK_STATUSES = ['todo', 'claimed', 'in_progress', 'blocked', 'review', 'done', 'cancelled'] as const;
export const AGENT_PROVIDERS = ['cursor', 'claude', 'codex', 'workbuddy', 'trae', 'custom'] as const;
export const DOCUMENT_KINDS = ['spec', 'design', 'handoff', 'report', 'note'] as const;
export const ACTIVE_TASK_STATUSES = ['claimed', 'in_progress', 'review'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type WorkspaceActor = {
  type: 'human' | 'agent';
  id: string | null;
  provider: AgentProvider | null;
};

export function hashWorkspaceToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeWorkspaceRole(value: unknown): WorkspaceRole {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if ((WORKSPACE_ROLES as readonly string[]).includes(raw)) return raw as WorkspaceRole;
  return raw ? 'custom' : 'custom';
}

export function normalizeAgentProvider(value: unknown): AgentProvider {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if ((AGENT_PROVIDERS as readonly string[]).includes(raw)) return raw as AgentProvider;
  return raw ? 'custom' : 'codex';
}

export function normalizeTaskStatus(value: unknown, fallback: TaskStatus = 'todo'): TaskStatus {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (TASK_STATUSES as readonly string[]).includes(raw) ? raw as TaskStatus : fallback;
}

export function normalizeRequirementStatus(value: unknown, fallback: RequirementStatus = 'draft'): RequirementStatus {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (REQUIREMENT_STATUSES as readonly string[]).includes(raw) ? raw as RequirementStatus : fallback;
}

export function normalizeDocumentKind(value: unknown, fallback: DocumentKind = 'note'): DocumentKind {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (DOCUMENT_KINDS as readonly string[]).includes(raw) ? raw as DocumentKind : fallback;
}

export function deriveRequirementStatus(input: {
  statusMode?: string | null;
  manualStatus?: string | null;
  taskStatuses: Array<string | null | undefined>;
}): RequirementStatus {
  if (input.statusMode === 'manual') {
    return normalizeRequirementStatus(input.manualStatus, 'draft');
  }
  const statuses = input.taskStatuses
    .map((status) => normalizeTaskStatus(status, 'todo'))
    .filter(Boolean);
  if (statuses.length === 0) return 'draft';
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  const effective = statuses.filter((status) => status !== 'cancelled');
  if (effective.length > 0 && effective.every((status) => status === 'done')) return 'done';
  if (effective.some((status) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(status))) return 'in_progress';
  if (effective.some((status) => status === 'blocked')) return 'blocked';
  if (effective.every((status) => status === 'todo')) return 'ready';
  return 'draft';
}

export function deriveAgentState(input: {
  taskStatuses: Array<{ status?: string | null; lastActivityAt?: string | null }>;
}): 'working' | 'blocked' | 'idle' | 'stalled' {
  const open = input.taskStatuses.filter((task) =>
    task.status && !['done', 'cancelled'].includes(task.status),
  );
  if (open.length === 0) return 'idle';

  const working = open.filter((task) => (ACTIVE_TASK_STATUSES as readonly string[]).includes(task.status || ''));
  if (working.length === 0) return open.some((task) => task.status === 'blocked') ? 'blocked' : 'idle';

  const oldest = working.reduce((min, task) => {
    const ts = task.lastActivityAt ? Date.parse(task.lastActivityAt) : Date.now();
    return Math.min(min, Number.isFinite(ts) ? ts : Date.now());
  }, Date.now());
  if (Date.now() - oldest > 24 * 60 * 60 * 1000) return 'stalled';
  return 'working';
}

export function publicWorkspaceToken(prefix: string): string {
  return `${prefix}...`;
}

export function safeWorkspaceId(value: string): string {
  return `ws_${value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
}
