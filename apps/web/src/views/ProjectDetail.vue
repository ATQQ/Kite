<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore, type CleanPreviewResult, type DeploymentLog, type Pm2AppStatus } from '../store/project'
import { ArrowLeft, Save, Key, Copy, RefreshCw, Trash2, CheckCircle2, TerminalSquare, FolderOpen, AlertTriangle, XCircle, ScrollText, Eye, Shield, ShieldAlert, Plus, History, RotateCcw, Archive, ArchiveX, CheckCheck, FileText, Activity, Cpu, MemoryStick, ChevronDown, ChevronUp, Pencil, Check, SlidersHorizontal, LayoutDashboard } from 'lucide-vue-next'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import CleanPreviewDialog from '../components/CleanPreviewDialog.vue'
import ProjectTagsEditor from '../components/ProjectTagsEditor.vue'
import { useToast } from '../composables/useToast'
import { useIntervalRaf } from '../composables/useIntervalRaf'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const toast = useToast()

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

onMounted(async () => {
  serverUrl.value = window.location.origin
  await projectStore.fetchProjects()
  await projectStore.fetchCategories()
  await projectStore.fetchTags()
  await loadPm2Available()
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
  } else {
    router.replace('/projects')
  }
  await loadDeployments()
  await refreshPm2Status()
})

const deployments = ref<DeploymentLog[]>([])
const isLoadingDeployments = ref(false)
const showRollbackConfirm = ref(false)
const isRollingBack = ref(false)
const rollbackTarget = ref<DeploymentLog | null>(null)

async function loadDeployments() {
  isLoadingDeployments.value = true
  try {
    await projectStore.fetchLogs()
    deployments.value = projectStore.logs
      .filter(l => l.projectId === projectId)
      .slice(0, 10)
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
    toast.success('已复制部署 ID', shortId(id))
    setTimeout(() => {
      if (copiedDeployId.value === id) copiedDeployId.value = ''
    }, 2000)
  } catch (e: any) {
    toast.error('复制失败', e?.message || '请手动选择文本复制')
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
  return !!log.artifactPath
}

function rollbackDisabledReason(log: DeploymentLog): string {
  if (!log) return ''
  if (log.status === 'running') return '部署进行中，无法回滚'
  if ((log as any).triggerSource === 'rollback') return '回滚记录不可再被回滚'
  if (!log.artifactPath) return '该版本归档已被清理或过早，无法回滚'
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
    toast.success('回滚已完成', `新部署 ${shortId(data.deployId)}`)
    showRollbackConfirm.value = false
    rollbackTarget.value = null
    await loadDeployments()
  } catch (e: any) {
    toast.error('回滚失败', e?.message || '未知错误')
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

const saveConfig = async () => {
  try {
    await projectStore.updateProject(projectId, {
      destPath: formData.value.destPath,
      preDeploy: formData.value.preDeploy,
      postDeploy: formData.value.postDeploy,
      postDeployAsync: formData.value.postDeployAsync,
      categoryId: formData.value.categoryId || null,
      env: cliEnv.value.trim(),
      pm2AppName: formData.value.pm2AppName.trim() || null,
      tagIds: [...formData.value.tagIds],
    })
    toast.success('配置已保存')
    await refreshPm2Status()
  } catch (e: any) {
    const conflict = e?.data?.conflictProject
    if (e?.status === 409 && conflict) {
      toast.error('保存失败', `部署目录已被项目「${conflict}」占用，请更换目录或修改对方项目`)
    } else {
      toast.error('保存失败', e?.message || '请稍后重试')
    }
  }
}

const isSavingEnv = ref(false)
const envDirty = computed(() => cliEnv.value.trim() !== (project.value?.env || ''))
async function saveEnv() {
  if (!envDirty.value || isSavingEnv.value) return
  isSavingEnv.value = true
  try {
    await projectStore.updateProject(projectId, { env: cliEnv.value.trim() })
    toast.success('部署环境已保存')
  } catch (e: any) {
    toast.error('保存失败', e?.message || '请稍后重试')
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
    await projectStore.updateProject(projectId, {
      cleanMode: cleanForm.value.cleanMode,
      protectPaths: cleanForm.value.protectPaths.length ? cleanForm.value.protectPaths : null,
    })
    toast.success('清理策略已保存', cleanForm.value.cleanMode === 'merge' ? '将沿用合并模式（零破坏）' : `下次部署会按 ${cleanForm.value.cleanMode} 执行`)
  } catch (e: any) {
    toast.error('保存失败', e?.message)
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
    toast.info('merge 模式不会删除任何文件，无需预览')
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
    previewError.value = e?.message || '预览失败'
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
      window.prompt('请手动复制以下内容（Ctrl/Cmd + C）：', value)
    })
  } else {
    window.prompt('请手动复制以下内容（Ctrl/Cmd + C）：', value)
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

const configFilesExamples = [
  { label: '打包所有文件', files: ['**/*'] },
  { label: '只上传 dist 目录', files: ['dist/**/*'] },
  { label: '指定多个目录', files: ['dist/**/*', 'public/**/*'] },
  { label: '单个文件', files: ['index.html'] },
  { label: '混合配置', files: ['dist/**/*', 'server.js', 'config/*.json'] },
]

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
    toast.success('Token 已重新生成', '旧 Token 已立即失效')
  } catch (e: any) {
    toast.error('Token 重置失败', e?.message)
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
      deleteError.value = '删除失败，请稍后重试'
    }
  } catch (e: any) {
    deleteError.value = e?.message || '删除失败，请稍后重试'
  } finally {
    isDeleting.value = false
  }
}

type DetailTab = 'overview' | 'config' | 'integration'
const tabStorageKey = computed(() => `kite:project-detail-tab:${projectId}`)
const activeTab = ref<DetailTab>('overview')
const tabs: Array<{ key: DetailTab; label: string; icon: any }> = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'config', label: '配置', icon: SlidersHorizontal },
  { key: 'integration', label: '危险区', icon: ShieldAlert },
]
onMounted(() => {
  try {
    const saved = localStorage.getItem(tabStorageKey.value)
    if (saved === 'overview' || saved === 'config' || saved === 'integration') {
      activeTab.value = saved
    }
  } catch {}
})
function switchTab(t: DetailTab) {
  activeTab.value = t
  try {
    localStorage.setItem(tabStorageKey.value, t)
  } catch {}
}
</script>

<template>
  <div v-if="project" class="max-w-7xl mx-auto space-y-6 pb-12">
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
            查看文件
          </router-link>
          <router-link
            :to="`/projects/${projectId}/logs`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <FileText class="w-3.5 h-3.5 mr-1.5" />
            运行日志
          </router-link>
          <router-link
            :to="`/audit?targetId=${projectId}`"
            class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
          >
            <ScrollText class="w-3.5 h-3.5 mr-1.5" />
            操作历史
          </router-link>
        </div>
        <p class="text-xs sm:text-sm text-textMuted mt-1 font-mono break-all">{{ project.id }}</p>
      </div>
    </div>

    <!-- Tab Navigation -->
    <nav class="flex flex-wrap items-center gap-1 border-b border-border -mt-2">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        @click="switchTab(t.key)"
        class="inline-flex items-center px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors"
        :class="activeTab === t.key
          ? 'border-primary text-primary'
          : 'border-transparent text-textMuted hover:text-textMain hover:border-border'"
      >
        <component :is="t.icon" class="w-4 h-4 mr-1.5" />
        {{ t.label }}
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
          PM2 应用状态
          <code class="font-mono text-textMain bg-base border border-border px-1.5 py-0.5 rounded ml-2 text-[11px]">{{ project.pm2AppName }}</code>
          <span class="ml-2 text-[10px] text-textMuted">每 5 秒自动刷新</span>
        </h3>
        <button
          @click="refreshPm2Status"
          :disabled="pm2Loading"
          class="text-textMuted hover:text-textMain text-xs flex items-center disabled:opacity-50"
        >
          <RefreshCw class="w-3 h-3 mr-1" :class="pm2Loading ? 'animate-spin' : ''" />
          刷新
        </button>
      </div>
      <div class="p-4">
        <div v-if="!pm2Status" class="text-xs text-textMuted">
          {{ pm2Loading ? '正在拉取…' : '尚未获取到状态' }}
        </div>
        <div v-else-if="!pm2Available" class="text-xs text-yellow-500 flex items-start gap-1.5">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          {{ pm2Status.message || '服务器未检测到 PM2，无法读取应用状态。' }}
        </div>
        <div v-else-if="pm2Status.found === false" class="text-xs text-yellow-500 flex items-start gap-1.5">
          <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          未在 PM2 中找到名为 <code class="font-mono text-textMain mx-1">{{ project.pm2AppName }}</code> 的应用。请确认 <code class="font-mono text-textMain mx-1">pm2 list</code> 中存在该应用名。
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" :class="pm2Status.status === 'online' ? 'bg-success' : 'bg-danger'"></span>
            <span class="text-textMuted">状态</span>
            <span class="text-textMain font-mono">{{ pm2Status.status || '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <Cpu class="w-3.5 h-3.5 text-textMuted" />
            <span class="text-textMuted">CPU</span>
            <span class="text-textMain font-mono">{{ pm2Status.cpuPercent != null ? pm2Status.cpuPercent.toFixed(1) + '%' : '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <MemoryStick class="w-3.5 h-3.5 text-textMuted" />
            <span class="text-textMuted">内存</span>
            <span class="text-textMain font-mono">{{ fmtBytes(pm2Status.memoryBytes) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">PID</span>
            <span class="text-textMain font-mono">{{ pm2Status.pid ?? '—' }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">实例</span>
            <span class="text-textMain font-mono">{{ pm2Status.instances ?? 1 }} ({{ pm2Status.execMode || '—' }})</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">运行时长</span>
            <span class="text-textMain font-mono">{{ fmtUptimeMs(pm2Status.uptimeMs) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-textMuted">重启次数</span>
            <span class="text-textMain font-mono">{{ pm2Status.restarts ?? 0 }}<span v-if="pm2Status.unstableRestarts" class="text-danger ml-1">（不稳定 {{ pm2Status.unstableRestarts }}）</span></span>
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
              部署历史
            </h2>
            <p class="text-sm text-textMuted mt-1">最近 10 次部署。点击行查看完整日志，行末可对已归档版本一键回滚。</p>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="loadDeployments"
              :disabled="isLoadingDeployments"
              class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all disabled:opacity-50"
            >
              <RefreshCw class="w-3.5 h-3.5 mr-1.5" :class="{ 'animate-spin': isLoadingDeployments }" />
              刷新
            </button>
            <button
              @click="goLogBoard()"
              class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
            >
              <ScrollText class="w-3.5 h-3.5 mr-1.5" />
              查看全部
            </button>
          </div>
        </div>

        <div class="p-6">
          <div v-if="isLoadingDeployments && deployments.length === 0" class="py-10 text-center text-sm text-textMuted">
            加载中…
          </div>
          <div v-else-if="deployments.length === 0" class="py-10 text-center text-sm text-textMuted">
            该项目暂无部署记录。
          </div>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="log in deployments"
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
                    title="该部署是一次回滚"
                  >
                    RB
                  </span>
                  <Archive
                    v-if="log.artifactPath"
                    class="w-3.5 h-3.5 text-success/70"
                    aria-label="已归档"
                  />
                  <ArchiveX
                    v-else
                    class="w-3.5 h-3.5 text-textMuted/50"
                    aria-label="无归档"
                  />
                  <span
                    role="button"
                    tabindex="0"
                    class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-base border border-border font-mono text-[10px] text-textMuted hover:text-primary hover:border-primary/40 transition-colors cursor-pointer"
                    :title="`点击复制完整 ID: ${log.id}`"
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
                    title="该版本为当前线上版本"
                  >当前版本</span>
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
                回滚到此版本
              </button>
              <span
                v-else
                class="inline-flex items-center px-2.5 py-1 text-xs font-medium bg-base text-textMuted/60 border border-border rounded-md cursor-not-allowed"
                :title="rollbackDisabledReason(log)"
              >
                不可回滚
              </span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Token Management Card -->
      <div class="lg:col-span-5 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Key class="w-5 h-5 mr-2 text-primary" />
            鉴权 Token 管理
          </h2>
          <p class="text-sm text-textMuted mt-1">用于 CLI 或 Webhook 触发自动化部署的专属凭证。</p>
        </div>

        <div class="p-6">
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center space-y-4 sm:space-y-0 sm:space-x-4">
            <div class="relative flex-1">
              <input
                :type="isTokenVisible ? 'text' : 'password'"
                readonly
                :value="project.token || '暂无 Token，请生成'"
                class="w-full bg-base border border-border rounded-md pl-4 pr-12 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary/50 transition-colors"
                :class="{'opacity-50 blur-[2px] select-none': !isTokenVisible && project.token}"
              />
              <button
                v-if="project.token"
                @click="isTokenVisible = !isTokenVisible"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-textMuted hover:text-textMain text-xs font-medium px-2 py-1 rounded transition-colors"
              >
                {{ isTokenVisible ? '隐藏' : '显示' }}
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
                {{ isCopied ? '已复制' : '复制' }}
              </button>
              <button
                @click="refreshToken"
                class="flex items-center justify-center px-4 py-3 bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-white rounded-md transition-all w-full sm:w-auto font-medium shadow-[0_0_10px_rgba(59,130,246,0.1)] hover:shadow-[0_0_15px_rgba(59,130,246,0.4)]"
              >
                <RefreshCw class="w-4 h-4 mr-2" />
                重新生成
              </button>
            </div>
          </div>

          <div class="mt-4 p-4 rounded-md bg-primary/5 border border-primary/10 text-sm">
            <p class="text-textMuted leading-relaxed">
              <strong class="text-primary font-medium">CLI 用法:</strong> 将此 Token 保存到全局配置后，<code class="bg-base px-1 py-0.5 rounded font-mono text-xs text-textMain border border-border">kite push</code> 时无需再传。
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
                CLI 快速部署指引
              </h2>
              <p class="text-sm text-textMuted mt-1">
                <template v-if="cliHelpCollapsed && deployments.length > 0">
                  已有部署记录，指引已折叠 — 点击展开
                </template>
                <template v-else>
                  三步完成部署：安装 CLI、初始化配置、推送部署。
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
            <label class="block text-sm font-medium text-textMain mb-2">部署环境 (可选)</label>
            <div class="flex items-center gap-3">
              <input
                v-model="cliEnv"
                type="text"
                class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder="留空为默认环境，或输入如 test、staging、prod"
                @keydown.enter.prevent="saveEnv"
              />
              <button
                @click="saveEnv"
                :disabled="!envDirty || isSavingEnv"
                class="flex items-center px-3 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                :title="envDirty ? '保存当前部署环境' : '当前值未变化'"
              >
                <RefreshCw v-if="isSavingEnv" class="w-3.5 h-3.5 mr-1.5 animate-spin" />
                <Save v-else class="w-3.5 h-3.5 mr-1.5" />
                保存
              </button>
            </div>
            <p class="text-xs text-textMuted mt-2">
              填写后下方所有指令将自动带上 <code class="font-mono text-textMain">--env</code> 参数，生成的配置文件为
              <code class="font-mono text-textMain">{{ configFileName }}</code>。
              适用于同一项目需要部署到不同环境（测试/预发/生产）的场景。
            </p>
          </div>

          <!-- Step 1: 安装 CLI -->
          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-2">1. 安装 CLI</p>
            <div class="flex items-center gap-2">
              <code class="flex-1 text-xs text-success font-mono break-all">{{ installCommand }}</code>
              <button @click="copyCommand('install', installCommand)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'install' ? '已复制' : '复制' }}
              </button>
            </div>
          </div>

          <!-- Step 2: 初始化配置 -->
          <div class="rounded-lg border border-border bg-base p-4">
            <p class="text-sm font-medium text-textMain mb-2">2. 初始化项目配置</p>
            <div class="flex items-center gap-2 mb-4">
              <code class="flex-1 text-xs text-success font-mono break-all">{{ initCommand }}</code>
              <button @click="copyCommand('init', initCommand)" class="text-xs text-primary hover:text-textMain">
                {{ copiedCommand === 'init' ? '已复制' : '复制' }}
              </button>
            </div>
            <p class="text-xs text-textMuted mb-3">执行后会在当前目录生成 <code class="font-mono text-textMain bg-panel px-1 py-0.5 rounded border border-border">{{ configFileName }}</code>，请确认生成的配置：</p>
            <pre class="text-xs text-success font-mono whitespace-pre-wrap overflow-x-auto bg-panel rounded-md p-3 border border-border mb-3">{{ configExample }}</pre>
            <div class="space-y-2 text-xs text-textMuted">
              <p><code class="font-mono text-textMain">projectId</code> — 项目唯一标识，由服务端分配</p>
              <p><code class="font-mono text-textMain">outputDir</code> — 本地打包输出目录，默认 <code class="font-mono">./dist</code></p>
              <p><code class="font-mono text-textMain">files</code> — 要打包上传的文件 glob 模式列表，示例：</p>
              <div class="pl-3 space-y-1">
                <div v-for="ex in configFilesExamples" :key="ex.label" class="flex items-center gap-2">
                  <span class="text-textMuted w-24 shrink-0">{{ ex.label }}</span>
                  <code class="text-success font-mono">"files": {{ JSON.stringify(ex.files) }}</code>
                </div>
              </div>
              <p><code class="font-mono text-textMain">postDeploy</code> — 服务端解压后执行的命令，如重启服务</p>
            </div>
          </div>

          <!-- Step 3: 部署 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="rounded-lg border border-border bg-base p-4">
              <p class="text-sm font-medium text-textMain mb-2">3. 部署 — 使用已保存的配置</p>
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs text-success font-mono break-all">{{ pushCommand }}</code>
                <button @click="copyCommand('push', pushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'push' ? '已复制' : '复制' }}
                </button>
              </div>
              <p class="text-xs text-textMuted mt-2">需先通过 <code class="font-mono">kite config:set token</code> 或 <code class="font-mono">--token-store global</code> 保存过 Token。</p>
            </div>

            <div class="rounded-lg border border-border bg-base p-4 space-y-3">
              <p class="text-sm font-medium text-textMain mb-2">3. 部署 — CLI 覆盖配置</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-20 shrink-0">使用全局 Token</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushCommand }}</code>
                <button @click="copyCommand('direct-push', directPushCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push' ? '已复制' : '复制' }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-20 shrink-0">指定项目 Token</span>
                <code class="flex-1 text-xs text-success font-mono break-all">{{ directPushWithTokenCommand }}</code>
                <button @click="copyCommand('direct-push-token', directPushWithTokenCommand)" class="text-xs text-primary hover:text-textMain">
                  {{ copiedCommand === 'direct-push-token' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
          </div>

          <!-- Tip: Token 设置方式 -->
          <div class="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
            <p class="text-sm text-textMain leading-relaxed">
              <strong class="text-primary font-medium">Token 设置方式</strong>
              <span class="text-textMuted">（已自动填充本项目 Token，可一键复制）：</span>
            </p>
            <div class="space-y-2">
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-28 shrink-0">按项目保存</span>
                <code class="flex-1 text-xs text-success font-mono break-all bg-base px-2 py-1 rounded border border-border">{{ tokenSetProjectCommand }}</code>
                <button
                  @click="copyCommand('token-set-project', tokenSetProjectCommand)"
                  :disabled="!project?.token"
                  class="text-xs text-primary hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  :title="project?.token ? '复制命令' : '请先生成 Token'"
                >
                  {{ copiedCommand === 'token-set-project' ? '已复制' : '复制' }}
                </button>
              </div>
              <p class="text-xs text-textMuted pl-[120px] -mt-1">需在含 <code class="font-mono">{{ configFileName }}</code> 的目录执行，token 会写入 <code class="font-mono">~/.kite/config.json</code> 的项目命名空间。</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-28 shrink-0">全局 fallback</span>
                <code class="flex-1 text-xs text-success font-mono break-all bg-base px-2 py-1 rounded border border-border">{{ tokenSetGlobalCommand }}</code>
                <button
                  @click="copyCommand('token-set-global', tokenSetGlobalCommand)"
                  :disabled="!project?.token"
                  class="text-xs text-primary hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  :title="project?.token ? '复制命令' : '请先生成 Token'"
                >
                  {{ copiedCommand === 'token-set-global' ? '已复制' : '复制' }}
                </button>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-textMuted w-28 shrink-0">.env.local</span>
                <code class="flex-1 text-xs text-success font-mono break-all bg-base px-2 py-1 rounded border border-border">{{ tokenEnvLocalLine }}</code>
                <button
                  @click="copyCommand('token-env-local', tokenEnvLocalLine)"
                  :disabled="!project?.token"
                  class="text-xs text-primary hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                  :title="project?.token ? '复制 .env.local 行' : '请先生成 Token'"
                >
                  {{ copiedCommand === 'token-env-local' ? '已复制' : '复制' }}
                </button>
              </div>
            </div>
            <p v-if="!project?.token" class="text-xs text-yellow-500">
              当前项目尚未生成 Token，请先在上方「项目 Token」区域生成后再复制。
            </p>
            <p class="text-sm text-textMuted leading-relaxed">
              配置优先级：<strong class="text-primary">CLI 参数</strong> &gt; <strong class="text-primary">.env.local</strong> &gt; <strong class="text-primary">项目级 Token</strong> &gt; <strong class="text-primary">全局 Token</strong>。未在 CLI 传入的部署脚本，会回退到本页保存的云端默认脚本。
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
            项目基本信息
          </h2>
          <p class="text-sm text-textMuted mt-1">项目的分类与标签，用于在项目列表中筛选与归档。</p>
        </div>

        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">所属分类</label>
            <select
              v-model="formData.categoryId"
              class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
            >
              <option value="">默认（未分类）</option>
              <option v-for="c in projectStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
            <p class="text-xs text-textMuted mt-2">用于在项目列表中按分类筛选。在「项目管理 → 管理分类」中创建更多分类。</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">标签（可多选）</label>
            <ProjectTagsEditor
              :model-value="formData.tagIds"
              size="md"
              read-only-save
              aria-label="编辑当前项目的标签"
              @update:model-value="(v) => formData.tagIds = v"
            />
            <p class="text-xs text-textMuted mt-2">点击「+ 标签」选择或直接新建；颜色和排序请在「项目管理 → 管理标签」里调整。</p>
          </div>

          <p class="text-xs text-textMuted border-t border-border pt-3">
            修改后请前往下方「部署脚本配置」点击「保存配置」生效。
          </p>
        </div>
      </div>

      <!-- PM2 App Binding Card -->
      <div class="lg:col-span-7 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Activity class="w-5 h-5 mr-2 text-primary" />
            PM2 应用绑定
          </h2>
          <p class="text-sm text-textMuted mt-1">将本项目关联到一个 PM2 应用，启用顶部实时资源监控与状态面板。</p>
        </div>

        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2 flex items-center">
              PM2 应用名（可选）
              <span v-if="pm2Available" class="ml-2 text-[10px] text-success border border-success/40 bg-success/10 px-1.5 py-0.5 rounded">PM2 已检测</span>
              <span v-else class="ml-2 text-[10px] text-textMuted border border-border bg-base px-1.5 py-0.5 rounded">PM2 未检测</span>
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
                  {{ formData.pm2AppName.trim() || '从 pm2 list 选择应用…' }}
                </span>
                <ChevronDown class="w-4 h-4 text-textMuted shrink-0" :class="pm2PickerOpen ? 'rotate-180' : ''" />
              </button>
              <div
                v-if="pm2PickerOpen"
                class="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto bg-panel border border-border rounded-md shadow-lg"
              >
                <button
                  v-if="formData.pm2AppName.trim()"
                  type="button"
                  @click.stop="pickPm2App('')"
                  class="flex items-center w-full px-3 py-2 text-sm text-textMuted hover:bg-white/5 transition-colors border-b border-border"
                >
                  <XCircle class="w-3.5 h-3.5 mr-2" />
                  解除绑定
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
                  手动输入…
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
                改用下拉选择
              </button>
            </div>

            <!-- Conflict (non-blocking warning) -->
            <div
              v-if="pm2ConflictProjects.length > 0"
              class="mt-2 flex items-start gap-2 text-xs text-yellow-500 border border-yellow-500/30 bg-yellow-500/5 rounded-md px-3 py-2"
            >
              <AlertTriangle class="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div class="leading-relaxed">
                该 PM2 应用名已被
                <template v-for="(p, idx) in pm2ConflictProjects" :key="p.id">
                  <router-link
                    :to="`/projects/${p.id}`"
                    class="font-medium text-yellow-500 hover:text-yellow-400 underline underline-offset-2 mx-0.5"
                  >「{{ p.name }}」</router-link><span v-if="idx < pm2ConflictProjects.length - 1">、</span>
                </template>
                绑定。继续保存不会被阻止，但状态与日志会同时归属于多个项目，请确认无误后再绑定。
              </div>
            </div>

            <p class="text-xs text-textMuted mt-2">
              绑定后，可在页面顶部实时查看该 PM2 应用的资源占用与运行状态。需要服务器上安装 PM2，且当前 Kite 进程可执行 <code class="font-mono">pm2 jlist</code>。
            </p>
          </div>

          <p class="text-xs text-textMuted border-t border-border pt-3">
            修改后请前往下方「部署脚本配置」点击「保存配置」生效。
          </p>
        </div>
      </div>

      <!-- Execution Scripts Card -->
      <div class="lg:col-span-7 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <TerminalSquare class="w-5 h-5 mr-2 text-primary" />
            部署脚本配置 (云端默认)
          </h2>
          <p class="text-sm text-textMuted mt-1">配置此项目在服务端接收到文件后，默认执行的 Shell 指令。可被 CLI 参数覆盖。</p>
        </div>
        
        <div class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">部署目录 (Destination Path)</label>
            <input
              v-model="formData.destPath"
              type="text"
              class="w-full bg-base border border-border rounded-md px-4 py-3 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="e.g. /var/www/my-project"
            />
            <p class="text-xs text-textMuted mt-2">在服务端解压和部署该项目文件的绝对路径。</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">前置脚本 (Pre-Deploy)</label>
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
            <p class="text-xs text-textMuted mt-2">在打包上传之前，于本地执行的构建命令（通常配置在本地 CLI，此处作为备用参考）。</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMain mb-2">后置脚本 (Post-Deploy)</label>
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
            <p class="text-xs text-textMuted mt-2">服务端解压文件后，在目标目录执行的重启或服务加载命令。</p>
            <label class="mt-3 flex items-start space-x-2 cursor-pointer select-none">
              <input
                v-model="formData.postDeployAsync"
                type="checkbox"
                class="mt-0.5 w-4 h-4 rounded border-border bg-base text-primary focus:ring-1 focus:ring-primary/50"
              />
              <span class="text-xs text-textMuted leading-relaxed">
                <span class="text-textMain font-medium">异步执行（不等待）</span>
                — 开启后，postDeploy 触发即认为部署成功；脚本输出仍可在部署日志中查看。适合启动常驻进程 / pm2 restart / 延迟任务。
                <span class="text-danger">注意：Kite 进程退出时子进程会被回收，需常驻请配合 <code class="font-mono">nohup</code> / <code class="font-mono">pm2</code> / <code class="font-mono">setsid</code> 自行守护。</span>
              </span>
            </label>
          </div>

          <div class="pt-4 border-t border-border flex justify-end">
            <button 
              @click="saveConfig"
              class="flex items-center px-6 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-md transition-all font-medium shadow-[0_0_15px_rgba(59,130,246,0.3)]"
            >
              <Save class="w-4 h-4 mr-2" />
              保存配置
            </button>
          </div>
        </div>
      </div>

      <!-- Clean Strategy Card -->
      <div class="lg:col-span-5 bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
        <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Shield class="w-5 h-5 mr-2 text-primary" />
            部署清理策略
          </h2>
          <p class="text-sm text-textMuted mt-1">每次部署解压前，对目标目录执行的清理动作。默认 <code class="font-mono text-textMain">merge</code> 沿用旧行为（零破坏）。</p>
        </div>
        <div class="p-6 space-y-5">
          <!-- Mode picker -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label
              v-for="opt in [
                { value: 'merge', title: 'merge', desc: '不清理，直接覆盖。旧行为，零破坏。', tone: 'primary' as const },
                { value: 'clean', title: 'clean', desc: '清空目录，但保留 protectPaths 命中的文件，以及 .kite-* 内部目录。', tone: 'warning' as const },
                { value: 'clean-all', title: 'clean-all', desc: '清空全部内容（仅保留 .kite-*），protectPaths 也被忽略。', tone: 'danger' as const },
              ]"
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
            <label class="block text-sm font-medium text-textMain mb-2">保护路径 (protectPaths)</label>
            <p class="text-xs text-textMuted mb-2">
              支持 minimatch glob，命中文件不会被删除。<code class="font-mono text-textMain">.kite-*</code> 始终自动保护，无需添加。
              常见示例：<code class="font-mono text-textMain">uploads/**</code>、<code class="font-mono text-textMain">.env</code>、<code class="font-mono text-textMain">config/*.json</code>
            </p>
            <div class="flex gap-2 mb-3">
              <input
                v-model="protectInput"
                type="text"
                class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
                placeholder="如 uploads/**"
                @keydown.enter.prevent="addProtectPath"
              />
              <button
                @click="addProtectPath"
                type="button"
                class="flex items-center px-3 bg-base border border-border hover:border-primary/50 hover:text-primary text-textMain rounded-md transition-all"
              >
                <Plus class="w-4 h-4 mr-1" />
                添加
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
            <p v-else class="text-xs text-textMuted italic">尚未设置保护路径。clean 模式下会清空整个部署目录（仅保留 .kite-*）。</p>
          </div>

          <div v-if="cleanForm.cleanMode === 'clean-all'" class="p-3 rounded-md bg-danger/10 border border-danger/30 flex items-start gap-2">
            <ShieldAlert class="w-4 h-4 text-danger shrink-0 mt-0.5" />
            <p class="text-xs text-danger leading-relaxed">
              clean-all 会清空目标目录下<strong>所有</strong>文件（仅保留 <code class="font-mono bg-base px-1 rounded">.kite-*</code>）。protectPaths 设置在此模式下被忽略。请务必通过预览确认。
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
              预览将删除的文件 (DRY-RUN)
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
              {{ isSavingClean ? '保存中...' : '保存清理策略' }}
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
            危险操作区
          </h3>
          <div class="mt-4 flex items-start justify-between gap-4">
            <div class="text-sm text-textMuted space-y-1">
              <p>删除该项目将同时清空数据库中的项目配置与全部部署历史日志，且不可恢复。</p>
              <p class="text-textMuted/80">部署目录中的实际文件不会被删除，需要时请手动清理。</p>
            </div>
            <button @click="openDeleteModal" class="shrink-0 px-4 py-2 bg-danger/10 hover:bg-danger text-danger hover:text-white border border-danger/20 hover:border-danger rounded-md transition-colors text-sm font-medium">
              删除项目
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
            <h2 class="text-lg font-semibold text-textMain">确认删除项目</h2>
            <p class="text-sm text-textMuted mt-1">
              即将删除项目
              <span class="font-mono text-textMain">{{ project?.name }}</span>
              （<span class="font-mono text-textMuted">{{ projectId }}</span>），此操作不可恢复。
            </p>
          </div>
        </div>

        <div class="space-y-3 mb-5">
          <div class="bg-danger/5 border border-danger/20 rounded-lg p-3">
            <p class="text-xs font-medium text-danger mb-2 flex items-center">
              <XCircle class="w-3.5 h-3.5 mr-1.5" />
              将被永久删除的内容
            </p>
            <ul class="text-xs text-textMain/90 space-y-1 list-disc list-inside marker:text-danger/60">
              <li>该项目在数据库中的配置（名称、描述、部署目录、部署脚本、Token、环境标识等）</li>
              <li>该项目的<span class="font-medium">全部部署历史日志</span>（部署日志面板中将不再可见）</li>
            </ul>
          </div>

          <div class="bg-success/5 border border-success/20 rounded-lg p-3">
            <p class="text-xs font-medium text-success mb-2 flex items-center">
              <CheckCircle2 class="w-3.5 h-3.5 mr-1.5" />
              不会被删除的内容
            </p>
            <ul class="text-xs text-textMain/90 space-y-1 list-disc list-inside marker:text-success/60">
              <li>
                部署目录
                <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">{{ project?.destPath || '—' }}</code>
                下的所有实际文件
              </li>
              <li>其他项目的数据、全局设置、Admin Token</li>
              <li>项目源码中的 <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">kite.config*.json</code> / <code class="font-mono text-textMain bg-base px-1 py-0.5 rounded text-[11px]">.env.local</code> 等本地配置</li>
            </ul>
          </div>
        </div>

        <div class="mb-2">
          <label class="block text-sm font-medium text-textMuted mb-1.5">
            请输入项目名称
            <span class="font-mono text-textMain">{{ expectedConfirmName }}</span>
            以确认删除
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
            取消
          </button>
          <button
            @click="confirmDelete"
            :disabled="!canConfirmDelete"
            class="px-4 py-2 text-sm font-medium bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isDeleting" class="w-4 h-4 mr-2 animate-spin" />
            <Trash2 v-else class="w-4 h-4 mr-2" />
            {{ isDeleting ? '正在删除...' : '永久删除' }}
          </button>
        </div>
      </div>
    </div>

    <ConfirmDialog
      v-model:open="showRefreshTokenModal"
      tone="warning"
      title="重新生成项目 Token？"
      message="旧 Token 将立即失效。所有正在使用旧 Token 的 CLI / Webhook 调用都会被拒绝，请记得同步更新。"
      confirm-text="重新生成"
      cancel-text="取消"
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
      title="确认启用 clean-all 模式？"
      message="后续每次部署都会清空部署目录下除 .kite-* 之外的全部内容，protectPaths 在此模式下被忽略。请输入项目名以确认。"
      confirm-text="启用 clean-all"
      cancel-text="取消"
      :require-text="expectedConfirmName"
      :require-text-hint="`请输入项目名 ${expectedConfirmName} 以确认`"
      :loading="isSavingClean"
      @confirm="commitCleanForm"
    />

    <ConfirmDialog
      v-model:open="showRollbackConfirm"
      tone="warning"
      title="确认回滚到此版本？"
      :message="rollbackTarget ? `将以归档 ${shortId(rollbackTarget.id)} 重新部署到项目 ${rollbackTarget.projectName}。会按当前项目的 cleanMode / protectPaths 执行清理后再解压，运行时数据按保护规则保留。` : ''"
      confirm-text="确认回滚"
      cancel-text="取消"
      :loading="isRollingBack"
      @confirm="confirmRollback"
    />
  </div>
</template>