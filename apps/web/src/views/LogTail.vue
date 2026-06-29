<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ArrowLeft, Plus, RefreshCw, Trash2, FileText, Play, Pause, ChevronDown, ChevronUp, Search, X, AlertTriangle, Loader2, Activity, History as HistoryIcon, Pencil, Zap, CheckSquare, Square, MinusSquare } from 'lucide-vue-next'
import { useProjectStore, type Pm2AppStatus } from '../store/project'
import { useToast } from '../composables/useToast'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import { useLogTailStream } from '../composables/useLogTailStream'
import { useLogSearchStream, type SearchHit } from '../composables/useLogSearchStream'

type LogSource = {
  id: string
  projectId: string
  label: string
  filePath: string
  kind: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

type Mode = 'live' | 'history' | 'search'

const route = useRoute()
const router = useRouter()
const store = useProjectStore()
const toast = useToast()

const projectId = computed(() => String(route.params.id))
const project = computed(() => store.projects.find((p) => p.id === projectId.value))

const sources = ref<LogSource[]>([])
const loadingSources = ref(false)
const activeSourceId = ref<string>('')
const activeSource = computed(() => sources.value.find((s) => s.id === activeSourceId.value) || null)

const pm2Status = ref<Pm2AppStatus | null>(null)
const pm2Loading = ref(false)
const pm2Importing = ref(false)
const pm2AppName = computed(() => (project.value as any)?.pm2AppName?.trim() || '')

const pm2LogPaths = computed<Array<{ path: string; kind: 'stdout' | 'stderr' }>>(() => {
  const s = pm2Status.value
  if (!s || s.found === false) return []
  const list: Array<{ path: string; kind: 'stdout' | 'stderr' }> = []
  if (s.outLogPath) list.push({ path: s.outLogPath, kind: 'stdout' })
  if (s.errorLogPath) list.push({ path: s.errorLogPath, kind: 'stderr' })
  return list
})

const pm2MissingPaths = computed(() => {
  if (pm2LogPaths.value.length === 0) return []
  const have = new Set(sources.value.map((s) => s.filePath))
  return pm2LogPaths.value.filter((p) => !have.has(p.path))
})

const canImportFromPm2 = computed(() => pm2AppName.value && pm2Status.value?.found === true && pm2LogPaths.value.length > 0)

const pickerOpen = ref(false)
const confirmDeleteOpen = ref(false)
const pendingDeleteId = ref<string>('')
const renamingId = ref<string>('')
const renameValue = ref<string>('')

const mode = ref<Mode>('live')

const fileSize = ref(0)

const liveLines = ref<string[]>([])
const liveFollow = ref(true)
const liveTailLines = ref(20)
const liveError = ref('')
const liveLogRef = ref<HTMLDivElement | null>(null)

const tail = useLogTailStream(() => store.adminToken)

const historyLines = ref<string[]>([])
const historyStart = ref(0)
const historyEnd = ref(0)
const historySize = ref(0)
const historyTruncatedHead = ref(false)
const historyTruncatedTail = ref(false)
const historyLoading = ref(false)
const historyError = ref('')
const historyBinary = ref(false)
const HISTORY_WINDOW = 64 * 1024

const searchQuery = ref('')
const searchRegex = ref(false)
const searchCaseInsensitive = ref(true)
const searchHits = ref<SearchHit[]>([])
const searchTruncated = ref<{ maxHits: number } | null>(null)
const searchDone = ref<{ scannedBytes: number } | null>(null)
const searchError = ref('')
const search = useLogSearchStream(() => store.adminToken)

async function loadSources() {
  loadingSources.value = true
  try {
    const data = await store.fetchLogSources(projectId.value)
    sources.value = data.items
    if (!activeSourceId.value && sources.value.length > 0) {
      pickSource(sources.value[0].id)
    }
  } catch (e: any) {
    toast.error(e?.message || '加载日志源失败')
  } finally {
    loadingSources.value = false
  }
}

async function loadPm2Status() {
  if (!pm2AppName.value) {
    pm2Status.value = null
    return
  }
  pm2Loading.value = true
  try {
    pm2Status.value = await store.fetchProjectPm2(projectId.value)
  } catch {
    pm2Status.value = null
  } finally {
    pm2Loading.value = false
  }
}

async function importPm2Sources() {
  if (pm2Importing.value) return
  const missing = pm2MissingPaths.value
  if (missing.length === 0) {
    toast.success('PM2 日志文件已全部导入')
    return
  }
  const name = pm2AppName.value || 'pm2'
  const items = missing.map((m) => ({
    filePath: m.path,
    label: `${name} · ${m.kind}`,
    kind: 'pm2',
  }))
  pm2Importing.value = true
  try {
    const data = await store.createLogSources(projectId.value, items)
    const created = Array.isArray(data?.created) ? data.created : []
    const errs = Array.isArray(data?.errors) ? data.errors : []
    if (created.length > 0) toast.success(`已从 PM2 导入 ${created.length} 个日志源`)
    if (errs.length > 0) toast.error(`${errs.length} 个未能导入`, errs.map((e: any) => e?.error).filter(Boolean).join('; ') || '请检查 PM2 日志路径是否可读')
    await loadSources()
    if (created.length > 0) pickSource(created[0].id)
  } catch (e: any) {
    toast.error(e?.message || '导入 PM2 日志失败')
  } finally {
    pm2Importing.value = false
  }
}

async function onPickerConfirm(paths: string[]) {
  pickerOpen.value = false
  if (!paths.length) return
  try {
    const items = paths.map((p) => ({ filePath: p }))
    await store.createLogSources(projectId.value, items)
    toast.success(`已添加 ${paths.length} 个日志文件`)
    await loadSources()
  } catch (e: any) {
    toast.error(e?.message || '添加日志失败')
  }
}

function askDelete(id: string) {
  pendingDeleteId.value = id
  confirmDeleteOpen.value = true
}

async function confirmDelete() {
  const id = pendingDeleteId.value
  pendingDeleteId.value = ''
  confirmDeleteOpen.value = false
  if (!id) return
  try {
    await store.deleteLogSource(id)
    if (activeSourceId.value === id) {
      tail.disconnect()
      search.abort()
      activeSourceId.value = ''
      liveLines.value = []
      historyLines.value = []
      searchHits.value = []
    }
    await loadSources()
    toast.success('已删除')
  } catch (e: any) {
    toast.error(e?.message || '删除失败')
  }
}

// ---------- Bulk selection: log sources ----------
const BULK_LOG_SRC_MAX = 200
const sourceBulk = useBulkSelection(sources)
const isBulkDeletingSources = ref(false)
const showBulkDeleteSources = ref(false)

onBeforeRouteLeave(() => {
  sourceBulk.clear()
})

const bulkDeleteSourcesRequireText = computed(() => `delete ${sourceBulk.selectedCount.value} log sources`)

function toggleSourceSelection(e: Event, id: string) {
  e.stopPropagation()
  sourceBulk.toggle(id)
}

function toggleAllSources() {
  if (sourceBulk.isAllSelected.value) {
    sourceBulk.clear()
    return
  }
  if (sources.value.length > BULK_LOG_SRC_MAX) {
    toast.error('已超出单次上限', `单次最多操作 ${BULK_LOG_SRC_MAX} 条`)
    return
  }
  sourceBulk.selectAll()
}

function openBulkDeleteSources() {
  if (sourceBulk.selectedCount.value === 0) return
  if (sourceBulk.selectedCount.value > BULK_LOG_SRC_MAX) {
    toast.error('已超出单次上限', `单次最多操作 ${BULK_LOG_SRC_MAX} 条`)
    return
  }
  showBulkDeleteSources.value = true
}

async function confirmBulkDeleteSources() {
  if (isBulkDeletingSources.value) return
  const ids = Array.from(sourceBulk.selectedIds.value)
  if (ids.length === 0) return
  isBulkDeletingSources.value = true
  try {
    const res = await fetch('/api/log-sources/bulk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${store.adminToken}`,
      },
      body: JSON.stringify({ ids, action: 'delete' }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error('批量删除失败', data?.error || `HTTP ${res.status}`)
      return
    }
    const success = Number(data?.success || 0)
    const failed = Array.isArray(data?.failed) ? data.failed.length : 0
    if (failed === 0) {
      toast.success(`已删除 ${success} 个日志源`)
    } else {
      toast.error('部分成功', `成功 ${success} 条，失败 ${failed} 条`)
    }
    if (activeSourceId.value && ids.includes(activeSourceId.value)) {
      tail.disconnect()
      search.abort()
      activeSourceId.value = ''
      liveLines.value = []
      historyLines.value = []
      searchHits.value = []
    }
    showBulkDeleteSources.value = false
    sourceBulk.clear()
    await loadSources()
  } catch (err: any) {
    toast.error('批量删除失败', err?.message || 'network error')
  } finally {
    isBulkDeletingSources.value = false
  }
}

function startRename(s: LogSource) {
  renamingId.value = s.id
  renameValue.value = s.label
}

async function commitRename() {
  const id = renamingId.value
  const label = renameValue.value.trim()
  renamingId.value = ''
  renameValue.value = ''
  if (!id || !label) return
  try {
    await store.updateLogSource(id, { label })
    await loadSources()
  } catch (e: any) {
    toast.error(e?.message || '重命名失败')
  }
}

function pickSource(id: string) {
  if (activeSourceId.value === id) return
  tail.disconnect()
  search.abort()
  activeSourceId.value = id
  liveLines.value = []
  liveError.value = ''
  historyLines.value = []
  historyError.value = ''
  searchHits.value = []
  searchTruncated.value = null
  searchDone.value = null
  searchError.value = ''
  onModeChange()
}

function onModeChange() {
  tail.disconnect()
  search.abort()
  if (!activeSourceId.value) return
  if (mode.value === 'live') {
    startLive()
  } else if (mode.value === 'history') {
    loadHistoryTail()
  }
}

watch(mode, onModeChange)

function startLive() {
  if (!activeSourceId.value) return
  liveLines.value = []
  liveError.value = ''
  tail.connect(activeSourceId.value, liveTailLines.value, {
    onSnapshot: ({ size, lines }) => {
      fileSize.value = size
      liveLines.value = lines
      scrollLiveBottom()
    },
    onLines: ({ lines }) => {
      liveLines.value.push(...lines)
      if (liveLines.value.length > 5000) {
        liveLines.value.splice(0, liveLines.value.length - 5000)
      }
      if (liveFollow.value) scrollLiveBottom()
    },
    onRotated: () => {
      liveLines.value.push('--- log rotated ---')
    },
    onError: (msg) => { liveError.value = msg },
  })
}

function scrollLiveBottom() {
  nextTick(() => {
    const el = liveLogRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function onLiveScroll() {
  const el = liveLogRef.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  liveFollow.value = nearBottom
}

async function loadHistoryRange(offset: number, direction: 'forward' | 'backward' = 'forward') {
  if (!activeSourceId.value) return
  historyLoading.value = true
  historyError.value = ''
  try {
    const data = await store.fetchLogSourceRange(activeSourceId.value, {
      offset, size: HISTORY_WINDOW, direction,
    })
    historyLines.value = data.lines
    historyStart.value = data.startOffset
    historyEnd.value = data.endOffset
    historySize.value = data.fileSize
    historyTruncatedHead.value = data.truncatedHead
    historyTruncatedTail.value = data.truncatedTail
    historyBinary.value = data.binary
    fileSize.value = data.fileSize
  } catch (e: any) {
    historyError.value = e?.message || '读取失败'
  } finally {
    historyLoading.value = false
  }
}

async function loadHistoryTail() {
  if (!activeSourceId.value) return
  const meta = await refreshMeta()
  if (!meta) return
  const offset = Math.max(0, meta.size - HISTORY_WINDOW)
  await loadHistoryRange(offset, 'forward')
}

async function loadHistoryHead() {
  await loadHistoryRange(0, 'forward')
}

async function pageBackward() {
  const next = Math.max(0, historyStart.value - HISTORY_WINDOW)
  if (next === historyStart.value) return
  await loadHistoryRange(next, 'forward')
}

async function pageForward() {
  if (historyEnd.value >= historySize.value) return
  await loadHistoryRange(historyEnd.value, 'forward')
}

async function refreshMeta() {
  if (!activeSourceId.value) return null
  try {
    const meta = await store.fetchLogSourceMeta(activeSourceId.value)
    fileSize.value = meta.size
    return meta
  } catch (e: any) {
    toast.error(e?.message || '读取元数据失败')
    return null
  }
}

function runSearch() {
  if (!activeSourceId.value) return
  if (!searchQuery.value.trim()) {
    toast.error('请输入关键词')
    return
  }
  searchHits.value = []
  searchTruncated.value = null
  searchDone.value = null
  searchError.value = ''
  search.search(activeSourceId.value, {
    q: searchQuery.value,
    regex: searchRegex.value,
    caseInsensitive: searchCaseInsensitive.value,
    maxHits: 500,
    context: 0,
  }, {
    onHit: (h) => { searchHits.value.push(h) },
    onTruncated: (info) => { searchTruncated.value = info },
    onDone: (info) => { searchDone.value = info },
    onError: (msg) => { searchError.value = msg },
  })
}

function abortSearch() {
  search.abort()
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function highlightHit(text: string): string {
  const q = searchQuery.value
  if (!q) return escapeHtml(text)
  const flags = searchCaseInsensitive.value ? 'gi' : 'g'
  let re: RegExp
  try {
    re = searchRegex.value
      ? new RegExp(q, flags)
      : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  } catch {
    return escapeHtml(text)
  }
  let out = ''
  let i = 0
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0
    const end = start + m[0].length
    if (start > i) out += escapeHtml(text.slice(i, start))
    out += `<mark class="bg-yellow-500/30 text-yellow-100 rounded px-0.5">${escapeHtml(text.slice(start, end))}</mark>`
    i = end
  }
  if (i < text.length) out += escapeHtml(text.slice(i))
  return out
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  ))
}

onMounted(async () => {
  if (!store.projects.length) {
    try { await store.fetchProjects() } catch { /* ignore */ }
  }
  await loadSources()
  await loadPm2Status()
})

// 项目数据/PM2 绑定可能在挂载后异步到达：变化时重新拉取
watch(pm2AppName, () => {
  loadPm2Status()
})

onUnmounted(() => {
  tail.disconnect()
  search.abort()
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <button @click="router.back()" class="p-2 rounded-md text-textMuted hover:text-textMain hover:bg-white/5">
          <ArrowLeft class="w-4 h-4" />
        </button>
        <div>
          <h1 class="text-xl font-bold text-textMain">运行日志</h1>
          <p class="text-xs text-textMuted font-mono mt-0.5">{{ project?.name || projectId }}</p>
        </div>
      </div>
      <div class="flex items-center space-x-2">
        <button
          @click="loadSources"
          class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all"
        >
          <RefreshCw class="w-3.5 h-3.5 mr-1.5" :class="{ 'animate-spin': loadingSources }" />
          刷新
        </button>
        <button
          v-if="canImportFromPm2"
          @click="importPm2Sources"
          :disabled="pm2Importing || pm2MissingPaths.length === 0"
          class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 disabled:opacity-50 disabled:hover:bg-base rounded-md transition-all"
          :title="pm2MissingPaths.length === 0 ? `PM2 应用 ${pm2AppName} 的日志文件已全部导入` : `从 pm2 jlist 自动识别 ${pm2AppName} 的 stdout / stderr 文件路径并添加为日志源`"
        >
          <Zap class="w-3.5 h-3.5 mr-1.5" :class="{ 'animate-pulse': pm2Importing }" />
          {{ pm2MissingPaths.length === 0
              ? `PM2 日志已导入`
              : `从 PM2 导入 (${pm2MissingPaths.length})` }}
        </button>
        <span
          v-else-if="pm2AppName && pm2Status && pm2Status.found === false"
          class="text-[11px] text-textMuted/70 italic"
          :title="pm2Status.message || '未在 PM2 中找到此应用'"
        >PM2 应用未找到</span>
        <button
          @click="pickerOpen = true"
          class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary/90 rounded-md transition-all"
        >
          <Plus class="w-3.5 h-3.5 mr-1.5" />
          添加日志文件
        </button>
      </div>
    </div>

    <div class="grid grid-cols-12 gap-4">
      <!-- Source list -->
      <aside class="col-span-12 lg:col-span-3 bg-panel border border-border rounded-lg p-3">
        <div class="text-xs text-textMuted mb-2 px-1 flex items-center justify-between">
          <span class="flex items-center gap-1.5">
            <button
              v-if="sources.length > 0"
              type="button"
              class="p-0.5 rounded hover:text-textMain transition-colors"
              :class="sourceBulk.isAllSelected.value || sourceBulk.isIndeterminate.value ? 'text-primary' : 'text-textMuted'"
              :title="sourceBulk.isAllSelected.value ? '清空选中' : '全选'"
              @click="toggleAllSources"
            >
              <CheckSquare v-if="sourceBulk.isAllSelected.value" class="w-3.5 h-3.5" />
              <MinusSquare v-else-if="sourceBulk.isIndeterminate.value" class="w-3.5 h-3.5" />
              <Square v-else class="w-3.5 h-3.5" />
            </button>
            <span>日志源</span>
          </span>
          <span>{{ sources.length }}</span>
        </div>
        <div v-if="loadingSources" class="text-xs text-textMuted py-6 text-center">
          <Loader2 class="w-4 h-4 mx-auto animate-spin" />
        </div>
        <div v-else-if="sources.length === 0" class="text-xs text-textMuted py-8 text-center">
          <FileText class="w-5 h-5 mx-auto mb-2 opacity-50" />
          暂无日志源
          <p class="mt-1 text-[10px]">点击右上「添加日志文件」</p>
        </div>
        <ul v-else class="space-y-1">
          <li
            v-for="s in sources"
            :key="s.id"
            class="group rounded-md border transition-all"
            :class="sourceBulk.isSelected(s.id) ? 'border-primary/60 bg-primary/10' : (activeSourceId === s.id ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:bg-white/5')"
          >
            <div class="flex items-start p-2">
              <button
                type="button"
                class="p-1 mr-1 rounded transition-colors shrink-0"
                :class="sourceBulk.isSelected(s.id) ? 'text-primary' : 'text-textMuted opacity-0 group-hover:opacity-100 hover:text-textMain'"
                :title="sourceBulk.isSelected(s.id) ? '取消选中' : '选中此日志源'"
                @click.stop="toggleSourceSelection($event, s.id)"
              >
                <CheckSquare v-if="sourceBulk.isSelected(s.id)" class="w-3.5 h-3.5" />
                <Square v-else class="w-3.5 h-3.5" />
              </button>
              <button
                @click="pickSource(s.id)"
                class="flex-1 text-left min-w-0"
              >
                <div v-if="renamingId === s.id" @click.stop>
                  <input
                    v-model="renameValue"
                    @keydown.enter.prevent="commitRename"
                    @keydown.esc.prevent="renamingId = ''"
                    @blur="commitRename"
                    class="w-full bg-base border border-border rounded px-2 py-1 text-xs text-textMain focus:outline-none focus:border-primary"
                    autofocus
                  />
                </div>
                <div v-else>
                  <div class="text-sm text-textMain font-medium truncate">{{ s.label }}</div>
                  <div class="text-[10px] text-textMuted font-mono truncate" :title="s.filePath">{{ s.filePath }}</div>
                </div>
              </button>
              <div class="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  @click.stop="startRename(s)"
                  class="p-1 text-textMuted hover:text-textMain rounded"
                  title="重命名"
                >
                  <Pencil class="w-3 h-3" />
                </button>
                <button
                  @click.stop="askDelete(s.id)"
                  class="p-1 text-textMuted hover:text-danger rounded"
                  title="移除"
                >
                  <Trash2 class="w-3 h-3" />
                </button>
              </div>
            </div>
          </li>
        </ul>
      </aside>

      <!-- Viewer -->
      <section class="col-span-12 lg:col-span-9 bg-panel border border-border rounded-lg flex flex-col" style="min-height: 540px;">
        <div v-if="!activeSource" class="flex-1 flex items-center justify-center text-textMuted text-sm">
          请选择左侧日志源
        </div>
        <template v-else>
          <div class="flex items-center justify-between px-4 py-3 border-b border-border">
            <div class="min-w-0 flex-1">
              <div class="text-sm text-textMain font-medium truncate">{{ activeSource.label }}</div>
              <div class="text-[10px] text-textMuted font-mono truncate" :title="activeSource.filePath">
                {{ activeSource.filePath }} · {{ formatBytes(fileSize) }}
              </div>
            </div>
            <div class="flex items-center space-x-1 ml-3">
              <button
                v-for="m in ['live','history','search'] as const"
                :key="m"
                @click="mode = m"
                class="inline-flex items-center px-2.5 py-1 text-xs rounded-md border transition-all"
                :class="mode === m ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-textMuted hover:text-textMain'"
              >
                <Activity v-if="m === 'live'" class="w-3 h-3 mr-1" />
                <HistoryIcon v-else-if="m === 'history'" class="w-3 h-3 mr-1" />
                <Search v-else class="w-3 h-3 mr-1" />
                {{ m === 'live' ? '实时' : m === 'history' ? '历史' : '搜索' }}
              </button>
            </div>
          </div>

          <!-- Live -->
          <div v-if="mode === 'live'" class="flex-1 flex flex-col min-h-0">
            <div class="flex items-center justify-between px-4 py-2 border-b border-border text-xs">
              <div class="flex items-center space-x-3 text-textMuted">
                <label class="flex items-center space-x-1">
                  <span>尾部行数</span>
                  <select v-model.number="liveTailLines" @change="startLive" class="bg-base border border-border rounded px-2 py-0.5 text-textMain focus:outline-none focus:border-primary">
                    <option :value="5">5</option>
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                    <option :value="30">30</option>
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                    <option :value="200">200</option>
                    <option :value="500">500</option>
                    <option :value="1000">1000</option>
                  </select>
                </label>
                <span :class="tail.connected ? 'text-success' : 'text-textMuted'">
                  {{ tail.connected ? '● 实时跟随' : '○ 已断开' }}
                </span>
              </div>
              <div class="flex items-center space-x-2">
                <button
                  @click="liveFollow = !liveFollow; if (liveFollow) scrollLiveBottom()"
                  class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded"
                  :class="{ 'text-primary border-primary/40': liveFollow }"
                >
                  <component :is="liveFollow ? Pause : Play" class="w-3 h-3 mr-1" />
                  {{ liveFollow ? '自动滚动中' : '已暂停滚动' }}
                </button>
                <button @click="startLive" class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded">
                  <RefreshCw class="w-3 h-3 mr-1" /> 重连
                </button>
              </div>
            </div>
            <div v-if="liveError" class="px-4 py-2 text-xs text-danger flex items-center bg-danger/5 border-b border-danger/20">
              <AlertTriangle class="w-3.5 h-3.5 mr-1" /> {{ liveError }}
            </div>
            <div
              ref="liveLogRef"
              @scroll="onLiveScroll"
              class="flex-1 overflow-auto bg-base p-3 font-mono text-xs leading-relaxed"
              style="min-height: 380px;"
            >
              <div v-if="liveLines.length === 0" class="text-textMuted text-center py-12">
                <Loader2 v-if="tail.connected" class="w-4 h-4 mx-auto animate-spin" />
                <span v-else>暂无日志内容</span>
              </div>
              <div v-for="(l, i) in liveLines" :key="i" class="whitespace-pre-wrap break-all text-textMain/90">{{ l }}</div>
            </div>
          </div>

          <!-- History -->
          <div v-else-if="mode === 'history'" class="flex-1 flex flex-col min-h-0">
            <div class="flex items-center justify-between px-4 py-2 border-b border-border text-xs">
              <div class="flex items-center space-x-2">
                <button @click="loadHistoryHead" class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded">
                  最前
                </button>
                <button @click="pageBackward" :disabled="historyLoading || historyStart <= 0" class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded disabled:opacity-40">
                  <ChevronUp class="w-3 h-3 mr-1" /> 上一页
                </button>
                <button @click="pageForward" :disabled="historyLoading || historyEnd >= historySize" class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded disabled:opacity-40">
                  <ChevronDown class="w-3 h-3 mr-1" /> 下一页
                </button>
                <button @click="loadHistoryTail" class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded">
                  最末
                </button>
              </div>
              <div class="text-textMuted font-mono">
                {{ formatBytes(historyStart) }} ~ {{ formatBytes(historyEnd) }} / {{ formatBytes(historySize) }}
                <span v-if="historyBinary" class="ml-2 text-yellow-400">[二进制]</span>
              </div>
            </div>
            <div v-if="historyError" class="px-4 py-2 text-xs text-danger flex items-center bg-danger/5 border-b border-danger/20">
              <AlertTriangle class="w-3.5 h-3.5 mr-1" /> {{ historyError }}
            </div>
            <div class="flex-1 overflow-auto bg-base p-3 font-mono text-xs leading-relaxed" style="min-height: 380px;">
              <div v-if="historyLoading && historyLines.length === 0" class="text-textMuted text-center py-12">
                <Loader2 class="w-4 h-4 mx-auto animate-spin" />
              </div>
              <div v-else>
                <div v-if="historyTruncatedHead" class="text-[10px] text-textMuted text-center py-1">… 顶部已截齐到换行</div>
                <div v-for="(l, i) in historyLines" :key="i" class="whitespace-pre-wrap break-all text-textMain/90">{{ l }}</div>
                <div v-if="historyTruncatedTail" class="text-[10px] text-textMuted text-center py-1">… 底部已截齐到换行</div>
              </div>
            </div>
          </div>

          <!-- Search -->
          <div v-else class="flex-1 flex flex-col min-h-0">
            <div class="px-4 py-2 border-b border-border space-y-2">
              <div class="flex items-center space-x-2">
                <input
                  v-model="searchQuery"
                  @keydown.enter.prevent="runSearch"
                  type="text"
                  spellcheck="false"
                  placeholder="输入关键词 / 正则 (回车搜索)"
                  class="flex-1 bg-base border border-border rounded-md px-3 py-1.5 text-textMain text-sm font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
                <button
                  v-if="search.running"
                  @click="abortSearch"
                  class="inline-flex items-center px-3 py-1.5 text-xs border border-border rounded-md text-textMuted hover:text-textMain"
                >
                  <X class="w-3 h-3 mr-1" /> 中止
                </button>
                <button
                  v-else
                  @click="runSearch"
                  class="inline-flex items-center px-3 py-1.5 text-xs bg-primary text-white rounded-md hover:bg-primary/90"
                >
                  <Search class="w-3 h-3 mr-1" /> 搜索
                </button>
              </div>
              <div class="flex items-center space-x-3 text-xs text-textMuted">
                <label class="flex items-center"><input type="checkbox" v-model="searchRegex" class="mr-1 accent-primary" /> 正则</label>
                <label class="flex items-center"><input type="checkbox" v-model="searchCaseInsensitive" class="mr-1 accent-primary" /> 忽略大小写</label>
                <span v-if="search.running" class="text-primary">搜索中…</span>
                <span v-else-if="searchDone">扫描 {{ formatBytes(searchDone.scannedBytes) }}，命中 {{ searchHits.length }} 条</span>
                <span v-if="searchTruncated" class="text-yellow-400">已截断（达到 {{ searchTruncated.maxHits }} 条上限）</span>
              </div>
            </div>
            <div v-if="searchError" class="px-4 py-2 text-xs text-danger flex items-center bg-danger/5 border-b border-danger/20">
              <AlertTriangle class="w-3.5 h-3.5 mr-1" /> {{ searchError }}
            </div>
            <div class="flex-1 overflow-auto bg-base p-3 font-mono text-xs leading-relaxed" style="min-height: 380px;">
              <div v-if="searchHits.length === 0 && !search.running" class="text-textMuted text-center py-12">
                {{ searchDone ? '无匹配' : '输入关键词后回车开始搜索' }}
              </div>
              <ul>
                <li v-for="(h, i) in searchHits" :key="i" class="flex items-start py-0.5">
                  <span class="text-textMuted/60 mr-3 text-right shrink-0 font-mono" style="min-width: 7em" :title="`offset=${h.offset}`">@{{ formatBytes(h.offset) }}</span>
                  <span class="text-textMain/90 whitespace-pre-wrap break-all" v-html="highlightHit(h.text)"></span>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </section>
    </div>

    <FolderPickerDialog
      :open="pickerOpen"
      mode="multi"
      pickKind="file"
      title="选择日志文件（可多选）"
      @update:open="pickerOpen = $event"
      @confirm="onPickerConfirm"
    />

    <ConfirmDialog
      :open="confirmDeleteOpen"
      title="移除日志源"
      message="移除后将无法继续查看该文件。日志文件本身不会被删除。"
      confirm-text="移除"
      tone="danger"
      @update:open="confirmDeleteOpen = $event"
      @confirm="confirmDelete"
    />

    <BulkActionBar
      :count="sourceBulk.selectedCount.value"
      :total="sources.length"
      @clear="sourceBulk.clear"
    >
      <template #actions>
        <button
          type="button"
          :disabled="isBulkDeletingSources"
          class="flex items-center px-2.5 py-1.5 text-xs rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
          @click="openBulkDeleteSources"
        >
          <Trash2 class="w-3.5 h-3.5 mr-1.5" />
          删除选中
        </button>
      </template>
    </BulkActionBar>

    <ConfirmDialog
      v-model:open="showBulkDeleteSources"
      tone="danger"
      title="批量移除日志源？"
      :message="`将移除 ${sourceBulk.selectedCount.value} 个日志源。日志文件本身不会被删除。`"
      confirm-text="确认删除"
      cancel-text="取消"
      :require-text="bulkDeleteSourcesRequireText"
      :require-text-hint="`请输入 ${bulkDeleteSourcesRequireText} 以确认`"
      :loading="isBulkDeletingSources"
      @confirm="confirmBulkDeleteSources"
    />
  </div>
</template>
