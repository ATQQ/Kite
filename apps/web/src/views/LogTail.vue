<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Plus, RefreshCw, Trash2, FileText, Play, Pause, ChevronDown, ChevronUp, Search, X, AlertTriangle, Loader2, Activity, History as HistoryIcon, Pencil } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import { useToast } from '../composables/useToast'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
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

const pickerOpen = ref(false)
const confirmDeleteOpen = ref(false)
const pendingDeleteId = ref<string>('')
const renamingId = ref<string>('')
const renameValue = ref<string>('')

const mode = ref<Mode>('live')

const fileSize = ref(0)

const liveLines = ref<string[]>([])
const liveFollow = ref(true)
const liveTailLines = ref(200)
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
          <span>日志源</span>
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
            :class="activeSourceId === s.id ? 'border-primary/60 bg-primary/5' : 'border-transparent hover:bg-white/5'"
          >
            <div class="flex items-start p-2">
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
  </div>
</template>
