<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { X, Plus, RefreshCw, AlertTriangle, ChevronDown } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import LogPane from './LogPane.vue'

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

const props = defineProps<{
  projectId: string
  sourceIds: string[]
  activeSourceId: string
  showClose?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:projectId', v: string): void
  (e: 'update:sourceIds', v: string[]): void
  (e: 'update:activeSourceId', v: string): void
  (e: 'close'): void
}>()

const store = useProjectStore()

const sources = ref<LogSource[]>([])
const loading = ref(false)
const loadError = ref('')
const addMenuOpen = ref(false)
const projectMenuOpen = ref(false)

const project = computed(() => store.projects.find((p) => p.id === props.projectId) || null)

const projectMissing = computed(() => !!props.projectId && !project.value && store.projects.length > 0)

const activeSources = computed(() => {
  const map = new Map(sources.value.map((s) => [s.id, s]))
  return props.sourceIds.map((id) => map.get(id) || null)
})

const availableSources = computed(() => {
  const picked = new Set(props.sourceIds)
  return sources.value.filter((s) => !picked.has(s.id))
})

async function loadSources() {
  if (!props.projectId) {
    sources.value = []
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const data = await store.fetchLogSources(props.projectId)
    sources.value = data.items
  } catch (e: any) {
    loadError.value = e?.message || '加载日志源失败'
    sources.value = []
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  if (store.projects.length === 0) {
    store.fetchProjects().catch(() => { /* ignore */ })
  }
  loadSources()
})

watch(() => props.projectId, () => {
  loadSources()
})

function pickProject(id: string) {
  projectMenuOpen.value = false
  if (id === props.projectId) return
  emit('update:projectId', id)
  emit('update:sourceIds', [])
  emit('update:activeSourceId', '')
}

function addSource(sourceId: string) {
  addMenuOpen.value = false
  if (!sourceId) return
  if (props.sourceIds.includes(sourceId)) return
  const next = [...props.sourceIds, sourceId]
  emit('update:sourceIds', next)
  if (!props.activeSourceId) {
    emit('update:activeSourceId', sourceId)
  }
}

function activateTab(sourceId: string) {
  if (props.activeSourceId === sourceId) return
  emit('update:activeSourceId', sourceId)
}

function closeTab(sourceId: string, evt?: Event) {
  if (evt) {
    evt.stopPropagation()
    evt.preventDefault()
  }
  const idx = props.sourceIds.indexOf(sourceId)
  if (idx < 0) return
  const next = props.sourceIds.filter((id) => id !== sourceId)
  emit('update:sourceIds', next)
  if (props.activeSourceId === sourceId) {
    const fallback = next[idx] || next[idx - 1] || next[0] || ''
    emit('update:activeSourceId', fallback)
  }
}

// If activeSourceId points to a removed source (external delete), auto-fix.
watch([() => props.activeSourceId, sources, () => props.sourceIds], () => {
  const valid = new Set(sources.value.map((s) => s.id))
  const filteredIds = props.sourceIds.filter((id) => valid.has(id))
  if (filteredIds.length !== props.sourceIds.length) {
    emit('update:sourceIds', filteredIds)
  }
  if (props.activeSourceId && !valid.has(props.activeSourceId)) {
    emit('update:activeSourceId', filteredIds[0] || '')
  } else if (!props.activeSourceId && filteredIds.length > 0) {
    emit('update:activeSourceId', filteredIds[0])
  }
}, { flush: 'post' })

function closeMenusOnBlur(evt: FocusEvent) {
  const next = evt.relatedTarget as HTMLElement | null
  const container = (evt.currentTarget as HTMLElement)
  if (next && container.contains(next)) return
  addMenuOpen.value = false
  projectMenuOpen.value = false
}
</script>

<template>
  <div class="bg-panel border border-border rounded-xl flex flex-col min-h-0 overflow-hidden h-full">
    <!-- Toolbar: project selector + add source + close pane -->
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-base/40 shrink-0" @focusout="closeMenusOnBlur">
      <!-- Project dropdown -->
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-base border border-border rounded-md text-textMain hover:border-primary/50 transition-colors max-w-[220px]"
          @click="projectMenuOpen = !projectMenuOpen"
        >
          <span class="truncate">
            <template v-if="project">{{ project.name }}</template>
            <template v-else-if="projectMissing">项目已删除</template>
            <template v-else>选择项目...</template>
          </span>
          <ChevronDown class="w-3.5 h-3.5 shrink-0 text-textMuted" />
        </button>
        <div
          v-if="projectMenuOpen"
          class="absolute left-0 top-full mt-1 z-20 w-64 max-h-72 overflow-y-auto bg-panel border border-border rounded-md shadow-lg py-1"
        >
          <button
            v-for="p in store.projects"
            :key="p.id"
            type="button"
            class="w-full text-left px-3 py-1.5 text-xs text-textMain dark:hover:bg-white/5 hover:bg-black/5 truncate"
            :class="p.id === props.projectId ? 'text-primary' : ''"
            @click="pickProject(p.id)"
          >{{ p.name }}</button>
          <div v-if="store.projects.length === 0" class="px-3 py-2 text-xs text-textMuted">暂无项目</div>
        </div>
      </div>

      <!-- Add source dropdown -->
      <div class="relative">
        <button
          type="button"
          class="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-base border border-border rounded-md text-textMain hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!props.projectId || availableSources.length === 0"
          :title="availableSources.length === 0 ? '该项目下已无可添加的日志源' : '添加同项目的另一个日志源'"
          @click="addMenuOpen = !addMenuOpen"
        >
          <Plus class="w-3.5 h-3.5" />
          <span>日志源</span>
        </button>
        <div
          v-if="addMenuOpen && availableSources.length > 0"
          class="absolute left-0 top-full mt-1 z-20 w-72 max-h-72 overflow-y-auto bg-panel border border-border rounded-md shadow-lg py-1"
        >
          <button
            v-for="s in availableSources"
            :key="s.id"
            type="button"
            class="w-full text-left px-3 py-1.5 text-xs text-textMain dark:hover:bg-white/5 hover:bg-black/5"
            @click="addSource(s.id)"
          >
            <div class="truncate">{{ s.label }}</div>
            <div class="text-[10px] text-textMuted font-mono truncate">{{ s.filePath }}</div>
          </button>
        </div>
      </div>

      <button
        type="button"
        class="flex items-center px-2 py-1 text-xs text-textMuted hover:text-textMain rounded-md dark:hover:bg-white/5 hover:bg-black/5"
        title="刷新日志源列表"
        @click="loadSources"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
      </button>

      <div class="flex-1"></div>

      <button
        v-if="props.showClose"
        type="button"
        class="flex items-center p-1 text-textMuted hover:text-danger rounded-md dark:hover:bg-white/5 hover:bg-black/5"
        title="关闭该槽位"
        @click="emit('close')"
      >
        <X class="w-4 h-4" />
      </button>
    </div>

    <!-- Sub-tab bar for multiple sources within same project -->
    <div
      v-if="props.sourceIds.length > 0"
      class="flex items-center gap-1 px-2 border-b border-border bg-panel/60 overflow-x-auto shrink-0"
    >
      <button
        v-for="(src, idx) in activeSources"
        :key="props.sourceIds[idx]"
        type="button"
        class="flex items-center gap-1.5 px-2.5 py-1.5 text-xs border-b-2 transition-colors max-w-[220px] shrink-0"
        :class="props.activeSourceId === props.sourceIds[idx]
          ? 'border-primary text-primary'
          : 'border-transparent text-textMuted hover:text-textMain'"
        @click="activateTab(props.sourceIds[idx])"
      >
        <span class="truncate">
          <template v-if="src">{{ src.label }}</template>
          <template v-else>（已删除）</template>
        </span>
        <span
          class="text-textMuted/50 hover:text-danger p-0.5 rounded"
          role="button"
          tabindex="0"
          title="从槽位移除"
          @click="closeTab(props.sourceIds[idx], $event)"
          @keydown.enter="closeTab(props.sourceIds[idx], $event)"
        >
          <X class="w-3 h-3" />
        </span>
      </button>
    </div>

    <!-- Content area: mount all LogPanes and toggle with v-show to preserve SSE -->
    <div class="flex-1 min-h-0 relative">
      <template v-if="projectMissing">
        <div class="h-full flex flex-col items-center justify-center text-textMuted text-sm gap-2 p-6 text-center">
          <AlertTriangle class="w-8 h-8 text-yellow-500/70" />
          <p>该槽位绑定的项目已被删除</p>
          <button
            class="px-3 py-1 text-xs bg-base border border-border rounded-md text-textMain hover:border-primary/50"
            @click="emit('close')"
          >移除槽位</button>
        </div>
      </template>
      <template v-else-if="!props.projectId">
        <div class="h-full flex flex-col items-center justify-center text-textMuted text-sm gap-1 p-6 text-center">
          <p>请选择项目</p>
          <p class="text-xs text-textMuted/70">选择项目后可添加一个或多个日志源</p>
        </div>
      </template>
      <template v-else-if="loadError">
        <div class="h-full flex flex-col items-center justify-center text-textMuted text-sm gap-2 p-6 text-center">
          <AlertTriangle class="w-8 h-8 text-danger/70" />
          <p>{{ loadError }}</p>
          <button
            class="px-3 py-1 text-xs bg-base border border-border rounded-md text-textMain hover:border-primary/50"
            @click="loadSources"
          >重试</button>
        </div>
      </template>
      <template v-else-if="props.sourceIds.length === 0">
        <div class="h-full flex flex-col items-center justify-center text-textMuted text-sm gap-1 p-6 text-center">
          <p>请添加一个日志源</p>
          <p class="text-xs text-textMuted/70">点击上方「+ 日志源」按钮</p>
        </div>
      </template>
      <template v-else>
        <div
          v-for="(src, idx) in activeSources"
          :key="props.sourceIds[idx]"
          v-show="props.activeSourceId === props.sourceIds[idx]"
          class="absolute inset-0 flex flex-col min-h-0"
        >
          <LogPane
            v-if="src"
            :source-id="src.id"
            :label="src.label"
            :file-path="src.filePath"
            :show-header="true"
            :show-close="false"
          />
          <div v-else class="h-full flex flex-col items-center justify-center text-textMuted text-sm gap-2 p-6 text-center">
            <AlertTriangle class="w-8 h-8 text-yellow-500/70" />
            <p>该日志源已被删除</p>
            <button
              class="px-3 py-1 text-xs bg-base border border-border rounded-md text-textMain hover:border-primary/50"
              @click="closeTab(props.sourceIds[idx])"
            >从槽位移除</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
