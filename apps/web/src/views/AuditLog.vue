<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import {
  ScrollText, RefreshCw, Filter, X, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, FileText, AlertCircle
} from 'lucide-vue-next'

interface AuditLogRow {
  id: string
  createdAt: number
  actor: string | null
  actorIp: string | null
  action: string
  targetType: string | null
  targetId: string | null
  targetName: string | null
  before: string | null
  after: string | null
  summary: string | null
  status: string
  errorMessage: string | null
}

const projectStore = useProjectStore()
const route = useRoute()
const router = useRouter()

const rows = ref<AuditLogRow[]>([])
const total = ref(0)
const loading = ref(false)
const selected = ref<AuditLogRow | null>(null)

const limit = 50
const offset = ref(0)
const filterAction = ref('')
const filterTargetId = ref('')
const filterTargetType = ref('')

const actionOptions = [
  { value: '', label: '全部操作' },
  { value: 'project.create', label: '创建项目' },
  { value: 'project.update', label: '更新项目' },
  { value: 'project.delete', label: '删除项目' },
  { value: 'project.token.rotate', label: '重置项目 Token' },
  { value: 'settings.update', label: '更新系统设置' },
  { value: 'admin_token.change', label: '修改 Admin Token' },
  { value: 'migration.export', label: '导出迁移包' },
  { value: 'migration.import', label: '导入迁移包' },
  { value: 'auth.login_failed', label: '登录失败' },
]

const actionLabel = (action: string) => {
  return actionOptions.find(o => o.value === action)?.label || action
}

const actionTone = (action: string) => {
  if (action.endsWith('.delete')) return 'text-danger bg-danger/10 border-danger/30'
  if (action.endsWith('.create')) return 'text-success bg-success/10 border-success/30'
  if (action.includes('token') || action.includes('admin_token')) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
  if (action.startsWith('migration.')) return 'text-primary bg-primary/10 border-primary/30'
  if (action.startsWith('auth.')) return 'text-textMuted bg-white/5 border-border'
  return 'text-primary bg-primary/10 border-primary/30'
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const currentPage = computed(() => Math.floor(offset.value / limit) + 1)

const fmtTime = (ts: number) => {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const parseJson = (s: string | null) => {
  if (!s) return null
  try { return JSON.parse(s) } catch { return s }
}

const beforeObj = computed(() => parseJson(selected.value?.before ?? null))
const afterObj = computed(() => parseJson(selected.value?.after ?? null))
const hasBeforeAfter = computed(() => beforeObj.value !== null || afterObj.value !== null)

async function load() {
  loading.value = true
  try {
    const data = await projectStore.fetchAuditLogs({
      action: filterAction.value || undefined,
      targetId: filterTargetId.value || undefined,
      targetType: filterTargetType.value || undefined,
      limit,
      offset: offset.value,
    })
    rows.value = data.rows || []
    total.value = data.total || 0
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filterAction.value = ''
  filterTargetId.value = ''
  filterTargetType.value = ''
}

function nextPage() {
  if (currentPage.value < totalPages.value) {
    offset.value += limit
    load()
  }
}
function prevPage() {
  if (offset.value > 0) {
    offset.value = Math.max(0, offset.value - limit)
    load()
  }
}

function openDetail(row: AuditLogRow) {
  selected.value = row
}
function closeDetail() {
  selected.value = null
}

onMounted(() => {
  const q = route.query
  if (typeof q.action === 'string') filterAction.value = q.action
  if (typeof q.targetId === 'string') filterTargetId.value = q.targetId
  if (typeof q.targetType === 'string') filterTargetType.value = q.targetType
  load()
})

// Auto-apply filters when any of them changes (with debounce for text inputs).
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch([filterAction, filterTargetId, filterTargetType], ([action], [prevAction]) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  // Action 是下拉，立即触发；targetId/targetType 是文本输入，debounce 300ms
  const isTextChange = action === prevAction
  const delay = isTextChange ? 300 : 0
  debounceTimer = setTimeout(() => {
    offset.value = 0
    const q: Record<string, string> = {}
    if (filterAction.value) q.action = filterAction.value
    if (filterTargetId.value) q.targetId = filterTargetId.value
    if (filterTargetType.value) q.targetType = filterTargetType.value
    router.replace({ query: q })
    load()
  }, delay)
})

watch(() => route.query.targetId, (tid) => {
  if (typeof tid === 'string' && tid !== filterTargetId.value) {
    filterTargetId.value = tid
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div class="flex items-center gap-3 min-w-0">
        <ScrollText class="w-6 h-6 text-primary shrink-0" />
        <div class="min-w-0">
          <h1 class="text-2xl font-bold text-textMain">操作日志</h1>
          <p class="text-sm text-textMuted mt-1">所有服务端运维操作的审计记录，含变更前后状态</p>
        </div>
      </div>
      <button
        @click="load"
        :disabled="loading"
        class="flex items-center gap-2 px-4 py-2 bg-panel border border-border rounded-md text-textMain hover:border-primary/50 transition-colors disabled:opacity-50 self-start sm:self-auto shrink-0"
      >
        <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
        <span class="text-sm">刷新</span>
      </button>
    </div>

    <!-- Filters -->
    <div class="bg-panel border border-border rounded-lg p-4">
      <div class="flex items-center gap-2 mb-3 text-sm text-textMuted">
        <Filter class="w-4 h-4" />
        <span>筛选</span>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label class="block text-xs text-textMuted mb-1">操作类型</label>
          <select
            v-model="filterAction"
            class="w-full bg-base border border-border rounded px-3 py-2 text-sm text-textMain focus:border-primary focus:outline-none"
          >
            <option v-for="opt in actionOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-textMuted mb-1">目标 ID</label>
          <input
            v-model="filterTargetId"
            type="text"
            placeholder="如 proj_xxxxx"
            class="w-full bg-base border border-border rounded px-3 py-2 text-sm text-textMain focus:border-primary focus:outline-none font-mono"
          />
        </div>
        <div>
          <label class="block text-xs text-textMuted mb-1">目标类型</label>
          <input
            v-model="filterTargetType"
            type="text"
            placeholder="如 project / settings"
            class="w-full bg-base border border-border rounded px-3 py-2 text-sm text-textMain focus:border-primary focus:outline-none"
          />
        </div>
        <div class="flex items-end">
          <button
            @click="resetFilters"
            :disabled="!filterAction && !filterTargetId && !filterTargetType"
            class="w-full px-3 py-2 bg-base border border-border text-textMuted rounded text-sm hover:border-textMuted hover:text-textMain transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            <X class="w-3.5 h-3.5" />
            清空筛选
          </button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="bg-panel border border-border rounded-lg overflow-hidden">
      <div v-if="loading && rows.length === 0" class="p-12 text-center text-textMuted">
        加载中...
      </div>
      <div v-else-if="rows.length === 0" class="p-12 text-center">
        <AlertCircle class="w-10 h-10 mx-auto text-textMuted mb-3" />
        <p class="text-textMuted">暂无操作日志</p>
      </div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm min-w-[720px]">
          <thead class="bg-base/50 border-b border-border">
            <tr class="text-left text-xs text-textMuted">
              <th class="px-4 py-3 font-medium">时间</th>
              <th class="px-4 py-3 font-medium">操作</th>
              <th class="px-4 py-3 font-medium">目标</th>
              <th class="px-4 py-3 font-medium">摘要</th>
              <th class="px-4 py-3 font-medium">来源 IP</th>
              <th class="px-4 py-3 font-medium">状态</th>
              <th class="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="border-b border-border last:border-0 hover:bg-base/50 transition-colors cursor-pointer"
              @click="openDetail(row)"
            >
              <td class="px-4 py-3 text-textMuted font-mono text-xs whitespace-nowrap">{{ fmtTime(row.createdAt) }}</td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs border" :class="actionTone(row.action)">
                  {{ actionLabel(row.action) }}
                </span>
              </td>
              <td class="px-4 py-3">
                <div v-if="row.targetName" class="text-textMain">{{ row.targetName }}</div>
                <div v-if="row.targetId" class="text-xs text-textMuted font-mono">{{ row.targetId }}</div>
                <span v-if="!row.targetName && !row.targetId" class="text-textMuted">-</span>
              </td>
              <td class="px-4 py-3 text-textMain max-w-xs truncate">{{ row.summary || '-' }}</td>
              <td class="px-4 py-3 text-textMuted font-mono text-xs">{{ row.actorIp || '-' }}</td>
              <td class="px-4 py-3">
                <span v-if="row.status === 'success'" class="inline-flex items-center gap-1 text-success text-xs">
                  <CheckCircle2 class="w-3.5 h-3.5" /> 成功
                </span>
                <span v-else class="inline-flex items-center gap-1 text-danger text-xs">
                  <XCircle class="w-3.5 h-3.5" /> 失败
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <FileText class="w-4 h-4 text-textMuted inline" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div v-if="rows.length > 0" class="flex items-center justify-between px-4 py-3 border-t border-border bg-base/30">
        <span class="text-xs text-textMuted">共 {{ total }} 条，第 {{ currentPage }} / {{ totalPages }} 页</span>
        <div class="flex items-center gap-2">
          <button
            @click="prevPage"
            :disabled="offset === 0 || loading"
            class="p-1.5 border border-border rounded text-textMuted hover:text-textMain hover:border-textMuted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>
          <button
            @click="nextPage"
            :disabled="currentPage >= totalPages || loading"
            class="p-1.5 border border-border rounded text-textMuted hover:text-textMain hover:border-textMuted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Detail Drawer -->
    <div
      v-if="selected"
      class="fixed inset-0 z-50 flex justify-end"
      @click.self="closeDetail"
    >
      <div class="fixed inset-0 bg-black/40" @click="closeDetail"></div>
      <div class="relative w-full max-w-2xl h-full bg-panel border-l border-border overflow-y-auto">
        <div class="sticky top-0 bg-panel border-b border-border px-6 py-4 flex items-center justify-between">
          <div>
            <h2 class="text-lg font-bold text-textMain">操作详情</h2>
            <p class="text-xs text-textMuted font-mono mt-1">{{ selected.id }}</p>
          </div>
          <button @click="closeDetail" class="p-1.5 hover:bg-base rounded text-textMuted hover:text-textMain">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="p-6 space-y-5">
          <div class="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div class="text-xs text-textMuted mb-1">操作类型</div>
              <span class="inline-flex items-center px-2 py-0.5 rounded text-xs border" :class="actionTone(selected.action)">
                {{ actionLabel(selected.action) }}
              </span>
              <div class="text-xs text-textMuted font-mono mt-1">{{ selected.action }}</div>
            </div>
            <div>
              <div class="text-xs text-textMuted mb-1">状态</div>
              <span v-if="selected.status === 'success'" class="inline-flex items-center gap-1 text-success text-xs">
                <CheckCircle2 class="w-3.5 h-3.5" /> 成功
              </span>
              <span v-else class="inline-flex items-center gap-1 text-danger text-xs">
                <XCircle class="w-3.5 h-3.5" /> 失败
              </span>
            </div>
            <div>
              <div class="text-xs text-textMuted mb-1">时间</div>
              <div class="text-textMain font-mono text-xs">{{ fmtTime(selected.createdAt) }}</div>
            </div>
            <div>
              <div class="text-xs text-textMuted mb-1">来源 IP</div>
              <div class="text-textMain font-mono text-xs">{{ selected.actorIp || '-' }}</div>
            </div>
            <div class="col-span-2">
              <div class="text-xs text-textMuted mb-1">目标</div>
              <div class="text-textMain">{{ selected.targetName || '-' }}</div>
              <div v-if="selected.targetId" class="text-xs text-textMuted font-mono break-all">{{ selected.targetType }}: {{ selected.targetId }}</div>
            </div>
            <div v-if="selected.summary" class="col-span-2">
              <div class="text-xs text-textMuted mb-1">摘要</div>
              <div class="text-textMain">{{ selected.summary }}</div>
            </div>
            <div v-if="selected.errorMessage" class="col-span-2">
              <div class="text-xs text-textMuted mb-1">错误信息</div>
              <div class="text-danger text-sm">{{ selected.errorMessage }}</div>
            </div>
          </div>

          <div v-if="hasBeforeAfter" class="space-y-3">
            <div class="text-xs text-textMuted">变更前后</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div class="text-xs text-danger mb-1">Before</div>
                <pre class="bg-base border border-border rounded p-3 text-xs text-textMain font-mono overflow-auto max-h-96"><code>{{ beforeObj === null ? '(无)' : JSON.stringify(beforeObj, null, 2) }}</code></pre>
              </div>
              <div>
                <div class="text-xs text-success mb-1">After</div>
                <pre class="bg-base border border-border rounded p-3 text-xs text-textMain font-mono overflow-auto max-h-96"><code>{{ afterObj === null ? '(无)' : JSON.stringify(afterObj, null, 2) }}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
