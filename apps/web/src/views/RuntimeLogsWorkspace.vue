<script setup lang="ts">
import { computed, onMounted, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, X, LayoutGrid, Pencil, Check } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import RuntimeLogPane from '../components/RuntimeLogPane.vue'

const { t } = useI18n()
const store = useProjectStore()

type RuntimePane = {
  id: string
  projectId: string
  sourceIds: string[]
  activeSourceId: string
}

type RuntimeLayoutTab = {
  id: string
  name: string
  panes: RuntimePane[]
}

type RuntimeLogsState = {
  version: 1
  tabs: RuntimeLayoutTab[]
  activeTabId: string
}

const STORAGE_KEY = 'kite.runtimeLogs.workspace.v1'
const MAX_PANES = 4

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function createPane(projectId = ''): RuntimePane {
  return { id: uid(), projectId, sourceIds: [], activeSourceId: '' }
}

function createTab(name = '', pane?: RuntimePane): RuntimeLayoutTab {
  return {
    id: uid(),
    name: name || `布局 ${Math.floor(Math.random() * 90 + 10)}`,
    panes: [pane || createPane()],
  }
}

function defaultState(): RuntimeLogsState {
  const first = createTab('布局 1')
  return { version: 1, tabs: [first], activeTabId: first.id }
}

function loadState(): RuntimeLogsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as RuntimeLogsState
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return defaultState()
    }
    const tabs = parsed.tabs.map((t) => {
      const panes = (Array.isArray(t.panes) ? t.panes : [])
        .slice(0, MAX_PANES)
        .map((p): RuntimePane => ({
          id: typeof p.id === 'string' && p.id ? p.id : uid(),
          projectId: typeof p.projectId === 'string' ? p.projectId : '',
          sourceIds: Array.isArray(p.sourceIds) ? p.sourceIds.filter((x) => typeof x === 'string') : [],
          activeSourceId: typeof p.activeSourceId === 'string' ? p.activeSourceId : '',
        }))
      return {
        id: typeof t.id === 'string' && t.id ? t.id : uid(),
        name: typeof t.name === 'string' && t.name ? t.name : '布局',
        panes: panes.length > 0 ? panes : [createPane()],
      }
    })
    const activeTabId = tabs.some((t) => t.id === parsed.activeTabId) ? parsed.activeTabId : tabs[0].id
    return { version: 1, tabs, activeTabId }
  } catch {
    return defaultState()
  }
}

const state = ref<RuntimeLogsState>(loadState())

const activeTab = computed(() => state.value.tabs.find((t) => t.id === state.value.activeTabId) || state.value.tabs[0])

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.value))
  } catch { /* ignore */ }
}

watch(state, persist, { deep: true })

onMounted(() => {
  if (store.projects.length === 0) {
    store.fetchProjects().catch(() => { /* ignore */ })
  }
})

// ---------------- Tab operations ----------------
function newTab() {
  const tab = createTab(`布局 ${state.value.tabs.length + 1}`)
  state.value.tabs.push(tab)
  state.value.activeTabId = tab.id
}

function activateTab(id: string) {
  if (state.value.activeTabId === id) return
  state.value.activeTabId = id
}

function closeTab(id: string, evt?: Event) {
  if (evt) {
    evt.stopPropagation()
    evt.preventDefault()
  }
  const idx = state.value.tabs.findIndex((t) => t.id === id)
  if (idx < 0) return
  state.value.tabs.splice(idx, 1)
  if (state.value.tabs.length === 0) {
    const t = createTab('布局 1')
    state.value.tabs.push(t)
    state.value.activeTabId = t.id
    return
  }
  if (state.value.activeTabId === id) {
    state.value.activeTabId = (state.value.tabs[idx] || state.value.tabs[idx - 1] || state.value.tabs[0]).id
  }
}

const renamingId = ref('')
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

async function startRename(tab: RuntimeLayoutTab) {
  renamingId.value = tab.id
  renameValue.value = tab.name
  await nextTick()
  renameInputRef.value?.focus()
  renameInputRef.value?.select()
}

function commitRename() {
  const id = renamingId.value
  const value = renameValue.value.trim()
  renamingId.value = ''
  renameValue.value = ''
  if (!id) return
  const tab = state.value.tabs.find((t) => t.id === id)
  if (!tab) return
  tab.name = value || tab.name
}

function cancelRename() {
  renamingId.value = ''
  renameValue.value = ''
}

// ---------------- Pane operations ----------------
function addPane() {
  const tab = activeTab.value
  if (!tab) return
  if (tab.panes.length >= MAX_PANES) return
  const last = tab.panes[tab.panes.length - 1]
  tab.panes.push(createPane(last?.projectId || ''))
}

function removePane(paneId: string) {
  const tab = activeTab.value
  if (!tab) return
  const idx = tab.panes.findIndex((p) => p.id === paneId)
  if (idx < 0) return
  if (tab.panes.length === 1) {
    tab.panes.splice(0, 1, createPane())
    return
  }
  tab.panes.splice(idx, 1)
}

function updatePane(paneId: string, patch: Partial<RuntimePane>) {
  const tab = activeTab.value
  if (!tab) return
  const p = tab.panes.find((x) => x.id === paneId)
  if (!p) return
  Object.assign(p, patch)
}

// ---------------- Layout grid class ----------------
const canvasGridClass = computed(() => {
  const n = activeTab.value?.panes.length || 1
  if (n <= 1) return 'grid-cols-1'
  if (n === 2) return 'grid-cols-1 lg:grid-cols-2'
  if (n === 3) return 'grid-cols-1 lg:grid-cols-3'
  return 'grid-cols-1 lg:grid-cols-2 lg:grid-rows-2'
})

// Tab title suffix hints (project name preview, up to 2)
function tabPreview(tab: RuntimeLayoutTab): string {
  const names = tab.panes
    .map((p) => store.projects.find((x) => x.id === p.projectId)?.name)
    .filter((x): x is string => !!x)
  if (names.length === 0) return ''
  if (names.length <= 2) return names.join(' · ')
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`
}
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- Page header -->
    <div class="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 shrink-0 mb-4">
      <div>
        <h1 class="text-2xl font-bold text-textMain tracking-tight">{{ t('nav.runtimeLogs') }}</h1>
        <p class="text-textMuted text-sm mt-1">跨项目并行观察运行日志（PM2 / 自定义文件）；每个布局 Tab 保存一份跨项目分屏组合</p>
      </div>
    </div>

    <!-- Layout Tabs bar -->
    <div class="flex items-center gap-1 border-b border-border shrink-0 overflow-x-auto pb-0">
      <div
        v-for="tab in state.tabs"
        :key="tab.id"
        class="group flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 cursor-pointer transition-colors shrink-0 max-w-[280px]"
        :class="state.activeTabId === tab.id
          ? 'border-primary text-primary'
          : 'border-transparent text-textMuted hover:text-textMain'"
        @click="activateTab(tab.id)"
        @dblclick="startRename(tab)"
      >
        <LayoutGrid class="w-3.5 h-3.5 shrink-0" />
        <template v-if="renamingId === tab.id">
          <input
            ref="renameInputRef"
            v-model="renameValue"
            class="bg-base border border-border rounded px-1.5 py-0.5 text-xs text-textMain focus:outline-none focus:border-primary/60 w-32"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="cancelRename"
            @blur="commitRename"
          />
          <button
            type="button"
            class="text-success hover:text-success/80 p-0.5"
            title="保存"
            @click.stop="commitRename"
          >
            <Check class="w-3.5 h-3.5" />
          </button>
        </template>
        <template v-else>
          <span class="truncate font-medium">{{ tab.name }}</span>
          <span v-if="tabPreview(tab)" class="text-[10px] text-textMuted/70 truncate">· {{ tabPreview(tab) }}</span>
          <span class="text-[10px] text-textMuted/60 font-mono">×{{ tab.panes.length }}</span>
          <span
            class="text-textMuted/40 hover:text-textMain p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            role="button"
            tabindex="0"
            title="重命名"
            @click.stop="startRename(tab)"
          >
            <Pencil class="w-3 h-3" />
          </span>
          <span
            class="text-textMuted/40 hover:text-danger p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            role="button"
            tabindex="0"
            title="关闭布局"
            @click.stop="closeTab(tab.id, $event)"
          >
            <X class="w-3.5 h-3.5" />
          </span>
        </template>
      </div>
      <button
        type="button"
        class="flex items-center gap-1 px-3 py-2 text-xs text-textMuted hover:text-textMain border-b-2 border-transparent shrink-0"
        title="新建布局"
        @click="newTab"
      >
        <Plus class="w-3.5 h-3.5" />
        <span>新建布局</span>
      </button>
    </div>

    <!-- Toolbar for active layout -->
    <div class="flex items-center gap-2 py-2 shrink-0">
      <button
        type="button"
        class="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-base border border-border rounded-md text-textMain hover:border-primary/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="(activeTab?.panes.length || 0) >= MAX_PANES"
        :title="(activeTab?.panes.length || 0) >= MAX_PANES ? `同屏最多 ${MAX_PANES} 个槽位` : '为当前布局追加一个槽位'"
        @click="addPane"
      >
        <Plus class="w-3.5 h-3.5" />
        <span>加槽位 ({{ activeTab?.panes.length || 0 }}/{{ MAX_PANES }})</span>
      </button>
      <span class="text-[11px] text-textMuted/70">槽位可来自不同项目 · 同屏最多 {{ MAX_PANES }} 个，每个槽位可挂多个日志源子 Tab</span>
    </div>

    <!-- Layouts canvas: render only active tab's panes (unmount others via v-if to save SSE) -->
    <div class="flex-1 min-h-0">
      <template v-for="tab in state.tabs" :key="tab.id">
        <div
          v-if="tab.id === state.activeTabId"
          class="h-full grid gap-3"
          :class="canvasGridClass"
          style="min-height: 480px;"
        >
          <RuntimeLogPane
            v-for="pane in tab.panes"
            :key="pane.id"
            :project-id="pane.projectId"
            :source-ids="pane.sourceIds"
            :active-source-id="pane.activeSourceId"
            :show-close="tab.panes.length > 1 || !!pane.projectId"
            @update:project-id="updatePane(pane.id, { projectId: $event })"
            @update:source-ids="updatePane(pane.id, { sourceIds: $event })"
            @update:active-source-id="updatePane(pane.id, { activeSourceId: $event })"
            @close="removePane(pane.id)"
          />
        </div>
      </template>
    </div>
  </div>
</template>
