<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  Command,
  FileText,
  FolderArchive,
  LayoutDashboard,
  Loader2,
  Rocket,
  ScrollText,
  Search as SearchIcon,
  Settings as SettingsIcon,
  TerminalSquare,
  X,
} from 'lucide-vue-next'
import { usePaletteStore } from '../store/palette'
import { useProjectStore } from '../store/project'

interface ProjectHit { type: 'project'; id: string; name: string; description: string | null; status: string | null; href: string }
interface DeploymentHit { type: 'deployment'; id: string; projectId: string; projectName: string; status: string; startTime: string; href: string; snippet: string | null }
interface AuditHit { type: 'audit'; id: string; action: string; targetName: string | null; createdAt: string; status: string; href: string }
interface LogSourceHit { type: 'logsource'; id: string; projectId: string; label: string; filePath: string; href: string }
interface CommandHit { type: 'command'; id: string; name: string; description: string | null; href: string }
type Hit = ProjectHit | DeploymentHit | AuditHit | LogSourceHit | CommandHit

interface Group {
  type: Hit['type']
  total: number
  items: Hit[]
}

const { t } = useI18n()
const router = useRouter()
const palette = usePaletteStore()
const projectStore = useProjectStore()

const query = ref('')
const groups = ref<Group[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let abortController: AbortController | null = null

const navigationCommands: CommandHit[] = [
  { type: 'command', id: 'cmd:dashboard', name: 'nav.dashboard',  description: null, href: '/' },
  { type: 'command', id: 'cmd:projects',  name: 'nav.projects',   description: null, href: '/projects' },
  { type: 'command', id: 'cmd:logs',      name: 'nav.deployLogs', description: null, href: '/logs' },
  { type: 'command', id: 'cmd:terminal',  name: 'nav.terminal',   description: null, href: '/terminal' },
  { type: 'command', id: 'cmd:audit',     name: 'nav.auditLog',   description: null, href: '/audit' },
  { type: 'command', id: 'cmd:storage',   name: 'nav.storage',    description: null, href: '/storage' },
  { type: 'command', id: 'cmd:migration', name: 'nav.migration',  description: null, href: '/migration' },
  { type: 'command', id: 'cmd:settings',  name: 'nav.settings',   description: null, href: '/settings' },
]

const flatHits = computed<Hit[]>(() => groups.value.flatMap(g => g.items))

const groupIconMap: Record<Hit['type'], any> = {
  project: FolderArchive,
  deployment: Rocket,
  audit: ScrollText,
  logsource: FileText,
  command: Command,
}

const commandIconMap: Record<string, any> = {
  'cmd:dashboard': LayoutDashboard,
  'cmd:projects': FolderArchive,
  'cmd:logs': TerminalSquare,
  'cmd:terminal': TerminalSquare,
  'cmd:audit': ScrollText,
  'cmd:storage': FileText,
  'cmd:migration': FileText,
  'cmd:settings': SettingsIcon,
}

const groupLabel = (type: Hit['type']) => {
  switch (type) {
    case 'project': return t('search.groupProject')
    case 'deployment': return t('search.groupDeployment')
    case 'audit': return t('search.groupAudit')
    case 'logsource': return t('search.groupLogSource')
    case 'command': return t('search.groupCommand')
  }
}

function highlight(text: string | null | undefined, q: string): Array<{ text: string; match: boolean }> {
  if (!text) return []
  if (!q) return [{ text, match: false }]
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: Array<{ text: string; match: boolean }> = []
  let cursor = 0
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor)
    if (idx === -1) {
      parts.push({ text: text.slice(cursor), match: false })
      break
    }
    if (idx > cursor) parts.push({ text: text.slice(cursor, idx), match: false })
    parts.push({ text: text.slice(idx, idx + needle.length), match: true })
    cursor = idx + needle.length
  }
  return parts
}

function buildCommandGroup(q: string): Group | null {
  if (!q) return null
  const needle = q.toLowerCase()
  const items = navigationCommands.filter(cmd => t(cmd.name).toLowerCase().includes(needle))
  if (items.length === 0) return null
  return { type: 'command', total: items.length, items }
}

async function fetchResults(q: string) {
  if (abortController) abortController.abort()
  abortController = new AbortController()
  loading.value = true
  error.value = null
  try {
    const token = projectStore.adminToken
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=5`, {
      headers,
      signal: abortController.signal,
    })
    if (res.status === 401) {
      palette.close()
      projectStore.logout()
      router.push('/login')
      return
    }
    if (!res.ok) {
      error.value = `HTTP ${res.status}`
      groups.value = []
      return
    }
    const data = await res.json()
    const remoteGroups: Group[] = Array.isArray(data?.groups)
      ? data.groups
          .map((g: any) => ({
            type: g.type as Hit['type'],
            total: Number(g.total) || 0,
            items: Array.isArray(g.items) ? (g.items as Hit[]) : [],
          }))
          .filter((g: Group) => g.items.length > 0)
      : []
    const cmd = buildCommandGroup(q)
    groups.value = cmd ? [cmd, ...remoteGroups] : remoteGroups
    activeIndex.value = 0
  } catch (e: any) {
    if (e?.name === 'AbortError') return
    error.value = e?.message || 'fetch failed'
    groups.value = []
  } finally {
    loading.value = false
  }
}

function scheduleFetch(q: string) {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!q.trim()) {
    groups.value = []
    loading.value = false
    return
  }
  debounceTimer = setTimeout(() => fetchResults(q.trim()), 200)
}

watch(query, (q) => {
  scheduleFetch(q)
})

function resetState() {
  query.value = ''
  groups.value = []
  activeIndex.value = 0
  error.value = null
  loading.value = false
  if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null }
  if (abortController) { abortController.abort(); abortController = null }
}

watch(() => palette.isOpen, (open) => {
  if (open) {
    nextTick(() => inputEl.value?.focus())
  } else {
    resetState()
  }
})

function selectHit(hit: Hit) {
  palette.pushRecent(query.value)
  palette.close()
  router.push(hit.href)
}

function moveActive(delta: number) {
  const total = flatHits.value.length
  if (total === 0) return
  activeIndex.value = (activeIndex.value + delta + total) % total
  nextTick(() => {
    const el = listEl.value?.querySelector<HTMLElement>(`[data-hit-index="${activeIndex.value}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-terminal-pane]')) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
    if (palette.isOpen) {
      e.preventDefault()
      palette.close()
      return
    }
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    palette.open()
    return
  }
  if (!palette.isOpen) return
  if (e.key === 'Escape') {
    e.preventDefault()
    palette.close()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveActive(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveActive(-1)
  } else if (e.key === 'Enter') {
    const hit = flatHits.value[activeIndex.value]
    if (hit) {
      e.preventDefault()
      selectHit(hit)
    }
  }
}

function onOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) palette.close()
}

function applyRecent(q: string) {
  query.value = q
}

function clearQuery() {
  query.value = ''
  inputEl.value?.focus()
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  if (debounceTimer) clearTimeout(debounceTimer)
  if (abortController) abortController.abort()
})

function indexFor(group: Group, itemIdx: number) {
  let acc = 0
  for (const g of groups.value) {
    if (g === group) return acc + itemIdx
    acc += g.items.length
  }
  return acc + itemIdx
}
</script>

<template>
  <transition name="palette-fade">
    <div
      v-if="palette.isOpen"
      class="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
      @click="onOverlayClick"
    >
      <div
        class="w-full max-w-2xl bg-panel border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        role="dialog"
        :aria-label="t('search.placeholder')"
      >
        <div class="flex items-center gap-2 px-4 h-12 border-b border-border">
          <SearchIcon class="w-4 h-4 text-textMuted shrink-0" />
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('search.placeholder')"
            class="flex-1 bg-transparent outline-none text-sm text-textMain placeholder-textMuted"
          />
          <button
            v-if="query"
            @click="clearQuery"
            :title="t('common.clear')"
            :aria-label="t('common.clear')"
            class="p-1 rounded text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 transition-colors"
          >
            <X class="w-3.5 h-3.5" />
          </button>
          <kbd class="hidden sm:inline-flex items-center gap-1 text-[10px] text-textMuted px-1.5 py-0.5 rounded border border-border bg-base">Esc</kbd>
        </div>

        <div ref="listEl" class="max-h-[60vh] overflow-y-auto">
          <!-- Loading -->
          <div v-if="loading" class="flex items-center gap-2 px-4 py-6 text-sm text-textMuted">
            <Loader2 class="w-4 h-4 animate-spin" />
            <span>{{ t('search.loading') }}</span>
          </div>

          <!-- Error -->
          <div v-else-if="error" class="px-4 py-6 text-sm text-danger">
            {{ t('search.error', { msg: error }) }}
          </div>

          <!-- Empty state with recent -->
          <div v-else-if="!query.trim()" class="py-4">
            <div v-if="palette.recent.length > 0">
              <div class="flex items-center justify-between px-4 py-1 text-[11px] uppercase tracking-wide text-textMuted">
                <span>{{ t('search.recent') }}</span>
                <button
                  @click="palette.clearRecent()"
                  class="text-textMuted hover:text-textMain transition-colors normal-case"
                >
                  {{ t('common.clear') }}
                </button>
              </div>
              <button
                v-for="(r, i) in palette.recent"
                :key="`recent-${i}`"
                @click="applyRecent(r)"
                class="w-full flex items-center gap-3 px-4 py-2 text-sm text-textMain hover:bg-primary/10 transition-colors text-left"
              >
                <SearchIcon class="w-3.5 h-3.5 text-textMuted" />
                <span>{{ r }}</span>
              </button>
            </div>
            <div v-else class="px-4 py-8 text-center text-sm text-textMuted">
              {{ t('search.hintEmpty') }}
            </div>
          </div>

          <!-- No results -->
          <div v-else-if="groups.length === 0" class="px-4 py-8 text-center text-sm text-textMuted">
            {{ t('search.noResults') }}
          </div>

          <!-- Result groups -->
          <template v-else>
            <div v-for="group in groups" :key="group.type" class="py-1">
              <div class="flex items-center gap-1.5 px-4 py-1 text-[11px] uppercase tracking-wide text-textMuted">
                <component :is="groupIconMap[group.type]" class="w-3 h-3" />
                <span>{{ groupLabel(group.type) }}</span>
              </div>
              <button
                v-for="(item, idx) in group.items"
                :key="item.id"
                :data-hit-index="indexFor(group, idx)"
                @mouseenter="activeIndex = indexFor(group, idx)"
                @click="selectHit(item)"
                class="w-full flex items-start gap-3 px-4 py-2 text-sm text-left transition-colors"
                :class="indexFor(group, idx) === activeIndex
                  ? 'bg-primary/10 text-textMain'
                  : 'text-textMain hover:bg-base/60'"
              >
                <component
                  :is="item.type === 'command' ? (commandIconMap[item.id] || Command) : groupIconMap[item.type]"
                  class="w-4 h-4 mt-0.5 shrink-0"
                  :class="indexFor(group, idx) === activeIndex ? 'text-primary' : 'text-textMuted'"
                />
                <div class="min-w-0 flex-1">
                  <!-- project -->
                  <template v-if="item.type === 'project'">
                    <div class="truncate">
                      <span v-for="(p, pi) in highlight(item.name, query)" :key="`pn-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                    </div>
                    <div v-if="item.description" class="text-xs text-textMuted truncate">
                      <span v-for="(p, pi) in highlight(item.description, query)" :key="`pd-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                    </div>
                  </template>
                  <!-- deployment -->
                  <template v-else-if="item.type === 'deployment'">
                    <div class="truncate">
                      <span class="text-textMuted">[{{ item.status }}]</span>
                      <span class="ml-1">
                        <span v-for="(p, pi) in highlight(item.projectName, query)" :key="`dn-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                      </span>
                      <span class="ml-2 text-xs text-textMuted">{{ item.startTime.slice(0, 19).replace('T', ' ') }}</span>
                    </div>
                    <div v-if="item.snippet" class="text-xs text-textMuted font-mono truncate">
                      <span v-for="(p, pi) in highlight(item.snippet, query)" :key="`ds-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                    </div>
                  </template>
                  <!-- audit -->
                  <template v-else-if="item.type === 'audit'">
                    <div class="truncate">
                      <span v-for="(p, pi) in highlight(item.action, query)" :key="`aa-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                      <span v-if="item.targetName" class="text-textMuted"> · </span>
                      <span v-if="item.targetName">
                        <span v-for="(p, pi) in highlight(item.targetName, query)" :key="`at-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                      </span>
                    </div>
                    <div class="text-xs text-textMuted">{{ item.createdAt.slice(0, 19).replace('T', ' ') }} · {{ item.status }}</div>
                  </template>
                  <!-- logsource -->
                  <template v-else-if="item.type === 'logsource'">
                    <div class="truncate">
                      <span v-for="(p, pi) in highlight(item.label, query)" :key="`ll-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                    </div>
                    <div class="text-xs text-textMuted font-mono truncate">
                      <span v-for="(p, pi) in highlight(item.filePath, query)" :key="`lf-${pi}`" :class="p.match ? 'bg-primary/20 text-primary px-0.5 rounded' : ''">{{ p.text }}</span>
                    </div>
                  </template>
                  <!-- command -->
                  <template v-else-if="item.type === 'command'">
                    <div class="truncate">{{ t(item.name) }}</div>
                    <div class="text-xs text-textMuted truncate">{{ item.href }}</div>
                  </template>
                </div>
              </button>
            </div>
          </template>
        </div>

        <div class="flex items-center justify-between gap-3 px-4 h-9 border-t border-border text-[11px] text-textMuted bg-base/40">
          <div class="flex items-center gap-3">
            <span class="flex items-center gap-1">
              <kbd class="px-1 py-0.5 rounded border border-border bg-panel">↑</kbd>
              <kbd class="px-1 py-0.5 rounded border border-border bg-panel">↓</kbd>
              {{ t('search.kbdNavigate') }}
            </span>
            <span class="flex items-center gap-1">
              <kbd class="px-1 py-0.5 rounded border border-border bg-panel">Enter</kbd>
              {{ t('search.kbdSelect') }}
            </span>
          </div>
          <span class="hidden sm:flex items-center gap-1">
            <kbd class="px-1 py-0.5 rounded border border-border bg-panel">Esc</kbd>
            {{ t('common.close') }}
          </span>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.palette-fade-enter-active,
.palette-fade-leave-active {
  transition: opacity 0.15s ease;
}
.palette-fade-enter-from,
.palette-fade-leave-to {
  opacity: 0;
}
</style>
