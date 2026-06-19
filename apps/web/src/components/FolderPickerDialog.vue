<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, FolderOpen, ChevronRight, ArrowUp, Home, RefreshCw, X, Check, AlertTriangle, Eye, EyeOff } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import { useToast } from '../composables/useToast'

type Mode = 'single' | 'multi'

const props = withDefaults(defineProps<{
  open: boolean
  mode?: Mode
  title?: string
}>(), {
  mode: 'multi',
  title: '选择文件夹',
})

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'confirm', paths: string[]): void
}>()

const projectStore = useProjectStore()
const toast = useToast()

const loading = ref(false)
const errorMsg = ref('')
const truncated = ref(false)
const currentPath = ref('')
const parentPath = ref<string | null>(null)
const entries = ref<Array<{ name: string; path: string; isDir: boolean; isHidden: boolean; isSymlink: boolean }>>([])
const sep = ref('/')
const home = ref('')
const roots = ref<string[]>(['/'])

const showHidden = ref(false)
const pathInput = ref('')
const selected = ref<string[]>([])

const filteredEntries = computed(() => {
  if (showHidden.value) return entries.value
  return entries.value.filter((e) => !e.isHidden)
})

const breadcrumbs = computed(() => {
  if (!currentPath.value) return [] as Array<{ label: string; path: string }>
  const isWin = sep.value === '\\'
  const list: Array<{ label: string; path: string }> = []
  if (isWin) {
    const parts = currentPath.value.split(/\\+/).filter(Boolean)
    let acc = ''
    parts.forEach((part, idx) => {
      if (idx === 0) {
        acc = part.endsWith(':') ? `${part}\\` : part
        list.push({ label: acc, path: acc })
      } else {
        acc = acc.endsWith('\\') ? `${acc}${part}` : `${acc}\\${part}`
        list.push({ label: part, path: acc })
      }
    })
  } else {
    const parts = currentPath.value.split('/').filter(Boolean)
    list.push({ label: '/', path: '/' })
    let acc = ''
    parts.forEach((part) => {
      acc = `${acc}/${part}`
      list.push({ label: part, path: acc })
    })
  }
  return list
})

function isSelected(p: string) {
  return selected.value.includes(p)
}

function toggleSelect(p: string) {
  if (props.mode === 'single') {
    selected.value = isSelected(p) ? [] : [p]
    return
  }
  const idx = selected.value.indexOf(p)
  if (idx >= 0) selected.value.splice(idx, 1)
  else selected.value.push(p)
}

function removeSelected(p: string) {
  const idx = selected.value.indexOf(p)
  if (idx >= 0) selected.value.splice(idx, 1)
}

async function loadDir(p: string) {
  loading.value = true
  errorMsg.value = ''
  try {
    const data = await projectStore.fetchFsList(p)
    currentPath.value = data.path
    parentPath.value = data.parent
    entries.value = data.entries
    truncated.value = data.truncated
    pathInput.value = data.path
  } catch (e: any) {
    const msg = e?.message || '读取目录失败'
    errorMsg.value = msg
    entries.value = []
    truncated.value = false
  } finally {
    loading.value = false
  }
}

async function initialize() {
  loading.value = true
  errorMsg.value = ''
  try {
    const info = await projectStore.fetchFsHome()
    home.value = info.home
    sep.value = info.sep
    roots.value = info.roots || ['/']
    await loadDir(info.home || info.cwd || (info.roots && info.roots[0]) || '/')
  } catch (e: any) {
    errorMsg.value = e?.message || '初始化目录浏览器失败'
  } finally {
    loading.value = false
  }
}

function goParent() {
  if (parentPath.value) loadDir(parentPath.value)
}

function goHome() {
  if (home.value) loadDir(home.value)
}

function gotoInput() {
  const p = pathInput.value.trim()
  if (!p) return
  loadDir(p)
}

function onEntryClick(e: { path: string; isDir: boolean }) {
  if (e.isDir) loadDir(e.path)
}

function selectCurrent() {
  if (!currentPath.value) return
  if (!isSelected(currentPath.value)) {
    toggleSelect(currentPath.value)
  }
}

function onCancel() {
  emit('update:open', false)
}

function onConfirm() {
  if (selected.value.length === 0) {
    toast.error('请至少选择一个目录')
    return
  }
  emit('confirm', [...selected.value])
  emit('update:open', false)
}

watch(() => props.open, (v) => {
  if (v) {
    selected.value = []
    errorMsg.value = ''
    initialize()
  }
})
</script>

<template>
  <transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="onCancel"
    >
      <div
        class="bg-panel border border-border rounded-xl w-full max-w-3xl shadow-2xl flex flex-col"
        style="max-height: 80vh;"
        @keydown.esc="onCancel"
      >
        <!-- Header -->
        <div class="flex items-center justify-between px-5 py-4 border-b border-border">
          <div class="flex items-center space-x-2">
            <FolderOpen class="w-5 h-5 text-primary" />
            <h3 class="text-base font-semibold text-textMain">{{ title }}</h3>
            <span v-if="mode === 'multi'" class="text-xs text-textMuted ml-2">支持多选</span>
          </div>
          <button @click="onCancel" class="text-textMuted hover:text-textMain rounded p-1">
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Toolbar -->
        <div class="px-5 py-3 border-b border-border space-y-2">
          <div class="flex items-center space-x-2">
            <button
              @click="goParent"
              :disabled="!parentPath || loading"
              class="p-2 rounded-md border border-border text-textMuted hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed"
              title="上一级"
            >
              <ArrowUp class="w-4 h-4" />
            </button>
            <button
              @click="goHome"
              :disabled="!home || loading"
              class="p-2 rounded-md border border-border text-textMuted hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed"
              title="回到 HOME"
            >
              <Home class="w-4 h-4" />
            </button>
            <input
              v-model="pathInput"
              type="text"
              spellcheck="false"
              class="flex-1 bg-base border border-border rounded-md px-3 py-1.5 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
              placeholder="粘贴绝对路径并回车跳转"
              @keydown.enter.prevent="gotoInput"
            />
            <button
              @click="gotoInput"
              :disabled="loading"
              class="px-3 py-1.5 text-sm border border-border rounded-md text-textMuted hover:text-textMain disabled:opacity-40"
            >跳转</button>
          </div>

          <!-- Breadcrumb -->
          <div class="flex items-center flex-wrap text-xs text-textMuted">
            <template v-for="(crumb, i) in breadcrumbs" :key="crumb.path">
              <button
                @click="loadDir(crumb.path)"
                class="px-1.5 py-0.5 rounded hover:bg-white/5 hover:text-textMain font-mono"
              >{{ crumb.label }}</button>
              <ChevronRight v-if="i < breadcrumbs.length - 1" class="w-3 h-3 mx-0.5 opacity-60" />
            </template>
          </div>
        </div>

        <!-- Entry list -->
        <div class="flex-1 overflow-auto px-2 py-2 min-h-[280px]">
          <div v-if="loading" class="flex items-center justify-center h-full text-textMuted text-sm">
            <RefreshCw class="w-4 h-4 mr-2 animate-spin" /> 加载中…
          </div>
          <div v-else-if="errorMsg" class="flex items-start justify-center h-full">
            <div class="flex items-start space-x-2 text-danger text-sm max-w-md p-4">
              <AlertTriangle class="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span class="break-all">{{ errorMsg }}</span>
            </div>
          </div>
          <div v-else-if="filteredEntries.length === 0" class="flex items-center justify-center h-full text-textMuted text-sm">
            空目录
          </div>
          <ul v-else class="space-y-0.5">
            <li
              v-for="e in filteredEntries"
              :key="e.path"
              class="group flex items-center px-3 py-2 rounded-md hover:bg-white/5 cursor-pointer"
              :class="{ 'opacity-60': e.isHidden }"
              @dblclick="onEntryClick(e)"
            >
              <input
                :type="mode === 'single' ? 'radio' : 'checkbox'"
                :checked="isSelected(e.path)"
                @click.stop="toggleSelect(e.path)"
                class="mr-3 accent-primary"
              />
              <Folder class="w-4 h-4 text-primary/80 mr-2 flex-shrink-0" />
              <span
                class="flex-1 text-sm text-textMain truncate font-mono"
                @click="onEntryClick(e)"
              >{{ e.name }}</span>
              <span v-if="e.isSymlink" class="text-[10px] text-textMuted mr-2">link</span>
              <ChevronRight
                class="w-4 h-4 text-textMuted opacity-0 group-hover:opacity-100"
                @click.stop="onEntryClick(e)"
              />
            </li>
          </ul>
          <p v-if="truncated" class="text-xs text-yellow-400 text-center mt-2">
            目录条目过多，已截断展示前 500 项，请通过路径输入精确跳转。
          </p>
        </div>

        <!-- Selected chips -->
        <div v-if="selected.length > 0" class="px-5 py-2 border-t border-border max-h-28 overflow-auto">
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="p in selected"
              :key="p"
              class="inline-flex items-center max-w-full bg-primary/10 border border-primary/30 text-primary text-xs font-mono rounded px-2 py-1"
            >
              <span class="truncate" :title="p">{{ p }}</span>
              <button @click="removeSelected(p)" class="ml-1.5 hover:text-textMain">
                <X class="w-3 h-3" />
              </button>
            </span>
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between px-5 py-3 border-t border-border">
          <div class="flex items-center space-x-3 text-xs text-textMuted">
            <button
              @click="showHidden = !showHidden"
              class="flex items-center hover:text-textMain"
            >
              <component :is="showHidden ? Eye : EyeOff" class="w-3.5 h-3.5 mr-1" />
              {{ showHidden ? '隐藏点开头目录' : '显示点开头目录' }}
            </button>
            <button
              @click="selectCurrent"
              :disabled="!currentPath || loading"
              class="flex items-center hover:text-textMain disabled:opacity-40 disabled:cursor-not-allowed"
              title="把当前所在目录加入选中"
            >
              <Check class="w-3.5 h-3.5 mr-1" />
              选中当前目录
            </button>
            <span>已选 {{ selected.length }} 项</span>
          </div>
          <div class="flex items-center space-x-2">
            <button
              @click="onCancel"
              class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
            >取消</button>
            <button
              @click="onConfirm"
              :disabled="selected.length === 0"
              class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >确认（{{ selected.length }}）</button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
