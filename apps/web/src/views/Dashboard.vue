<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { Activity, Server, Clock, AlertCircle, AlertTriangle, Cpu, MemoryStick, HardDrive } from 'lucide-vue-next'
import { APP_VERSION } from '../constants'
import DeployHeatmap from '../components/DeployHeatmap.vue'
import SuccessRateChart from '../components/SuccessRateChart.vue'
import { useIntervalRaf } from '../composables/useIntervalRaf'

const { t } = useI18n()
const projectStore = useProjectStore()
const router = useRouter()

interface HeatmapCell { date: string; count: number }
interface RatePoint { date: string; success: number; failed: number; total: number; rate: number | null }
interface FailureItem { projectId: string; projectName: string; failed: number; total: number; rate: number }

const heatmapCells = ref<HeatmapCell[]>([])
const ratePoints = ref<RatePoint[]>([])
const failureItems = ref<FailureItem[]>([])
const statsLoading = ref(true)

onMounted(async () => {
  projectStore.fetchProjects()
  projectStore.fetchLogs()
  try {
    const [hm, sr, ft] = await Promise.all([
      projectStore.fetchHeatmap(30),
      projectStore.fetchSuccessRate(14),
      projectStore.fetchFailureTop(5, 30),
    ])
    heatmapCells.value = hm?.cells ?? []
    ratePoints.value = sr?.points ?? []
    failureItems.value = ft?.items ?? []
  } finally {
    statsLoading.value = false
  }
})

// 服务器资源 5s 轮询（rAF 节流，切到后台自动暂停）
useIntervalRaf(async () => { await projectStore.fetchSystemResources() }, 5000)

const sysRes = computed(() => projectStore.systemResources)

function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[u]}`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${n.toFixed(n < 10 ? 1 : 0)}%`
}

function fmtUptime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '-'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function barColor(pct: number | null | undefined): string {
  if (pct == null) return 'bg-textMuted/40'
  if (pct >= 90) return 'bg-danger'
  if (pct >= 70) return 'bg-yellow-500'
  return 'bg-primary'
}

const recentLogs = computed(() => projectStore.logs.slice(0, 5))

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

function elapsedMs(log: { startTime: string; endTime?: string }): number | null {
  if (!log.endTime || !log.startTime) return null
  const ms = new Date(log.endTime).getTime() - new Date(log.startTime).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

const avgDurationText = computed(() => {
  const finished = projectStore.logs.filter(l => l.status !== 'running')
  const samples = finished.map(elapsedMs).filter((n): n is number => n !== null)
  if (samples.length === 0) return '-'
  const totalMs = samples.reduce((sum, n) => sum + n, 0)
  return formatDuration(Math.round(totalMs / samples.length))
})

const stats = computed(() => [
  { label: t('dashboard.statTotalProjects'), value: projectStore.projects.length, icon: Server, color: 'text-primary' },
  { label: t('dashboard.statSuccess'), value: projectStore.logs.filter(l => l.status === 'success').length, icon: Activity, color: 'text-success' },
  { label: t('dashboard.statFailed'), value: projectStore.logs.filter(l => l.status === 'failed').length, icon: AlertCircle, color: 'text-danger' },
  { label: t('dashboard.statAvgDuration'), value: avgDurationText.value, icon: Clock, color: 'text-blue-400' },
])

function goToLog(id: string) {
  router.push({ name: 'LogBoard', query: { id } })
}

function goToProject(id: string) {
  router.push({ name: 'ProjectDetail', params: { id } })
}

function pctText(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}
</script>

<template>
  <div class="space-y-6 max-w-7xl mx-auto">
    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-8">
      <h1 class="text-2xl font-bold text-textMain tracking-tight">{{ t('dashboard.pageTitle') }}</h1>
      <div class="text-sm text-textMuted bg-panel px-3 py-1 rounded-full border border-border self-start sm:self-auto">
        {{ t('dashboard.currentVersion', { version: APP_VERSION }) }}
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="bg-panel border border-border rounded-xl p-4 sm:p-6 flex items-center shadow-sm hover:border-primary/50 transition-colors"
      >
        <div :class="['w-10 h-10 sm:w-12 sm:h-12 rounded-lg bg-base flex items-center justify-center border border-border shrink-0', stat.color]">
          <component :is="stat.icon" class="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
        <div class="ml-3 sm:ml-4 min-w-0">
          <p class="text-xs sm:text-sm font-medium text-textMuted truncate">{{ stat.label }}</p>
          <p class="text-2xl sm:text-3xl font-bold text-textMain mt-1 font-mono">{{ stat.value }}</p>
        </div>
      </div>
    </div>

    <!-- Server Resources -->
    <div class="bg-panel border border-border rounded-xl p-4 sm:p-6 shadow-sm">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div>
          <h3 class="text-base font-semibold text-textMain flex items-center gap-2">
            <Server class="w-4 h-4 text-primary" />
            {{ t('dashboard.serverResources') }}
          </h3>
          <p class="text-xs text-textMuted mt-1">
            {{ t('dashboard.serverResourcesHint') }}
            <span v-if="sysRes" class="ml-2 font-mono">
              {{ sysRes.host.hostname }} · {{ sysRes.host.platform }}/{{ sysRes.host.arch }} · {{ t('dashboard.serverResourcesCores', { count: sysRes.host.cpuCount }) }}
            </span>
          </p>
        </div>
        <div v-if="sysRes" class="text-xs text-textMuted font-mono">
          {{ t('dashboard.collectedAt', { time: new Date(sysRes.collectedAt).toLocaleTimeString() }) }}
        </div>
      </div>
      <div v-if="!sysRes" class="text-sm text-textMuted py-6 text-center">{{ t('dashboard.loading') }}</div>
      <div v-else class="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <!-- 整机 CPU -->
        <div class="bg-base border border-border rounded-lg p-3">
          <div class="flex items-center justify-between text-xs text-textMuted">
            <span class="flex items-center gap-1.5"><Cpu class="w-3.5 h-3.5" />{{ t('dashboard.cpuTotal') }}</span>
            <span class="font-mono text-textMain">{{ fmtPct(sysRes.cpu.percent) }}</span>
          </div>
          <div class="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="barColor(sysRes.cpu.percent)" :style="{ width: `${Math.min(100, sysRes.cpu.percent ?? 0)}%` }"></div>
          </div>
          <p class="mt-2 text-[11px] text-textMuted font-mono">{{ t('dashboard.load', { value: sysRes.host.loadAvg.map(n => n.toFixed(2)).join(' / ') }) }}</p>
        </div>
        <!-- 整机内存 -->
        <div class="bg-base border border-border rounded-lg p-3">
          <div class="flex items-center justify-between text-xs text-textMuted">
            <span class="flex items-center gap-1.5"><MemoryStick class="w-3.5 h-3.5" />{{ t('dashboard.memoryTotal') }}</span>
            <span class="font-mono text-textMain">{{ fmtPct(sysRes.memory.percentUsed) }}</span>
          </div>
          <div class="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="barColor(sysRes.memory.percentUsed)" :style="{ width: `${sysRes.memory.percentUsed}%` }"></div>
          </div>
          <p class="mt-2 text-[11px] text-textMuted font-mono">{{ t('dashboard.memUsage', { used: fmtBytes(sysRes.memory.usedBytes), avail: fmtBytes(sysRes.memory.availableBytes), total: fmtBytes(sysRes.memory.totalBytes) }) }}</p>
        </div>
        <!-- 整机磁盘 -->
        <div class="bg-base border border-border rounded-lg p-3">
          <div class="flex items-center justify-between text-xs text-textMuted">
            <span class="flex items-center gap-1.5"><HardDrive class="w-3.5 h-3.5" />{{ t('dashboard.diskTotal') }}</span>
            <span class="font-mono text-textMain">{{ fmtPct(sysRes.disk.percentUsed) }}</span>
          </div>
          <div class="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="barColor(sysRes.disk.percentUsed)" :style="{ width: `${sysRes.disk.percentUsed ?? 0}%` }"></div>
          </div>
          <p class="mt-2 text-[11px] text-textMuted font-mono">{{ t('dashboard.diskUsage', { free: fmtBytes(sysRes.disk.freeBytes), total: fmtBytes(sysRes.disk.totalBytes) }) }}</p>
        </div>
        <!-- Kite 进程 CPU -->
        <div class="bg-base border border-border rounded-lg p-3">
          <div class="flex items-center justify-between text-xs text-textMuted">
            <span class="flex items-center gap-1.5"><Cpu class="w-3.5 h-3.5" />{{ t('dashboard.cpuProcess') }}</span>
            <span class="font-mono text-textMain">{{ fmtPct(sysRes.process.cpuPercent) }}</span>
          </div>
          <div class="mt-2 h-1.5 bg-border rounded-full overflow-hidden">
            <div class="h-full rounded-full transition-all" :class="barColor(sysRes.process.cpuPercent)" :style="{ width: `${Math.min(100, sysRes.process.cpuPercent ?? 0)}%` }"></div>
          </div>
          <p class="mt-2 text-[11px] text-textMuted font-mono">{{ t('dashboard.processInfo', { pid: sysRes.process.pid, runtime: sysRes.process.runtime, version: sysRes.process.runtimeVersion }) }}</p>
        </div>
        <!-- Kite 进程内存 -->
        <div class="bg-base border border-border rounded-lg p-3">
          <div class="flex items-center justify-between text-xs text-textMuted">
            <span class="flex items-center gap-1.5"><MemoryStick class="w-3.5 h-3.5" />{{ t('dashboard.memoryProcess') }}</span>
            <span class="font-mono text-textMain">{{ fmtBytes(sysRes.process.memoryRssBytes) }}</span>
          </div>
          <p class="mt-2 text-[11px] text-textMuted font-mono">{{ t('dashboard.heap', { value: fmtBytes(sysRes.process.memoryHeapUsedBytes) }) }}</p>
        </div>
        <!-- 运行时长 -->
        <div class="bg-base border border-border rounded-lg p-3">
          <div class="flex items-center justify-between text-xs text-textMuted">
            <span class="flex items-center gap-1.5"><Clock class="w-3.5 h-3.5" />{{ t('dashboard.uptime') }}</span>
          </div>
          <p class="mt-2 text-sm font-mono text-textMain">{{ t('dashboard.procUptime', { value: fmtUptime(sysRes.process.uptimeSec) }) }}</p>
          <p class="mt-1 text-[11px] text-textMuted font-mono">{{ t('dashboard.hostUptime', { value: fmtUptime(sysRes.host.uptimeSec) }) }}</p>
        </div>
      </div>
    </div>

    <!-- Heatmap -->
    <DeployHeatmap :cells="heatmapCells" :loading="statsLoading" />

    <!-- Success rate + Failure TopN -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2">
        <SuccessRateChart :points="ratePoints" :loading="statsLoading" />
      </div>
      <div class="bg-panel border border-border rounded-xl p-4 sm:p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-base font-semibold text-textMain flex items-center gap-2">
              <AlertTriangle class="w-4 h-4 text-danger" />
              {{ t('dashboard.failureTopN') }}
            </h3>
            <p class="text-xs text-textMuted mt-1">{{ t('dashboard.failureTopNHint') }}</p>
          </div>
        </div>
        <div v-if="statsLoading" class="text-sm text-textMuted py-6 text-center">{{ t('dashboard.loading') }}</div>
        <ul v-else-if="failureItems.length" class="space-y-2">
          <li
            v-for="item in failureItems"
            :key="item.projectId"
            @click="goToProject(item.projectId)"
            class="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-base hover:border-primary/40 cursor-pointer transition-colors"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-textMain truncate">{{ item.projectName }}</p>
              <p class="text-xs text-textMuted font-mono mt-0.5">{{ t('dashboard.failureSubtext', { failed: item.failed, total: item.total }) }}</p>
            </div>
            <span
              class="font-mono text-sm shrink-0 ml-3"
              :class="item.rate >= 0.5 ? 'text-danger' : item.rate >= 0.2 ? 'text-yellow-400' : 'text-textMuted'"
            >{{ pctText(item.rate) }}</span>
          </li>
        </ul>
        <div v-else class="text-sm text-textMuted py-6 text-center">{{ t('dashboard.failureEmpty') }}</div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold text-textMain mb-4">{{ t('dashboard.recentDeployActivity') }}</h2>
      <div class="bg-panel border border-border rounded-xl overflow-hidden shadow-sm">
        <ul class="divide-y divide-border">
          <li v-if="recentLogs.length === 0" class="px-6 py-8 text-center text-textMuted">{{ t('dashboard.noActivity') }}</li>
          <li v-for="log in recentLogs" :key="log.id" @click="goToLog(log.id)" class="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 dark:hover:bg-white/5 hover:bg-black/5 transition-colors cursor-pointer">
            <div class="flex items-center space-x-4 min-w-0">
              <div class="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] shrink-0" :class="log.status === 'success' ? 'bg-success text-success' : log.status === 'failed' ? 'bg-danger text-danger' : 'bg-primary text-primary'"></div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-textMain truncate">{{ t('dashboard.deployStatusLabel', { label: log.status === 'success' ? t('dashboard.deployDone') : log.status === 'failed' ? t('dashboard.deployFailedShort') : t('dashboard.deployRunning') }) }}<span class="font-mono text-primary ml-1">{{ log.projectName }}</span></p>
                <p class="text-xs text-textMuted mt-1 truncate">{{ t('dashboard.triggerSource', { source: log.triggerSource }) }}</p>
              </div>
            </div>
            <div class="text-left sm:text-right pl-6 sm:pl-0 shrink-0">
              <p class="text-xs sm:text-sm text-textMuted font-mono">{{ new Date(log.startTime).toLocaleString() }}</p>
              <p class="text-xs mt-1" :class="log.status === 'success' ? 'text-success' : log.status === 'failed' ? 'text-danger' : 'text-primary'">{{ formatDuration(elapsedMs(log) ?? NaN) }}</p>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>