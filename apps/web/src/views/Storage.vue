<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  HardDrive,
  RefreshCw,
  Database,
  FileText,
  Folder,
  Trash2,
  Archive,
  ChevronRight,
  X,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-vue-next'
import { useProjectStore } from '../store/project'
import { useToast } from '../composables/useToast'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const projectStore = useProjectStore()
const toast = useToast()

interface DiskOverview {
  kiteHome: {
    path: string
    totalBytes: number
    breakdown: { deployments: number; tmp: number; db: number; config: number }
    approximated: boolean
  }
  filesystem: { freeBytes: number | null; totalBytes: number | null; percentUsed: number | null }
  cached?: boolean
}

interface ProjectDiskItem {
  projectId: string
  projectName: string
  artifactsBytes: number
  artifactCount: number
  oldestAt: string | null
  newestAt: string | null
  deployPath: string | null
  deployPathBytes: number
  deployPathExists: boolean
  approximated: boolean
}

interface ProjectDiskResp {
  items: ProjectDiskItem[]
  totals: { artifactsBytes: number; deployPathBytes: number }
  cached?: boolean
}

interface ArtifactItem {
  deployId: string
  sizeBytes: number
  createdAt: string
  status: string | null
  triggerSource: string | null
  rollbackOf: string | null
  referencedBy: number
  canDelete: boolean
}

interface ArtifactsResp {
  projectId: string
  projectName: string
  items: ArtifactItem[]
  totalBytes: number
}

const overview = ref<DiskOverview | null>(null)
const projects = ref<ProjectDiskItem[]>([])
const loading = ref(false)
const loadingError = ref('')

const drawerOpen = ref(false)
const drawerProject = ref<ProjectDiskItem | null>(null)
const drawerData = ref<ArtifactsResp | null>(null)
const drawerLoading = ref(false)
const drawerError = ref('')

const confirmOpen = ref(false)
const pendingDelete = ref<ArtifactItem | null>(null)
const deleting = ref(false)

const formatBytes = (n?: number | null) => {
  if (n == null || !Number.isFinite(n)) return '-'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}

const formatDate = (iso?: string | null) => {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const breakdownTotal = computed(() => overview.value?.kiteHome.totalBytes || 0)
const breakdownRows = computed(() => {
  if (!overview.value) return []
  const b = overview.value.kiteHome.breakdown
  const total = Math.max(breakdownTotal.value, 1)
  return [
    { label: 'deployments/', value: b.deployments, color: 'bg-primary', icon: Archive },
    { label: 'tmp/', value: b.tmp, color: 'bg-yellow-400', icon: Folder },
    { label: 'kite.db', value: b.db, color: 'bg-success', icon: Database },
    { label: 'config.json', value: b.config, color: 'bg-textMuted', icon: FileText },
  ].map(r => ({ ...r, pct: (r.value / total) * 100 }))
})

const fsUsedPct = computed(() => overview.value?.filesystem.percentUsed ?? null)
const fsBarColor = computed(() => {
  const p = fsUsedPct.value
  if (p == null) return 'bg-textMuted'
  if (p >= 95) return 'bg-danger'
  if (p >= 85) return 'bg-yellow-400'
  return 'bg-success'
})

const refresh = async () => {
  loading.value = true
  loadingError.value = ''
  try {
    const [ov, pj] = await Promise.all([
      projectStore.fetchDiskOverview() as Promise<DiskOverview>,
      projectStore.fetchDiskProjects() as Promise<ProjectDiskResp>,
    ])
    overview.value = ov
    projects.value = pj.items
  } catch (e: any) {
    loadingError.value = e?.message || '加载失败'
    toast.error(loadingError.value)
  } finally {
    loading.value = false
  }
}

const openDrawer = async (item: ProjectDiskItem) => {
  drawerProject.value = item
  drawerOpen.value = true
  drawerLoading.value = true
  drawerError.value = ''
  drawerData.value = null
  try {
    drawerData.value = await projectStore.fetchProjectArtifacts(item.projectId) as ArtifactsResp
  } catch (e: any) {
    drawerError.value = e?.message || '加载归档失败'
  } finally {
    drawerLoading.value = false
  }
}

const closeDrawer = () => {
  drawerOpen.value = false
  drawerProject.value = null
  drawerData.value = null
}

const askDelete = (item: ArtifactItem) => {
  if (!item.canDelete) {
    toast.warning(`该归档被 ${item.referencedBy} 条部署记录引用，无法删除`)
    return
  }
  pendingDelete.value = item
  confirmOpen.value = true
}

const confirmDelete = async () => {
  if (!pendingDelete.value) return
  deleting.value = true
  try {
    const res = await projectStore.deleteArtifact(pendingDelete.value.deployId)
    if (res?.success) {
      toast.success(`已删除归档，释放 ${formatBytes(res.freedBytes)}`)
      // refresh drawer + project list (totals change)
      if (drawerProject.value) await openDrawer(drawerProject.value)
      await refresh()
      confirmOpen.value = false
      pendingDelete.value = null
    } else {
      toast.error(res?.error || '删除失败')
    }
  } catch (e: any) {
    if (e?.message?.includes('referenced')) {
      toast.warning('该归档被其它部署记录引用')
    } else {
      toast.error(e?.message || '删除失败')
    }
  } finally {
    deleting.value = false
  }
}

const cancelDelete = () => {
  confirmOpen.value = false
  pendingDelete.value = null
}

const statusBadge = (s: ArtifactItem) => {
  if (s.triggerSource === 'rollback') return { label: 'rollback', cls: 'bg-yellow-400/15 text-yellow-400 border-yellow-400/30' }
  switch (s.status) {
    case 'success': return { label: 'success', cls: 'bg-success/15 text-success border-success/30' }
    case 'failed': return { label: 'failed', cls: 'bg-danger/15 text-danger border-danger/30' }
    case 'running': return { label: 'running', cls: 'bg-primary/15 text-primary border-primary/30' }
    default: return { label: s.status || '-', cls: 'bg-textMuted/15 text-textMuted border-border' }
  }
}

const confirmMessage = computed(() => {
  if (!pendingDelete.value) return ''
  const it = pendingDelete.value
  return `deployId: ${it.deployId}\n大小: ${formatBytes(it.sizeBytes)}\n创建时间: ${formatDate(it.createdAt)}\n\n删除后该部署记录将无法回滚（仅清理归档 zip，部署记录保留）。`
})

onMounted(() => {
  refresh()
})
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-textMain flex items-center">
          <HardDrive class="w-6 h-6 mr-2 text-primary" />
          存储
        </h1>
        <p class="text-sm text-textMuted mt-1">查看 Kite 数据目录与项目归档的磁盘占用，按需手动清理。</p>
      </div>
      <button
        @click="refresh"
        :disabled="loading"
        class="flex items-center px-3 py-2 bg-base border border-border rounded-md text-textMuted hover:text-textMain hover:border-primary/50 transition-all disabled:opacity-50"
        type="button"
      >
        <RefreshCw class="w-4 h-4 mr-2" :class="loading ? 'animate-spin' : ''" />
        刷新
      </button>
    </div>

    <!-- Loading / Error -->
    <div v-if="loadingError" class="bg-danger/10 border border-danger/30 text-danger text-sm rounded-lg px-4 py-3">
      {{ loadingError }}
    </div>

    <!-- Global overview -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain">~/.kite 数据目录</h2>
        <p class="text-sm text-textMuted mt-1">
          <span v-if="overview?.cached" class="text-yellow-400">使用 30s 内缓存结果</span>
          <span v-else-if="overview?.kiteHome.approximated" class="text-yellow-400 inline-flex items-center">
            <AlertTriangle class="w-3.5 h-3.5 mr-1" /> 目录较大，部分子目录扫描已超时（近似值）
          </span>
          <span v-else class="text-textMuted">opendir 流式扫描，结果在内存中缓存 30s。</span>
        </p>
      </div>

      <div v-if="!overview" class="p-6 text-textMuted text-sm text-center">加载中...</div>
      <div v-else class="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Kite home breakdown -->
        <div>
          <div class="flex items-baseline justify-between mb-3">
            <span class="text-xs text-textMuted font-mono">{{ overview.kiteHome.path }}</span>
            <span class="text-2xl font-bold text-textMain font-mono">{{ formatBytes(breakdownTotal) }}</span>
          </div>
          <div class="space-y-2">
            <div v-for="row in breakdownRows" :key="row.label" class="space-y-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-textMain inline-flex items-center">
                  <component :is="row.icon" class="w-3.5 h-3.5 mr-1.5 text-textMuted" />
                  {{ row.label }}
                </span>
                <span class="font-mono text-textMuted">{{ formatBytes(row.value) }}</span>
              </div>
              <div class="h-1.5 bg-base rounded-full overflow-hidden">
                <div :class="['h-full', row.color]" :style="{ width: row.pct + '%' }" />
              </div>
            </div>
          </div>
        </div>

        <!-- Filesystem -->
        <div>
          <div class="flex items-baseline justify-between mb-3">
            <span class="text-xs text-textMuted">系统盘（包含 Kite Home 所在挂载点）</span>
            <span class="text-2xl font-bold text-textMain font-mono">
              <template v-if="overview.filesystem.percentUsed != null">{{ overview.filesystem.percentUsed }}%</template>
              <template v-else>-</template>
            </span>
          </div>
          <div class="h-3 bg-base rounded-full overflow-hidden mb-3">
            <div :class="['h-full transition-all', fsBarColor]" :style="{ width: (fsUsedPct ?? 0) + '%' }" />
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div class="bg-base rounded-md px-3 py-2">
              <div class="text-textMuted">可用</div>
              <div class="font-mono text-textMain mt-0.5">{{ formatBytes(overview.filesystem.freeBytes) }}</div>
            </div>
            <div class="bg-base rounded-md px-3 py-2">
              <div class="text-textMuted">总容量</div>
              <div class="font-mono text-textMain mt-0.5">{{ formatBytes(overview.filesystem.totalBytes) }}</div>
            </div>
          </div>
          <p v-if="overview.filesystem.percentUsed == null" class="text-xs text-textMuted mt-2 italic">
            当前平台未提供 df 信息（如 Windows）。
          </p>
        </div>
      </div>
    </div>

    <!-- Per-project table -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain">项目占用</h2>
        <p class="text-sm text-textMuted mt-1">归档 zip 由 keepN 策略自动清理，部署目录由你的部署模式决定（merge 累加 / clean 仅本次内容）。</p>
      </div>

      <div v-if="!loading && projects.length === 0" class="p-6 text-textMuted text-sm text-center">暂无项目</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-xs text-textMuted bg-base/40 border-b border-border">
            <tr>
              <th class="text-left px-6 py-3 font-medium">项目</th>
              <th class="text-right px-4 py-3 font-medium">归档大小</th>
              <th class="text-right px-4 py-3 font-medium">归档数量</th>
              <th class="text-left px-4 py-3 font-medium">最新归档</th>
              <th class="text-right px-4 py-3 font-medium">部署目录</th>
              <th class="text-right px-6 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in projects" :key="p.projectId" class="border-b border-border last:border-0 hover:bg-base/40 transition-colors">
              <td class="px-6 py-3">
                <div class="text-textMain font-medium">{{ p.projectName }}</div>
                <div class="text-xs text-textMuted font-mono mt-0.5">{{ p.projectId }}</div>
              </td>
              <td class="px-4 py-3 text-right font-mono text-textMain">{{ formatBytes(p.artifactsBytes) }}</td>
              <td class="px-4 py-3 text-right font-mono text-textMuted">{{ p.artifactCount }}</td>
              <td class="px-4 py-3 text-textMuted text-xs">{{ formatDate(p.newestAt) }}</td>
              <td class="px-4 py-3 text-right">
                <div v-if="p.deployPathExists" class="font-mono text-textMain">{{ formatBytes(p.deployPathBytes) }}</div>
                <div v-else class="text-textMuted text-xs italic">未创建</div>
                <div v-if="p.deployPath" class="text-[10px] text-textMuted font-mono truncate max-w-[180px] ml-auto mt-0.5">{{ p.deployPath }}</div>
              </td>
              <td class="px-6 py-3 text-right">
                <button
                  @click="openDrawer(p)"
                  class="inline-flex items-center px-3 py-1.5 text-xs text-primary border border-primary/30 hover:bg-primary/10 rounded-md transition-colors"
                  type="button"
                >
                  详情
                  <ChevronRight class="w-3.5 h-3.5 ml-1" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Drawer -->
    <transition name="fade">
      <div v-if="drawerOpen" class="fixed inset-0 z-40 flex" @click.self="closeDrawer">
        <div class="fixed inset-0 bg-black/50" />
        <div class="ml-auto relative w-full max-w-xl bg-panel border-l border-border h-full overflow-y-auto z-50">
          <div class="sticky top-0 bg-panel border-b border-border px-6 py-4 flex items-center justify-between z-10">
            <div>
              <div class="text-xs text-textMuted">归档详情</div>
              <h3 class="text-lg font-semibold text-textMain mt-0.5">{{ drawerProject?.projectName }}</h3>
            </div>
            <button @click="closeDrawer" class="text-textMuted hover:text-textMain p-2 rounded-md" type="button">
              <X class="w-5 h-5" />
            </button>
          </div>

          <div class="p-6">
            <div v-if="drawerLoading" class="text-textMuted text-sm text-center py-8">加载中...</div>
            <div v-else-if="drawerError" class="bg-danger/10 border border-danger/30 text-danger text-sm rounded-md px-3 py-2">
              {{ drawerError }}
            </div>
            <div v-else-if="drawerData">
              <div class="bg-base border border-border rounded-md px-4 py-3 mb-4 flex items-center justify-between">
                <div class="text-xs text-textMuted">归档总占用</div>
                <div class="font-mono text-textMain">{{ formatBytes(drawerData.totalBytes) }} · {{ drawerData.items.length }} 份</div>
              </div>

              <div v-if="drawerData.items.length === 0" class="text-textMuted text-sm text-center py-6">该项目暂无归档</div>

              <ul v-else class="space-y-2">
                <li
                  v-for="it in drawerData.items"
                  :key="it.deployId"
                  class="bg-base border border-border rounded-md px-4 py-3"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-mono text-sm text-textMain">{{ it.deployId.slice(0, 12) }}</span>
                        <span :class="['px-1.5 py-0.5 text-[10px] font-mono rounded border', statusBadge(it).cls]">
                          {{ statusBadge(it).label }}
                        </span>
                        <span v-if="it.referencedBy > 1" class="px-1.5 py-0.5 text-[10px] font-mono rounded border bg-yellow-400/15 text-yellow-400 border-yellow-400/30">
                          ref ×{{ it.referencedBy }}
                        </span>
                      </div>
                      <div class="text-xs text-textMuted mt-1.5 flex items-center gap-3">
                        <span class="font-mono">{{ formatBytes(it.sizeBytes) }}</span>
                        <span>·</span>
                        <span>{{ formatDate(it.createdAt) }}</span>
                      </div>
                    </div>
                    <div class="shrink-0">
                      <button
                        v-if="it.canDelete"
                        @click="askDelete(it)"
                        class="inline-flex items-center px-2.5 py-1.5 text-xs text-danger border border-danger/30 hover:bg-danger/10 rounded-md transition-colors"
                        type="button"
                      >
                        <Trash2 class="w-3.5 h-3.5 mr-1" />
                        删除
                      </button>
                      <span
                        v-else
                        class="inline-flex items-center px-2.5 py-1.5 text-xs text-textMuted italic"
                        :title="`被 ${it.referencedBy} 条部署记录引用，不可单独删除`"
                      >
                        <CheckCircle2 class="w-3.5 h-3.5 mr-1" />
                        受引用保护
                      </span>
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </transition>

    <ConfirmDialog
      v-model:open="confirmOpen"
      tone="danger"
      title="删除归档 zip"
      :message="confirmMessage"
      confirm-text="确认删除"
      cancel-text="取消"
      :loading="deleting"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
