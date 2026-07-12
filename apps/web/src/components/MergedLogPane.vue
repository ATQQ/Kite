<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { Activity, AlertTriangle, Loader2, Pause, Play, RefreshCw, Trash2, X } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import { apiUrl } from '../lib/base'

type MergedSource = {
  id: string
  label: string
  filePath: string
  pmId?: number
  instanceId?: number
}

type MergedLine = {
  seq: number
  sourceId: string
  tag: string
  text: string
}

const props = withDefaults(defineProps<{
  kind: 'stdout' | 'stderr'
  sources: MergedSource[]
  tailLines?: number
}>(), {
  tailLines: 20,
})

const emit = defineEmits<{
  (e: 'close'): void
}>()

const store = useProjectStore()

const lines = ref<MergedLine[]>([])
const follow = ref(true)
const scrollRef = ref<HTMLDivElement | null>(null)
const tailLines = ref<number>(props.tailLines)
const errorsByTag = ref<Record<string, string>>({})
const activeCount = ref(0)
const snapshotReceived = ref<Set<string>>(new Set())
let seqCounter = 0
let isProgrammaticScroll = false
let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null

const kindLabel = computed(() => props.kind === 'stdout' ? 'stdout' : 'stderr')
const kindColorCls = computed(() => props.kind === 'stdout' ? 'text-success' : 'text-danger')

const allSnapshotsReceived = computed(() => {
  if (props.sources.length === 0) return true
  return props.sources.every((s) => snapshotReceived.value.has(s.id))
})

const controllers = new Map<string, AbortController>()

function tagFor(src: MergedSource): string {
  if (typeof src.instanceId === 'number' && Number.isFinite(src.instanceId)) return `#${src.instanceId}`
  if (typeof src.pmId === 'number' && Number.isFinite(src.pmId)) return `#${src.pmId}`
  return src.label
}

function paletteFor(src: MergedSource): string {
  const id = (typeof src.instanceId === 'number' ? src.instanceId : (typeof src.pmId === 'number' ? src.pmId : 0)) | 0
  const palette = [
    'text-blue-400',
    'text-emerald-400',
    'text-amber-400',
    'text-fuchsia-400',
    'text-cyan-400',
    'text-orange-400',
    'text-lime-400',
    'text-rose-400',
  ]
  return palette[Math.abs(id) % palette.length]
}

const tagColorBySourceId = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  for (const s of props.sources) map[s.id] = paletteFor(s)
  return map
})

function pushLines(src: MergedSource, incoming: string[], asSnapshot = false) {
  const tag = tagFor(src)
  const arr: MergedLine[] = []
  for (const t of incoming) {
    arr.push({ seq: seqCounter++, sourceId: src.id, tag, text: t })
  }
  if (asSnapshot) {
    lines.value = lines.value.filter((l) => l.sourceId !== src.id).concat(arr)
  } else {
    lines.value.push(...arr)
  }
  if (lines.value.length > 8000) {
    lines.value.splice(0, lines.value.length - 8000)
  }
  if (follow.value) scrollBottom()
}

function scrollBottom() {
  nextTick(() => {
    const el = scrollRef.value
    if (!el) return
    isProgrammaticScroll = true
    el.scrollTop = el.scrollHeight
    if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer)
    programmaticScrollTimer = setTimeout(() => {
      isProgrammaticScroll = false
      programmaticScrollTimer = null
    }, 120)
  })
}

function onScroll() {
  if (isProgrammaticScroll) return
  const el = scrollRef.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  if (!nearBottom && follow.value) follow.value = false
}

function onUserInteract() {
  if (isProgrammaticScroll) return
  const el = scrollRef.value
  if (!el) return
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32
  if (!nearBottom) follow.value = false
}

function toggleFollow() {
  follow.value = !follow.value
  if (follow.value) scrollBottom()
}

function disconnectAll() {
  for (const c of controllers.values()) {
    try { c.abort() } catch { /* ignore */ }
  }
  controllers.clear()
  activeCount.value = 0
}

async function subscribe(src: MergedSource) {
  const controller = new AbortController()
  controllers.set(src.id, controller)
  activeCount.value = controllers.size
  try {
    const res = await fetch(apiUrl(`/log-sources/${src.id}/stream?tailLines=${tailLines.value}`), {
      headers: { Authorization: `Bearer ${store.adminToken}` },
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      errorsByTag.value = { ...errorsByTag.value, [tagFor(src)]: `HTTP ${res.status}` }
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n\n')
      buffer = parts.pop()!

      for (const part of parts) {
        if (!part.trim() || part.startsWith(':')) continue
        let eventType = 'message'
        let eventData = ''
        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) eventType = line.slice(7)
          else if (line.startsWith('data: ')) eventData += (eventData ? '\n' : '') + line.slice(6)
        }
        if (!eventData) continue
        try {
          const data = JSON.parse(eventData)
          if (eventType === 'snapshot') {
            pushLines(src, Array.isArray(data?.lines) ? data.lines : [], true)
            if (!snapshotReceived.value.has(src.id)) {
              const next = new Set(snapshotReceived.value)
              next.add(src.id)
              snapshotReceived.value = next
            }
          } else if (eventType === 'lines') {
            pushLines(src, Array.isArray(data?.lines) ? data.lines : [], false)
          } else if (eventType === 'rotated') {
            pushLines(src, [`--- ${src.label} log rotated ---`], false)
          } else if (eventType === 'error') {
            const msg = data?.message || 'stream error'
            errorsByTag.value = { ...errorsByTag.value, [tagFor(src)]: msg }
          }
        } catch {
          /* swallow parse errors */
        }
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') {
      errorsByTag.value = { ...errorsByTag.value, [tagFor(src)]: e?.message || 'connect failed' }
    }
  } finally {
    controllers.delete(src.id)
    activeCount.value = controllers.size
  }
}

function connectAll() {
  disconnectAll()
  lines.value = []
  errorsByTag.value = {}
  snapshotReceived.value = new Set()
  seqCounter = 0
  for (const src of props.sources) {
    subscribe(src)
  }
}

watch(() => props.sources.map((s) => s.id).join('|'), () => {
  connectAll()
}, { immediate: true })

watch(tailLines, () => {
  connectAll()
})

onUnmounted(() => {
  disconnectAll()
  if (programmaticScrollTimer) {
    clearTimeout(programmaticScrollTimer)
    programmaticScrollTimer = null
  }
})

function reconnect() {
  connectAll()
}

function clearBuffer() {
  lines.value = []
}
</script>

<template>
  <div class="flex flex-col min-h-0 h-full bg-panel border border-border rounded-lg overflow-hidden">
    <!-- Header -->
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between px-3 sm:px-4 py-2 sm:py-3 border-b border-border">
      <div class="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
        <span class="w-2 h-2 rounded-full shrink-0" :class="kind === 'stdout' ? 'bg-success' : 'bg-danger'"></span>
        <div class="text-sm text-textMain font-medium">
          合并视图 · <span :class="kindColorCls">{{ kindLabel }}</span>
        </div>
        <span class="text-[11px] text-textMuted">
          {{ sources.length }} 个来源
        </span>
        <span :class="activeCount > 0 ? 'text-success' : 'text-textMuted'" class="text-[11px]">
          {{ activeCount > 0 ? `● ${activeCount} 路实时` : '○ 未连接' }}
        </span>
      </div>
      <div class="flex items-center gap-1 flex-wrap sm:flex-nowrap sm:ml-3">
        <label class="flex items-center text-[11px] text-textMuted mr-1">
          <span class="mr-1">尾部行数</span>
          <select
            v-model.number="tailLines"
            class="bg-base border border-border rounded px-2 py-0.5 text-textMain focus:outline-none focus:border-primary"
          >
            <option :value="10">10</option>
            <option :value="20">20</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
            <option :value="200">200</option>
            <option :value="500">500</option>
          </select>
        </label>
        <button
          @click="toggleFollow"
          class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded text-xs"
          :class="{ 'text-primary border-primary/40': follow }"
        >
          <component :is="follow ? Pause : Play" class="w-3 h-3 mr-1" />
          {{ follow ? '跟随中' : '已暂停' }}
        </button>
        <button
          @click="reconnect"
          class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded text-xs"
          title="重连所有 SSE 流"
        >
          <RefreshCw class="w-3 h-3 mr-1" /> 重连
        </button>
        <button
          @click="clearBuffer"
          class="inline-flex items-center px-2 py-1 border border-border text-textMuted hover:text-textMain rounded text-xs"
          title="清空当前缓冲区"
        >
          <Trash2 class="w-3 h-3 mr-1" /> 清空
        </button>
        <button
          @click="emit('close')"
          class="p-1 ml-auto sm:ml-1 rounded text-textMuted hover:text-danger hover:bg-white/5"
          title="关闭合并视图"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Source tags legend -->
    <div class="px-3 sm:px-4 py-2 border-b border-border/60 bg-base/40 flex flex-wrap items-center gap-2 text-[11px]">
      <span class="text-textMuted flex items-center shrink-0">
        <Activity class="w-3 h-3 mr-1" />
        来源标签：
      </span>
      <span
        v-for="src in sources"
        :key="src.id"
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-base font-mono max-w-full"
        :title="src.filePath"
      >
        <span class="font-semibold shrink-0" :class="paletteFor(src)">{{ tagFor(src) }}</span>
        <span class="text-textMuted truncate max-w-[10em] sm:max-w-[16em]">{{ src.label }}</span>
      </span>
    </div>

    <!-- Errors -->
    <div
      v-if="Object.keys(errorsByTag).length > 0"
      class="px-3 sm:px-4 py-2 text-xs text-danger bg-danger/5 border-b border-danger/20 space-y-0.5"
    >
      <div
        v-for="(msg, tag) in errorsByTag"
        :key="tag"
        class="flex items-center"
      >
        <AlertTriangle class="w-3.5 h-3.5 mr-1 shrink-0" />
        <span class="font-mono mr-2 shrink-0">{{ tag }}</span>
        <span class="truncate">{{ msg }}</span>
      </div>
    </div>

    <!-- Lines -->
    <div
      ref="scrollRef"
      @scroll.passive="onScroll"
      @wheel.passive="onUserInteract"
      @touchstart.passive="onUserInteract"
      class="flex-1 min-h-0 overflow-auto bg-base p-2 sm:p-3 font-mono text-[11px] sm:text-xs leading-relaxed"
    >
      <div v-if="lines.length === 0" class="text-textMuted text-center py-12">
        <Loader2 v-if="activeCount > 0 && !allSnapshotsReceived" class="w-4 h-4 mx-auto animate-spin" />
        <span v-else>暂无日志数据</span>
      </div>
      <div
        v-for="l in lines"
        :key="l.seq"
        class="whitespace-pre-wrap break-words text-textMain/90 flex items-start gap-2"
      >
        <span
          class="shrink-0 font-semibold select-none"
          :class="tagColorBySourceId[l.sourceId] || 'text-textMuted'"
        >[{{ l.tag }}]</span>
        <span class="min-w-0 flex-1 break-all">{{ l.text }}</span>
      </div>
    </div>
  </div>
</template>
