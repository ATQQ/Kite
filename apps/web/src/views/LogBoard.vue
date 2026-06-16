<script setup lang="ts">
import { ref, onMounted, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectStore } from '../store/project'
import { ansiToHtml } from '../utils/ansi'
import { useDeployStream } from '../composables/useDeployStream'
import { Terminal, CheckCircle2, XCircle, Clock, RefreshCw, AlertCircle } from 'lucide-vue-next'

const projectStore = useProjectStore()
const route = useRoute()

const logs = computed(() => projectStore.logs)

const selectedLog = ref<any>(null)
const isRunning = computed(() => selectedLog.value?.status === 'running')

const listItemRefs = ref<Record<string, HTMLElement | null>>({})
const setItemRef = (id: string) => (el: any) => {
  listItemRefs.value[id] = el as HTMLElement | null
}

async function selectById(id: string | null) {
  if (!id) return
  const matched = logs.value.find(l => l.id === id)
  if (!matched) return
  selectedLog.value = matched
  await nextTick()
  const el = listItemRefs.value[id]
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest' })
  }
}

onMounted(async () => {
  await projectStore.fetchLogs()
  const id = typeof route.query.id === 'string' ? route.query.id : null
  await selectById(id)
})

watch(() => route.query.id, async (id) => {
  if (typeof id === 'string') await selectById(id)
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

const selectLog = (log: any) => {
  selectedLog.value = log
}

const refreshLogs = async () => {
  await projectStore.fetchLogs()
  if (selectedLog.value) {
    selectedLog.value = logs.value.find(l => l.id === selectedLog.value.id) || null
  }
}

function renderLine(line: string): string {
  return ansiToHtml(line)
}
</script>

<template>
  <div class="h-full flex flex-col space-y-6 max-w-7xl mx-auto">
    <div class="flex justify-between items-center shrink-0">
      <div>
        <h1 class="text-2xl font-bold text-textMain tracking-tight">部署日志</h1>
        <p class="text-textMuted text-sm mt-1">实时查看所有项目的自动化部署过程及终端输出</p>
      </div>
      <button @click="refreshLogs" class="flex items-center px-4 py-2 bg-panel dark:hover:bg-white/5 hover:bg-black/5 border border-border text-textMain rounded-md transition-colors text-sm font-medium shadow-sm">
        <RefreshCw class="w-4 h-4 mr-2" />
        刷新
      </button>
    </div>

    <!-- Layout: Left List, Right Terminal -->
    <div class="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">

      <!-- Log List -->
      <div class="w-full lg:w-1/3 bg-panel border border-border rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px] lg:h-auto">
        <div class="p-4 border-b border-border bg-base/50 shrink-0">
          <input
            type="text"
            placeholder="搜索项目或记录 ID..."
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-sm text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
          />
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
              <div class="flex justify-between items-center mb-1">
                <span class="font-medium text-textMain text-sm truncate">{{ log.projectName }}</span>
                <span class="text-xs text-textMuted font-mono shrink-0">{{ new Date(log.startTime).toLocaleString() }}</span>
              </div>
              <div class="flex items-center text-xs text-textMuted space-x-3">
                <span class="flex items-center">
                  <Terminal class="w-3 h-3 mr-1" />
                  {{ log.triggerSource }}
                </span>
                <span class="flex items-center">
                  <Clock class="w-3 h-3 mr-1" />
                  {{ log.duration }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Terminal View -->
      <div class="flex-1 bg-[#09090b] border border-border rounded-xl shadow-sm flex flex-col overflow-hidden h-[500px] lg:h-auto font-mono text-sm">
        <!-- Terminal Header -->
        <div class="h-10 bg-panel border-b border-border flex items-center px-4 shrink-0">
          <div class="flex space-x-2 mr-4">
            <div class="w-3 h-3 rounded-full bg-danger/80"></div>
            <div class="w-3 h-3 rounded-full bg-yellow-500/80"></div>
            <div class="w-3 h-3 rounded-full bg-success/80"></div>
          </div>
          <div class="flex-1 text-center text-textMuted text-xs font-sans truncate">
            <template v-if="selectedLog">bash - {{ selectedLog.projectName }} ({{ selectedLog.id }})</template>
            <template v-else>等待选择...</template>
          </div>
        </div>

        <!-- Terminal Content -->
        <div class="flex-1 p-4 overflow-y-auto bg-[#09090b] text-[#f4f4f5] leading-relaxed selection:bg-primary/30">
          <div v-if="selectedLog" class="space-y-1 whitespace-pre-wrap break-all">
            <template v-for="(line, index) in displayLines" :key="index">
              <div class="flex dark:hover:bg-white/5 hover:bg-black/5 px-2 -mx-2 rounded transition-colors group">
                <span class="w-8 text-right mr-4 text-textMuted/30 select-none group-hover:text-textMuted/50 transition-colors">{{ Number(index) + 1 }}</span>
                <span v-html="renderLine(line)"></span>
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
