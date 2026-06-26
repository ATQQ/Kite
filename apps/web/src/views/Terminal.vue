<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, nextTick, watch, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { Plus, X, RefreshCw, AlertTriangle, Terminal as TerminalIcon } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import { useTerminalSocket } from '../composables/useTerminalSocket'
import { storeToRefs } from 'pinia'

interface TerminalTab {
  id: string
  title: string
  cwdHint: string
  projectId: string | null
  pid: number | null
  status: 'connecting' | 'open' | 'closed' | 'error'
  errorMsg: string | null
  closedCode: number | null
}

interface TerminalRuntime {
  xterm: XTerm
  fit: FitAddon
  socket: ReturnType<typeof useTerminalSocket>
}

const projectStore = useProjectStore()
const { adminToken } = storeToRefs(projectStore)
const route = useRoute()

const tabs = ref<TerminalTab[]>([])
const runtimes = new Map<string, TerminalRuntime>()
const activeTabId = ref<string | null>(null)
const terminalInfo = ref<any>(null)
const loadingInfo = ref(true)
const limitWarning = ref<string | null>(null)

const terminalContainerRef = ref<HTMLDivElement | null>(null)
const containers = ref<Record<string, HTMLDivElement | null>>({})

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

function makeXTerm() {
  const term = new XTerm({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    theme: {
      background: '#09090B',
      foreground: '#E4E4E7',
      cursor: '#22D3EE',
      selectionBackground: '#3F3F46',
    },
    convertEol: false,
    scrollback: 5000,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  return { term, fit }
}

function defaultCwdHint(projectId: string | null) {
  if (projectId) {
    const proj = projectStore.projects.find(p => p.id === projectId)
    return proj ? (proj.deployPath || proj.name) : projectId
  }
  return terminalInfo.value?.defaultCwd || '~'
}

async function createTab(opts?: { projectId?: string | null; title?: string }) {
  if (!terminalInfo.value?.available) return
  const limits = terminalInfo.value?.limits
  if (limits && tabs.value.length >= (limits.maxTotalSessions || 16)) {
    limitWarning.value = `已达到当前实例最大会话数 ${limits.maxTotalSessions}`
    return
  }
  const projectId = opts?.projectId ?? null
  const id = genId()
  const { term, fit } = makeXTerm()
  const cwdHint = defaultCwdHint(projectId)

  const socket = useTerminalSocket({
    token: adminToken,
    onData: (chunk) => term.write(chunk),
    onReady: (info) => {
      const tab = tabs.value.find(t => t.id === id)
      if (tab) {
        tab.pid = info.pid
        tab.status = 'open'
      }
    },
    onExit: (info) => {
      const tab = tabs.value.find(t => t.id === id)
      if (tab) {
        tab.status = 'closed'
        tab.closedCode = typeof info.exitCode === 'number' ? info.exitCode : null
        term.writeln('')
        term.writeln(`\x1b[90m[会话已结束 exitCode=${info.exitCode ?? 'n/a'}]\x1b[0m`)
      }
    },
    onError: (info) => {
      const tab = tabs.value.find(t => t.id === id)
      if (tab) {
        tab.status = 'error'
        tab.errorMsg = info.message || info.reason || '未知错误'
        term.writeln('')
        term.writeln(`\x1b[31m[错误] ${tab.errorMsg}\x1b[0m`)
      }
    },
    onStatus: (s) => {
      const tab = tabs.value.find(t => t.id === id)
      if (!tab) return
      if (s === 'connecting' || s === 'open' || s === 'closed' || s === 'error') {
        tab.status = s as any
      }
    },
  })

  term.onData((data) => socket.sendInput(data))
  term.onResize(({ cols, rows }) => socket.sendResize(cols, rows))

  runtimes.set(id, { xterm: term, fit, socket })

  const tab: TerminalTab = {
    id,
    title: opts?.title || (projectId ? `项目:${cwdHint}` : `终端 ${tabs.value.length + 1}`),
    cwdHint,
    projectId,
    pid: null,
    status: 'connecting',
    errorMsg: null,
    closedCode: null,
  }
  tabs.value.push(tab)
  activeTabId.value = id

  await nextTick()
  const host = containers.value[id]
  if (host) {
    term.open(host)
    try { fit.fit() } catch {}
    const dims = { cols: term.cols, rows: term.rows }
    socket.connect({ projectId: tab.projectId, cwd: undefined, cols: dims.cols, rows: dims.rows })
    term.focus()
  }
}

function closeTab(id: string) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  const rt = runtimes.get(id)
  try { rt?.socket.disconnect() } catch {}
  try { rt?.xterm.dispose() } catch {}
  runtimes.delete(id)
  tabs.value.splice(idx, 1)
  if (activeTabId.value === id) {
    activeTabId.value = tabs.value[Math.max(0, idx - 1)]?.id || null
    nextTick(() => fitActive())
  }
}

function fitActive() {
  const id = activeTabId.value
  if (!id) return
  const rt = runtimes.get(id)
  try { rt?.fit.fit() } catch {}
}

function setActive(id: string) {
  activeTabId.value = id
  nextTick(() => {
    fitActive()
    runtimes.get(id)?.xterm.focus()
  })
}

function reconnectTab(id: string) {
  const tab = tabs.value.find(t => t.id === id)
  const rt = runtimes.get(id)
  if (!tab || !rt) return
  rt.xterm.writeln('\x1b[33m[正在重新连接...]\x1b[0m')
  tab.status = 'connecting'
  tab.errorMsg = null
  const dims = { cols: rt.xterm.cols, rows: rt.xterm.rows }
  rt.socket.connect({ projectId: tab.projectId, cwd: undefined, cols: dims.cols, rows: dims.rows })
}

async function refreshInfo() {
  loadingInfo.value = true
  terminalInfo.value = await projectStore.fetchTerminalInfo()
  loadingInfo.value = false
}

let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  await projectStore.fetchProjects()
  await refreshInfo()
  if (terminalInfo.value?.available) {
    const projectId = (route.query.projectId as string) || null
    await createTab({ projectId })
  }
  window.addEventListener('resize', fitActive)
  if (terminalContainerRef.value) {
    resizeObserver = new ResizeObserver(() => fitActive())
    resizeObserver.observe(terminalContainerRef.value)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', fitActive)
  resizeObserver?.disconnect()
  for (const rt of runtimes.values()) {
    try { rt.socket.disconnect() } catch {}
    try { rt.xterm.dispose() } catch {}
  }
  runtimes.clear()
})

watch(activeTabId, () => nextTick(() => fitActive()))

const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) || null)
</script>

<template>
  <div class="h-full flex flex-col bg-zinc-950 text-zinc-200">
    <div class="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <TerminalIcon class="w-5 h-5 text-cyan-400" />
        <h1 class="text-base font-semibold">终端</h1>
        <span v-if="terminalInfo" class="text-xs text-zinc-500 ml-2">
          {{ terminalInfo.shell }} · {{ terminalInfo.platform }}
        </span>
      </div>
      <div class="flex items-center gap-2 text-xs">
        <span v-if="terminalInfo" class="text-zinc-500">
          会话 {{ tabs.length }} / {{ terminalInfo.limits?.maxTotalSessions ?? '∞' }}
        </span>
        <button
          class="px-2 py-1 rounded border border-zinc-700 hover:bg-zinc-800"
          @click="refreshInfo"
          title="刷新状态"
        >
          <RefreshCw class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <div v-if="loadingInfo" class="flex-1 flex items-center justify-center text-zinc-500 text-sm">
      正在加载终端信息...
    </div>

    <div v-else-if="!terminalInfo?.available" class="flex-1 flex items-center justify-center px-6">
      <div class="max-w-lg text-center space-y-3">
        <AlertTriangle class="w-10 h-10 text-yellow-500 mx-auto" />
        <div class="text-lg font-medium">终端能力不可用</div>
        <p class="text-sm text-zinc-400">{{ terminalInfo?.reason || '未知原因' }}</p>
        <p class="text-xs text-zinc-500">
          请确认运行平台支持（仅 macOS / Linux）且 node-pty 原生模块已安装成功。
        </p>
      </div>
    </div>

    <div v-else class="flex-1 flex flex-col min-h-0">
      <div class="flex items-center bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer border-r border-zinc-800 select-none"
          :class="tab.id === activeTabId ? 'bg-zinc-950 text-white' : 'text-zinc-400 hover:text-zinc-200'"
          @click="setActive(tab.id)"
        >
          <span
            class="w-2 h-2 rounded-full"
            :class="{
              'bg-green-500': tab.status === 'open',
              'bg-yellow-500': tab.status === 'connecting',
              'bg-red-500': tab.status === 'error',
              'bg-zinc-500': tab.status === 'closed',
            }"
          ></span>
          <span class="font-mono">{{ tab.title }}</span>
          <span v-if="tab.pid" class="text-zinc-600">#{{ tab.pid }}</span>
          <button
            class="text-zinc-500 hover:text-red-400 ml-1"
            @click.stop="closeTab(tab.id)"
            title="关闭会话"
          >
            <X class="w-3 h-3" />
          </button>
        </div>
        <button
          class="px-3 py-2 text-xs text-zinc-400 hover:text-cyan-400"
          @click="() => createTab()"
          title="新建会话（默认家目录）"
        >
          <Plus class="w-4 h-4" />
        </button>
        <div v-if="limitWarning" class="text-yellow-500 text-xs px-3">{{ limitWarning }}</div>
      </div>

      <div ref="terminalContainerRef" class="flex-1 relative bg-black min-h-0">
        <template v-for="tab in tabs" :key="tab.id">
          <div
            v-show="tab.id === activeTabId"
            class="absolute inset-0"
            :ref="(el) => containers[tab.id] = el as HTMLDivElement"
          ></div>
        </template>
        <div
          v-if="activeTab && (activeTab.status === 'error' || activeTab.status === 'closed')"
          class="absolute bottom-3 right-3 z-10 flex items-center gap-2 bg-zinc-900/90 border border-zinc-700 px-3 py-2 rounded text-xs"
        >
          <span v-if="activeTab.status === 'error'" class="text-red-400">{{ activeTab.errorMsg || '连接出错' }}</span>
          <span v-else class="text-zinc-400">会话已结束</span>
          <button
            class="px-2 py-1 border border-zinc-700 rounded hover:bg-zinc-800 text-cyan-400"
            @click="reconnectTab(activeTab.id)"
          >重新连接</button>
        </div>
      </div>
    </div>
  </div>
</template>
