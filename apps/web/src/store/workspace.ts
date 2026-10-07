import { defineStore } from 'pinia'
import { ref } from 'vue'
import { apiUrl, pageUrl } from '../lib/base'

export type WorkspaceRole = 'frontend' | 'backend' | 'docs' | 'demo' | 'custom'
export type RequirementStatus = 'draft' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'cancelled'
export type TaskStatus = 'todo' | 'claimed' | 'in_progress' | 'blocked' | 'review' | 'done' | 'cancelled'
export type AgentProvider = 'cursor' | 'claude' | 'codex' | 'workbuddy' | 'trae' | 'custom'
export type DocumentKind = 'spec' | 'design' | 'handoff' | 'report' | 'note'

export interface Workspace {
  id: string
  name: string
  description?: string | null
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
  projectCount?: number
  requirementCount?: number
  taskCount?: number
  documentCount?: number
}

export interface WorkspaceProjectLink {
  workspaceId: string
  projectId: string
  role: WorkspaceRole
  sortOrder?: number
  name: string
  description?: string | null
  status?: string | null
  env?: string | null
  deployPath?: string
  lastDeployAt?: string | null
}

export interface Requirement {
  id: string
  workspaceId: string
  title: string
  description?: string | null
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  statusMode: 'auto' | 'manual'
  manualStatus?: RequirementStatus | null
  effectiveStatus: RequirementStatus
  derivedStatus: RequirementStatus
  acceptanceCriteria?: string | null
  archivedAt?: string | null
  projectIds: string[]
  tags: Array<{ id: string; name: string; color?: string | null }>
  taskCount?: number
  activeTaskCount?: number
  blockedTaskCount?: number
  doneTaskCount?: number
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  workspaceId: string
  requirementId: string
  requirementTitle?: string
  requirementPriority?: string
  title: string
  description?: string | null
  status: TaskStatus
  assignedProvider?: AgentProvider | null
  claimedAgentId?: string | null
  claimedAt?: string | null
  progress?: number | null
  lastActivityAt: string
  createdAt: string
  updatedAt: string
  activities?: TaskActivity[]
}

export interface TaskActivity {
  id: string
  kind: string
  actorType: string
  actorId?: string | null
  provider?: AgentProvider | null
  statusFrom?: string | null
  statusTo?: string | null
  summary?: string | null
  documentId?: string | null
  createdAt: string
}

export interface DocumentAsset {
  id: string
  documentId: string
  sha256: string
  mime: string
  size: number
  originalName: string
  createdAt: string
}

export interface WorkspaceDocument {
  id: string
  workspaceId: string
  title: string
  kind: DocumentKind
  currentRevisionId?: string | null
  latestRevision?: { id: string; revisionNumber: number; contentMarkdown: string; createdAt: string }
  contentMarkdown: string
  revision_count?: number
  revisionCount?: number
  links: Array<{ targetType: 'requirement' | 'task'; targetId: string }>
  revisions: Array<{ id: string; revisionNumber: number; contentMarkdown: string; createdAt: string }>
  assets: DocumentAsset[]
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkspaceAgent {
  id: string
  workspaceId: string
  provider: AgentProvider
  displayName: string
  state: 'working' | 'blocked' | 'idle' | 'stalled'
  openTaskIds: string[]
  lastSeenAt: string
}

export interface BoardSnapshot {
  generatedAt: string
  workspaceId: string
  agents: WorkspaceAgent[]
  tasks: Task[]
  requirements: Requirement[]
  unassigned: Task[]
  counts: { requirements: number; tasks: number; unassigned: number; documents: number; projects: number }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<Workspace[]>([])
  const current = ref<(Workspace & {
    projects: WorkspaceProjectLink[]
    requirements: Requirement[]
    documents: WorkspaceDocument[]
    agents: WorkspaceAgent[]
  }) | null>(null)
  const board = ref<BoardSnapshot | null>(null)
  const loading = ref(false)

  function token() {
    return localStorage.getItem('adminToken') || ''
  }

  async function apiFetch(endpoint: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers as Record<string, string> | undefined),
    }
    if (token()) headers.Authorization = `Bearer ${token()}`
    const res = await fetch(apiUrl(endpoint), { ...options, headers })
    if (res.status === 401) {
      localStorage.removeItem('adminToken')
      window.location.href = pageUrl('/login')
      throw new Error('Unauthorized')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err: any = new Error(data?.error || data?.message || `HTTP ${res.status}`)
      err.status = res.status
      err.data = data
      throw err
    }
    return data
  }

  async function fetchWorkspaces() {
    loading.value = true
    try {
      const data = await apiFetch('/workspaces')
      workspaces.value = Array.isArray(data) ? data : []
    } finally {
      loading.value = false
    }
  }

  async function createWorkspace(payload: { name: string; description?: string }) {
    const data = await apiFetch('/workspaces', { method: 'POST', body: JSON.stringify(payload) })
    await fetchWorkspaces()
    return data as { workspace: Workspace; token: string }
  }

  async function fetchWorkspace(id: string) {
    loading.value = true
    try {
      current.value = await apiFetch(`/workspaces/${id}`)
      return current.value
    } finally {
      loading.value = false
    }
  }

  async function updateWorkspace(id: string, payload: Partial<Workspace>) {
    const data = await apiFetch(`/workspaces/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
    current.value = current.value ? { ...current.value, ...data.workspace } : current.value
    return data
  }

  async function archiveWorkspace(id: string) {
    await apiFetch(`/workspaces/${id}`, { method: 'DELETE' })
    await fetchWorkspaces()
  }

  async function rotateToken(id: string) {
    return await apiFetch(`/workspaces/${id}/token/rotate`, { method: 'POST' }) as { token: string }
  }

  async function linkProject(workspaceId: string, projectId: string, role: WorkspaceRole, sortOrder = 0) {
    await apiFetch(`/workspaces/${workspaceId}/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ role, sortOrder }),
    })
    await fetchWorkspace(workspaceId)
  }

  async function unlinkProject(workspaceId: string, projectId: string) {
    await apiFetch(`/workspaces/${workspaceId}/projects/${projectId}`, { method: 'DELETE' })
    await fetchWorkspace(workspaceId)
  }

  async function createRequirement(workspaceId: string, payload: Record<string, unknown>) {
    const data = await apiFetch(`/workspaces/${workspaceId}/requirements`, { method: 'POST', body: JSON.stringify(payload) })
    await fetchWorkspace(workspaceId)
    return data.requirement as Requirement
  }

  async function updateRequirement(workspaceId: string, requirementId: string, payload: Record<string, unknown>) {
    const data = await apiFetch(`/workspaces/${workspaceId}/requirements/${requirementId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    await fetchWorkspace(workspaceId)
    return data.requirement as Requirement
  }

  async function archiveRequirement(workspaceId: string, requirementId: string) {
    await apiFetch(`/workspaces/${workspaceId}/requirements/${requirementId}`, { method: 'DELETE' })
    await fetchWorkspace(workspaceId)
  }

  async function createTask(workspaceId: string, payload: Record<string, unknown>) {
    const data = await apiFetch(`/workspaces/${workspaceId}/tasks`, { method: 'POST', body: JSON.stringify(payload) })
    await fetchBoard(workspaceId)
    return data.task as Task
  }

  async function updateTask(workspaceId: string, taskId: string, payload: Record<string, unknown>) {
    const data = await apiFetch(`/workspaces/${workspaceId}/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(payload) })
    await fetchBoard(workspaceId)
    return data.task as Task
  }

  async function assignTask(workspaceId: string, taskId: string, provider: AgentProvider | null) {
    const data = await apiFetch(`/workspaces/${workspaceId}/tasks/${taskId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    })
    await fetchBoard(workspaceId)
    return data.task as Task
  }

  async function fetchBoard(workspaceId: string) {
    board.value = await apiFetch(`/workspaces/${workspaceId}/board`)
    return board.value
  }

  async function fetchDocument(workspaceId: string, documentId: string) {
    return await apiFetch(`/workspaces/${workspaceId}/documents/${documentId}`) as WorkspaceDocument
  }

  async function createDocument(workspaceId: string, payload: Record<string, unknown>) {
    const data = await apiFetch(`/workspaces/${workspaceId}/documents`, { method: 'POST', body: JSON.stringify(payload) })
    await fetchWorkspace(workspaceId)
    return data.document as WorkspaceDocument
  }

  async function updateDocument(workspaceId: string, documentId: string, payload: Record<string, unknown>) {
    const data = await apiFetch(`/workspaces/${workspaceId}/documents/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    await fetchWorkspace(workspaceId)
    return data.document as WorkspaceDocument
  }

  async function commitDocument(workspaceId: string, documentId: string, contentMarkdown: string, baseRevisionId: string | null) {
    return await apiFetch(`/workspaces/${workspaceId}/documents/${documentId}/revisions`, {
      method: 'POST',
      body: JSON.stringify({ contentMarkdown, baseRevisionId }),
    })
  }

  async function linkDocument(workspaceId: string, documentId: string, targetType: 'requirement' | 'task', targetId: string) {
    await apiFetch(`/workspaces/${workspaceId}/documents/${documentId}/links`, {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId }),
    })
  }

  async function unlinkDocument(workspaceId: string, documentId: string, targetType: 'requirement' | 'task', targetId: string) {
    await apiFetch(`/workspaces/${workspaceId}/documents/${documentId}/links/${targetType}/${targetId}`, {
      method: 'DELETE',
    })
  }

  async function uploadDocumentAsset(workspaceId: string, documentId: string, file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(apiUrl(`/workspaces/${workspaceId}/documents/${documentId}/assets`), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
      body: form,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(data?.error || 'Upload failed')
    return data.asset as DocumentAsset
  }

  async function fetchAssetBlob(workspaceId: string, assetId: string) {
    const res = await fetch(apiUrl(`/workspaces/${workspaceId}/assets/${assetId}`), {
      headers: { Authorization: `Bearer ${token()}` },
    })
    if (!res.ok) throw new Error('Asset not found')
    return await res.blob()
  }

  return {
    workspaces,
    current,
    board,
    loading,
    fetchWorkspaces,
    createWorkspace,
    fetchWorkspace,
    updateWorkspace,
    archiveWorkspace,
    rotateToken,
    linkProject,
    unlinkProject,
    createRequirement,
    updateRequirement,
    archiveRequirement,
    createTask,
    updateTask,
    assignTask,
    fetchBoard,
    fetchDocument,
    createDocument,
    updateDocument,
    commitDocument,
    linkDocument,
    unlinkDocument,
    uploadDocumentAsset,
    fetchAssetBlob,
  }
})
