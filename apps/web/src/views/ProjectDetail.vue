<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore, type CleanPreviewResult, type DeploymentLog, type Pm2AppStatus } from '../store/project'
import { ArrowLeft, Save, Key, Copy, RefreshCw, Trash2, CheckCircle2, TerminalSquare, FolderOpen, AlertTriangle, XCircle, ScrollText, Eye, Shield, ShieldAlert, Plus, History, RotateCcw, Archive, ArchiveX, CheckCheck, FileText, Activity, Cpu, MemoryStick, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, Check, SlidersHorizontal, LayoutDashboard } from 'lucide-vue-next'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import CleanPreviewDialog from '../components/CleanPreviewDialog.vue'
import ProjectTagsEditor from '../components/ProjectTagsEditor.vue'
import { useToast } from '../composables/useToast'
import { useIntervalRaf } from '../composables/useIntervalRaf'
import { BASE_PATH } from '../lib/base'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const toast = useToast()
const { t } = useI18n()

const projectId = route.params.id as string
const project = computed(() => projectStore.getProjectById(projectId))

const formData = ref({
  destPath: '',
  preDeploy: '',
  postDeploy: '',
  postDeployAsync: false,
  categoryId: '' as string,
  pm2AppName: '',
  tagIds: [] as string[],
})

const cleanForm = ref<{
  cleanMode: 'merge' | 'clean' | 'clean-all'
  protectPaths: string[]
}>({
  cleanMode: 'merge',
  protectPaths: [],
})
const protectInput = ref('')
const isSavingClean = ref(false)
const showCleanAllConfirm = ref(false)

const showPreview = ref(false)
const previewLoading = ref(false)
const previewError = ref('')
const previewData = ref<CleanPreviewResult | null>(null)

const isTokenVisible = ref(false)
const isCopied = ref(false)
const copiedCommand = ref('')
const serverUrl = ref('http://127.0.0.1:3000')
const cliEnv = ref('')
const cliHelpCollapsed = ref(false)
const cliHelpUserToggled = ref(false)
const cliHelpStorageKey = computed(() => `kite:cli-help-collapsed:${projectId}`)

function initCliHelpCollapsed() {
  try {
    const stored = localStorage.getItem(cliHelpStorageKey.value)
    if (stored === '1' || stored === '0') {
      cliHelpCollapsed.value = stored === '1'
      cliHelpUserToggled.value = true
      return
    }
  } catch {}
  cliHelpUserToggled.value = false
  cliHelpCollapsed.value = deployments.value.length > 0
}

function toggleCliHelp() {
  cliHelpCollapsed.value = !cliHelpCollapsed.value
  cliHelpUserToggled.value = true
  try {
    localStorage.setItem(cliHelpStorageKey.value, cliHelpCollapsed.value ? '1' : '0')
  } catch {}
}

const isInitialLoading = ref(true)

onMounted(async () => {
  serverUrl.value = window.location.origin + BASE_PATH
  await Promise.all([
    projectStore.fetchProjects(),
    projectStore.fetchCategories(),
    projectStore.fetchTags(),
    loadPm2Available(),
  ])
  if (project.value) {
    formData.value.destPath = project.value.destPath || ''
    formData.value.preDeploy = project.value.preDeploy || ''
    formData.value.postDeploy = project.value.postDeploy || ''
    formData.value.postDeployAsync = Boolean((project.value as any).postDeployAsync)
    formData.value.categoryId = project.value.categoryId || ''
    formData.value.pm2AppName = (project.value as any).pm2AppName || ''
    formData.value.tagIds = Array.isArray((project.value as any).tagIds) ? [...(project.value as any).tagIds] : []
    cliEnv.value = project.value.env || ''
    const rawMode = (project.value as any).cleanMode
    cleanForm.value.cleanMode = (rawMode === 'clean' || rawMode === 'clean-all') ? rawMode : 'merge'
    const rawProtect = (project.value as any).protectPaths
    if (typeof rawProtect === 'string' && rawProtect.length > 0) {
      try {
        const parsed = JSON.parse(rawProtect)
        cleanForm.value.protectPaths = Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : []
      } catch {
        cleanForm.value.protectPaths = []
      }
    } else {
      cleanForm.value.protectPaths = []
    }
    isInitialLoading.value = false
    Promise.all([loadDeployments(), refreshPm2Status()]).catch(() => {})
  } else {
    isInitialLoading.value = false
    router.replace('/projects')
  }
})

const deployments = ref<DeploymentLog[]>([])
const isLoadingDeployments = ref(false)
const showRollbackConfirm = ref(false)
const isRollingBack = ref(false)
const rollbackTarget = ref<DeploymentLog | null>(null)

// ---------- Deployment history pagination ----------
const DEPLOYMENT_PAGE_SIZE = 10
const deploymentPage = ref(1)
const totalDeploymentPages = computed(() => Math.max(1, Math.ceil(deployments.value.length / DEPLOYMENT_PAGE_SIZE)))
const pagedDeployments = computed(() => {
  const start = (deploymentPage.value - 1) * DEPLOYMENT_PAGE_SIZE
  return deployments.value.slice(start, start + DEPLOYMENT_PAGE_SIZE)
})
const deploymentPageRange = computed(() => {
  const total = deployments.value.length
  if (total === 0) return { from: 0, to: 0, total: 0 }
  const from = (deploymentPage.value - 1) * DEPLOYMENT_PAGE_SIZE + 1
  const to = Math.min(deploymentPage.value * DEPLOYMENT_PAGE_SIZE, total)
  return { from, to, total }
})
function goPrevDeploymentPage() {
  if (deploymentPage.value > 1) deploymentPage.value -= 1
}
function goNextDeploymentPage() {
  if (deploymentPage.value < totalDeploymentPages.value) deploymentPage.value += 1
}

async function loadDeployments() {
  isLoadingDeployments.value = true
  try {
    await projectStore.fetchLogs()
    deployments.value = projectStore.logs
      .filter(l => l.projectId === projectId)
    if (deploymentPage.value > totalDeploymentPages.value) {
      deploymentPage.value = Math.max(1, totalDeploymentPages.value)
    }
  } catch (e) {
    deployments.value = []
  } finally {
    isLoadingDeployments.value = false
    if (!cliHelpUserToggled.value) {
      initCliHelpCollapsed()
    }
  }
}

function shortId(id?: string | null) {
  if (!id) return ''
  return id.slice(0, 8)
}

const copiedDeployId = ref<string>('')
async function copyDeploymentId(id: string, evt?: Event) {
  if (evt) {
    evt.stopPropagation()
    evt.preventDefault()
  }
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    copiedDeployId.value = id
    toast.success(t('project.detail.copyDeployIdSuccess'), shortId(id))
    setTimeout(() => {
      if (copiedDeployId.value === id) copiedDeployId.value = ''
    }, 2000)
  } catch (e: any) {
    toast.error(t('project.detail.copyFailed'), e?.message || t('project.detail.copyManualHint'))
  }
}

const currentDeploymentId = computed(() => {
  const sorted = [...deployments.value].sort((a, b) => {
    const ta = new Date(a.startTime).getTime() || 0
    const tb = new Date(b.startTime).getTime() || 0
    return tb - ta
  })
  return sorted.find(l => l.status === 'success' && (l as any).triggerSource !== 'rollback')?.id || ''
})

function canRollbackLog(log: DeploymentLog): boolean {
  if (!log) return false
  if (log.status === 'running') return false
  if ((log as any).triggerSource === 'rollback') return false
  if (log.id === currentDeploymentId.value) return false
  return !!log.artifactPath
}

function rollbackDisabledReason(log: DeploymentLog): string {
  if (!log) return ''
  if (log.status === 'running') return t('project.detail.rollbackInProgress')
  if ((log as any).triggerSource === 'rollback') return t('project.detail.rollbackOfRollback')
  if (log.id === currentDeploymentId.value) return ''
  if (!log.artifactPath) return t('project.detail.rollbackNoArtifact')
  return ''
}

function openRollback(log: DeploymentLog) {
  if (!canRollbackLog(log)) return
  rollbackTarget.value = log
  showRollbackConfirm.value = true
}

async function confirmRollback() {
  const sourceId = rollbackTarget.value?.id
  if (!sourceId) return
  isRollingBack.value = true
  try {
    const data = await projectStore.rollbackDeployment(sourceId)
    toast.success(t('project.detail.rollbackDone'), t('project.detail.rollbackNewDeploy', { id: shortId(data.deployId) }))
    showRollbackConfirm.value = false
    rollbackTarget.value = null
    await loadDeployments()
  } catch (e: any) {
    toast.error(t('project.detail.rollbackFailed'), e?.message || t('project.detail.unknownError'))
  } finally {
    isRollingBack.value = false
  }
}

function goLogBoard(log?: DeploymentLog) {
  if (log) {
    router.push({ path: '/logs', query: { id: log.id, projectId } })
  } else {
    router.push({ path: '/logs', query: { projectId } })
  }
}

function formatStart(s: string) {
  if (!s) return '—'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return d.toLocaleString()
  } catch {
    return s
  }
}

async function savePartial(payload: Record<string, any>, successMessage = t('project.detail.configSaved')) {
  try {
    applyOptimisticPatch(payload)
    await projectStore.updateProject(projectId, payload)
    toast.success(successMessage)
    return true
  } catch (e: any) {
    const conflict = e?.data?.conflictProject
    if (e?.status === 409 && conflict) {
      toast.error(t('project.detail.saveConflict'), t('project.detail.saveConflictDetail', { name: conflict }))
    } else {
      toast.error(t('project.detail.saveFailed'), e?.message || t('project.detail.retryLater'))
    }
    return false
  }
}

const isSavingBasics = ref(false)
async function saveBasics() {
  if (isSavingBasics.value) return
  isSavingBasics.value = true
  try {
    await savePartial({
      categoryId: formData.value.categoryId || null,
      tagIds: [...formData.value.tagIds],
    }, t('project.detail.basicsSaved'))
  } finally {
    isSavingBasics.value = false
  }
}

const isSavingPm2 = ref(false)
async function savePm2Binding() {
  if (isSavingPm2.value) return
  isSavingPm2.value = true
  try {
    const nextName = formData.value.pm2AppName.trim() || null
    const prevName = ((project.value as any)?.pm2AppName || '').trim() || null
    const ok = await savePartial({ pm2AppName: nextName }, t('project.detail.pm2BindSaved'))
    if (ok) {
      await refreshPm2Status()
      if (nextName && nextName !== prevName) {
        await autoImportPm2LogSources()
      }
    }
  } finally {
    isSavingPm2.value = false
  }
}

const isSavingScripts = ref(false)
async function saveScripts() {
  if (isSavingScripts.value) return
  isSavingScripts.value = true
  try {
    await savePartial({
      destPath: formData.value.destPath,
      preDeploy: formData.value.preDeploy,
      postDeploy: formData.value.postDeploy,
      postDeployAsync: formData.value.postDeployAsync,
    }, t('project.detail.scriptsSaved'))
  } finally {
    isSavingScripts.value = false
  }
}

async function autoImportPm2LogSources() {
  try {
    const status = await projectStore.fetchProjectPm2(projectId)
    if (!status || status.found !== true) return
    const paths: Array<{ path: string; kind: 'stdout' | 'stderr' }> = []
    if ((status as any).outLogPath) paths.push({ path: (status as any).outLogPath, kind: 'stdout' })
    if ((status as any).errorLogPath) paths.push({ path: (status as any).errorLogPath, kind: 'stderr' })
    if (paths.length === 0) return
    const existing = await projectStore.fetchLogSources(projectId)
    const have = new Set((existing?.items || []).map((s: any) => s.filePath))
    const missing = paths.filter((p) => !have.has(p.path))
    if (missing.length === 0) return
    const name = formData.value.pm2AppName.trim() || 'pm2'
    const items = missing.map((m) => ({
      filePath: m.path,
      label: `${name} · ${m.kind}`,
      kind: 'pm2',
    }))
    const data: any = await projectStore.createLogSources(projectId, items)
    const created = Array.isArray(data?.created) ? data.created : []
    if (created.length > 0) {
      toast.success(t('project.detail.pm2LogsImported', { n: created.length }), t('project.detail.pm2LogsImportedHint'))
    }
  } catch {
    // 静默失败：用户仍可在 LogTail 页面手动导入
  }
}

function applyOptimisticPatch(payload: Record<string, any>) {
  const p: any = project.value
  if (!p) return
  if (payload.destPath !== undefined) {
    p.destPath = payload.destPath
    p.deployPath = payload.destPath
  }
  if (payload.preDeploy !== undefined) {
    p.preDeploy = payload.preDeploy
    p.preDeployScript = payload.preDeploy
  }
  if (payload.postDeploy !== undefined) {
    p.postDeploy = payload.postDeploy
    p.postDeployScript = payload.postDeploy
  }
  if (payload.postDeployAsync !== undefined) p.postDeployAsync = Boolean(payload.postDeployAsync)
  if (payload.categoryId !== undefined) p.categoryId = payload.categoryId
  if (payload.env !== undefined) p.env = payload.env
  if (payload.pm2AppName !== undefined) p.pm2AppName = payload.pm2AppName
  if (payload.tagIds !== undefined) p.tagIds = Array.isArray(payload.tagIds) ? [...payload.tagIds] : []
  if (payload.cleanMode !== undefined) p.cleanMode = payload.cleanMode
  if (payload.protectPaths !== undefined) {
    p.protectPaths = Array.isArray(payload.protectPaths) && payload.protectPaths.length
      ? JSON.stringify(payload.protectPaths)
      : null
  }
  if (payload.name !== undefined) p.name = payload.name
}

const isSavingEnv = ref(false)
const envDirty = computed(() => cliEnv.value.trim() !== (project.value?.env || ''))
async function saveEnv() {
  if (!envDirty.value || isSavingEnv.value) return
  isSavingEnv.value = true
  try {
    const envPayload = { env: cliEnv.value.trim() }
    applyOptimisticPatch(envPayload)
    await projectStore.updateProject(projectId, envPayload)
    toast.success(t('project.detail.envSaved'))
  } catch (e: any) {
    toast.error(t('project.detail.saveFailed'), e?.message || t('project.detail.retryLater'))
  } finally {
    isSavingEnv.value = false
  }
}

// ---------- PM2 status ----------
const pm2Available = ref(false)
const pm2Apps = ref<Array<{ name: string; pmId: number; status: string }>>([])
const pm2Status = ref<Pm2AppStatus | null>(null)
const pm2Loading = ref(false)

async function loadPm2Available() {
  try {
    pm2Available.value = await projectStore.fetchPm2Available()
    if (pm2Available.value) {
      try {
        const apps = await projectStore.fetchPm2Apps()
        pm2Apps.value = Array.isArray(apps) ? apps.filter((a) => a.name) : []
      } catch {
        pm2Apps.value = []
      }
    }
  } catch {
    pm2Available.value = false
  }
}

async function refreshPm2Status() {
  if (!formData.value.pm2AppName.trim()) {
    pm2Status.value = null
    return
  }
  pm2Loading.value = true
  try {
    pm2Status.value = await projectStore.fetchProjectPm2(projectId)
  } finally {
    pm2Loading.value = false
  }
}

useIntervalRaf(async () => {
  if (formData.value.pm2AppName.trim()) {
    await refreshPm2Status()
  }
}, 5000)

// ---------- PM2 app picker (dropdown + manual fallback) ----------
const pm2PickerOpen = ref(false)
const pm2ManualMode = ref(false)

function togglePm2Picker() {
  pm2PickerOpen.value = !pm2PickerOpen.value
}
function closePm2Picker() {
  pm2PickerOpen.value = false
}
function pickPm2App(name: string) {
  formData.value.pm2AppName = name
  pm2ManualMode.value = false
  closePm2Picker()
}
function enterPm2ManualMode() {
  pm2ManualMode.value = true
  closePm2Picker()
}

const pm2DropdownAvailable = computed(
  () => pm2Available.value && pm2Apps.value.length > 0 && !pm2ManualMode.value,
)

const pm2ConflictProjects = computed(() => {
  const name = formData.value.pm2AppName.trim()
  if (!name) return []
  return projectStore.projects.filter(
    (p) => p.id !== projectId && (p.pm2AppName || '').trim() === name,
  )
})

function onDocClickClosePm2(e: MouseEvent) {
  if (!pm2PickerOpen.value) return
  const target = e.target as HTMLElement | null
  if (target && target.closest('[data-pm2-picker-root]')) return
  closePm2Picker()
}
onMounted(() => {
  document.addEventListener('click', onDocClickClosePm2)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClickClosePm2)
})

function fmtBytes(n?: number | null): string {
  if (n == null || isNaN(n)) return '—'
  const k = 1024
  if (n < k) return `${n} B`
  if (n < k * k) return `${(n / k).toFixed(1)} KB`
  if (n < k * k * k) return `${(n / k / k).toFixed(1)} MB`
  return `${(n / k / k / k).toFixed(2)} GB`
}

function fmtUptimeMs(ms?: number): string {
  if (ms == null || ms < 0) return '—'
  const sec = Math.floor(ms / 1000)
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

function addProtectPath() {
  const v = protectInput.value.trim()
  if (!v) return
  if (cleanForm.value.protectPaths.includes(v)) {
    protectInput.value = ''
    return
  }
  cleanForm.value.protectPaths.push(v)
  protectInput.value = ''
}
function removeProtectPath(g: string) {
  cleanForm.value.protectPaths = cleanForm.value.protectPaths.filter(x => x !== g)
}

async function commitCleanForm() {
  isSavingClean.value = true
  try {
    const cleanPayload = {
      cleanMode: cleanForm.value.cleanMode,
      protectPaths: cleanForm.value.protectPaths.length ? cleanForm.value.protectPaths : null,
    }
    applyOptimisticPatch(cleanPayload)
    await projectStore.updateProject(projectId, cleanPayload)
    toast.success(t('project.detail.cleanPolicySaved'), cleanForm.value.cleanMode === 'merge' ? t('project.detail.cleanPolicyMergeDetail') : t('project.detail.cleanPolicyDetail', { mode: cleanForm.value.cleanMode }))
  } catch (e: any) {
    toast.error(t('project.detail.saveFailed'), e?.message)
  } finally {
    isSavingClean.value = false
    showCleanAllConfirm.value = false
  }
}

async function saveCleanConfig() {
  if (cleanForm.value.cleanMode === 'clean-all') {
    showCleanAllConfirm.value = true
    return
  }
  await commitCleanForm()
}

async function openPreview() {
  if (cleanForm.value.cleanMode === 'merge') {
    toast.info(t('project.detail.mergeNoPreview'))
    return
  }
  showPreview.value = true
  previewLoading.value = true
  previewError.value = ''
  previewData.value = null
  try {
    previewData.value = await projectStore.cleanPreview(projectId, {
      cleanMode: cleanForm.value.cleanMode,
      protectPaths: cleanForm.value.protectPaths,
    })
  } catch (e: any) {
    previewError.value = e?.message || t('project.detail.previewFailed')
  } finally {
    previewLoading.value = false
  }
}

const copyToken = () => {
  if (project.value?.token) {
    navigator.clipboard.writeText(project.value.token)
    isCopied.value = true
    setTimeout(() => isCopied.value = false, 2000)
  }
}

const writeClipboardSync = (text: string): boolean => {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

const copyCommand = (key: string, value: string) => {
  if (!value) return
  const finish = () => {
    copiedCommand.value = key
    setTimeout(() => copiedCommand.value = '', 2000)
  }
  const syncOk = writeClipboardSync(value)
  if (syncOk) {
    finish()
    return
  }
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(value).then(finish).catch(() => {
      window.prompt(t('project.detail.copyManualPrompt'), value)
    })
  } else {
    window.prompt(t('project.detail.copyManualPrompt'), value)
  }
}

const envSuffix = computed(() => cliEnv.value.trim() ? ` --env ${cliEnv.value.trim()}` : '')
const configFileName = computed(() => cliEnv.value.trim() ? `kite.config.${cliEnv.value.trim()}.json` : 'kite.config.json')

const installCommand = 'npm install -g @kitecd/cli'
const initCommand = computed(() => `kite init --project ${projectId}${envSuffix.value} --out ./dist --server ${serverUrl.value} --token ${project.value?.token || '<DEPLOY_TOKEN>'}`)
const pushCommand = computed(() => `kite push${envSuffix.value}`)
const directPushCommand = computed(() => `kite push --server ${serverUrl.value} --project ${projectId}${envSuffix.value} --out ./dist`)
const directPushWithTokenCommand = computed(() => `kite push --server ${serverUrl.value} --project ${projectId} --token ${project.value?.token || '<DEPLOY_TOKEN>'}${envSuffix.value} --out ./dist`)
const tokenPlaceholder = computed(() => project.value?.token || '<DEPLOY_TOKEN>')
const tokenSetProjectCommand = computed(() => cliEnv.value.trim()
  ? `kite config:set token ${tokenPlaceholder.value} --env ${cliEnv.value.trim()}`
  : `kite config:set token ${tokenPlaceholder.value}`)
const tokenSetGlobalCommand = computed(() => `kite config:set token ${tokenPlaceholder.value} --global`)
const tokenEnvLocalLine = computed(() => `KITE_DEPLOY_TOKEN=${tokenPlaceholder.value}`)
const configExample = computed(() => JSON.stringify({
  projectId,
  outputDir: './dist',
  files: ['**/*'],
  postDeploy: project.value?.postDeploy || 'pm2 restart your-service'
}, null, 2))

const configFilesExamples = computed(() => [
  { label: t('project.detail.filesExampleAll'), files: ['**/*'] },
  { label: t('project.detail.filesExampleDist'), files: ['dist/**/*'] },
  { label: t('project.detail.filesExampleMultiDir'), files: ['dist/**/*', 'public/**/*'] },
  { label: t('project.detail.filesExampleSingle'), files: ['index.html'] },
  { label: t('project.detail.filesExampleMix'), files: ['dist/**/*', 'server.js', 'config/*.json'] },
])

const cleanModeOptions = computed<Array<{ value: 'merge' | 'clean' | 'clean-all'; title: string; desc: string; tone: 'primary' | 'warning' | 'danger' }>>(() => [
  { value: 'merge', title: 'merge', desc: t('project.detail.cleanModeMergeDesc'), tone: 'primary' },
  { value: 'clean', title: 'clean', desc: t('project.detail.cleanModeCleanDesc'), tone: 'warning' },
  { value: 'clean-all', title: 'clean-all', desc: t('project.detail.cleanModeCleanAllDesc'), tone: 'danger' },
])

const showRefreshTokenModal = ref(false)
const isRefreshingToken = ref(false)
const refreshToken = () => {
  showRefreshTokenModal.value = true
}
const confirmRefreshToken = async () => {
  isRefreshingToken.value = true
  try {
    await projectStore.generateToken(projectId)
    isTokenVisible.value = true
    showRefreshTokenModal.value = false
    toast.success(t('project.detail.tokenRegenerated'), t('project.detail.tokenInvalidated'))
  } catch (e: any) {
    toast.error(t('project.detail.tokenResetFailed'), e?.message)
  } finally {
    isRefreshingToken.value = false
  }
}

const showDeleteModal = ref(false)
const deleteConfirmText = ref('')
const isDeleting = ref(false)
const deleteError = ref('')

const expectedConfirmName = computed(() => project.value?.name?.trim() || '')
const canConfirmDelete = computed(() =>
  !isDeleting.value &&
  expectedConfirmName.value.length > 0 &&
  deleteConfirmText.value.trim() === expectedConfirmName.value
)

function openDeleteModal() {
  deleteConfirmText.value = ''
  deleteError.value = ''
  isDeleting.value = false
  showDeleteModal.value = true
}

function closeDeleteModal() {
  if (isDeleting.value) return
  showDeleteModal.value = false
  deleteConfirmText.value = ''
  deleteError.value = ''
}

async function confirmDelete() {
  if (!canConfirmDelete.value) return
  isDeleting.value = true
  deleteError.value = ''
  try {
    const success = await projectStore.removeProject(projectId)
    if (success) {
      showDeleteModal.value = false
      router.replace('/projects')
    } else {
      deleteError.value = t('project.detail.deleteFailedRetry')
    }
  } catch (e: any) {
    deleteError.value = e?.message || t('project.detail.deleteFailedRetry')
  } finally {
    isDeleting.value = false
  }
}

type DetailTab = 'overview' | 'config' | 'integration'
const tabStorageKey = computed(() => `kite:project-detail-tab:${projectId}`)
const activeTab = ref<DetailTab>('overview')
const tabs = computed<Array<{ key: DetailTab; label: string; icon: any }>>(() => [
  { key: 'overview', label: t('project.detail.tabOverviewLabel'), icon: LayoutDashboard },
  { key: 'config', label: t('project.detail.tabConfigLabel'), icon: SlidersHorizontal },
  { key: 'integration', label: t('project.detail.tabDangerLabel'), icon: ShieldAlert },
])
onMounted(() => {
  try {
    const saved = localStorage.getItem(tabStorageKey.value)
    if (saved === 'overview' || saved === 'config' || saved === 'integration') {
      activeTab.value = saved
    }
  } catch {}
})
function switchTab(tab: DetailTab) {
  activeTab.value = tab
  try {
    localStorage.setItem(tabStorageKey.value, tab)
  } catch {}
}
</script>

<template>
  <!-- Skeleton Placeholder (only shown before initial data arrives) -->
  <div v-if="isInitialLoading" class="max-w-7xl mx-auto space-y-6 pb-12" aria-busy="true">
    <div class="flex items-start gap-3 sm:gap-4 mb-8 animate-pulse">
      <div class="w-9 h-9 rounded-full bg-border/40 shrink-0"></div>
      <div class="min-w-0 flex-1 space-y-3">
        <div class="flex items-center flex-wrap gap-2 sm:gap-3">
          <div class="h-7 w-48 rounded-md bg-border/40"></div>
          <div class="h-5 w-16 rounded-md bg-border/30"></div>
          <div class="h-7 w-24 rounded-md bg-border/30"></div>
          <div class="h-7 w-24 rounded-md bg-border/30"></div>
          <div class="h-7 w-24 rounded-md bg-border/30"></div>
        </div>
        <div class="h-3 w-72 rounded bg-border/30"></div>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-1 border-b border-border -mt-2 animate-pulse">
      <div class="h-9 w-24 rounded-t-md bg-border/30 mr-2"></div>
      <div class="h-9 w-24 rounded-t-md bg-border/20 mr-2"></div>
      <div class="h-9 w-20 rounded-t-md bg-border/20"></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
      <div class="lg:col-span-7 h-72 rounded-xl bg-panel border border-border"></div>
      <div class="lg:col-span-5 h-72 rounded-xl bg-panel border border-border"></div>
      <div class="lg:col-span-12 h-48 rounded-xl bg-panel border border-border"></div>
    </div>
  </div>

  <div v-else-if="project" class="max-w-7xl mx-auto space-y-6 pb-12">
    <!-- Header -->
    <div class="flex items-start gap-3 sm:gap-4 mb-8">
      <button 
        @click="router.back()"
        class="p-2 dark:hover:bg-white/10 hover:bg-black/10 rounded-full transition-colors text-textMuted hover:text-textMain shrink-0"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="min-w-0 flex-1">
        <div class="flex items-center flex-wrap gap-2 sm:gap-3">
          <h1 class="text-xl sm:text-2xl font-bold text-textMain tracking-tight truncate max-w-full">{{ project.name }}</h1>
          <span
            class="px-2.5 py-0.5 text-xs rounded-md border shrink-0"
            :class="project.status === 'success' ? 'bg-success/10 border-success/20 text-success' : 'bg-primary/10 border-primary/20 text-primary'"
          >
            {{ project.status }}
          </span>
          <router-link
            :to="`/projects/${projectId}/files`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <FolderOpen class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.detail.viewFiles') }}
          </router-link>
          <router-link
            :to="`/projects/${projectId}/logs`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <FileText class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.detail.runtimeLogs') }}
          </router-link>
          <router-link
            :to="`/audit?targetId=${projectId}`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <ScrollText class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.detail.auditHistory') }}
          </router-link>
          <router-link
            :to="`/terminal?projectId=${projectId}`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <TerminalSquare class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.detail.openTerminal') }}
          </router-link>
        </div>
        <p class="text-xs sm:text-sm text-textMuted mt-1 font-mono break-all">{{ project.id }}</p>
      </div>
    </div>

    <!-- Tab Navigation -->
    <nav class="flex flex-wrap items-center gap-1 border-b border-border -mt-2">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        @click="switchTab(tab.key)"
        class="inline-flex items-center px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === tab.key
          ? 'border-primary text-primary'
          : 'border-transparent text-textMuted hover:text-textMain hover:border-border'"
      >
        <component :is="tab.icon" class="w-4 h-4 mr-1.5" />
        {{ tab.label }}
      </button>
    </nav>

    <!-- ============== Overview Tab ============== -->
    <section v-show="activeTab === 'overview'" class="grid grid-cols-1 lg:grid-cols-12 gap-6">

    <!-- PM2 Status Panel (top, only when project has pm2AppName bound) -->
    <div
      v-if="(project.pm2AppName || '').trim()"
      class="lg:col-span-12 bg-panel border border-border rounded-xl shadow-sm overflow-hidden"
    >
      <div class="px-4 py-3 border-b border-border bg-base/40 flex items-center justify-between">
        <h3 class="text-sm font-semibold text-textMain flex items-center">
          <Activity class="w-4 h-4 mr-2 text-primary" />
          {{ t('project.detail.pm2StatusTitle') }}
          <code class="font-mono text-textMain bg-base border border-border px-1.5 py-0.5 rounded ml-2 text-[11px]">{{ project.pm2AppName }}</code>
          <span class="ml-2 text-[10px] text-textMuted">{{ t('project.detail.pm2AutoRefresh') }}</span>
        </h3>
        <button
          @click="refreshPm2Status"
          :disabled="pm2Loading"
          class="text-textMuted hover:text-textMain text-xs flex items-center disabled:opacity-50"
        >
          <RefreshCw class="w-3 h-3 mr-1" :class="pm2Loading ? 'animate-spin' : ''" />
          {{ t('project.detail.refresh') }}
        </button>
      </div>
      <div class="p-4">
        <div v-if="!pm2Status" class="text-xs text-textMuted">
          {{ pm2Loading ? t('project.detail.pm2Fetching') : t('project.detail.pm2NotFetched') }}
        </div>
        <div v-else-if="!pm2Available" class="text-xs text-yellow-500 flex items-start gap-1.5">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {{ pm2Status.message || t('project.detail.pm2NotAvailableMsg') }}
        </div>
        <div v-else-if="pm2Status.found === false" class="text-xs text-yellow-500 flex items-start gap-1.5">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {{ t('project.detail.pm2AppNotFoundPart1') }} <code class="font-mono text-textMain mx-1">{{ project.pm2AppName }}</code> {{ t('project.detail.pm2AppNotFoundPart2') }} <code class="font-mono text-textMain mx-1">pm2 list</code> {{ t('project.detail.pm2AppNotFoundPart3') }}
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" :class="pm2Status.status === 'online' ? 'bg-success' : 'bg-danger'"></span>
            <span class="text-textMuted">{{ t('project.detail.pm2StatusLabel') }}</span>
            <span class="text-textMain font-mono">{{ pm2Status.status || '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <Cpu class="w-3.5 h-3.5 text-textMuted" />
            <span class="text-textMuted">{{ t('project.detail.pm2CpuLabel') }}</span>
            <span class="text-textMain font-mono">{{ pm2Status.cpuPercent != null ? pm2Status.cpuPercent.toFixed(1) + '%' : '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <MemoryStick class="w-3.5 h-3.5 text-textMuted" />
            <span class="text-textMuted">{{ t('project.detail.pm2MemoryLabel') }}</span>
            <span class="text-textMain font-mono">{{ fmtBytes(pm2Status.memoryBytes) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">{{ t('project.detail.pm2PidLabel') }}</span>
            <span class="text-textMain font-mono">{{ pm2Status.pid ?? '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">{{ t('project.detail.pm2InstancesLabel') }}</span>
            <span class="text-textMain font-mono">{{ pm2Status.instances ?? 1 }} ({{ pm2Status.execMode || '—' }})</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">{{ t('project.detail.pm2UptimeLabel') }}</span>
            <span class="text-textMain font-mono">{{ fmtUptimeMs(pm2Status.uptimeMs) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">{{ t('project.detail.pm2RestartsLabel') }}</span>
            <span class="text-textMain font-mono">{{ pm2Status.restarts ?? 0 }}<span v-if="pm2Status.unstableRestarts" class="text-danger ml-1">{{ t('project.detail.pm2UnstableRestarts', { n: pm2Status.unstableRestarts }) }}</span></span>
          </div>
        </div>
      </div>
    </div>

      <!-- Deployment History Card -->
      <div class="lg:col-span-7 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-4 sm:px-6 py-4 sm:py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-textMain flex items-center">
              <History class="w-5 h-5 mr-2 text-primary" />
              {{ t('project.detail.deployHistoryTitle') }}
            </h2>
            <p class="text-sm text-textMuted mt-1">{{ t('project.detail.deployHistoryDesc') }}</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="loadDeployments"
              :disabled="isLoadingDeployments"
              class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all disabled:opacity-50"
            >
              <RefreshCw class="w-3.5 h-3.5 mr-1.5" :class="{ 'animate-spin': isLoadingDeployments }" />
              {{ t('project.detail.refresh') }}
            </button>
            <button
              @click="goLogBoard()"
              class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
            >
              <ScrollText class="w-3.5 h-3.5 mr-1.5" />
              {{ t('project.detail.viewAll') }}
            </button>
          </div>
        </div>

        <div class="p-6">
          <div v-if="isLoadingDeployments && deployments.length === 0" class="py-10 text-center text-sm text-textMuted">
            {{ t('project.detail.loading') }}
          </div>
          <div v-else-if="deployments.length === 0" class="py-10 text-center text-sm text-textMuted">
            {{ t('project.detail.noDeployRecords') }}
          </div>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="log in pagedDeployments"
              :key="log.id"
              class="flex items-center gap-3 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] -mx-2 px-2 rounded-md transition-colors"
            >
              <button
                @click="goLogBoard(log)"
                class="flex-1 min-w-0 text-left"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border"
                    :class="{
                      'bg-success/10 border-success/20 text-success': log.status === 'success',
                      'bg-danger/10 border-danger/20 text-danger': log.status === 'failed',
                      'bg-primary/10 border-primary/20 text-primary': log.status === 'running',
                    }"
                  >
                    {{ log.status }}
                  </span>
                  <span
                    v-if="(log as any).triggerSource === 'rollback'"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/10 border border-warning/20 text-warning"
                    :title="t('project.detail.rbTooltip')"
                  >
                    {{ t('project.detail.rbBadge') }}
                  </span>
                  <Archive
                    v-if="log.artifactPath"
                    class="w-3.5 h-3.5 text-success/70"
                    :aria-label="t('project.detail.archived')"
                  />
                  <ArchiveX
                    v-else
                    class="w-3.5 h-3.5 text-textMuted/50"
                    :aria-label="t('project.detail.noArchive')"
                  />
                  <span
                    role="button"
                    tabindex="0"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-base border border-border font-mono text-[10px] text-textMuted hover:text-primary hover:border-primary/40 transition-colors cursor-pointer"
                    :title="t('project.detail.copyFullIdTooltip', { id: log.id })"
                    @click.stop.prevent="copyDeploymentId(log.id, $event)"
                    @keydown.enter.stop.prevent="copyDeploymentId(log.id, $event)"
                  >
                    <CheckCheck v-if="copiedDeployId === log.id" class="w-3 h-3 text-success" />
                    <Copy v-else class="w-3 h-3" />
                    {{ shortId(log.id) }}
                  </span>
                  <span
                    v-if="log.id === currentDeploymentId"
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/10 border border-success/30 text-success"
                    :title="t('project.detail.currentVersionTooltip')"
                  >{{ t('project.detail.currentVersion') }}</span>
                  <span class="text-xs text-textMuted">·</span>
                  <span class="text-xs text-textMuted truncate">{{ formatStart(log.startTime) }}</span>
                  <span v-if="log.duration" class="text-xs text-textMuted">· {{ log.duration }}</span>
                </div>
              </button>
              <button
                v-if="canRollbackLog(log)"
                @click.stop="openRollback(log)"
                class="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-warning/10 text-warning border border-warning/20 hover:bg-warning hover:text-white rounded-md transition-all"
              >
                <RotateCcw class="w-3 h-3 mr-1" />
                {{ t('project.detail.rollbackToThisVersion') }}
              </button>
              <span
                v-else-if="rollbackDisabledReason(log)"
                class="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-base text-textMuted/60 border border-border rounded-md cursor-not-allowed"
                :title="rollbackDisabledReason(log)"
              >
                {{ t('project.detail.cannotRollback') }}
              </span>
            </li>
          </ul>

          <div
            v-if="deployments.length > DEPLOYMENT_PAGE_SIZE"
            class="mt-4 flex items-center justify-between text-xs text-textMuted"
          >
            <span class="font-mono">
              {{ t('project.detail.pageRange', { from: deploymentPageRange.from, to: deploymentPageRange.to, total: deploymentPageRange.total }) }}
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="deploymentPage === 1"
                class="inline-flex items-center px-2.5 py-1 text-xs bg-base border border-border rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 hover:text-primary"
                @click="goPrevDeploymentPage"
              >
                <ChevronLeft class="w-3.5 h-3.5 mr-1" />
                {{ t('project.detail.pagePrev') }}
              </button>
              <span class="font-mono">
                {{ t('project.detail.pageIndicator', { current: deploymentPage, total: totalDeploymentPages }) }}
              </span>
              <button
                type="button"
                :disabled="deploymentPage >= totalDeploymentPages"
                class="inline-flex items-center px-2.5 py-1 text-xs bg-base border border-border rounded-md transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:border-primary/50 hover:text-primary"
                @click="goNextDeploymentPage"
              >
                {{ t('project.detail.pageNext') }}
                <ChevronRight class="w-3.5 h-3.5 ml-1" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Token Management Card -->
      <div class="lg:col-span-5 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Key class="w-5 h-5 mr-2 text-primary" />
            {{ t('project.detail.tokenManageTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">{{ t('project.detail.tokenManageDesc') }}</p>
        </div>

        <div class="p-6">
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center space-y-4 sm:space-y-0 sm:space-x-4">
            <div class="relative flex-1">
              <input
                :type="isTokenVisible ? 'text' : 'password'"
                readonly
                :value="project.token || t('project.detail.tokenEmptyPlaceholder')"
                class="w-full bg-base border border-border rounded-md pl-4 pr-12 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary/50 transition-colors"
                :class="{'opacity-50 blur-[2px] select-none': !isTokenVisible && project.token}"
              />
              <button
                v-if="project.token"
                @click="isTokenVisible = !isTokenVisible"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain text-xs font-medium px-2 py-1 rounded transition-colors"
              >
                {{ isTokenVisible ? t('project.detail.hideToken') : t('project.detail.showToken') }}
              </button>
            </div>

            <div class="flex items-center space-x-2">
              <button
                @click="copyToken"
                :disabled="!project.token"
                class="flex items-center justify-center px-4 py-3 bg-base border border-border hover:border-primary/50 hover:text-primary text-textMain rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
              >
                <CheckCircle2 v-if="isCopied" class="w-4 h-4 mr-2 text-success" />
                <Copy v-else class="w-4 h-4 mr-2" />
                {{ isCopied ? t('project.detail.copied') : t('project.detail.copy') }}
              </button>
              <button
                @click="refreshToken"
                class="flex items-center justify-center px-4 py-3 bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-white rounded-md transition-all w-full sm:w-auto font-medium shadow-[0_0_10px_rgba(59,130,246,0.1)] hover:shadow-[0_0_15px_rgba(59,130,246,0.4)]"
              >
                <RefreshCw class="w-4 h-4 mr-2" />
                {{ t('project.detail.regenerate') }}
              </button>
            </div>
          </div>

          <div class="mt-4 p-4 rounded-md bg-primary/5 border border-primary/10 text-sm">
            <p class="text-textMuted leading-relaxed">
              <strong class="text-primary font-medium">{{ t('project.detail.cliUsage') }}</strong> {{ t('project.detail.cliUsageDetailPart1') }}<code class="bg-base px-1 py-0.5 rounded font-mono text-xs text-textMain border border-border">kite push</code> {{ t('project.detail.cliUsageDetailPart2') }}
            </p>
          </div>
        </div>
      </div>

      <!-- CLI Help Card -->
      <div class="lg:col-span-12 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div
          class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02] cursor-pointer select-none hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
          :class="{ 'border-b-0': cliHelpCollapsed }"
          @click="toggleCliHelp"
          role="button"
          :aria-expanded="!cliHelpCollapsed"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-textMain flex items-center">
                <TerminalSquare class="w-5 h-5 mr-2 text-primary" />
                {{ t('project.detail.cliGuideTitle') }}
              </h2>
              <p class="text-sm text-textMuted mt-1">
                <template v-if="cliHelpCollapsed && deployments.length > 0">
                  {{ t('project.detail.cliGuideCollapsedHint') }}
                </template>
                <template v-else>
                  {{ t('project.detail.cliGuideExpandedHint') }}
                </template>
              </p>
            </div>
            <component
              :is="cliHelpCollapsed ? ChevronDown : ChevronUp"
              class="w-5 h-5 text-textMuted shrink-0"
            />
          </div>
        </div>

        <div v-show="!cliHelpCollapsed" class="p-6 space-y-5">
          <!-- Env selector -->
          <div class="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.cliEnvLabel') }}</label>
            <div class="flex items-center gap-3">
              <input
                v-model="cliEnv"
                type="text"
                class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                :placeholder="t('project.detail.cliEnvPlaceholder')"
                @keydown.enter.prevent="saveEnv"
              />
              <button
                @click="saveEnv"
                :disabled="!envDirty || isSavingEnv"
                class="flex items-center px-3 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                :title="envDirty ? t('project.detail.cliEnvSaveTitleDirty') : t('project.detail.cliEnvSaveTitleClean')"
              >
                <RefreshCw v-if="isSavingEnv" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
                <Save v-else class="w-3.5 h-3.5 mr-1.5" />
                {{ t('project.detail.save') }}
              </button>
            </div>
            <p class="text-xs text-textMuted mt-2">
              {{ t('project.detail.cliEnvHintPart1') }} <code class="font-mono text-textMain">--env</code> {{ t('project.detail.cliEnvHintPart2') }}
              <code class="font-mono text-textMain">{{ configFileName }}</code>{{ t('project.detail.cliEnvHintPart3') }}
            </p>
          </div>

          <!-- Step 1: 安装 CLI -->
          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-2">{{ t('project.detail.step1Title') }}</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs text-success font-mono break-all">{{ installCommand }}</code>
              <button @click="copyCommand('install', installCommand)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'install' ? t('project.detail.copied') : t('project.detail.copy') }}
              </button>
            </div>
          </div>

          <!-- Step 2: 初始化配置 -->
          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-2">{{ t('project.detail.step2Title') }}</p>
            <div class="flex items-center gap-2 mb-4">
              <code class="flex-1 text-xs text-success font-mono break-all">{{ initCommand }}</code>
              <button @click="copyCommand('init', initCommand)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'init' ? t('project.detail.copied') : t('project.detail.copy') }}
              </button>
            </div>
            <p class="text-xs text-textMuted mb-3">{{ t('project.detail.step2HintPart1') }} <code class="font-mono text-textMain bg-panel px-1 py-0.5 rounded border border-border">{{ configFileName }}</code>{{ t('project.detail.step2HintPart2') }}</p>
            <pre class="text-xs text-success font-mono whitespace-pre-wrap overflow-x-auto bg-panel rounded-md p-3 border border-border mb-3">{{ configExample }}</pre>
            <div class="space-y-2 text-xs text-textMuted">
              <p><code class="font-mono text-textMain">projectId</code> {{ t('project.detail.fieldProjectIdHint') }}</p>
              <p><code class="font-mono text-textMain">outputDir</code> {{ t('project.detail.fieldOutputDirHintPart1') }} <code class="font-mono">./dist</code></p>
              <p><code class="font-mono text-textMain">files</code> {{ t('project.detail.fieldFilesHint') }}</p>
              <div class="pl-3 space-y-1">
                <div v-for="ex in configFilesExamples" :key="ex.label" class="flex items-center gap-2">
                  <span class="text-textMuted w-24 shrink-0">{{ ex.label }}</span>
                  <code class="text-success font-mono">"files": {{ JSON.stringify(ex.files) }}</code>
                </div>
              </div>
              <p><code class="font-mono text-textMain">postDeploy</code> {{ t('project.detail.fieldPostDeployHint') }}</p>
            </div>
          </div>

          <!-- Step 3: 部署 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">{{ t('project.detail.step3SavedTitle') }}</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ pushCommand }}</code>
                <button @click="copyCommand('push', pushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'push' ? t('project.detail.copied') : t('project.detail.copy') }}
                </button>
              </div>
              <p class="text-xs text-textMuted mt-2">{{ t('project.detail.step3SavedHintPart1') }} <code class="font-mono">kite config:set token</code> {{ t('project.detail.step3SavedHintPart2') }} <code class="font-mono">--token-store global</code> {{ t('project.detail.step3SavedHintPart3') }}</p>
            </div>

            <div class="rounded-lg border border-border bg-base p-4 space-y-3">
              <p class="text-sm font-medium text-textMain mb-2">{{ t('project.detail.step3OverrideTitle') }}</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-20 shrink-0">{{ t('project.detail.useGlobalToken') }}</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushCommand }}</code>
                <button @click="copyCommand('direct-push', directPushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push' ? t('project.detail.copied') : t('project.detail.copy') }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-20 shrink-0">{{ t('project.detail.specifyProjectToken') }}</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushWithTokenCommand }}</code>
                <button @click="copyCommand('direct-push-token', directPushWithTokenCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push-token' ? t('project.detail.copied') : t('project.detail.copy') }}
                </button>
              </div>
            </div>
          </div>

          <!-- Tip: Token 设置方式 -->
          <div class="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <p class="text-sm text-textMain leading-relaxed">
              <strong class="text-primary font-medium">{{ t('project.detail.tokenSetupTitle') }}</strong>
              <span class="text-textMuted">{{ t('project.detail.tokenSetupSubtitle') }}</span>
            </p>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-28 shrink-0">{{ t('project.detail.tokenSetProject') }}</span>
                <code class="flex-1 text-xs text-success font-mono break-all bg-base px-2 py-1 rounded border border-border">{{ tokenSetProjectCommand }}</code>
                <button
                  @click="copyCommand('token-set-project', tokenSetProjectCommand)"
                  :disabled="!project?.token"
                  class="text-xs text-primary hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  :title="project?.token ? t('project.detail.copyCommandTitle') : t('project.detail.generateTokenFirst')"
                >
                  {{ copiedCommand === 'token-set-project' ? t('project.detail.copied') : t('project.detail.copy') }}
                </button>
              </div>
              <p class="text-xs text-textMuted pl-[120px] -mt-1">{{ t('project.detail.tokenSetProjectHintPart1') }} <code class="font-mono">{{ configFileName }}</code> {{ t('project.detail.tokenSetProjectHintPart2') }} <code class="font-mono">~/.kite/config.json</code> {{ t('project.detail.tokenSetProjectHintPart3') }}</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-28 shrink-0">{{ t('project.detail.tokenSetGlobal') }}</span>
                <code class="flex-1 text-xs text-success font-mono break-all bg-base px-2 py-1 rounded border border-border">{{ tokenSetGlobalCommand }}</code>
                <button
                  @click="copyCommand('token-set-global', tokenSetGlobalCommand)"
                  :disabled="!project?.token"
                  class="text-xs text-primary hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  :title="project?.token ? t('project.detail.copyCommandTitle') : t('project.detail.generateTokenFirst')"
                >
                  {{ copiedCommand === 'token-set-global' ? t('project.detail.copied') : t('project.detail.copy') }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-28 shrink-0">.env.local</span>
                <code class="flex-1 text-xs text-success font-mono break-all bg-base px-2 py-1 rounded border border-border">{{ tokenEnvLocalLine }}</code>
                <button
                  @click="copyCommand('token-env-local', tokenEnvLocalLine)"
                  :disabled="!project?.token"
                  class="text-xs text-primary hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  :title="project?.token ? t('project.detail.copyEnvLocalLine') : t('project.detail.generateTokenFirst')"
                >
                  {{ copiedCommand === 'token-env-local' ? t('project.detail.copied') : t('project.detail.copy') }}
                </button>
              </div>
            </div>
            <p v-if="!project?.token" class="text-xs text-yellow-500">
              {{ t('project.detail.tokenNotGenerated') }}
            </p>
            <p class="text-sm text-textMuted leading-relaxed">
              {{ t('project.detail.configPriorityPart1') }}<strong class="text-primary">{{ t('project.detail.cfgCliParams') }}</strong> &gt; <strong class="text-primary">{{ t('project.detail.cfgEnvLocal') }}</strong> &gt; <strong class="text-primary">{{ t('project.detail.cfgProjectToken') }}</strong> &gt; <strong class="text-primary">{{ t('project.detail.cfgGlobalToken') }}</strong>{{ t('project.detail.configPriorityPart2') }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ============== Configuration Tab ============== -->
    <section v-show="activeTab === 'config'" class="grid grid-cols-1 lg:grid-cols-12 gap-6">

      <!-- Project Basics Card -->
      <div class="lg:col-span-5 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <FileText class="w-5 h-5 mr-2 text-primary" />
            {{ t('project.detail.basicInfoTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">{{ t('project.detail.basicInfoDesc') }}</p>
        </div>

        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.categoryLabel') }}</label>
            <select
              v-model="formData.categoryId"
              class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            >
              <option value="">{{ t('project.detail.categoryDefaultOption') }}</option>
              <option v-for="c in projectStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <p class="text-xs text-textMuted mt-2">{{ t('project.detail.categoryHint') }}</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.tagsLabel') }}</label>
            <ProjectTagsEditor
              :model-value="formData.tagIds"
              size="md"
              read-only-save
              :aria-label="t('project.detail.tagsEditAriaLabel')"
              @update:model-value="(v) => formData.tagIds = v"
            />
            <p class="text-xs text-textMuted mt-2">{{ t('project.detail.tagsHint') }}</p>
          </div>

          <div class="pt-4 border-t border-border flex justify-end">
            <button
              @click="saveBasics"
              :disabled="isSavingBasics"
              class="flex items-center px-5 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium disabled:opacity-50"
            >
              <RefreshCw v-if="isSavingBasics" class="w-4 h-4 mr-2 animate-spin" />
              <Save v-else class="w-4 h-4 mr-2" />
              {{ isSavingBasics ? t('project.detail.saving') : t('project.detail.saveBasics') }}
            </button>
          </div>
        </div>
      </div>

      <!-- PM2 App Binding Card -->
      <div class="lg:col-span-7 bg-panel border border-border rounded-xl shadow-sm overflow-visible">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Activity class="w-5 h-5 mr-2 text-primary" />
            {{ t('project.detail.pm2BindingTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">{{ t('project.detail.pm2BindingDesc') }}</p>
        </div>

        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2 flex items-center">
              {{ t('project.detail.pm2AppLabel') }}
              <span v-if="pm2Available" class="ml-2 text-[10px] text-success border border-success/40 bg-success/10 px-1.5 py-0.5 rounded">{{ t('project.detail.pm2DetectedYes') }}</span>
              <span v-else class="ml-2 text-[10px] text-textMuted border border-border bg-base px-1.5 py-0.5 rounded">{{ t('project.detail.pm2DetectedNo') }}</span>
            </label>

            <!-- Mode A: dropdown picker (PM2 available + apps non-empty + not manual) -->
            <div
              v-if="pm2DropdownAvailable"
              class="relative"
              data-pm2-picker-root
            >
              <button
                type="button"
                @click.stop="togglePm2Picker"
                class="w-full flex items-center justify-between bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              >
                <span :class="formData.pm2AppName.trim() ? 'text-textMain' : 'text-textMuted font-sans'">
                  {{ formData.pm2AppName.trim() || t('project.detail.pm2PickPlaceholder') }}
                </span>
                <ChevronDown class="w-4 h-4 text-textMuted shrink-0" :class="pm2PickerOpen ? 'rotate-180' : ''" />
              </button>
              <div
                v-if="pm2PickerOpen"
                class="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto bg-panel border border-border rounded-md shadow-lg"
              >
                <button
                  v-if="formData.pm2AppName.trim()"
                  type="button"
                  @click.stop="pickPm2App('')"
                  class="flex items-center w-full px-3 py-2 text-sm text-textMuted hover:bg-white/5 transition-colors border-b border-border"
                >
                  <XCircle class="w-3.5 h-3.5 mr-2" />
                  {{ t('project.detail.pm2Unbind') }}
                </button>
                <button
                  v-for="app in pm2Apps"
                  :key="app.pmId + ':' + app.name"
                  type="button"
                  @click.stop="pickPm2App(app.name)"
                  class="flex items-center justify-between w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
                >
                  <span class="flex items-center min-w-0">
                    <Check
                      v-if="formData.pm2AppName.trim() === app.name"
                      class="w-3.5 h-3.5 mr-2 text-primary shrink-0"
                    />
                    <span v-else class="w-3.5 h-3.5 mr-2 shrink-0"></span>
                    <span class="font-mono truncate">{{ app.name }}</span>
                  </span>
                  <span class="flex items-center gap-2 shrink-0 ml-3">
                    <span class="text-[10px] text-textMuted font-mono">#{{ app.pmId }}</span>
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded border"
                      :class="app.status === 'online'
                        ? 'text-success border-success/40 bg-success/10'
                        : 'text-textMuted border-border bg-base'"
                    >
                      {{ app.status }}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  @click.stop="enterPm2ManualMode"
                  class="flex items-center w-full px-3 py-2 text-sm text-textMuted hover:bg-white/5 transition-colors border-t border-border"
                >
                  <Pencil class="w-3.5 h-3.5 mr-2" />
                  {{ t('project.detail.pm2ManualInput') }}
                </button>
              </div>
            </div>

            <!-- Mode B: manual input (PM2 unavailable / apps empty / user opted in) -->
            <div v-else>
              <input
                v-model="formData.pm2AppName"
                type="text"
                list="pm2-apps-suggest"
                spellcheck="false"
                class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder="e.g. my-api / web-server"
              />
              <datalist id="pm2-apps-suggest">
                <option v-for="app in pm2Apps" :key="app.pmId + ':' + app.name" :value="app.name" />
              </datalist>
              <button
                v-if="pm2Available && pm2Apps.length > 0"
                type="button"
                @click="pm2ManualMode = false"
                class="mt-2 text-xs text-primary hover:text-textMain inline-flex items-center"
              >
                <ChevronDown class="w-3.5 h-3.5 mr-1" />
                {{ t('project.detail.pm2UseDropdown') }}
              </button>
            </div>

            <!-- Conflict (non-blocking warning) -->
            <div
              v-if="pm2ConflictProjects.length > 0"
              class="mt-2 flex items-start gap-2 text-xs text-yellow-500 border border-yellow-500/30 bg-yellow-500/5 rounded-md px-3 py-2"
            >
              <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div class="leading-relaxed">
                {{ t('project.detail.pm2ConflictPart1') }}
                <template v-for="(p, idx) in pm2ConflictProjects" :key="p.id">
                  <router-link
                    :to="`/projects/${p.id}`"
                    class="font-medium text-yellow-500 hover:text-yellow-400 underline underline-offset-2 mx-0.5"
                  >「{{ p.name }}」</router-link><span v-if="idx < pm2ConflictProjects.length - 1">、</span>
                </template>
                {{ t('project.detail.pm2ConflictPart2') }}
              </div>
            </div>

            <p class="text-xs text-textMuted mt-2">
              {{ t('project.detail.pm2BindHintPart1') }} <code class="font-mono">pm2 jlist</code>{{ t('project.detail.pm2BindHintPart2') }}
            </p>
          </div>

          <div class="pt-4 border-t border-border flex justify-end">
            <button
              @click="savePm2Binding"
              :disabled="isSavingPm2"
              class="flex items-center px-5 py-2 text-sm bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium disabled:opacity-50"
            >
              <RefreshCw v-if="isSavingPm2" class="w-4 h-4 mr-2 animate-spin" />
              <Save v-else class="w-4 h-4 mr-2" />
              {{ isSavingPm2 ? t('project.detail.saving') : t('project.detail.savePm2Binding') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Execution Scripts Card -->
      <div class="lg:col-span-7 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <TerminalSquare class="w-5 h-5 mr-2 text-primary" />
            {{ t('project.detail.scriptsTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">{{ t('project.detail.scriptsDesc') }}</p>
        </div>
        
        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.destPathLabel') }}</label>
            <input
              v-model="formData.destPath"
              type="text"
              class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="e.g. /var/www/my-project"
            />
            <p class="text-xs text-textMuted mt-2">{{ t('project.detail.destPathHint') }}</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.preDeployLabel') }}</label>
            <div class="relative">
              <div class="absolute left-0 top-0 bottom-0 w-8 bg-base border-r border-border rounded-l-md flex flex-col items-center py-3 text-textMuted font-mono text-xs select-none">
                <span>1</span>
              </div>
              <textarea 
                v-model="formData.preDeploy"
                class="w-full bg-base border border-border rounded-md pl-11 pr-4 py-3 text-success font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all min-h-[100px] resize-y"
                placeholder="# e.g. npm install && npm run build"
                spellcheck="false"
              ></textarea>
            </div>
            <p class="text-xs text-textMuted mt-2">{{ t('project.detail.preDeployHint') }}</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.postDeployLabel') }}</label>
            <div class="relative">
              <div class="absolute left-0 top-0 bottom-0 w-8 bg-base border-r border-border rounded-l-md flex flex-col items-center py-3 text-textMuted font-mono text-xs select-none">
                <span>1</span>
              </div>
              <textarea 
                v-model="formData.postDeploy"
                class="w-full bg-base border border-border rounded-md pl-11 pr-4 py-3 text-success font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all min-h-[100px] resize-y"
                placeholder="# e.g. pm2 restart api-server"
                spellcheck="false"
              ></textarea>
            </div>
            <p class="text-xs text-textMuted mt-2">{{ t('project.detail.postDeployHint') }}</p>
            <label class="mt-3 flex items-start space-x-2 cursor-pointer select-none">
              <input
                v-model="formData.postDeployAsync"
                type="checkbox"
                class="mt-0.5 w-4 h-4 rounded border-border bg-base text-primary focus:ring-1 focus:ring-primary/50"
              />
              <span class="text-xs text-textMuted leading-relaxed">
                <span class="text-textMain font-medium">{{ t('project.detail.asyncExecLabel') }}</span>
                {{ t('project.detail.asyncExecHint') }}
                <span class="text-danger">{{ t('project.detail.asyncExecWarnPart1') }} <code class="font-mono">nohup</code> {{ t('project.detail.asyncExecWarnPart2') }} <code class="font-mono">pm2</code> {{ t('project.detail.asyncExecWarnPart3') }} <code class="font-mono">setsid</code> {{ t('project.detail.asyncExecWarnPart4') }}</span>
              </span>
            </label>
          </div>

          <div class="pt-4 border-t border-border flex justify-end">
            <button 
              @click="saveScripts"
              :disabled="isSavingScripts"
              class="flex items-center px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium shadow-[0_0_15px_rgba(59,130,246,0.3)] disabled:opacity-50"
            >
              <RefreshCw v-if="isSavingScripts" class="w-4 h-4 mr-2 animate-spin" />
              <Save v-else class="w-4 h-4 mr-2" />
              {{ isSavingScripts ? t('project.detail.saving') : t('project.detail.saveScripts') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Clean Strategy Card -->
      <div class="lg:col-span-5 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Shield class="w-5 h-5 mr-2 text-primary" />
            {{ t('project.detail.cleanStrategyTitle') }}
          </h2>
          <p class="text-sm text-textMuted mt-1">{{ t('project.detail.cleanStrategyDescPart1') }} <code class="font-mono text-textMain">merge</code> {{ t('project.detail.cleanStrategyDescPart2') }}</p>
        </div>
        <div class="p-6 space-y-5">
          <!-- Mode picker -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label
              v-for="opt in cleanModeOptions"
              :key="opt.value"
              class="relative flex flex-col p-4 rounded-lg border-2 cursor-pointer transition-all"
              :class="cleanForm.cleanMode === opt.value
                ? (opt.tone === 'danger' ? 'border-danger bg-danger/5' : opt.tone === 'warning' ? 'border-yellow-400 bg-yellow-400/5' : 'border-primary bg-primary/5')
                : 'border-border hover:border-textMuted/50 bg-base'"
            >
              <input type="radio" v-model="cleanForm.cleanMode" :value="opt.value" class="sr-only" />
              <span class="text-sm font-semibold font-mono"
                :class="opt.tone === 'danger' ? 'text-danger' : opt.tone === 'warning' ? 'text-yellow-400' : 'text-primary'"
              >{{ opt.title }}</span>
              <span class="text-xs text-textMuted mt-1 leading-relaxed">{{ opt.desc }}</span>
              <CheckCircle2
                v-if="cleanForm.cleanMode === opt.value"
                class="absolute top-2 right-2 w-4 h-4"
                :class="opt.tone === 'danger' ? 'text-danger' : opt.tone === 'warning' ? 'text-yellow-400' : 'text-primary'"
              />
            </label>
          </div>

          <!-- ProtectPaths -->
          <div v-if="cleanForm.cleanMode === 'clean'">
            <label class="block text-sm font-medium text-textMain mb-2">{{ t('project.detail.protectPathsLabel') }}</label>
            <p class="text-xs text-textMuted mb-2">
              {{ t('project.detail.protectPathsHintPart1') }}<code class="font-mono text-textMain">.kite-*</code> {{ t('project.detail.protectPathsHintPart2') }}<code class="font-mono text-textMain">uploads/**</code>、<code class="font-mono text-textMain">.env</code>、<code class="font-mono text-textMain">config/*.json</code>
            </p>
            <div class="flex gap-2 mb-3">
              <input
                v-model="protectInput"
                type="text"
                class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                :placeholder="t('project.detail.protectInputPlaceholder')"
                @keydown.enter.prevent="addProtectPath"
              />
              <button
                @click="addProtectPath"
                type="button"
                class="flex items-center px-3 bg-base border border-border hover:border-primary/50 hover:text-primary text-textMain rounded-md transition-all"
              >
                <Plus class="w-4 h-4 mr-1" />
                {{ t('project.detail.addBtn') }}
              </button>
            </div>
            <div v-if="cleanForm.protectPaths.length" class="flex flex-wrap gap-2">
              <span
                v-for="g in cleanForm.protectPaths"
                :key="g"
                class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-success/10 border border-success/30 text-success font-mono"
              >
                {{ g }}
                <button @click="removeProtectPath(g)" type="button" class="text-success/70 hover:text-danger">
                  <XCircle class="w-3 h-3" />
                </button>
              </span>
            </div>
            <p v-else class="text-xs text-textMuted italic">{{ t('project.detail.protectPathsEmpty') }}</p>
          </div>

          <div v-if="cleanForm.cleanMode === 'clean-all'" class="p-3 rounded-md bg-danger/10 border border-danger/30 flex items-start gap-2">
            <ShieldAlert class="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p class="text-xs text-danger leading-relaxed">
              {{ t('project.detail.cleanAllWarnPart1') }}<strong>{{ t('project.detail.cleanAllWarnStrong') }}</strong>{{ t('project.detail.cleanAllWarnPart2') }} <code class="font-mono bg-base px-1 rounded">.kite-*</code>{{ t('project.detail.cleanAllWarnPart3') }}
            </p>
          </div>

          <!-- Action bar -->
          <div class="pt-3 border-t border-border flex items-center justify-end gap-3">
            <button
              v-if="cleanForm.cleanMode !== 'merge'"
              @click="openPreview"
              type="button"
              class="flex items-center px-4 py-2 text-sm bg-base border border-border hover:border-yellow-400/50 hover:text-yellow-400 text-textMain rounded-md transition-all"
            >
              <Eye class="w-4 h-4 mr-2" />
              {{ t('project.detail.previewDryRun') }}
            </button>
            <button
              @click="saveCleanConfig"
              :disabled="isSavingClean"
              class="flex items-center px-6 py-2.5 text-sm font-medium rounded-md transition-all disabled:opacity-50"
              :class="cleanForm.cleanMode === 'clean-all'
                ? 'bg-danger text-white hover:bg-danger/90'
                : 'bg-primary text-white hover:bg-primary/90 shadow-[0_0_15px_rgba(59,130,246,0.3)]'"
            >
              <Save class="w-4 h-4 mr-2" />
              {{ isSavingClean ? t('project.detail.saving') : t('project.detail.saveCleanStrategy') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ============== Danger Tab ============== -->
    <section v-show="activeTab === 'integration'" class="space-y-6">

      <!-- Danger Zone -->
      <div class="bg-panel border border-danger/20 rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-4">
          <h3 class="text-danger font-medium flex items-center">
            <Trash2 class="w-4 h-4 mr-2" />
            {{ t('project.detail.dangerZone') }}
          </h3>
          <div class="mt-4 flex items-start justify-between gap-4">
            <div class="text-sm text-textMuted space-y-1">
              <p>{{ t('project.detail.dangerLine1') }}</p>
              <p class="text-textMuted/80">{{ t('project.detail.dangerLine2') }}</p>
            </div>
            <button @click="openDeleteModal" class="shrink-0 px-4 py-2 bg-danger/10 hover:bg-danger text-danger hover:text-white border border-danger/20 hover:border-danger rounded-md transition-colors text-sm font-medium">
              {{ t('project.detail.deleteProject') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="closeDeleteModal"
    >
      <div class="bg-panel border border-danger/30 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div class="flex items-start space-x-3 mb-5">
          <div class="p-2 rounded-lg bg-danger/10 border border-danger/20 shrink-0">
            <AlertTriangle class="w-5 h-5 text-danger" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-textMain">{{ t('project.detail.deleteModalTitle') }}</h2>
            <p class="text-sm text-textMuted mt-1">
              {{ t('project.detail.deleteModalIntroPart1') }}
              <span class="font-mono text-textMain">{{ project?.name }}</span>
              {{ t('project.detail.deleteModalIntroPart2') }}<span class="font-mono text-textMuted">{{ projectId }}</span>{{ t('project.detail.deleteModalIntroPart3') }}
            </p>
          </div>
        </div>

        <div class="space-y-3 mb-5">
          <div class="bg-danger/5 border border-danger/20 rounded-lg p-3">
            <p class="text-xs font-medium text-danger mb-2 flex items-center">
              <XCircle class="w-3.5 h-3.5 mr-1.5" />
              {{ t('project.detail.deletePermanentBoxTitle') }}
            </p>
            <ul class="text-xs text-textMain/90 space-y-1 list-disc list-inside marker:text-danger/60">
              <li>{{ t('project.detail.deletePermanentItem1') }}</li>
              <li>{{ t('project.detail.deletePermanentItem2Part1') }}<span class="font-medium">{{ t('project.detail.deletePermanentItem2Strong') }}</span>{{ t('project.detail.deletePermanentItem2Part2') }}</li>
            </ul>
          </div>

          <div class="bg-success/5 border border-success/20 rounded-lg p-3">
            <p class="text-xs font-medium text-success mb-2 flex items-center">
              <CheckCircle2 class="w-3.5 h-3.5 mr-1.5" />
              {{ t('project.detail.deleteKeptBoxTitle') }}
            </p>
            <ul class="text-xs text-textMain/90 space-y-1 list-disc list-inside marker:text-success/60">
              <li>
                {{ t('project.detail.deleteKeptItem1Part1') }}
                <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">{{ project?.destPath || '—' }}</code>
                {{ t('project.detail.deleteKeptItem1Part2') }}
              </li>
              <li>{{ t('project.detail.deleteKeptItem2') }}</li>
              <li>{{ t('project.detail.deleteKeptItem3Part1') }} <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">kite.config*.json</code> {{ t('project.detail.deleteKeptItem3Part2') }} <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">.env.local</code> {{ t('project.detail.deleteKeptItem3Part3') }}</li>
            </ul>
          </div>
        </div>

        <div class="mb-2">
          <label class="block text-sm font-medium text-textMuted mb-1.5">
            {{ t('project.detail.deleteConfirmInputPart1') }}
            <span class="font-mono text-textMain">{{ expectedConfirmName }}</span>
            {{ t('project.detail.deleteConfirmInputPart2') }}
          </label>
          <input
            v-model="deleteConfirmText"
            type="text"
            :disabled="isDeleting"
            :placeholder="expectedConfirmName"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-danger focus:ring-1 focus:ring-danger/50 transition-all text-sm disabled:opacity-60"
            @keydown.enter.prevent="confirmDelete"
          />
        </div>

        <p v-if="deleteError" class="text-xs text-danger mt-2">{{ deleteError }}</p>

        <div class="mt-6 flex justify-end space-x-3">
          <button
            @click="closeDeleteModal"
            :disabled="isDeleting"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ t('project.detail.cancel') }}
          </button>
          <button
            @click="confirmDelete"
            :disabled="!canConfirmDelete"
            class="px-4 py-2 text-sm font-medium bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isDeleting" class="w-4 h-4 mr-2 animate-spin" />
            <Trash2 v-else class="w-4 h-4 mr-2" />
            {{ isDeleting ? t('project.detail.deletingBtn') : t('project.detail.deleteForeverBtn') }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model:open="showRefreshTokenModal"
      tone="warning"
      :title="t('project.detail.refreshTokenTitle')"
      :message="t('project.detail.refreshTokenMessage')"
      :confirm-text="t('project.detail.regenerateBtn')"
      :cancel-text="t('project.detail.cancel')"
      :loading="isRefreshingToken"
      @confirm="confirmRefreshToken"
    />

    <CleanPreviewDialog
      v-model:open="showPreview"
      :loading="previewLoading"
      :error="previewError"
      :preview="previewData"
      :mode="cleanForm.cleanMode === 'merge' ? 'clean' : cleanForm.cleanMode"
      :protect-paths="cleanForm.protectPaths"
    />

    <ConfirmDialog
      v-model:open="showCleanAllConfirm"
      tone="danger"
      :title="t('project.detail.cleanAllConfirmTitle')"
      :message="t('project.detail.cleanAllConfirmMessage')"
      :confirm-text="t('project.detail.cleanAllConfirmBtn')"
      :cancel-text="t('project.detail.cancel')"
      :require-text="expectedConfirmName"
      :require-text-hint="t('project.detail.cleanAllConfirmHint', { name: expectedConfirmName })"
      :loading="isSavingClean"
      @confirm="commitCleanForm"
    />

    <ConfirmDialog
      v-model:open="showRollbackConfirm"
      tone="warning"
      :title="t('project.detail.rollbackConfirmTitle')"
      :message="rollbackTarget ? t('project.detail.rollbackConfirmMessage', { id: shortId(rollbackTarget.id), project: rollbackTarget.projectName }) : ''"
      :confirm-text="t('project.detail.rollbackConfirmBtn')"
      :cancel-text="t('project.detail.cancel')"
      :loading="isRollingBack"
      @confirm="confirmRollback"
    />
  </div>
</template>