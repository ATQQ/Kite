<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useProjectStore } from '../store/project'
import { Activity, Server, Clock, AlertCircle } from 'lucide-vue-next'
import { APP_VERSION } from '../constants'

const projectStore = useProjectStore()

onMounted(() => {
  projectStore.fetchProjects()
  projectStore.fetchLogs()
})

const recentLogs = computed(() => projectStore.logs.slice(0, 5))

const stats = computed(() => [
  { label: '总计项目数', value: projectStore.projects.length, icon: Server, color: 'text-primary' },
  { label: '成功部署', value: projectStore.logs.filter(l => l.status === 'success').length, icon: Activity, color: 'text-success' },
  { label: '失败任务', value: projectStore.logs.filter(l => l.status === 'failed').length, icon: AlertCircle, color: 'text-danger' },
  { label: '平均耗时', value: '-', icon: Clock, color: 'text-blue-400' },
])
</script>

<template>
  <div class="space-y-6 max-w-7xl mx-auto">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-2xl font-bold text-textMain tracking-tight">Kite 概览</h1>
      <div class="text-sm text-textMuted bg-panel px-3 py-1 rounded-full border border-border">
        当前版本：v{{ APP_VERSION }}
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="bg-panel border border-border rounded-xl p-6 flex items-center shadow-sm hover:border-primary/50 transition-colors"
      >
        <div :class="['w-12 h-12 rounded-lg bg-base flex items-center justify-center border border-border', stat.color]">
          <component :is="stat.icon" class="w-6 h-6" />
        </div>
        <div class="ml-4">
          <p class="text-sm font-medium text-textMuted">{{ stat.label }}</p>
          <p class="text-3xl font-bold text-textMain mt-1 font-mono">{{ stat.value }}</p>
        </div>
      </div>
    </div>

    <!-- Recent Activity -->
    <div class="mt-8">
      <h2 class="text-lg font-semibold text-textMain mb-4">最近部署活动</h2>
      <div class="bg-panel border border-border rounded-xl overflow-hidden shadow-sm">
        <ul class="divide-y divide-border">
          <li v-if="recentLogs.length === 0" class="px-6 py-8 text-center text-textMuted">暂无部署活动</li>
          <li v-for="log in recentLogs" :key="log.id" class="px-6 py-4 flex items-center justify-between dark:hover:bg-white/5 hover:bg-black/5 transition-colors cursor-pointer">
            <div class="flex items-center space-x-4">
              <div class="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]" :class="log.status === 'success' ? 'bg-success text-success' : log.status === 'failed' ? 'bg-danger text-danger' : 'bg-primary text-primary'"></div>
              <div>
                <p class="text-sm font-medium text-textMain">部署{{ log.status === 'success' ? '完成' : log.status === 'failed' ? '失败' : '中' }}: <span class="font-mono text-primary ml-1">{{ log.projectName }}</span></p>
                <p class="text-xs text-textMuted mt-1">触发源: {{ log.triggerSource }}</p>
              </div>
            </div>
            <div class="text-right">
              <p class="text-sm text-textMuted font-mono">{{ new Date(log.startTime).toLocaleTimeString() }}</p>
              <p class="text-xs mt-1" :class="log.status === 'success' ? 'text-success' : 'text-danger'">{{ log.duration || '-' }}</p>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>