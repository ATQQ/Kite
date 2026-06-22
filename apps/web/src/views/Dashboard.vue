<script setup lang="ts">
import { onMounted, computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { Activity, Server, Clock, AlertCircle, AlertTriangle } from 'lucide-vue-next'
import { APP_VERSION } from '../constants'
import DeployHeatmap from '../components/DeployHeatmap.vue'
import SuccessRateChart from '../components/SuccessRateChart.vue'

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
  { label: '总计项目数', value: projectStore.projects.length, icon: Server, color: 'text-primary' },
  { label: '成功部署', value: projectStore.logs.filter(l => l.status === 'success').length, icon: Activity, color: 'text-success' },
  { label: '失败任务', value: projectStore.logs.filter(l => l.status === 'failed').length, icon: AlertCircle, color: 'text-danger' },
  { label: '平均耗时', value: avgDurationText.value, icon: Clock, color: 'text-blue-400' },
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
      <h1 class="text-2xl font-bold text-textMain tracking-tight">Kite 概览</h1>
      <div class="text-sm text-textMuted bg-panel px-3 py-1 rounded-full border border-border self-start sm:self-auto">
        当前版本：v{{ APP_VERSION }}
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
              失败率 TopN
            </h3>
            <p class="text-xs text-textMuted mt-1">近 30 天 · 至少 3 次部署</p>
          </div>
        </div>
        <div v-if="statsLoading" class="text-sm text-textMuted py-6 text-center">加载中…</div>
        <ul v-else-if="failureItems.length" class="space-y-2">
          <li
            v-for="item in failureItems"
            :key="item.projectId"
            @click="goToProject(item.projectId)"
            class="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-base hover:border-primary/40 cursor-pointer transition-colors"
          >
            <div class="min-w-0">
              <p class="text-sm font-medium text-textMain truncate">{{ item.projectName }}</p>
              <p class="text-xs text-textMuted font-mono mt-0.5">{{ item.failed }} / {{ item.total }} 失败</p>
            </div>
            <span
              class="font-mono text-sm shrink-0 ml-3"
              :class="item.rate >= 0.5 ? 'text-danger' : item.rate >= 0.2 ? 'text-yellow-400' : 'text-textMuted'"
            >{{ pctText(item.rate) }}</span>
          </li>
        </ul>
        <div v-else class="text-sm text-textMuted py-6 text-center">暂无符合条件的项目</div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold text-textMain mb-4">最近部署活动</h2>
      <div class="bg-panel border border-border rounded-xl overflow-hidden shadow-sm">
        <ul class="divide-y divide-border">
          <li v-if="recentLogs.length === 0" class="px-6 py-8 text-center text-textMuted">暂无部署活动</li>
          <li v-for="log in recentLogs" :key="log.id" @click="goToLog(log.id)" class="px-4 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 dark:hover:bg-white/5 hover:bg-black/5 transition-colors cursor-pointer">
            <div class="flex items-center space-x-4 min-w-0">
              <div class="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor] shrink-0" :class="log.status === 'success' ? 'bg-success text-success' : log.status === 'failed' ? 'bg-danger text-danger' : 'bg-primary text-primary'"></div>
              <div class="min-w-0">
                <p class="text-sm font-medium text-textMain truncate">部署{{ log.status === 'success' ? '完成' : log.status === 'failed' ? '失败' : '中' }}: <span class="font-mono text-primary ml-1">{{ log.projectName }}</span></p>
                <p class="text-xs text-textMuted mt-1 truncate">触发源: {{ log.triggerSource }}</p>
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