<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { ArrowLeft, Plus, RefreshCw, Trash2, FileText, Loader2, Pencil, Zap, CheckSquare, Square, MinusSquare, Columns, X } from 'lucide-vue-next'
import { useProjectStore, type Pm2AppStatus } from '../store/project'
import { useToast } from '../composables/useToast'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import LogPane from '../components/LogPane.vue'
import LogPaneSplit from '../components/LogPaneSplit.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import { apiUrl } from '../lib/base'

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
const pm2AutoLinked = ref(false)
const pm2AppName = computed(() => (project.value as any)?.pm2AppName?.trim() || '')

const AUTO_PRUNE_STORAGE_KEY = 'kite.logTail.autoPrunePm2'
const autoPrunePm2Logs = ref<boolean>(((): boolean => {
  try {
    const v = localStorage.getItem(AUTO_PRUNE_STORAGE_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
})())
watch(autoPrunePm2Logs, (v) => {
  try { localStorage.setItem(AUTO_PRUNE_STORAGE_KEY, v ? '1' : '0') } catch { /* ignore */ }
})

type Pm2LogPathItem = {
  path: string
  kind: 'stdout' | 'stderr'
  instanceId?: number
}

const pm2LogPaths = computed<Pm2LogPathItem[]>(() => {
  const s = pm2Status.value
  if (!s || s.found === false) return []
  const list: Pm2LogPathItem[] = []
  const seen = new Set<string>()
  const pushUnique = (item: Pm2LogPathItem) => {
    if (!item.path) return
    if (seen.has(item.path)) return
    seen.add(item.path)
    list.push(item)
  }
  // 优先使用每个实例的日志路径（cluster 模式下可能有多组 -0/-1/…）
  const perInstance = Array.isArray(s.instancesLogPaths) ? s.instancesLogPaths : []
  for (const inst of perInstance) {
    if (inst?.outLogPath) pushUnique({ path: inst.outLogPath, kind: 'stdout', instanceId: inst.instanceId })
    if (inst?.errorLogPath) pushUnique({ path: inst.errorLogPath, kind: 'stderr', instanceId: inst.instanceId })
  }
  // 兜底：老版本 server 只返回 outLogPath / errorLogPath
  if (s.outLogPath) pushUnique({ path: s.outLogPath, kind: 'stdout' })
  if (s.errorLogPath) pushUnique({ path: s.errorLogPath, kind: 'stderr' })
  return list
})

const pm2MissingPaths = computed(() => {
  if (pm2LogPaths.value.length === 0) return []
  const have = new Set(sources.value.map((s) => s.filePath))
  return pm2LogPaths.value.filter((p) => !have.has(p.path))
})

const canImportFromPm2 = computed(() => pm2AppName.value && pm2Status.value?.found === true && pm2LogPaths.value.length > 0)

function buildPm2SourceLabel(name: string, item: Pm2LogPathItem): string {
  const parts = [name, item.kind]
  if (typeof item.instanceId === 'number' && Number.isFinite(item.instanceId)) {
    parts.push(`#${item.instanceId}`)
  }
  return parts.join(' · ')
}

const pickerOpen = ref(false)
const confirmDeleteOpen = ref(false)
const pendingDeleteId = ref<string>('')
const renamingId = ref<string>('')
const renameValue = ref<string>('')

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
  const minSort = sources.value.reduce((acc, s) => Math.min(acc, s.sortOrder ?? 0), 0)
  const baseSort = minSort - missing.length
  const items = missing.map((m, idx) => ({
    filePath: m.path,
    label: buildPm2SourceLabel(name, m),
    kind: 'pm2',
    sortOrder: baseSort + idx,
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

// 静默自动关联：进入日志页时如发现 PM2 有未导入的日志文件，自动补齐并置顶排序。
async function autoLinkPm2Sources() {
  if (pm2AutoLinked.value) return
  if (!pm2AppName.value) return
  if (pm2Status.value?.found !== true) return
  // 先按当前 PM2 activeSet 清理过期的 pm2 kind 行，避免"旧路径残留 + 新路径新增"造成翻倍。
  await prunePm2IfNeeded()
  await loadSources()
  const missing = pm2MissingPaths.value
  if (missing.length === 0) {
    pm2AutoLinked.value = true
    return
  }
  const name = pm2AppName.value || 'pm2'
  const minSort = sources.value.reduce((acc, s) => Math.min(acc, s.sortOrder ?? 0), 0)
  const baseSort = minSort - missing.length
  const items = missing.map((m, idx) => ({
    filePath: m.path,
    label: buildPm2SourceLabel(name, m),
    kind: 'pm2',
    sortOrder: baseSort + idx,
  }))
  try {
    const data = await store.createLogSources(projectId.value, items)
    const created = Array.isArray(data?.created) ? data.created : []
    if (created.length > 0) {
      await loadSources()
      if (!activeSourceId.value) pickSource(created[0].id)
    }
    pm2AutoLinked.value = true
  } catch {
    // ignore, 用户仍可手动点"从 PM2 导入"
  }
}

async function refreshAll() {
  pm2AutoLinked.value = false
  await loadPm2Status()
  await prunePm2IfNeeded()
  await loadSources()
  await autoLinkPm2Sources()
}

// 清理已不在 pm2 jlist 有效路径集合内的 kind='pm2' 日志源。
// 仅当自动清理开关开启、项目已绑定 pm2AppName、且 pm2Status.found === true 才执行。
async function prunePm2IfNeeded() {
  if (!autoPrunePm2Logs.value) return
  if (!pm2AppName.value) return
  if (pm2Status.value?.found !== true) return
  try {
    const res = await store.prunePm2LogSources(projectId.value)
    const removed = Array.isArray(res?.removed) ? res.removed : []
    if (removed.length === 0) return
    const removedIds = new Set(removed.map((r) => r.id))
    if (activeSourceId.value && removedIds.has(activeSourceId.value)) {
      activeSourceId.value = ''
    }
    // 从本地 sources 中同步移除，避免在下一次 loadSources 之前列表仍显示旧项。
    sources.value = sources.value.filter((s) => !removedIds.has(s.id))
    toast.success(`已清理 ${removed.length} 个旧的 PM2 日志源`)
  } catch (e: any) {
    // 静默失败，避免影响主要刷新流程；控制台留痕便于排查
    console.warn('prunePm2LogSources failed', e)
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
      activeSourceId.value = ''
    }
    await loadSources()
    pm2AutoLinked.value = false
    await autoLinkPm2Sources()
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

// ---------- Split view ----------
const SPLIT_MAX = 4
const SPLIT_MIN = 2
const splitMode = ref(false)

const splitSources = computed(() => {
  const ids = Array.from(sourceBulk.selectedIds.value)
  const map = new Map(sources.value.map((s) => [s.id, s]))
  return ids
    .map((id) => map.get(id))
    .filter((s): s is LogSource => !!s)
    .slice(0, SPLIT_MAX)
})

const canOpenSplit = computed(() => {
  const n = sourceBulk.selectedCount.value
  return n >= SPLIT_MIN && n <= SPLIT_MAX
})

function openSplit() {
  const n = sourceBulk.selectedCount.value
  if (n < SPLIT_MIN) {
    toast.error(`请至少勾选 ${SPLIT_MIN} 个日志源`)
    return
  }
  if (n > SPLIT_MAX) {
    toast.error('已超出分屏上限', `分屏最多同时查看 ${SPLIT_MAX} 个日志源`)
    return
  }
  splitMode.value = true
}

function exitSplit() {
  splitMode.value = false
}

function removeFromSplit(id: string) {
  sourceBulk.toggle(id)
  if (splitSources.value.length < SPLIT_MIN) {
    splitMode.value = false
  }
}

watch(splitSources, (val) => {
  if (splitMode.value && val.length < SPLIT_MIN) {
    splitMode.value = false
  }
})

async function confirmBulkDeleteSources() {
  if (isBulkDeletingSources.value) return
  const ids = Array.from(sourceBulk.selectedIds.value)
  if (ids.length === 0) return
  isBulkDeletingSources.value = true
  try {
    const res = await fetch(apiUrl('/log-sources/bulk'), {
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
      activeSourceId.value = ''
    }
    showBulkDeleteSources.value = false
    sourceBulk.clear()
    await loadSources()
    pm2AutoLinked.value = false
    await autoLinkPm2Sources()
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
  activeSourceId.value = id
}

onMounted(async () => {
  if (!store.projects.length) {
    try { await store.fetchProjects() } catch { /* ignore */ }
  }
  await loadPm2Status()
  await prunePm2IfNeeded()
  await loadSources()
  await autoLinkPm2Sources()
})

// 项目数据/PM2 绑定可能在挂载后异步到达：变化时重新拉取
watch(pm2AppName, async () => {
  pm2AutoLinked.value = false
  await loadPm2Status()
  await prunePm2IfNeeded()
  await loadSources()
  await autoLinkPm2Sources()
})

watch(() => pm2Status.value?.found === true ? pm2LogPaths.value.map((p) => p.path).join('|') : '', async (val, prev) => {
  if (val && val !== prev) {
    pm2AutoLinked.value = false
    await prunePm2IfNeeded()
    await loadSources()
    await autoLinkPm2Sources()
  }
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
        <label
          v-if="pm2AppName"
          class="inline-flex items-center px-2 py-1.5 text-[11px] text-textMuted border border-border rounded-md cursor-pointer hover:text-textMain hover:border-primary/40 transition-colors select-none"
          title="刷新时自动清理 PM2 重启后遗留的旧日志源（仅移除 kind=pm2 且不在最新有效路径集合中的记录）"
        >
          <input v-model="autoPrunePm2Logs" type="checkbox" class="mr-1.5 accent-primary" />
          自动清理旧 PM2 日志
        </label>
        <button
          v-if="!splitMode"
          @click="openSplit"
          :disabled="!canOpenSplit"
          class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-border hover:border-primary/50 hover:text-primary text-textMuted rounded-md transition-all disabled:opacity-50 disabled:hover:border-border disabled:hover:text-textMuted"
          :title="sourceBulk.selectedCount.value < 2
            ? '勾选左侧 2~4 个日志源后可开启分屏对比'
            : (sourceBulk.selectedCount.value > 4 ? '分屏最多同时查看 4 个日志源' : `分屏对比选中的 ${sourceBulk.selectedCount.value} 个日志源`)"
        >
          <Columns class="w-3.5 h-3.5 mr-1.5" />
          分屏对比{{ sourceBulk.selectedCount.value >= 2 ? ` (${Math.min(sourceBulk.selectedCount.value, 4)})` : '' }}
        </button>
        <button
          v-else
          @click="exitSplit"
          class="inline-flex items-center px-3 py-1.5 text-xs font-medium bg-base border border-primary/50 text-primary hover:bg-primary/10 rounded-md transition-all"
          title="退出分屏，返回单开查看"
        >
          <X class="w-3.5 h-3.5 mr-1.5" />
          退出分屏
        </button>
        <button
          @click="refreshAll"
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

    <div v-if="splitMode" class="w-full">
      <LogPaneSplit :sources="splitSources" @remove="removeFromSplit" />
    </div>

    <div v-else class="grid grid-cols-12 gap-4">
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
        <LogPane
          v-if="activeSource"
          :source-id="activeSource.id"
          :label="activeSource.label"
          :file-path="activeSource.filePath"
        />
        <div v-else class="flex-1 flex items-center justify-center text-textMuted text-sm">
          请选择左侧日志源
        </div>
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
