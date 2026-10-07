<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Boxes,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  FileText,
  History,
  ImagePlus,
  KeyRound,
  Link2,
  ListChecks,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Unlink,
} from 'lucide-vue-next'
import WorkspaceBoard3D from '../components/WorkspaceBoard3D.vue'
import ProviderLogo from '../components/ProviderLogo.vue'
import { useToast } from '../composables/useToast'
import { apiUrl } from '../lib/base'
import { useProjectStore } from '../store/project'
import {
  useWorkspaceStore,
  type AgentProvider,
  type DocumentKind,
  type Requirement,
  type RequirementStatus,
  type Task,
  type TaskStatus,
  type WorkspaceAgent,
  type WorkspaceDocument,
  type WorkspaceRole,
} from '../store/workspace'

type WorkspaceTab = 'overview' | 'requirements' | 'documents' | 'agents'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const store = useWorkspaceStore()
const projectStore = useProjectStore()

const workspaceId = computed(() => String(route.params.id || ''))
const current = computed(() => store.current)
const activeTab = ref<WorkspaceTab>('overview')
const realtimeConnected = ref(false)
const tokenIssued = ref('')
const rotatingToken = ref(false)

const requirements = computed<Requirement[]>(() => store.board?.requirements || current.value?.requirements || [])
const workspaceTasks = computed<Task[]>(() => store.board?.tasks || [])
const agents = computed<WorkspaceAgent[]>(() => store.board?.agents || current.value?.agents || [])
const unassignedTasks = computed<Task[]>(() => store.board?.unassigned || [])

const selectedRequirementId = ref('')
const selectedRequirement = computed(() =>
  requirements.value.find((item) => item.id === selectedRequirementId.value) || null,
)
const selectedRequirementTasks = computed(() =>
  workspaceTasks.value.filter((task) => task.requirementId === selectedRequirementId.value),
)
const selectedTaskId = ref('')
const selectedTask = computed(() =>
  workspaceTasks.value.find((task) => task.id === selectedTaskId.value) || null,
)

const projectLinkDraft = reactive<{ projectId: string; role: WorkspaceRole }>({
  projectId: '',
  role: 'frontend',
})
const availableProjects = computed(() => {
  const linked = new Set((current.value?.projects || []).map((item) => item.projectId))
  return projectStore.projects.filter((project) => !linked.has(project.id))
})

const showRequirementCreate = ref(false)
const showAcceptanceFields = ref(false)
const requirementDraft = reactive({
  title: '',
  description: '',
  priority: 'P2',
  acceptanceCriteria: '',
  projectIds: [] as string[],
})
const editingRequirementId = ref('')
const requirementEdit = reactive({
  title: '',
  description: '',
  priority: 'P2',
  statusMode: 'auto' as 'auto' | 'manual',
  manualStatus: 'draft' as RequirementStatus,
  acceptanceCriteria: '',
  projectIds: [] as string[],
})

const taskDraft = reactive({
  title: '',
  description: '',
  assignedProvider: '' as AgentProvider | '',
})
const showTaskCreate = ref(false)

const selectedDocumentId = ref('')
const activeDocument = ref<WorkspaceDocument | null>(null)
const documentLoading = ref(false)
const documentContent = ref('')
const documentTitle = ref('')
const documentKind = ref<DocumentKind>('note')
const documentMode = ref<'edit' | 'preview'>('preview')
const documentLinkRequirement = ref('')
const documentLinkTask = ref('')
const conflictLatest = ref<{ id: string; revisionNumber: number } | null>(null)
const viewingRevisionId = ref('')
const assetBlobUrls = ref<Record<string, string>>({})
const imageInput = ref<HTMLInputElement | null>(null)
const previewPane = ref<HTMLElement | null>(null)

const newDocument = reactive({
  title: '',
  kind: 'note' as DocumentKind,
  contentMarkdown: '',
})
const showDocumentCreate = ref(false)

const roleOptions: WorkspaceRole[] = ['frontend', 'backend', 'docs', 'demo', 'custom']
const providerOptions: AgentProvider[] = ['cursor', 'claude', 'codex', 'workbuddy', 'trae', 'custom']
const requirementStatuses: RequirementStatus[] = ['draft', 'ready', 'in_progress', 'blocked', 'done', 'cancelled']
const taskStatuses: TaskStatus[] = ['todo', 'claimed', 'in_progress', 'blocked', 'review', 'done', 'cancelled']
const documentKinds: DocumentKind[] = ['spec', 'design', 'handoff', 'report', 'note']

const taskBoardColumns: Array<{ id: string; labelKey: string; states: TaskStatus[] }> = [
  { id: 'todo', labelKey: 'workspace.taskTodo', states: ['todo'] },
  { id: 'active', labelKey: 'workspace.statusInProgress', states: ['claimed', 'in_progress'] },
  { id: 'review', labelKey: 'workspace.taskReview', states: ['review'] },
  { id: 'blocked', labelKey: 'workspace.statusBlocked', states: ['blocked'] },
  { id: 'done', labelKey: 'workspace.statusDone', states: ['done', 'cancelled'] },
]

let eventAbort: AbortController | null = null
let pollTimer: number | undefined
let reconnectTimer: number | undefined
let refreshTimer: number | undefined
let disposed = false

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('adminToken') || ''}` }
}

function roleLabel(role: string) {
  const key = `workspace.projectRole${role.charAt(0).toUpperCase()}${role.slice(1)}`
  return t(key)
}

function requirementStatusLabel(status: RequirementStatus | string | null | undefined) {
  const map: Record<string, string> = {
    draft: 'workspace.statusDraft',
    ready: 'workspace.statusReady',
    in_progress: 'workspace.statusInProgress',
    blocked: 'workspace.statusBlocked',
    done: 'workspace.statusDone',
    cancelled: 'workspace.statusCancelled',
  }
  return t(map[String(status)] || 'common.pending')
}

function taskStatusLabel(status: TaskStatus | string | null | undefined) {
  const map: Record<string, string> = {
    todo: 'workspace.taskTodo',
    claimed: 'workspace.taskClaimed',
    in_progress: 'workspace.statusInProgress',
    blocked: 'workspace.statusBlocked',
    review: 'workspace.taskReview',
    done: 'workspace.statusDone',
    cancelled: 'workspace.statusCancelled',
  }
  return t(map[String(status)] || 'common.pending')
}

function agentStateLabel(state: string) {
  const map: Record<string, string> = {
    working: 'workspace.working',
    idle: 'workspace.idle',
    blocked: 'workspace.blocked',
    stalled: 'workspace.stalled',
  }
  return t(map[state] || 'workspace.idle')
}

function documentKindLabel(kind: string) {
  const map: Record<string, string> = {
    spec: 'workspace.docKindSpec',
    design: 'workspace.docKindDesign',
    handoff: 'workspace.docKindHandoff',
    report: 'workspace.docKindReport',
    note: 'workspace.docKindNote',
  }
  return t(map[kind] || 'workspace.docKindNote')
}

function statusClass(status: string | null | undefined) {
  if (status === 'done') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
  if (status === 'blocked') return 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  if (status === 'cancelled' || status === 'stalled') return 'border-red-500/40 bg-red-500/10 text-red-300'
  if (status === 'in_progress' || status === 'working' || status === 'claimed' || status === 'review') {
    return 'border-sky-500/40 bg-sky-500/10 text-sky-300'
  }
  return 'border-border bg-base text-textMuted'
}

function columnDotClass(columnId: string) {
  if (columnId === 'active') return 'bg-sky-400'
  if (columnId === 'review') return 'bg-violet-400'
  if (columnId === 'blocked') return 'bg-amber-400'
  if (columnId === 'done') return 'bg-emerald-400'
  return 'bg-slate-400'
}

function tasksByColumn(states: TaskStatus[]) {
  return selectedRequirementTasks.value.filter((task) => states.includes(task.status))
}

function providerLabel(provider: string | null | undefined) {
  if (!provider) return t('workspace.unassigned')
  const map: Record<string, string> = {
    cursor: 'Cursor',
    claude: 'Claude',
    codex: 'Codex',
    workbuddy: 'WorkBuddy',
    trae: 'Trae',
    custom: 'Custom',
  }
  return map[provider] || provider
}

function clampProgress(value: number | null | undefined) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)))
}

function formatTime(value?: string | null) {
  if (!value) return '-'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '-' : time.toLocaleString()
}

function scheduleRefresh() {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(async () => {
    try {
      await Promise.all([store.fetchWorkspace(workspaceId.value), store.fetchBoard(workspaceId.value)])
    } catch {
      /* transient refresh failures are retried by SSE or polling */
    }
  }, 250)
}

function startPolling() {
  if (pollTimer) return
  pollTimer = window.setInterval(scheduleRefresh, 15000)
}

function stopPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = undefined
}

async function connectRealtime() {
  stopPolling()
  eventAbort?.abort()
  const controller = new AbortController()
  eventAbort = controller
  try {
    const response = await fetch(apiUrl(`/workspaces/${workspaceId.value}/events`), {
      headers: { ...authHeaders(), Accept: 'text/event-stream' },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`SSE ${response.status}`)
    realtimeConnected.value = true
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!disposed) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() || ''
      for (const block of blocks) {
        const eventName = block.split('\n').find((line) => line.startsWith('event:'))?.slice(6).trim()
        if (eventName && eventName !== 'ready') scheduleRefresh()
      }
    }
    throw new Error('SSE closed')
  } catch {
    if (controller.signal.aborted || disposed) return
    realtimeConnected.value = false
    startPolling()
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    reconnectTimer = window.setTimeout(connectRealtime, 30000)
  }
}

function revokeAssetUrls() {
  for (const url of Object.values(assetBlobUrls.value)) URL.revokeObjectURL(url)
  assetBlobUrls.value = {}
}

async function loadDocumentAssets(document: WorkspaceDocument) {
  revokeAssetUrls()
  const next: Record<string, string> = {}
  await Promise.all((document.assets || []).map(async (asset) => {
    try {
      next[asset.id] = URL.createObjectURL(await store.fetchAssetBlob(workspaceId.value, asset.id))
    } catch {
      /* missing or unauthorized assets stay unresolved */
    }
  }))
  assetBlobUrls.value = next
}

async function loadDocument(documentId: string) {
  if (!documentId) {
    activeDocument.value = null
    return
  }
  documentLoading.value = true
  try {
    const document = await store.fetchDocument(workspaceId.value, documentId)
    activeDocument.value = document
    documentTitle.value = document.title
    documentKind.value = document.kind
    documentContent.value = document.contentMarkdown || document.latestRevision?.contentMarkdown || ''
    conflictLatest.value = null
    viewingRevisionId.value = document.currentRevisionId || document.latestRevision?.id || document.revisions[0]?.id || ''
    await loadDocumentAssets(document)
  } catch (error: any) {
    toast.error(error.message || t('common.requestFailed'))
  } finally {
    documentLoading.value = false
  }
}

const previewHtml = computed(() => {
  let html = marked.parse(documentContent.value || '', { breaks: true }) as string
  for (const [assetId, url] of Object.entries(assetBlobUrls.value)) {
    html = html.split(`asset://${assetId}`).join(url)
  }
  return DOMPurify.sanitize(html)
})

const latestRevisionId = computed(() => activeDocument.value?.currentRevisionId || activeDocument.value?.latestRevision?.id || '')
const viewingRevision = computed(() => activeDocument.value?.revisions.find((revision) => revision.id === viewingRevisionId.value) || null)
const viewingHistory = computed(() => Boolean(viewingRevisionId.value && viewingRevisionId.value !== latestRevisionId.value))

function scrollPreviewTop() {
  void nextTick(() => {
    if (previewPane.value) previewPane.value.scrollTop = 0
  })
}

function selectRevision(revision: { id: string; contentMarkdown: string }) {
  viewingRevisionId.value = revision.id
  documentContent.value = revision.contentMarkdown
  documentMode.value = 'preview'
  scrollPreviewTop()
}

function backToLatestRevision() {
  if (!activeDocument.value) return
  viewingRevisionId.value = latestRevisionId.value
  documentContent.value = activeDocument.value.latestRevision?.contentMarkdown ?? activeDocument.value.contentMarkdown ?? ''
  scrollPreviewTop()
}

async function restoreViewedRevision() {
  const revision = viewingRevision.value
  if (!revision) return
  documentContent.value = revision.contentMarkdown
  viewingRevisionId.value = latestRevisionId.value
  await commitRevision()
}

async function loadWorkspace() {
  if (!workspaceId.value) return
  await Promise.all([
    store.fetchWorkspace(workspaceId.value),
    store.fetchBoard(workspaceId.value),
    projectStore.fetchProjects(),
  ])
  if (!selectedRequirementId.value && requirements.value[0]) {
    selectedRequirementId.value = requirements.value[0].id
  }
  if (!selectedDocumentId.value && current.value?.documents[0]) {
    selectedDocumentId.value = current.value.documents[0].id
  }
}

async function refreshAll() {
  try {
    await loadWorkspace()
    if (activeDocument.value) await loadDocument(activeDocument.value.id)
  } catch (error: any) {
    toast.error(error.message || t('common.requestFailed'))
  }
}

async function linkProject() {
  if (!projectLinkDraft.projectId) return
  try {
    await store.linkProject(workspaceId.value, projectLinkDraft.projectId, projectLinkDraft.role)
    projectLinkDraft.projectId = ''
    await store.fetchBoard(workspaceId.value)
    toast.success(t('common.saveSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.saveFailed'))
  }
}

async function updateProjectRole(projectId: string, role: WorkspaceRole) {
  try {
    await store.linkProject(workspaceId.value, projectId, role)
    await store.fetchBoard(workspaceId.value)
  } catch (error: any) {
    toast.error(error.message || t('common.saveFailed'))
  }
}

async function unlinkProject(projectId: string) {
  try {
    await store.unlinkProject(workspaceId.value, projectId)
    await store.fetchBoard(workspaceId.value)
  } catch (error: any) {
    toast.error(error.message || t('common.deleteFailed'))
  }
}

async function rotateToken() {
  if (!window.confirm(t('workspace.rotateConfirm'))) return
  rotatingToken.value = true
  try {
    const result = await store.rotateToken(workspaceId.value)
    tokenIssued.value = result.token
    await navigator.clipboard.writeText(result.token)
    toast.success(t('workspace.tokenCopied'))
  } catch (error: any) {
    toast.error(error.message || t('common.requestFailed'))
  } finally {
    rotatingToken.value = false
  }
}

async function copyIssuedToken() {
  if (!tokenIssued.value) return
  await navigator.clipboard.writeText(tokenIssued.value)
  toast.success(t('workspace.tokenCopied'))
}

async function createRequirement() {
  if (!requirementDraft.title.trim()) return
  try {
    const created = await store.createRequirement(workspaceId.value, { ...requirementDraft })
    selectedRequirementId.value = created.id
    requirementDraft.title = ''
    requirementDraft.description = ''
    requirementDraft.acceptanceCriteria = ''
    requirementDraft.projectIds = []
    showRequirementCreate.value = false
    showAcceptanceFields.value = false
    await store.fetchBoard(workspaceId.value)
    toast.success(t('common.createSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.createFailed'))
  }
}

function startRequirementEdit(requirement: Requirement) {
  editingRequirementId.value = requirement.id
  requirementEdit.title = requirement.title
  requirementEdit.description = requirement.description || ''
  requirementEdit.priority = requirement.priority
  requirementEdit.statusMode = requirement.statusMode
  requirementEdit.manualStatus = requirement.manualStatus || requirement.effectiveStatus
  requirementEdit.acceptanceCriteria = requirement.acceptanceCriteria || ''
  requirementEdit.projectIds = [...requirement.projectIds]
}

async function saveRequirementEdit() {
  if (!editingRequirementId.value) return
  try {
    await store.updateRequirement(workspaceId.value, editingRequirementId.value, { ...requirementEdit })
    editingRequirementId.value = ''
    await store.fetchBoard(workspaceId.value)
    toast.success(t('common.saveSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.saveFailed'))
  }
}

async function archiveRequirement(requirementId: string) {
  if (!window.confirm(t('common.confirmDelete'))) return
  try {
    await store.archiveRequirement(workspaceId.value, requirementId)
    selectedRequirementId.value = requirements.value.find((item) => item.id !== requirementId)?.id || ''
    toast.success(t('common.deleteSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.deleteFailed'))
  }
}

async function createTask() {
  if (!selectedRequirement.value || !taskDraft.title.trim()) return
  try {
    const task = await store.createTask(workspaceId.value, {
      requirementId: selectedRequirement.value.id,
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim() || undefined,
      assignedProvider: taskDraft.assignedProvider || undefined,
    })
    selectedTaskId.value = task.id
    taskDraft.title = ''
    taskDraft.description = ''
    taskDraft.assignedProvider = ''
    showTaskCreate.value = false
    await store.fetchWorkspace(workspaceId.value)
    toast.success(t('common.createSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.createFailed'))
  }
}

async function assignTask(taskId: string, provider: AgentProvider | null) {
  try {
    await store.assignTask(workspaceId.value, taskId, provider)
    await store.fetchWorkspace(workspaceId.value)
    toast.success(t('common.updateSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.updateFailed'))
  }
}

async function updateTaskStatus(taskId: string, status: TaskStatus) {
  try {
    await store.updateTask(workspaceId.value, taskId, { status, summary: `Status changed to ${status}` })
    await store.fetchWorkspace(workspaceId.value)
  } catch (error: any) {
    toast.error(error.message || t('common.updateFailed'))
  }
}

async function selectDocument(documentId: string) {
  selectedDocumentId.value = documentId
}

async function createDocument() {
  if (!newDocument.title.trim()) return
  try {
    const created = await store.createDocument(workspaceId.value, {
      title: newDocument.title.trim(),
      kind: newDocument.kind,
      contentMarkdown: newDocument.contentMarkdown,
      links: [
        ...(documentLinkRequirement.value ? [{ targetType: 'requirement', targetId: documentLinkRequirement.value }] : []),
        ...(documentLinkTask.value ? [{ targetType: 'task', targetId: documentLinkTask.value }] : []),
      ],
    })
    selectedDocumentId.value = created.id
    newDocument.title = ''
    newDocument.contentMarkdown = ''
    showDocumentCreate.value = false
    await loadDocument(created.id)
    await store.fetchBoard(workspaceId.value)
    toast.success(t('common.createSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.createFailed'))
  }
}

async function saveDocumentMeta() {
  if (!activeDocument.value) return
  try {
    const updated = await store.updateDocument(workspaceId.value, activeDocument.value.id, {
      title: documentTitle.value,
      kind: documentKind.value,
    })
    activeDocument.value = updated
    toast.success(t('common.saveSuccess'))
  } catch (error: any) {
    toast.error(error.message || t('common.saveFailed'))
  }
}

async function commitRevision(baseRevisionId?: string | null) {
  if (!activeDocument.value) return
  try {
    await store.commitDocument(
      workspaceId.value,
      activeDocument.value.id,
      documentContent.value,
      baseRevisionId ?? activeDocument.value.currentRevisionId ?? activeDocument.value.latestRevision?.id ?? null,
    )
    conflictLatest.value = null
    await loadDocument(activeDocument.value.id)
    await store.fetchWorkspace(workspaceId.value)
    await store.fetchBoard(workspaceId.value)
    toast.success(t('common.saveSuccess'))
  } catch (error: any) {
    if (error.status === 409) {
      conflictLatest.value = error.data?.latest || null
      toast.warning(t('workspace.conflict'))
      return
    }
    toast.error(error.message || t('common.saveFailed'))
  }
}

function reloadConflictedDocument() {
  if (!activeDocument.value) return
  const latest = conflictLatest.value
  conflictLatest.value = null
  if (latest?.id) {
    activeDocument.value = { ...activeDocument.value, latestRevision: latest as any }
  }
  void loadDocument(activeDocument.value.id)
}

async function uploadImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !activeDocument.value) return
  try {
    const asset = await store.uploadDocumentAsset(workspaceId.value, activeDocument.value.id, file)
    assetBlobUrls.value = { ...assetBlobUrls.value, [asset.id]: URL.createObjectURL(file) }
    documentContent.value = `${documentContent.value.trimEnd()}\n\n![${asset.originalName}](asset://${asset.id})\n`
    input.value = ''
    toast.success(t('common.upload'))
  } catch (error: any) {
    toast.error(error.message || t('common.upload'))
  }
}

async function linkDocument() {
  if (!activeDocument.value) return
  try {
    if (documentLinkRequirement.value) {
      await store.linkDocument(workspaceId.value, activeDocument.value.id, 'requirement', documentLinkRequirement.value)
    }
    if (documentLinkTask.value) {
      await store.linkDocument(workspaceId.value, activeDocument.value.id, 'task', documentLinkTask.value)
    }
    documentLinkRequirement.value = ''
    documentLinkTask.value = ''
    await loadDocument(activeDocument.value.id)
  } catch (error: any) {
    toast.error(error.message || t('common.saveFailed'))
  }
}

async function unlinkDocument(targetType: 'requirement' | 'task', targetId: string) {
  if (!activeDocument.value) return
  try {
    await store.unlinkDocument(workspaceId.value, activeDocument.value.id, targetType, targetId)
    await loadDocument(activeDocument.value.id)
  } catch (error: any) {
    toast.error(error.message || t('common.deleteFailed'))
  }
}

function selectTask(task: Task) {
  selectedTaskId.value = task.id
  activeTab.value = 'agents'
}

function selectAgent(agent: WorkspaceAgent) {
  selectedTaskId.value = agent.openTaskIds[0] || ''
  activeTab.value = 'agents'
}

watch(workspaceId, async () => {
  selectedRequirementId.value = ''
  selectedDocumentId.value = ''
  selectedTaskId.value = ''
  activeDocument.value = null
  await loadWorkspace()
  await connectRealtime()
})

watch(selectedDocumentId, (documentId) => {
  if (documentId) void loadDocument(documentId)
})

onMounted(async () => {
  await loadWorkspace()
  await connectRealtime()
})

onBeforeUnmount(() => {
  disposed = true
  eventAbort?.abort()
  stopPolling()
  if (reconnectTimer) window.clearTimeout(reconnectTimer)
  if (refreshTimer) window.clearTimeout(refreshTimer)
  revokeAssetUrls()
})
</script>

<template>
  <div class="mx-auto max-w-[1600px] space-y-5">
    <div v-if="!current && store.loading" class="flex h-80 items-center justify-center text-textMuted">
      <Loader2 class="h-5 w-5 animate-spin" />
    </div>

    <template v-else-if="current">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <button class="mb-3 inline-flex items-center gap-1.5 text-xs text-textMuted hover:text-textMain" @click="router.push('/workspaces')">
            <ArrowLeft class="h-3.5 w-3.5" />
            {{ t('workspace.back') }}
          </button>
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Boxes class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <h1 class="truncate text-2xl font-semibold text-textMain">{{ current.name }}</h1>
              <p class="mt-1 truncate text-sm text-textMuted">{{ current.description || t('workspace.noDescription') }}</p>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs" :class="realtimeConnected ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-border bg-panel text-textMuted'">
            <span class="h-1.5 w-1.5 rounded-full" :class="realtimeConnected ? 'bg-emerald-400' : 'bg-slate-500'" />
            {{ realtimeConnected ? t('workspace.realtime') : t('workspace.polling') }}
          </span>
          <button class="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-panel px-3 text-sm text-textMuted hover:text-textMain" @click="refreshAll">
            <RefreshCw class="h-4 w-4" />
            {{ t('common.refresh') }}
          </button>
        </div>
      </header>

      <nav class="flex flex-wrap gap-1 border-b border-border">
        <button
          v-for="tab in ([
            { id: 'overview', label: t('workspace.overview'), icon: ClipboardList },
            { id: 'requirements', label: t('workspace.requirementsTitle'), icon: ListChecks },
            { id: 'documents', label: t('workspace.docsTitle'), icon: FileText },
            { id: 'agents', label: t('workspace.agentsTitle'), icon: Bot },
          ] as const)"
          :key="tab.id"
          class="-mb-px inline-flex h-10 items-center gap-2 border-b-2 px-3 text-sm transition-colors"
          :class="activeTab === tab.id ? 'border-primary text-primary' : 'border-transparent text-textMuted hover:text-textMain'"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-4 w-4" />
          {{ tab.label }}
        </button>
      </nav>

      <section v-if="activeTab === 'overview'" class="grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
        <div class="space-y-5">
          <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div v-for="item in [
              { label: t('workspace.projects'), value: current.projects.length, icon: Link2 },
              { label: t('workspace.requirements'), value: requirements.length, icon: ListChecks },
              { label: t('workspace.tasks'), value: workspaceTasks.length, icon: Activity },
              { label: t('workspace.documents'), value: current.documents.length, icon: FileText },
            ]" :key="item.label" class="rounded-lg border border-border bg-panel p-4">
              <div class="flex items-center justify-between">
                <span class="text-xs text-textMuted">{{ item.label }}</span>
                <component :is="item.icon" class="h-4 w-4 text-primary" />
              </div>
              <div class="mt-3 text-2xl font-semibold tabular-nums text-textMain">{{ item.value }}</div>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-panel">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.linkedProjects') }}</h2>
                <p class="mt-1 text-xs text-textMuted">{{ current.projects.length }} / {{ projectStore.projects.length }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <select v-model="projectLinkDraft.projectId" class="h-9 min-w-44 rounded-md border border-border bg-base px-2 text-sm text-textMain outline-none focus:border-primary">
                  <option value="">{{ t('workspace.selectProject') }}</option>
                  <option v-for="project in availableProjects" :key="project.id" :value="project.id">{{ project.name }}</option>
                </select>
                <select v-model="projectLinkDraft.role" class="h-9 rounded-md border border-border bg-base px-2 text-sm text-textMain outline-none focus:border-primary">
                  <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabel(role) }}</option>
                </select>
                <button class="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white disabled:opacity-50" :disabled="!projectLinkDraft.projectId" @click="linkProject">
                  <Link2 class="h-4 w-4" />
                  {{ t('workspace.link') }}
                </button>
              </div>
            </div>
            <div v-if="current.projects.length === 0" class="px-5 py-12 text-center text-sm text-textMuted">{{ t('workspace.noProjects') }}</div>
            <div v-else class="divide-y divide-border">
              <div v-for="link in current.projects" :key="link.projectId" class="flex flex-wrap items-center gap-3 px-5 py-3">
                <button class="min-w-0 flex-1 text-left" @click="router.push(`/projects/${link.projectId}`)">
                  <div class="truncate text-sm font-medium text-textMain">{{ link.name }}</div>
                  <div class="mt-0.5 truncate text-xs text-textMuted">{{ link.deployPath }}</div>
                </button>
                <span class="hidden text-xs text-textMuted lg:inline">{{ formatTime(link.lastDeployAt) }}</span>
                <select :value="link.role" class="h-8 rounded-md border border-border bg-base px-2 text-xs text-textMain" @change="updateProjectRole(link.projectId, ($event.target as HTMLSelectElement).value as WorkspaceRole)">
                  <option v-for="role in roleOptions" :key="role" :value="role">{{ roleLabel(role) }}</option>
                </select>
                <button class="rounded-md p-2 text-textMuted hover:bg-danger/10 hover:text-danger" :title="t('workspace.unlink')" @click="unlinkProject(link.projectId)">
                  <Unlink class="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside class="space-y-5">
          <div class="rounded-lg border border-border bg-panel p-5">
            <div class="flex items-center gap-2">
              <KeyRound class="h-4 w-4 text-primary" />
              <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.token') }}</h2>
            </div>
            <div v-if="tokenIssued" class="mt-4">
              <code class="block break-all rounded-md border border-warning/40 bg-warning/5 p-3 font-mono text-xs text-textMain">{{ tokenIssued }}</code>
              <button class="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-textMain" @click="copyIssuedToken">
                <Copy class="h-3.5 w-3.5" />
                {{ t('workspace.copy') }}
              </button>
            </div>
            <p v-else class="mt-3 text-xs text-textMuted">{{ t('workspace.tokenHint') }}</p>
            <button class="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-warning/40 bg-warning/5 text-sm text-warning hover:bg-warning/10 disabled:opacity-50" :disabled="rotatingToken" @click="rotateToken">
              <RefreshCw class="h-4 w-4" :class="rotatingToken ? 'animate-spin' : ''" />
              {{ t('workspace.rotateToken') }}
            </button>
          </div>

          <div class="rounded-lg border border-border bg-panel p-5">
            <div class="flex items-center justify-between">
              <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.pendingPool') }}</h2>
              <span class="rounded-full border border-border px-2 py-0.5 text-xs tabular-nums text-textMuted">{{ unassignedTasks.length }}</span>
            </div>
            <div v-if="unassignedTasks.length === 0" class="py-8 text-center text-xs text-textMuted">{{ t('workspace.noPending') }}</div>
            <button v-for="task in unassignedTasks.slice(0, 6)" :key="task.id" class="mt-2 flex w-full items-start gap-2 rounded-md border border-border bg-base px-3 py-2 text-left hover:border-primary/40" @click="selectTask(task)">
              <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" />
              <span class="min-w-0">
                <span class="block truncate text-xs font-medium text-textMain">{{ task.title }}</span>
                <span class="mt-0.5 block truncate text-[11px] text-textMuted">{{ task.requirementTitle }}</span>
              </span>
            </button>
          </div>
        </aside>
      </section>

      <section v-else-if="activeTab === 'requirements'" class="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div class="rounded-lg border border-border bg-panel">
          <div class="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.requirementsTitle') }}</h2>
              <p class="mt-0.5 text-xs text-textMuted">{{ requirements.length }}</p>
            </div>
            <button class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white" @click="showRequirementCreate = !showRequirementCreate">
              <Plus class="h-3.5 w-3.5" />
              {{ t('workspace.newRequirement') }}
            </button>
          </div>

          <form v-if="showRequirementCreate" class="space-y-3 border-b border-border bg-base/60 p-4" @submit.prevent="createRequirement">
            <input v-model="requirementDraft.title" class="h-9 w-full rounded-md border border-border bg-base px-3 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.titleLabel')" />
            <textarea v-model="requirementDraft.description" rows="3" class="w-full rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.description')" />
            <select v-model="requirementDraft.priority" class="h-9 w-full rounded-md border border-border bg-base px-2 text-sm text-textMain">
              <option v-for="priority in ['P0', 'P1', 'P2', 'P3']" :key="priority" :value="priority">{{ priority }}</option>
            </select>
            <textarea v-if="showAcceptanceFields" v-model="requirementDraft.acceptanceCriteria" rows="2" class="w-full rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.acceptance')" />
            <button type="button" class="inline-flex items-center gap-1 text-xs text-textMuted hover:text-textMain" @click="showAcceptanceFields = !showAcceptanceFields">
              <component :is="showAcceptanceFields ? ChevronUp : ChevronDown" class="h-3.5 w-3.5" />
              {{ showAcceptanceFields ? t('workspace.hideAcceptance') : t('workspace.addAcceptance') }}
            </button>
            <div class="flex justify-end gap-2">
              <button type="button" class="h-8 rounded-md border border-border px-3 text-xs text-textMuted" @click="showRequirementCreate = false">{{ t('common.cancel') }}</button>
              <button class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-white disabled:opacity-50" :disabled="!requirementDraft.title.trim()">{{ t('workspace.createRequirement') }}</button>
            </div>
          </form>

          <div v-if="requirements.length === 0" class="px-4 py-14 text-center text-sm text-textMuted">{{ t('workspace.noRequirements') }}</div>
          <div v-else class="max-h-[720px] divide-y divide-border overflow-y-auto">
            <button
              v-for="requirement in requirements"
              :key="requirement.id"
              class="w-full px-4 py-3 text-left transition-colors"
              :class="selectedRequirementId === requirement.id ? 'bg-primary/5' : 'hover:bg-white/[0.02]'"
              @click="selectedRequirementId = requirement.id"
            >
              <div class="flex items-start gap-2">
                <span class="mt-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(requirement.effectiveStatus)">{{ requirement.priority }}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-textMain">{{ requirement.title }}</span>
                  <span class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-textMuted">
                    <span>{{ requirementStatusLabel(requirement.effectiveStatus) }}</span>
                    <span>{{ requirement.taskCount || 0 }} {{ t('workspace.tasks') }}</span>
                  </span>
                </span>
              </div>
            </button>
          </div>
        </div>

        <div v-if="selectedRequirement" class="min-w-0 space-y-5">
          <div class="rounded-lg border border-border bg-panel p-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded border px-2 py-0.5 text-xs font-semibold" :class="statusClass(selectedRequirement.effectiveStatus)">{{ selectedRequirement.priority }}</span>
                  <span class="rounded border px-2 py-0.5 text-xs" :class="statusClass(selectedRequirement.effectiveStatus)">{{ requirementStatusLabel(selectedRequirement.effectiveStatus) }}</span>
                </div>
                <h2 class="mt-3 text-lg font-semibold text-textMain">{{ selectedRequirement.title }}</h2>
                <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-textMuted">{{ selectedRequirement.description || '-' }}</p>
              </div>
              <div class="flex items-center gap-2">
                <button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-textMuted hover:text-textMain" @click="startRequirementEdit(selectedRequirement)">
                  <Pencil class="h-3.5 w-3.5" />
                  {{ t('common.edit') }}
                </button>
                <button class="rounded-md p-2 text-textMuted hover:bg-danger/10 hover:text-danger" @click="archiveRequirement(selectedRequirement.id)">
                  <Trash2 class="h-4 w-4" />
                </button>
              </div>
            </div>

            <div class="mt-5 grid gap-4 border-t border-border pt-4 md:grid-cols-2">
              <div>
                <div class="text-xs text-textMuted">{{ t('workspace.acceptance') }}</div>
                <div class="mt-1 whitespace-pre-wrap text-sm text-textMain">{{ selectedRequirement.acceptanceCriteria || '-' }}</div>
              </div>
              <div>
                <div class="text-xs text-textMuted">{{ t('workspace.scope') }}</div>
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <span v-for="projectId in selectedRequirement.projectIds" :key="projectId" class="rounded border border-border bg-base px-2 py-1 text-xs text-textMain">
                    {{ current.projects.find((item) => item.projectId === projectId)?.name || projectId }}
                  </span>
                  <span v-if="selectedRequirement.projectIds.length === 0" class="text-sm text-textMain">{{ t('workspace.entireWorkspace') }}</span>
                </div>
                <div v-if="selectedRequirement.tags.length" class="mt-3 flex flex-wrap gap-1.5">
                  <span v-for="tag in selectedRequirement.tags" :key="tag.id" class="rounded-full border border-border px-2 py-0.5 text-xs text-textMuted">{{ tag.name }}</span>
                </div>
              </div>
            </div>

            <form v-if="editingRequirementId === selectedRequirement.id" class="mt-5 grid gap-3 border-t border-border pt-5 lg:grid-cols-2" @submit.prevent="saveRequirementEdit">
              <input v-model="requirementEdit.title" class="h-9 rounded-md border border-border bg-base px-3 text-sm text-textMain outline-none focus:border-primary" />
              <select v-model="requirementEdit.priority" class="h-9 rounded-md border border-border bg-base px-2 text-sm text-textMain">
                <option v-for="priority in ['P0', 'P1', 'P2', 'P3']" :key="priority" :value="priority">{{ priority }}</option>
              </select>
              <textarea v-model="requirementEdit.description" rows="4" class="rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary" />
              <textarea v-model="requirementEdit.acceptanceCriteria" rows="4" class="rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary" />
              <div class="flex gap-2">
                <select v-model="requirementEdit.statusMode" class="h-9 flex-1 rounded-md border border-border bg-base px-2 text-sm text-textMain">
                  <option value="auto">{{ t('workspace.autoStatus') }}</option>
                  <option value="manual">{{ t('workspace.manualStatus') }}</option>
                </select>
                <select v-model="requirementEdit.manualStatus" class="h-9 flex-1 rounded-md border border-border bg-base px-2 text-sm text-textMain" :disabled="requirementEdit.statusMode !== 'manual'">
                  <option v-for="status in requirementStatuses" :key="status" :value="status">{{ requirementStatusLabel(status) }}</option>
                </select>
              </div>
              <select v-model="requirementEdit.projectIds" multiple class="min-h-24 rounded-md border border-border bg-base px-2 py-1 text-sm text-textMain lg:col-span-2">
                <option v-for="project in current.projects" :key="project.projectId" :value="project.projectId">{{ project.name }}</option>
              </select>
              <div class="flex justify-end gap-2 lg:col-span-2">
                <button type="button" class="h-9 rounded-md border border-border px-3 text-sm text-textMuted" @click="editingRequirementId = ''">{{ t('common.cancel') }}</button>
                <button class="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white">
                  <Save class="h-4 w-4" />
                  {{ t('workspace.save') }}
                </button>
              </div>
            </form>
          </div>

          <div class="rounded-lg border border-border bg-panel">
            <div class="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 class="text-sm font-semibold text-textMain">{{ t('workspace.tasksTitle') }}</h3>
                <p class="mt-1 text-xs text-textMuted">{{ selectedRequirementTasks.length }}</p>
              </div>
              <button class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white" @click="showTaskCreate = !showTaskCreate">
                <Plus class="h-3.5 w-3.5" />
                {{ t('workspace.newTask') }}
              </button>
            </div>

            <form v-if="showTaskCreate" class="grid gap-3 border-b border-border bg-base/60 p-4 md:grid-cols-[1fr_180px]" @submit.prevent="createTask">
              <input v-model="taskDraft.title" class="h-9 rounded-md border border-border bg-base px-3 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.titleLabel')" />
              <select v-model="taskDraft.assignedProvider" class="h-9 rounded-md border border-border bg-base px-2 text-sm text-textMain">
                <option value="">{{ t('workspace.unassigned') }}</option>
                <option v-for="provider in providerOptions" :key="provider" :value="provider">{{ providerLabel(provider) }}</option>
              </select>
              <textarea v-model="taskDraft.description" rows="3" class="rounded-md border border-border bg-base px-3 py-2 text-sm text-textMain outline-none focus:border-primary md:col-span-2" :placeholder="t('workspace.description')" />
              <div class="flex justify-end gap-2 md:col-span-2">
                <button type="button" class="h-8 rounded-md border border-border px-3 text-xs text-textMuted" @click="showTaskCreate = false">{{ t('common.cancel') }}</button>
                <button class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-white disabled:opacity-50" :disabled="!taskDraft.title.trim()">{{ t('workspace.createTask') }}</button>
              </div>
            </form>

            <div v-if="selectedRequirementTasks.length === 0" class="px-5 py-12 text-center text-sm text-textMuted">{{ t('workspace.noTasks') }}</div>
            <div v-else class="p-4">
              <div class="grid auto-cols-[minmax(236px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
                <div v-for="column in taskBoardColumns" :key="column.id" class="flex min-w-0 flex-col rounded-md border border-border bg-base/60">
                  <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-textMain">
                      <span class="h-1.5 w-1.5 rounded-full" :class="columnDotClass(column.id)" />
                      {{ t(column.labelKey) }}
                    </span>
                    <span class="text-[11px] tabular-nums text-textMuted">{{ tasksByColumn(column.states).length }}</span>
                  </div>
                  <div class="flex-1 space-y-2 p-2">
                    <div v-if="tasksByColumn(column.states).length === 0" class="rounded-md border border-dashed border-border px-3 py-6 text-center text-[11px] text-textMuted">-</div>
                    <article v-for="task in tasksByColumn(column.states)" :key="task.id" class="rounded-md border border-border bg-panel p-3 transition-colors hover:border-primary/40">
                      <div class="flex items-start justify-between gap-2">
                        <button class="min-w-0 flex-1 text-left" @click="selectTask(task)">
                          <span class="line-clamp-2 text-sm font-medium text-textMain">{{ task.title }}</span>
                        </button>
                        <span class="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold" :class="statusClass(task.status)">{{ taskStatusLabel(task.status) }}</span>
                      </div>
                      <p v-if="task.description" class="mt-2 line-clamp-2 text-xs leading-5 text-textMuted">{{ task.description }}</p>
                      <div class="mt-3 flex items-center gap-1.5">
                        <ProviderLogo v-if="task.assignedProvider" :provider="task.assignedProvider" :size="14" />
                        <Bot v-else class="h-3.5 w-3.5 text-textMuted" />
                        <span class="truncate text-[11px] text-textMuted">{{ providerLabel(task.assignedProvider) }}</span>
                      </div>
                      <div class="mt-3">
                        <div class="h-1.5 w-full overflow-hidden rounded-full bg-border">
                          <div class="h-full rounded-full bg-primary" :style="{ width: `${clampProgress(task.progress)}%` }" />
                        </div>
                        <div class="mt-1 flex items-center justify-between gap-2 text-[11px] text-textMuted">
                          <span class="tabular-nums">{{ clampProgress(task.progress) }}%</span>
                          <span class="truncate">{{ formatTime(task.lastActivityAt) }}</span>
                        </div>
                      </div>
                      <div class="mt-3 grid grid-cols-2 gap-2">
                        <select :value="task.assignedProvider || ''" class="h-7 w-full rounded border border-border bg-base px-1.5 text-[11px] text-textMain" @change="assignTask(task.id, (($event.target as HTMLSelectElement).value || null) as AgentProvider | null)">
                          <option value="">{{ t('workspace.unassigned') }}</option>
                          <option v-for="provider in providerOptions" :key="provider" :value="provider">{{ providerLabel(provider) }}</option>
                        </select>
                        <select :value="task.status" class="h-7 w-full rounded border border-border bg-base px-1.5 text-[11px] text-textMain" @change="updateTaskStatus(task.id, ($event.target as HTMLSelectElement).value as TaskStatus)">
                          <option v-for="status in taskStatuses" :key="status" :value="status">{{ taskStatusLabel(status) }}</option>
                        </select>
                      </div>
                    </article>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="rounded-lg border border-dashed border-border bg-panel/50 px-6 py-20 text-center text-sm text-textMuted">
          {{ t('workspace.selectRequirement') }}
        </div>
      </section>

      <section v-else-if="activeTab === 'documents'" class="grid gap-5 xl:grid-cols-[340px_1fr]">
        <div class="rounded-lg border border-border bg-panel">
          <div class="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.docsTitle') }}</h2>
              <p class="mt-0.5 text-xs text-textMuted">{{ current.documents.length }}</p>
            </div>
            <button class="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white" @click="showDocumentCreate = !showDocumentCreate">
              <Plus class="h-3.5 w-3.5" />
              {{ t('workspace.newDocument') }}
            </button>
          </div>

          <form v-if="showDocumentCreate" class="space-y-3 border-b border-border bg-base/60 p-4" @submit.prevent="createDocument">
            <input v-model="newDocument.title" class="h-9 w-full rounded-md border border-border bg-base px-3 text-sm text-textMain outline-none focus:border-primary" :placeholder="t('workspace.titleLabel')" />
            <select v-model="newDocument.kind" class="h-9 w-full rounded-md border border-border bg-base px-2 text-sm text-textMain">
              <option v-for="kind in documentKinds" :key="kind" :value="kind">{{ documentKindLabel(kind) }}</option>
            </select>
            <textarea v-model="newDocument.contentMarkdown" rows="5" class="w-full rounded-md border border-border bg-base px-3 py-2 font-mono text-xs text-textMain outline-none focus:border-primary" :placeholder="t('workspace.content')" />
            <select v-model="documentLinkRequirement" class="h-9 w-full rounded-md border border-border bg-base px-2 text-sm text-textMain">
              <option value="">{{ t('workspace.linkRequirement') }}</option>
              <option v-for="requirement in requirements" :key="requirement.id" :value="requirement.id">{{ requirement.title }}</option>
            </select>
            <select v-model="documentLinkTask" class="h-9 w-full rounded-md border border-border bg-base px-2 text-sm text-textMain">
              <option value="">{{ t('workspace.linkTask') }}</option>
              <option v-for="task in workspaceTasks" :key="task.id" :value="task.id">{{ task.title }}</option>
            </select>
            <div class="flex justify-end gap-2">
              <button type="button" class="h-8 rounded-md border border-border px-3 text-xs text-textMuted" @click="showDocumentCreate = false">{{ t('common.cancel') }}</button>
              <button class="h-8 rounded-md bg-primary px-3 text-xs font-medium text-white disabled:opacity-50" :disabled="!newDocument.title.trim()">{{ t('workspace.createDocument') }}</button>
            </div>
          </form>

          <div v-if="current.documents.length === 0" class="px-4 py-14 text-center text-sm text-textMuted">{{ t('workspace.noDocuments') }}</div>
          <div v-else class="max-h-[720px] divide-y divide-border overflow-y-auto">
            <button v-for="document in current.documents" :key="document.id" class="w-full px-4 py-3 text-left hover:bg-white/[0.02]" :class="selectedDocumentId === document.id ? 'bg-primary/5' : ''" @click="selectDocument(document.id)">
              <div class="flex items-start gap-2">
                <FileText class="mt-0.5 h-4 w-4 shrink-0 text-textMuted" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-textMain">{{ document.title }}</span>
                  <span class="mt-1 block text-[11px] text-textMuted">{{ documentKindLabel(document.kind) }} · {{ t('workspace.revision') }} {{ document.revisionCount || document.revisions?.length || 1 }}</span>
                </span>
              </div>
            </button>
          </div>
        </div>

        <div v-if="activeDocument" class="rounded-lg border border-border bg-panel">
          <div class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <input v-model="documentTitle" class="h-9 min-w-52 flex-1 rounded-md border border-border bg-base px-3 text-sm font-medium text-textMain outline-none focus:border-primary" />
            <select v-model="documentKind" class="h-9 rounded-md border border-border bg-base px-2 text-sm text-textMain">
              <option v-for="kind in documentKinds" :key="kind" :value="kind">{{ documentKindLabel(kind) }}</option>
            </select>
            <button class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-textMuted hover:text-textMain" @click="saveDocumentMeta">
              <Save class="h-4 w-4" />
              {{ t('workspace.save') }}
            </button>
            <button class="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white" :disabled="documentLoading" @click="commitRevision()">
              <Send class="h-4 w-4" />
              {{ t('workspace.saveRevision') }}
            </button>
          </div>

          <div v-if="conflictLatest" class="m-4 rounded-md border border-warning/40 bg-warning/5 p-4">
            <div class="flex items-start gap-2">
              <AlertTriangle class="mt-0.5 h-4 w-4 text-warning" />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-medium text-textMain">{{ t('workspace.conflict') }}</div>
                <p class="mt-1 text-xs text-textMuted">{{ t('workspace.conflictHint') }}</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button class="h-8 rounded-md border border-border px-3 text-xs text-textMain" @click="reloadConflictedDocument">{{ t('workspace.reloadServer') }}</button>
                  <button class="h-8 rounded-md bg-warning px-3 text-xs font-medium text-black" @click="commitRevision(conflictLatest?.id)">{{ t('workspace.forceCommit') }}</button>
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-5 p-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
            <div class="min-w-0">
              <div v-if="viewingHistory" class="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-textMain">
                <History class="h-3.5 w-3.5 shrink-0 text-warning" />
                <span>{{ t('workspace.viewingHistory', { revision: viewingRevision?.revisionNumber ?? '' }) }}</span>
                <div class="ml-auto flex shrink-0 gap-2">
                  <button type="button" class="rounded border border-border px-2 py-1 text-[11px] text-textMuted hover:text-textMain" @click="backToLatestRevision">{{ t('workspace.backToLatest') }}</button>
                  <button type="button" class="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] text-primary" @click="restoreViewedRevision">{{ t('workspace.restoreRevision') }}</button>
                </div>
              </div>
              <div class="mb-2 flex items-center justify-between">
                <div class="flex rounded-md border border-border p-0.5">
                  <button class="rounded px-3 py-1.5 text-xs" :class="documentMode === 'edit' ? 'bg-primary/10 text-primary' : 'text-textMuted'" @click="documentMode = 'edit'">{{ t('workspace.edit') }}</button>
                  <button class="rounded px-3 py-1.5 text-xs" :class="documentMode === 'preview' ? 'bg-primary/10 text-primary' : 'text-textMuted'" @click="documentMode = 'preview'">{{ t('workspace.preview') }}</button>
                </div>
                <button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-textMuted hover:text-textMain" @click="imageInput?.click()">
                  <ImagePlus class="h-3.5 w-3.5" />
                  {{ t('workspace.uploadImage') }}
                </button>
                <input ref="imageInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" @change="uploadImage" />
              </div>
              <textarea
                v-if="documentMode === 'edit'"
                v-model="documentContent"
                class="h-[560px] w-full resize-none rounded-md border border-border bg-base p-4 font-mono text-sm leading-6 text-textMain outline-none focus:border-primary"
                :placeholder="t('workspace.content')"
              />
              <div v-else ref="previewPane" class="h-[560px] max-w-none overflow-y-auto rounded-md border border-border bg-base text-sm text-textMain">
                <div v-if="!documentContent.trim()" class="flex h-full items-center justify-center px-6 text-center text-xs text-textMuted">
                  {{ t('workspace.emptyRevision') }}
                </div>
                <div v-else class="md-preview p-5" v-html="previewHtml" />
              </div>
            </div>

            <aside class="space-y-4">
              <div class="rounded-md border border-border bg-base p-4">
                <h3 class="text-xs font-semibold text-textMain">{{ t('workspace.links') }}</h3>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span v-for="link in activeDocument.links" :key="`${link.targetType}-${link.targetId}`" class="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-textMain">
                    {{ link.targetType === 'requirement' ? requirements.find((item) => item.id === link.targetId)?.title || link.targetId : workspaceTasks.find((item) => item.id === link.targetId)?.title || link.targetId }}
                    <button class="text-textMuted hover:text-danger" @click="unlinkDocument(link.targetType, link.targetId)">×</button>
                  </span>
                  <span v-if="activeDocument.links.length === 0" class="text-xs text-textMuted">-</span>
                </div>
                <div class="mt-3 space-y-2">
                  <select v-model="documentLinkRequirement" class="h-8 w-full rounded-md border border-border bg-panel px-2 text-xs text-textMain">
                    <option value="">{{ t('workspace.linkRequirement') }}</option>
                    <option v-for="requirement in requirements" :key="requirement.id" :value="requirement.id">{{ requirement.title }}</option>
                  </select>
                  <select v-model="documentLinkTask" class="h-8 w-full rounded-md border border-border bg-panel px-2 text-xs text-textMain">
                    <option value="">{{ t('workspace.linkTask') }}</option>
                    <option v-for="task in workspaceTasks" :key="task.id" :value="task.id">{{ task.title }}</option>
                  </select>
                  <button class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-textMain" @click="linkDocument">
                    <Link2 class="h-3.5 w-3.5" />
                    {{ t('workspace.link') }}
                  </button>
                </div>
              </div>

              <div class="rounded-md border border-border bg-base p-4">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="text-xs font-semibold text-textMain">{{ t('workspace.revision') }}</h3>
                  <span class="text-[11px] tabular-nums text-textMuted">{{ activeDocument.revisions.length }}</span>
                </div>
                <div class="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  <button
                    v-for="revision in activeDocument.revisions"
                    :key="revision.id"
                    class="flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left text-xs transition-colors"
                    :class="revision.id === viewingRevisionId ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border text-textMuted hover:border-primary/30 hover:text-textMain'"
                    @click="selectRevision(revision)"
                  >
                    <span class="inline-flex items-center gap-2">
                      <span>#{{ revision.revisionNumber }}</span>
                      <span v-if="revision.id === latestRevisionId" class="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-px text-[10px] text-emerald-300">{{ t('workspace.currentRevision') }}</span>
                    </span>
                    <span class="truncate">{{ formatTime(revision.createdAt) }}</span>
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>

        <div v-else class="rounded-lg border border-dashed border-border bg-panel/50 px-6 py-20 text-center text-sm text-textMuted">
          {{ t('workspace.selectDocument') }}
        </div>
      </section>

      <section v-else class="space-y-5">
        <WorkspaceBoard3D
          :agents="agents"
          :tasks="workspaceTasks"
          :unassigned="unassignedTasks"
          @select-agent="selectAgent"
          @select-task="selectTask"
        />

        <div class="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <div class="rounded-lg border border-border bg-panel">
            <div class="border-b border-border px-5 py-4">
              <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.agentsTitle') }}</h2>
              <p class="mt-1 text-xs text-textMuted">{{ agents.length }}</p>
            </div>
            <div v-if="agents.length === 0" class="px-5 py-12 text-center text-sm text-textMuted">{{ t('workspace.noAgents') }}</div>
            <div v-else class="divide-y divide-border">
              <button v-for="agent in agents" :key="agent.id" class="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-white/[0.02]" @click="selectAgent(agent)">
                <span class="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-base text-textMain">
                  <ProviderLogo :provider="agent.provider" :size="18" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium capitalize text-textMain">{{ agent.provider }}</span>
                  <span class="mt-0.5 block text-xs text-textMuted">{{ agent.openTaskIds.length }} {{ t('workspace.openTasks') }} · {{ formatTime(agent.lastSeenAt) }}</span>
                </span>
                <span class="rounded border px-2 py-1 text-xs" :class="statusClass(agent.state)">{{ agentStateLabel(agent.state) }}</span>
              </button>
            </div>
          </div>

          <div class="rounded-lg border border-border bg-panel">
            <div class="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 class="text-sm font-semibold text-textMain">{{ t('workspace.pendingPool') }}</h2>
              <span class="rounded-full border border-border px-2 py-0.5 text-xs text-textMuted">{{ unassignedTasks.length }}</span>
            </div>
            <div v-if="unassignedTasks.length === 0" class="px-5 py-12 text-center text-sm text-textMuted">{{ t('workspace.noPending') }}</div>
            <div v-else class="divide-y divide-border">
              <button v-for="task in unassignedTasks" :key="task.id" class="w-full px-5 py-3 text-left hover:bg-white/[0.02]" @click="selectTask(task)">
                <div class="truncate text-sm font-medium text-textMain">{{ task.title }}</div>
                <div class="mt-1 flex items-center gap-2 text-xs text-textMuted">
                  <span>{{ task.requirementPriority }}</span>
                  <span class="truncate">{{ task.requirementTitle }}</span>
                </div>
              </button>
            </div>
          </div>
        </div>

        <div v-if="selectedTask" class="rounded-lg border border-primary/30 bg-panel p-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-xs text-textMuted">{{ t('workspace.taskDetail') }}</div>
              <h2 class="mt-1 text-lg font-semibold text-textMain">{{ selectedTask.title }}</h2>
              <p class="mt-2 whitespace-pre-wrap text-sm text-textMuted">{{ selectedTask.description || '-' }}</p>
            </div>
            <span class="rounded border px-2 py-1 text-xs" :class="statusClass(selectedTask.status)">{{ taskStatusLabel(selectedTask.status) }}</span>
          </div>
          <div class="mt-5 grid gap-4 border-t border-border pt-4 md:grid-cols-4">
            <div>
              <div class="text-xs text-textMuted">{{ t('workspace.assignee') }}</div>
              <select :value="selectedTask.assignedProvider || ''" class="mt-2 h-8 w-full rounded-md border border-border bg-base px-2 text-xs text-textMain" @change="assignTask(selectedTask.id, (($event.target as HTMLSelectElement).value || null) as AgentProvider | null)">
                <option value="">{{ t('workspace.unassigned') }}</option>
                <option v-for="provider in providerOptions" :key="provider" :value="provider">{{ provider }}</option>
              </select>
            </div>
            <div>
              <div class="text-xs text-textMuted">{{ t('workspace.status') }}</div>
              <select :value="selectedTask.status" class="mt-2 h-8 w-full rounded-md border border-border bg-base px-2 text-xs text-textMain" @change="updateTaskStatus(selectedTask.id, ($event.target as HTMLSelectElement).value as TaskStatus)">
                <option v-for="status in taskStatuses" :key="status" :value="status">{{ taskStatusLabel(status) }}</option>
              </select>
            </div>
            <div>
              <div class="text-xs text-textMuted">{{ t('workspace.progress') }}</div>
              <div class="mt-3 flex items-center gap-2">
                <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-base">
                  <div class="h-full rounded-full bg-primary" :style="{ width: `${selectedTask.progress ?? 0}%` }" />
                </div>
                <span class="text-xs tabular-nums text-textMain">{{ selectedTask.progress ?? 0 }}%</span>
              </div>
            </div>
            <div>
              <div class="text-xs text-textMuted">{{ t('workspace.lastActivity') }}</div>
              <div class="mt-2 text-xs text-textMain">{{ formatTime(selectedTask.lastActivityAt) }}</div>
            </div>
          </div>
          <div class="mt-5 border-t border-border pt-4">
            <h3 class="text-xs font-semibold text-textMain">{{ t('workspace.activity') }}</h3>
            <div v-if="!selectedTask.activities?.length" class="mt-3 text-xs text-textMuted">{{ t('workspace.noActivity') }}</div>
            <div v-else class="mt-3 space-y-3">
              <div v-for="activity in selectedTask.activities" :key="activity.id" class="flex gap-3">
                <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <span class="min-w-0">
                  <span class="block text-xs text-textMain">{{ activity.summary || activity.kind }}</span>
                  <span class="mt-0.5 block text-[11px] text-textMuted">{{ activity.provider || activity.actorType }} · {{ formatTime(activity.createdAt) }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
