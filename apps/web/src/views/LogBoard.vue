<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { ansiToHtml } from '../utils/ansi'
import { useDeployStream } from '../composables/useDeployStream'
import { Terminal, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle, RotateCcw, Archive, ArchiveX, Copy, CheckCheck, Wrench, GitBranch, ListTree, FileText } from 'lucide-vue-next'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import DeploymentTimeline from '../components/DeploymentTimeline.vue'
import { useToast } from '../composables/useToast'
import { parseDeploymentEvents, splitTimestamp } from '../utils/deployment-timeline'

const projectStore = useProjectStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const searchKeyword = ref('')
const selectedProjectId = ref<string>('')

const projectOptions = computed(() => {
  const fromStore = projectStore.projects.map(p => ({ id: p.id, name: p.name }))
  const seen = new Set(fromStore.map(p => p.id))
  for (const log of projectStore.logs) {
    if (!seen.has(log.projectId)) {
      seen.add(log.projectId)
      fromStore.push({ id: log.projectId, name: log.projectName })
    }
  }
  return fromStore
})

const logs = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase()
  return projectStore.logs.filter(log => {
    if (selectedProjectId.value && log.projectId !== selectedProjectId.value) return false
    if (!kw) return true
    return (
      log.projectName.toLowerCase().includes(kw) ||
      log.id.toLowerCase().includes(kw)
    )
  })
})

const selectedLog = ref<any>(null)
const isRunning = computed(() => selectedLog.value?.status === 'running')

const nowTick = ref(Date.now())
let nowTimer: number | null = null
const DEFAULT_STUCK_THRESHOLD_MIN = 10
const stuckThresholdMin = ref<number>(DEFAULT_STUCK_THRESHOLD_MIN)
const stuckThresholdMs = computed(() => stuckThresholdMin.value * 60 * 1000)

const listItemRefs = ref<Record<string, HTMLElement | null>>({})
const setItemRef = (id: string) => (el: any) => {
  listItemRefs.value[id] = el as HTMLElement | null
}

async function selectById(id: string | null) {
  if (!id) return
  const matched = projectStore.logs.find(l => l.id === id)
  if (!matched) return
  selectedLog.value = matched
  await nextTick()
  const el = listItemRefs.value[id]
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest' })
  }
}

onMounted(async () => {
  if (projectStore.projects.length === 0) {
    projectStore.fetchProjects()
  }
  await projectStore.fetchLogs()
  projectStore.fetchSettings().then((s: any) => {
    const raw = s?.deployment_stuck_threshold_min
    const n = raw == null ? NaN : Number(raw)
    if (Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 1440) {
      stuckThresholdMin.value = n
    }
  }).catch(() => { /* ignore, fallback to default */ })
  const pid = typeof route.query.projectId === 'string' ? route.query.projectId : ''
  if (pid) selectedProjectId.value = pid
  const id = typeof route.query.id === 'string' ? route.query.id : null
  await selectById(id)
  nowTick.value = Date.now()
  nowTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 30_000)
})

onBeforeUnmount(() => {
  if (nowTimer !== null) {
    clearInterval(nowTimer)
    nowTimer = null
  }
})

watch(() => route.query.id, async (id) => {
  if (typeof id === 'string') await selectById(id)
})

watch(() => route.query.projectId, (pid) => {
  selectedProjectId.value = typeof pid === 'string' ? pid : ''
})

watch(selectedProjectId, (pid) => {
  const currentPid = typeof route.query.projectId === 'string' ? route.query.projectId : ''
  if (pid === currentPid) return
  const nextQuery = { ...route.query }
  if (pid) nextQuery.projectId = pid
  else delete nextQuery.projectId
  router.replace({ query: nextQuery })
  if (selectedLog.value && pid && selectedLog.value.projectId !== pid) {
    selectedLog.value = null
  }
})

// SSE stream for running deployments
const { lines: streamLines, status: streamStatus } = useDeployStream(
  computed(() => isRunning.value ? selectedLog.value?.id : null),
  computed(() => projectStore.adminToken)
)

// When stream reports a final status, refresh the log list
watch(streamStatus, (s) => {
  if (s) {
    projectStore.fetchLogs().then(() => {
      if (selectedLog.value) {
        const updated = projectStore.logs.find(l => l.id === selectedLog.value.id)
        if (updated) selectedLog.value = updated
      }
    })
  }
})

// Display lines: use stream for running, stored output for finished
const displayLines = computed(() => {
  if (isRunning.value && streamLines.value.length > 0) {
    return streamLines.value
  }
  return selectedLog.value?.output?.split('\n') || []
})

const displayLineRows = computed(() => {
  return displayLines.value.map((line: string) => {
    const split = splitTimestamp(line)
    return {
      raw: line,
      time: formatLineTime(split.timestamp),
      html: ansiToHtml(split.timestamp !== null ? split.rest : line),
    }
  })
})

// === Timeline Tab (F22) ===
type TabView = 'timeline' | 'raw'
const activeView = ref<TabView>('timeline')

function syncViewToQuery(v: TabView) {
  const current = typeof route.query.view === 'string' ? route.query.view : ''
  if (current === v) return
  const nextQuery = { ...route.query }
  if (v === 'timeline') delete nextQuery.view
  else nextQuery.view = v
  router.replace({ query: nextQuery })
}

watch(() => route.query.view, (raw) => {
  const v = raw === 'raw' ? 'raw' : 'timeline'
  if (v !== activeView.value) activeView.value = v
}, { immediate: true })

function setView(v: TabView) {
  activeView.value = v
  syncViewToQuery(v)
}

const timelineEvents = computed(() => {
  const log: any = selectedLog.value
  if (!log) return []
  const output = (isRunning.value && streamLines.value.length > 0)
    ? streamLines.value.join('\n')
    : (log.output || '')
  return parseDeploymentEvents({
    output,
    startTimeIso: log.startTime,
    endTimeIso: log.endTime ?? null,
    status: log.status,
    triggerSource: log.triggerSource,
  })
})

const rollbackSourceLog = computed(() => {
  const log: any = selectedLog.value
  if (!log?.rollbackOf) return null
  return projectStore.logs.find(l => l.id === log.rollbackOf) || null
})

const rollbackTargets = computed(() => {
  const log: any = selectedLog.value
  if (!log) return [] as any[]
  return projectStore.logs.filter((l: any) => l.rollbackOf === log.id)
})

const rawLogContainer = ref<HTMLElement | null>(null)
const highlightedLineIndex = ref<number | null>(null)
let highlightTimer: number | null = null

async function jumpToRawLine(rawLineIndex: number) {
  setView('raw')
  highlightedLineIndex.value = rawLineIndex
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer)
    highlightTimer = null
  }
  await nextTick()
  const container = rawLogContainer.value
  if (container) {
    const target = container.querySelector(`[data-line-index="${rawLineIndex}"]`) as HTMLElement | null
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }
  highlightTimer = window.setTimeout(() => {
    highlightedLineIndex.value = null
    highlightTimer = null
  }, 1500)
}

function jumpToDeployment(id: string) {
  const nextQuery = { ...route.query, id }
  router.replace({ query: nextQuery })
  selectById(id)
  setView('timeline')
}

onBeforeUnmount(() => {
  if (highlightTimer !== null) {
    clearTimeout(highlightTimer)
    highlightTimer = null
  }
})

const selectLog = (log: any) => {
  selectedLog.value = log
}

const refreshLogs = async () => {
  await projectStore.fetchLogs()
  if (selectedLog.value) {
    selectedLog.value = logs.value.find(l => l.id === selectedLog.value.id) || null
  }
}

function formatLineTime(ms: number | null): string {
  if (ms === null) return ''
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const mmm = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${mmm}`
}

const canRollback = computed(() => {
  const log: any = selectedLog.value
  if (!log) return false
  if (log.status === 'running') return false
  if (log.triggerSource === 'rollback') return false
  if (isCurrentVersion(log)) return false
  return !!log.artifactPath
})

const rollbackDisabledReason = computed(() => {
  const log: any = selectedLog.value
  if (!log) return ''
  if (log.status === 'running') return '部署进行中，无法回滚'
  if (log.triggerSource === 'rollback') return '回滚记录不可再被回滚'
  if (isCurrentVersion(log)) return ''
  if (!log.artifactPath) return '该版本归档已被清理或过早，无法回滚'
  return ''
})

const showRollbackConfirm = ref(false)
const isRollingBack = ref(false)

function shortId(id?: string | null) {
  if (!id) return ''
  return id.slice(0, 8)
}

const copiedId = ref<string>('')
async function copyDeploymentId(id: string, evt?: Event) {
  if (evt) {
    evt.stopPropagation()
    evt.preventDefault()
  }
  if (!id) return
  try {
    await navigator.clipboard.writeText(id)
    copiedId.value = id
    toast.success('已复制部署 ID', shortId(id))
    setTimeout(() => {
      if (copiedId.value === id) copiedId.value = ''
    }, 2000)
  } catch (e: any) {
    toast.error('复制失败', e?.message || '请手动选择文本复制')
  }
}

const currentDeploymentByProject = computed(() => {
  const map: Record<string, string> = {}
  const sorted = [...projectStore.logs].sort((a, b) => {
    const ta = new Date(a.startTime).getTime() || 0
    const tb = new Date(b.startTime).getTime() || 0
    return tb - ta
  })
  for (const log of sorted) {
    if (log.status !== 'success') continue
    if (map[log.projectId]) continue
    // A successful rollback re-deploys the source version's code, so the live
    // version is the rollback's `rollbackOf` target, not the rollback event row.
    if ((log as any).triggerSource === 'rollback' && (log as any).rollbackOf) {
      map[log.projectId] = (log as any).rollbackOf
    } else {
      map[log.projectId] = log.id
    }
  }
  return map
})

function isCurrentVersion(log: { id: string; projectId: string }) {
  return currentDeploymentByProject.value[log.projectId] === log.id
}

function openRollback() {
  if (!canRollback.value) return
  showRollbackConfirm.value = true
}

async function confirmRollback() {
  const sourceId = selectedLog.value?.id
  if (!sourceId) return
  isRollingBack.value = true
  try {
    const data = await projectStore.rollbackDeployment(sourceId)
    toast.success('回滚已完成', `新部署 ${shortId(data.deployId)}`)
    showRollbackConfirm.value = false
    await projectStore.fetchLogs()
    const next = projectStore.logs.find(l => l.id === data.deployId)
    if (next) {
      selectedLog.value = next
      await nextTick()
      const el = listItemRefs.value[next.id]
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' })
      }
    }
  } catch (e: any) {
    toast.error('回滚失败', e?.message || '未知错误')
  } finally {
    isRollingBack.value = false
  }
}

const stuckRunningMs = computed(() => {
  const log: any = selectedLog.value
  if (!log || log.status !== 'running') return 0
  const startMs = new Date(log.startTime).getTime()
  if (!Number.isFinite(startMs)) return 0
  return Math.max(0, nowTick.value - startMs)
})

const canMarkStatus = computed(() => stuckRunningMs.value >= stuckThresholdMs.value)

const stuckDurationLabel = computed(() => {
  const ms = stuckRunningMs.value
  if (ms <= 0) return ''
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 60) return `${totalMin} 分钟`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`
})

const showMarkConfirm = ref(false)
const pendingMarkStatus = ref<'success' | 'failed'>('failed')
const isMarking = ref(false)

const markDialogTone = computed(() => pendingMarkStatus.value === 'failed' ? 'danger' : 'warning')
const markDialogTitle = computed(() =>
  pendingMarkStatus.value === 'failed' ? '确认将此部署标记为失败？' : '确认将此部署标记为成功？'
)
const markDialogMessage = computed(() => {
  const log: any = selectedLog.value
  const idShort = log ? shortId(log.id) : ''
  const projectName = log?.projectName || ''
  const lasted = stuckDurationLabel.value ? `（已持续 ${stuckDurationLabel.value}）` : ''
  if (pendingMarkStatus.value === 'failed') {
    return `部署 ${idShort}（${projectName}）当前显示为进行中${lasted}。此操作只会修正数据库记录与项目状态，不会回滚或清理已落盘的文件，仅适用于服务进程已退出 / 卡死的场景。`
  }
  return `部署 ${idShort}（${projectName}）当前显示为进行中${lasted}。标记为成功仅会修正数据库状态，**不代表部署真的执行成功**，请确认你已通过其他方式验证产物可用。`
})

function openMark(status: 'success' | 'failed') {
  if (!canMarkStatus.value) return
  pendingMarkStatus.value = status
  showMarkConfirm.value = true
}

async function confirmMark() {
  const log: any = selectedLog.value
  if (!log) return
  isMarking.value = true
  try {
    const res = await projectStore.markDeploymentStatus(log.id, pendingMarkStatus.value)
    toast.success(
      pendingMarkStatus.value === 'failed' ? '已标记为失败' : '已标记为成功',
      `部署 ${shortId(log.id)}`
    )
    showMarkConfirm.value = false
    await projectStore.fetchLogs()
    const updated = projectStore.logs.find(l => l.id === log.id)
    if (updated) {
      selectedLog.value = updated
    } else if (res?.deployment) {
      selectedLog.value = res.deployment
    }
  } catch (e: any) {
    const msg = e?.data?.code === 'NOT_RUNNING'
      ? '该部署已不是进行中状态，无需修正'
      : (e?.message || '未知错误')
    toast.error('标记失败', msg)
  } finally {
    isMarking.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col space-y-6 max-w-7xl mx-auto">
    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 shrink-0">
      <div>
        <h1 class="text-2xl font-bold text-textMain tracking-tight">部署日志</h1>
        <p class="text-textMuted text-sm mt-1">实时查看所有项目的自动化部署过程及终端输出</p>
      </div>
      <button @click="refreshLogs" class="flex items-center px-4 py-2 bg-panel dark:hover:bg-white/5 hover:bg-black/5 border border-border text-textMain rounded-md transition-colors text-sm font-medium shadow-sm self-start sm:self-auto">
        <RefreshCw class="w-4 h-4 mr-2" />
        刷新
      </button>
    </div>

    <!-- Layout: Left List, Right Terminal -->
    <div class="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">

      <!-- Log List -->
      <div class="w-full lg:w-1/3 bg-panel border border-border rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px] lg:h-auto">
        <div class="p-4 border-b border-border bg-base/50 shrink-0 space-y-2">
          <select
            v-model="selectedProjectId"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
          >
            <option value="">全部项目</option>
            <option v-for="p in projectOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索项目或记录 ID..."
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
          />
          <div v-if="selectedProjectId || searchKeyword" class="flex items-center justify-between text-xs text-textMuted">
            <span>已过滤 {{ logs.length }} 条记录</span>
            <button
              @click="selectedProjectId = ''; searchKeyword = ''"
              class="text-primary hover:underline"
            >清除过滤</button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-2 space-y-1">
          <div
            v-for="log in logs"
            :key="log.id"
            :ref="setItemRef(log.id)"
            @click="selectLog(log)"
            class="p-3 rounded-lg cursor-pointer transition-all border border-transparent flex items-start space-x-3"
            :class="selectedLog?.id === log.id ? 'bg-primary/10 border-primary/20 shadow-[inset_2px_0_0_0_#3b82f6]' : 'dark:hover:bg-white/5 hover:bg-black/5'"
          >
            <div class="mt-0.5">
              <CheckCircle2 v-if="log.status === 'success'" class="w-5 h-5 text-success" />
              <XCircle v-else-if="log.status === 'failed'" class="w-5 h-5 text-danger" />
              <RefreshCw v-else class="w-5 h-5 text-primary animate-spin" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex justify-between items-center mb-1 gap-2">
                <span class="font-medium text-textMain text-sm truncate">{{ log.projectName }}</span>
                <span class="text-xs text-textMuted font-mono shrink-0 truncate">{{ new Date(log.startTime).toLocaleString() }}</span>
              </div>
              <div class="flex items-center text-xs text-textMuted gap-1.5 flex-wrap">
                <span
                  class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-base border border-border font-mono text-[10px] text-textMuted hover:text-primary hover:border-primary/40 transition-colors cursor-pointer"
                  :title="`点击复制完整 ID: ${log.id}`"
                  @click.stop="copyDeploymentId(log.id, $event)"
                >
                  <CheckCheck v-if="copiedId === log.id" class="w-3 h-3 text-success" />
                  <Copy v-else class="w-3 h-3" />
                  {{ shortId(log.id) }}
                </span>
                <span
                  v-if="isCurrentVersion(log)"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-success/10 border border-success/30 text-success"
                  title="该版本为当前线上版本"
                >当前</span>
                <span class="flex items-center">
                  <Terminal class="w-3 h-3 mr-1" />
                  {{ log.triggerSource }}
                </span>
                <span class="flex items-center">
                  <Clock class="w-3 h-3 mr-1" />
                  {{ log.duration }}
                </span>
                <span
                  v-if="log.triggerSource === 'rollback'"
                  class="ml-auto text-[10px] font-mono px-1 py-0 rounded bg-yellow-400/10 border border-yellow-400/30 text-yellow-400"
                >RB</span>
              </div>
            </div>
          </div>
          <div v-if="logs.length === 0" class="flex flex-col items-center justify-center py-10 text-textMuted text-sm">
            <AlertCircle class="w-8 h-8 mb-2 opacity-50" />
            <p>暂无匹配的部署记录</p>
          </div>
        </div>
      </div>

      <!-- Terminal View -->
      <div class="flex-1 bg-[#09090b] border border-border rounded-xl shadow-sm flex flex-col overflow-hidden h-[500px] lg:h-auto font-mono text-sm">
        <!-- Terminal Header -->
        <div class="h-10 bg-panel border-b border-border flex items-center px-4 shrink-0 gap-2">
          <div class="flex space-x-2 mr-2">
            <div class="w-3 h-3 rounded-full bg-danger/80"></div>
            <div class="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div class="w-3 h-3 rounded-full bg-success/80"></div>
          </div>
          <div class="flex-1 text-center text-textMuted text-xs font-sans truncate flex items-center justify-center gap-1.5">
            <template v-if="selectedLog">
              <span>bash - {{ selectedLog.projectName }}</span>
              <button
                type="button"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-base border border-border font-mono text-[10px] text-textMuted hover:text-primary hover:border-primary/40 transition-colors"
                :title="`点击复制完整 ID: ${selectedLog.id}`"
                @click="copyDeploymentId(selectedLog.id, $event)"
              >
                <CheckCheck v-if="copiedId === selectedLog.id" class="w-3 h-3 text-success" />
                <Copy v-else class="w-3 h-3" />
                {{ shortId(selectedLog.id) }}
              </button>
            </template>
            <template v-else>等待选择...</template>
          </div>
          <div v-if="selectedLog" class="flex items-center gap-1.5">
            <span
              v-if="isCurrentVersion(selectedLog)"
              class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-success/10 border border-success/30 text-success"
              title="该版本为当前线上版本"
            >当前版本</span>
            <span
              v-if="selectedLog.triggerSource === 'rollback'"
              class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-yellow-400/10 border border-yellow-400/30 text-yellow-400"
              :title="`rollbackOf=${(selectedLog as any).rollbackOf || ''}`"
            >rollback</span>
            <Archive v-if="(selectedLog as any).artifactPath" class="w-3.5 h-3.5 text-success/70" title="已归档，可回滚" />
            <ArchiveX v-else class="w-3.5 h-3.5 text-textMuted/50" title="无归档" />
            <template v-if="isRunning && canMarkStatus">
              <button
                @click="openMark('failed')"
                class="flex items-center px-2.5 py-1 text-[11px] font-medium bg-danger/10 border border-danger/30 text-danger hover:bg-danger hover:text-white rounded transition-colors"
                type="button"
                :title="`部署已持续 ${stuckDurationLabel}，将状态修正为 failed`"
              >
                <Wrench class="w-3 h-3 mr-1" />
                标记为失败
              </button>
              <button
                @click="openMark('success')"
                class="flex items-center px-2.5 py-1 text-[11px] font-medium bg-success/10 border border-success/30 text-success hover:bg-success hover:text-white rounded transition-colors"
                type="button"
                :title="`部署已持续 ${stuckDurationLabel}，将状态修正为 success（仅状态修正，不验证产物）`"
              >
                <Wrench class="w-3 h-3 mr-1" />
                标记为成功
              </button>
            </template>
            <span
              v-else-if="isRunning"
              class="text-[10px] text-textMuted/70 italic"
              :title="`部署进行中不足 ${stuckThresholdMin} 分钟，暂不允许手动修正状态`"
            >进行中…</span>
            <button
              v-if="canRollback"
              @click="openRollback"
              class="flex items-center px-2.5 py-1 text-[11px] font-medium bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400 hover:text-black rounded transition-colors"
              type="button"
            >
              <RotateCcw class="w-3 h-3 mr-1" />
              回滚到此版本
            </button>
            <span
              v-else-if="rollbackDisabledReason"
              class="text-[10px] text-textMuted/70 italic"
              :title="rollbackDisabledReason"
            >不可回滚</span>
          </div>
        </div>

        <!-- Tab bar (F22: Timeline / Raw Log) -->
        <div v-if="selectedLog" class="border-b border-border bg-panel/60 flex items-center gap-1 px-3 shrink-0 font-sans">
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors"
            :class="activeView === 'timeline' ? 'border-primary text-primary' : 'border-transparent text-textMuted hover:text-textMain'"
            @click="setView('timeline')"
          >
            <ListTree class="w-3.5 h-3.5" />
            时间线
          </button>
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors"
            :class="activeView === 'raw' ? 'border-primary text-primary' : 'border-transparent text-textMuted hover:text-textMain'"
            @click="setView('raw')"
          >
            <FileText class="w-3.5 h-3.5" />
            原始日志
            <span class="text-[10px] text-textMuted/70 font-mono">({{ displayLines.length }})</span>
          </button>
        </div>

        <!-- Rollback ChainBar (F22) -->
        <div
          v-if="selectedLog && (rollbackSourceLog || rollbackTargets.length > 0)"
          class="px-4 py-2 border-b border-border bg-panel/40 text-xs text-textMuted font-sans flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0"
        >
          <template v-if="rollbackSourceLog">
            <GitBranch class="w-3.5 h-3.5 text-yellow-400" />
            <span>回滚自</span>
            <button
              type="button"
              class="inline-flex items-center px-1.5 py-0.5 rounded bg-base border border-border font-mono text-[10px] text-yellow-400 hover:border-yellow-400/60 transition-colors"
              :title="`跳转到部署 ${rollbackSourceLog.id}`"
              @click="jumpToDeployment(rollbackSourceLog.id)"
            >#{{ shortId(rollbackSourceLog.id) }} ↗</button>
            <span class="text-textMuted/60">({{ rollbackSourceLog.projectName }})</span>
          </template>
          <template v-if="rollbackTargets.length > 0">
            <span v-if="rollbackSourceLog" class="text-textMuted/30">·</span>
            <RotateCcw class="w-3.5 h-3.5 text-yellow-400" />
            <span>被</span>
            <button
              v-for="t in rollbackTargets"
              :key="t.id"
              type="button"
              class="inline-flex items-center px-1.5 py-0.5 rounded bg-base border border-border font-mono text-[10px] text-yellow-400 hover:border-yellow-400/60 transition-colors"
              :title="`跳转到部署 ${t.id}`"
              @click="jumpToDeployment(t.id)"
            >#{{ shortId(t.id) }} ↗</button>
            <span>回滚</span>
            <span class="text-textMuted/40 italic" title="反扫范围仅限当前已加载的部署列表">·仅在已加载列表内反扫</span>
          </template>
        </div>

        <!-- Tab Content -->
        <div class="flex-1 min-h-0 relative">
          <!-- Timeline view -->
          <div
            v-show="activeView === 'timeline'"
            class="absolute inset-0 overflow-y-auto p-4 bg-[#09090b]"
          >
            <DeploymentTimeline
              v-if="selectedLog"
              :events="timelineEvents"
              @jump="jumpToRawLine"
            />
            <div v-else class="h-full flex flex-col items-center justify-center text-textMuted font-sans">
              <AlertCircle class="w-12 h-12 mb-4 opacity-50" />
              <p>请选择左侧部署记录以查看时间线</p>
            </div>
          </div>

          <!-- Raw log view (kept mounted with v-show to preserve scroll) -->
          <div
            v-show="activeView === 'raw'"
            ref="rawLogContainer"
            class="absolute inset-0 p-4 overflow-y-auto bg-[#09090b] text-[#f4f4f5] leading-relaxed selection:bg-primary/30"
          >
            <div v-if="selectedLog" class="space-y-1 whitespace-pre-wrap break-all">
              <template v-for="(row, index) in displayLineRows" :key="index">
                <div
                  class="flex dark:hover:bg-white/5 hover:bg-black/5 px-2 -mx-2 rounded transition-colors group"
                  :class="highlightedLineIndex === index ? 'bg-primary/20 ring-1 ring-primary/40' : ''"
                  :data-line-index="index"
                >
                  <span class="w-8 text-right mr-4 text-textMuted/30 select-none group-hover:text-textMuted/50 transition-colors">{{ Number(index) + 1 }}</span>
                  <span
                    v-if="row.time"
                    class="text-textMuted/40 select-none mr-3 shrink-0 font-mono"
                  >{{ row.time }}</span>
                  <span v-html="row.html"></span>
                </div>
              </template>
              <div v-if="selectedLog.status === 'running'" class="flex px-2 -mx-2 mt-2">
                <span class="w-8 text-right mr-4 text-textMuted/30 select-none">{{ displayLines.length + 1 }}</span>
                <span class="w-2 h-4 bg-textMain animate-pulse inline-block align-middle"></span>
              </div>
            </div>
            <div v-else class="h-full flex flex-col items-center justify-center text-textMuted font-sans">
              <AlertCircle class="w-12 h-12 mb-4 opacity-50" />
              <p>请选择左侧部署记录以查看详细终端输出</p>
            </div>
          </div>
        </div>
      </div>

    </div>

    <ConfirmDialog
      v-model:open="showRollbackConfirm"
      tone="warning"
      title="确认回滚到此版本？"
      :message="`将以归档 ${shortId(selectedLog?.id)} 重新部署到项目 ${selectedLog?.projectName}。会按当前项目的 cleanMode / protectPaths 执行清理后再解压，运行时数据按保护规则保留。`"
      confirm-text="确认回滚"
      cancel-text="取消"
      :loading="isRollingBack"
      @confirm="confirmRollback"
    />

    <ConfirmDialog
      v-model:open="showMarkConfirm"
      :tone="markDialogTone"
      :title="markDialogTitle"
      :message="markDialogMessage"
      :confirm-text="pendingMarkStatus === 'failed' ? '确认标记失败' : '确认标记成功'"
      cancel-text="取消"
      :loading="isMarking"
      @confirm="confirmMark"
    />
  </div>
</template>

<style scoped>
/* Scrollbar specific for terminal */
.overflow-y-auto::-webkit-scrollbar {
  width: 10px;
}
.overflow-y-auto::-webkit-scrollbar-track {
  background: #09090b;
}
.overflow-y-auto::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 5px;
  border: 2px solid #09090b;
}
.overflow-y-auto::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
}
</style>
