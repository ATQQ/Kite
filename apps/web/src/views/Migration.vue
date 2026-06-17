<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Database, Download, Upload, RefreshCw, CheckCircle2, AlertTriangle, FileArchive, Loader2 } from 'lucide-vue-next'
import { useProjectStore } from '../store/project'

interface MigrationProject {
  id: string
  name: string
  deployPath: string
  deployPathExists: boolean
  deploymentCount: number
}

interface ImportSummary {
  manifest: { schemaVersion: number; exportedAt: string; kiteVersion: string }
  projects: { inserted: number; updated: number; skipped: number }
  settings: { inserted: number; updated: number; skipped: number }
  deployments: { inserted: number; updated: number; skipped: number }
  artifacts: { ok: number; warnings: number; items: Array<{ projectId: string; status: string; message?: string }> }
}

const projectStore = useProjectStore()

const projects = ref<MigrationProject[]>([])
const loadingProjects = ref(false)
const projectsError = ref('')

const selectedIds = ref<string[]>([])

const exportOptions = ref({
  includeArtifacts: true,
  includeDeployments: true,
  deploymentMode: 'all' as 'all' | 'limit',
  deploymentLimitPerProject: 50,
})

const isExporting = ref(false)
const exportMessage = ref('')
const exportMessageType = ref<'success' | 'error'>('success')

const importFile = ref<File | null>(null)
const importStrategy = ref<'merge' | 'overwrite' | 'skip-existing'>('skip-existing')
const importRestoreArtifacts = ref(true)
const isImporting = ref(false)
const importMessage = ref('')
const importMessageType = ref<'success' | 'error'>('success')
const importSummary = ref<ImportSummary | null>(null)

const allSelected = computed(() =>
  projects.value.length > 0 && selectedIds.value.length === projects.value.length
)
const someSelected = computed(() =>
  selectedIds.value.length > 0 && selectedIds.value.length < projects.value.length
)

function toggleAll() {
  if (allSelected.value) {
    selectedIds.value = []
  } else {
    selectedIds.value = projects.value.map(p => p.id)
  }
}

function toggleOne(id: string) {
  const i = selectedIds.value.indexOf(id)
  if (i >= 0) selectedIds.value.splice(i, 1)
  else selectedIds.value.push(id)
}

async function loadProjects() {
  loadingProjects.value = true
  projectsError.value = ''
  try {
    const res = await fetch('/api/migration/projects', {
      headers: { Authorization: `Bearer ${projectStore.adminToken}` },
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || '获取项目失败')
    projects.value = data.projects || []
    selectedIds.value = projects.value.map(p => p.id)
  } catch (err: any) {
    projectsError.value = err.message
  } finally {
    loadingProjects.value = false
  }
}

async function handleExport() {
  exportMessage.value = ''
  if (selectedIds.value.length === 0) {
    exportMessage.value = '请至少选择一个项目'
    exportMessageType.value = 'error'
    return
  }
  isExporting.value = true
  try {
    const body = {
      projectIds: selectedIds.value,
      includeArtifacts: exportOptions.value.includeArtifacts,
      includeDeployments: exportOptions.value.includeDeployments,
      deploymentLimitPerProject:
        exportOptions.value.includeDeployments && exportOptions.value.deploymentMode === 'limit'
          ? Math.max(0, Math.floor(Number(exportOptions.value.deploymentLimitPerProject) || 0))
          : 0,
    }
    const res = await fetch('/api/migration/export', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${projectStore.adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { const j = await res.json(); msg = j.error || msg } catch {}
      throw new Error(msg)
    }
    const disposition = res.headers.get('Content-Disposition') || ''
    const m = /filename="?([^"]+)"?/.exec(disposition)
    const filename = m ? m[1] : `kite-export-${Date.now()}.zip`
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    exportMessage.value = `导出成功：${filename}（${(blob.size / 1024).toFixed(1)} KB）`
    exportMessageType.value = 'success'
  } catch (err: any) {
    exportMessage.value = `导出失败：${err.message}`
    exportMessageType.value = 'error'
  } finally {
    isExporting.value = false
  }
}

function handleFilePick(e: Event) {
  const target = e.target as HTMLInputElement
  importFile.value = target.files?.[0] || null
  importMessage.value = ''
  importSummary.value = null
}

async function handleImport() {
  importMessage.value = ''
  importSummary.value = null
  if (!importFile.value) {
    importMessage.value = '请选择要导入的 zip 文件'
    importMessageType.value = 'error'
    return
  }
  if (importStrategy.value === 'overwrite') {
    const ok = window.confirm('Overwrite 策略会覆盖同 ID 的现有项目/设置/部署日志，确认继续吗？')
    if (!ok) return
  }
  isImporting.value = true
  try {
    const formData = new FormData()
    formData.append('file', importFile.value)
    formData.append('strategy', importStrategy.value)
    formData.append('restoreArtifacts', importRestoreArtifacts.value ? 'true' : 'false')

    const headers: Record<string, string> = {
      Authorization: `Bearer ${projectStore.adminToken}`,
    }
    if (importStrategy.value === 'overwrite') {
      headers['X-Confirm-Overwrite'] = 'yes'
    }

    const res = await fetch('/api/migration/import', {
      method: 'POST',
      headers,
      body: formData,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
    importSummary.value = data.summary
    importMessage.value = '导入完成'
    importMessageType.value = 'success'
    await loadProjects()
  } catch (err: any) {
    importMessage.value = `导入失败：${err.message}`
    importMessageType.value = 'error'
  } finally {
    isImporting.value = false
  }
}

onMounted(loadProjects)
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6 pb-12">
    <div class="flex items-center space-x-3 mb-8">
      <Database class="w-7 h-7 text-primary" />
      <h1 class="text-2xl font-bold text-textMain tracking-tight">数据迁移</h1>
    </div>

    <!-- Projects + Export -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02] flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-textMain flex items-center">
            <Download class="w-5 h-5 mr-2 text-primary" />
            导出
          </h2>
          <p class="text-sm text-textMuted mt-1">选择项目并下载 zip 归档，可用于备份或迁移到另一台机器。</p>
        </div>
        <button
          @click="loadProjects"
          class="flex items-center text-sm text-textMuted hover:text-primary transition-colors"
          :disabled="loadingProjects"
        >
          <RefreshCw class="w-4 h-4 mr-1" :class="loadingProjects ? 'animate-spin' : ''" />
          刷新
        </button>
      </div>

      <div class="p-6 space-y-6">
        <div v-if="projectsError" class="p-3 rounded-lg bg-danger/10 border border-danger/30 text-danger text-sm flex items-center">
          <AlertTriangle class="w-4 h-4 mr-2" />{{ projectsError }}
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-medium text-textMain">项目列表</h3>
            <span class="text-xs text-textMuted">已选 {{ selectedIds.length }} / {{ projects.length }}</span>
          </div>
          <div class="border border-border rounded-lg overflow-hidden">
            <table class="w-full text-sm">
              <thead class="dark:bg-white/[0.02] bg-black/[0.02] text-textMuted">
                <tr>
                  <th class="w-10 px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      :checked="allSelected"
                      :indeterminate.prop="someSelected"
                      @change="toggleAll"
                      class="rounded border-border"
                    />
                  </th>
                  <th class="px-3 py-2 text-left font-medium">项目名 / ID</th>
                  <th class="px-3 py-2 text-left font-medium">部署路径</th>
                  <th class="px-3 py-2 text-right font-medium">部署日志</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="loadingProjects">
                  <td colspan="4" class="px-3 py-6 text-center text-textMuted">加载中...</td>
                </tr>
                <tr v-else-if="projects.length === 0">
                  <td colspan="4" class="px-3 py-6 text-center text-textMuted">暂无项目</td>
                </tr>
                <tr
                  v-for="p in projects"
                  :key="p.id"
                  class="border-t border-border dark:hover:bg-white/[0.02] hover:bg-black/[0.02] cursor-pointer"
                  @click="toggleOne(p.id)"
                >
                  <td class="px-3 py-2">
                    <input
                      type="checkbox"
                      :checked="selectedIds.includes(p.id)"
                      @click.stop
                      @change="toggleOne(p.id)"
                      class="rounded border-border"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <div class="font-medium text-textMain">{{ p.name }}</div>
                    <div class="font-mono text-xs text-textMuted">{{ p.id }}</div>
                  </td>
                  <td class="px-3 py-2">
                    <div class="font-mono text-xs break-all" :class="p.deployPathExists ? 'text-textMain' : 'text-textMuted'">{{ p.deployPath }}</div>
                    <div v-if="!p.deployPathExists" class="text-xs text-yellow-500 mt-0.5 flex items-center">
                      <AlertTriangle class="w-3 h-3 mr-1" />路径不存在，artifacts 会被跳过
                    </div>
                  </td>
                  <td class="px-3 py-2 text-right text-textMuted">{{ p.deploymentCount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="space-y-3">
          <h3 class="text-sm font-medium text-textMain">导出选项</h3>
          <label class="flex items-start space-x-3 cursor-pointer">
            <input type="checkbox" v-model="exportOptions.includeArtifacts" class="mt-0.5 rounded border-border" />
            <div>
              <div class="text-sm text-textMain">包含部署 artifacts（项目 deployPath 内的文件）</div>
              <div class="text-xs text-textMuted">关闭后仅导出数据库元数据与部署日志，体积更小。</div>
            </div>
          </label>
          <label class="flex items-start space-x-3 cursor-pointer">
            <input type="checkbox" v-model="exportOptions.includeDeployments" class="mt-0.5 rounded border-border" />
            <div>
              <div class="text-sm text-textMain">包含部署日志</div>
              <div class="text-xs text-textMuted">默认导出所有日志以保证信息完全一致。</div>
            </div>
          </label>
          <div v-if="exportOptions.includeDeployments" class="ml-7 space-y-2">
            <div class="flex items-center space-x-4 text-sm">
              <label class="flex items-center space-x-2 cursor-pointer">
                <input type="radio" value="all" v-model="exportOptions.deploymentMode" />
                <span class="text-textMain">保留全部</span>
              </label>
              <label class="flex items-center space-x-2 cursor-pointer">
                <input type="radio" value="limit" v-model="exportOptions.deploymentMode" />
                <span class="text-textMain">每项目最近</span>
                <input
                  type="number"
                  v-model.number="exportOptions.deploymentLimitPerProject"
                  min="1"
                  class="w-20 px-2 py-1 rounded bg-base border border-border text-sm text-textMain"
                  :disabled="exportOptions.deploymentMode !== 'limit'"
                />
                <span class="text-textMuted">条</span>
              </label>
            </div>
          </div>
        </div>

        <div v-if="exportMessage" class="p-3 rounded-lg border text-sm flex items-center" :class="exportMessageType === 'success' ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'">
          <CheckCircle2 v-if="exportMessageType === 'success'" class="w-4 h-4 mr-2" />
          <AlertTriangle v-else class="w-4 h-4 mr-2" />
          {{ exportMessage }}
        </div>

        <div class="flex justify-end">
          <button
            @click="handleExport"
            :disabled="isExporting || selectedIds.length === 0"
            class="inline-flex items-center px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Loader2 v-if="isExporting" class="w-4 h-4 mr-2 animate-spin" />
            <Download v-else class="w-4 h-4 mr-2" />
            {{ isExporting ? '导出中...' : '导出选中项目' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Import -->
    <div class="bg-panel border border-border rounded-xl shadow-sm overflow-hidden">
      <div class="px-6 py-5 border-b border-border dark:bg-white/[0.02] bg-black/[0.02]">
        <h2 class="text-lg font-semibold text-textMain flex items-center">
          <Upload class="w-5 h-5 mr-2 text-primary" />
          导入
        </h2>
        <p class="text-sm text-textMuted mt-1">从 kite-export-*.zip 还原项目、设置、部署日志与 artifacts。</p>
      </div>

      <div class="p-6 space-y-5">
        <div>
          <label class="block text-sm font-medium text-textMain mb-2">选择文件</label>
          <div class="flex items-center space-x-3">
            <label class="inline-flex items-center px-3 py-2 rounded-lg border border-border bg-base text-sm text-textMain cursor-pointer hover:border-primary">
              <FileArchive class="w-4 h-4 mr-2" />
              选择 zip 文件
              <input type="file" accept=".zip,application/zip" @change="handleFilePick" class="hidden" />
            </label>
            <span v-if="importFile" class="text-sm text-textMuted">
              {{ importFile.name }} ({{ (importFile.size / 1024).toFixed(1) }} KB)
            </span>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">冲突策略</label>
            <select
              v-model="importStrategy"
              class="w-full px-3 py-2 rounded-lg bg-base border border-border text-sm text-textMain"
            >
              <option value="skip-existing">skip-existing（默认，跳过已存在）</option>
              <option value="merge">merge（仅插入新数据）</option>
              <option value="overwrite">overwrite（覆盖同 ID 数据）</option>
            </select>
            <p class="text-xs text-textMuted mt-1">overwrite 会覆盖已有项目/设置/部署日志，请谨慎使用。</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-textMain mb-2">Artifacts 还原</label>
            <label class="flex items-center space-x-2 cursor-pointer mt-2">
              <input type="checkbox" v-model="importRestoreArtifacts" class="rounded border-border" />
              <span class="text-sm text-textMain">还原 artifacts 到项目 deployPath</span>
            </label>
            <p class="text-xs text-textMuted mt-1">关闭则仅恢复数据库内容，不解压 artifacts。</p>
          </div>
        </div>

        <div v-if="importMessage" class="p-3 rounded-lg border text-sm flex items-center" :class="importMessageType === 'success' ? 'bg-success/10 border-success/30 text-success' : 'bg-danger/10 border-danger/30 text-danger'">
          <CheckCircle2 v-if="importMessageType === 'success'" class="w-4 h-4 mr-2" />
          <AlertTriangle v-else class="w-4 h-4 mr-2" />
          {{ importMessage }}
        </div>

        <div v-if="importSummary" class="border border-border rounded-lg p-4 bg-base space-y-3">
          <div class="text-sm font-medium text-textMain">导入摘要</div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div class="p-3 rounded bg-panel border border-border">
              <div class="text-textMuted text-xs">项目</div>
              <div class="mt-1 text-textMain">
                新增 {{ importSummary.projects.inserted }} / 更新 {{ importSummary.projects.updated }} / 跳过 {{ importSummary.projects.skipped }}
              </div>
            </div>
            <div class="p-3 rounded bg-panel border border-border">
              <div class="text-textMuted text-xs">设置</div>
              <div class="mt-1 text-textMain">
                新增 {{ importSummary.settings.inserted }} / 更新 {{ importSummary.settings.updated }} / 跳过 {{ importSummary.settings.skipped }}
              </div>
            </div>
            <div class="p-3 rounded bg-panel border border-border">
              <div class="text-textMuted text-xs">部署日志</div>
              <div class="mt-1 text-textMain">
                新增 {{ importSummary.deployments.inserted }} / 更新 {{ importSummary.deployments.updated }} / 跳过 {{ importSummary.deployments.skipped }}
              </div>
            </div>
          </div>
          <div class="text-sm">
            <span class="text-textMuted">Artifacts：</span>
            <span class="text-success">成功 {{ importSummary.artifacts.ok }}</span>
            <span class="text-textMuted mx-1">/</span>
            <span :class="importSummary.artifacts.warnings > 0 ? 'text-yellow-500' : 'text-textMuted'">
              警告 {{ importSummary.artifacts.warnings }}
            </span>
          </div>
          <div v-if="importSummary.artifacts.items.length > 0" class="space-y-1 text-xs">
            <div
              v-for="item in importSummary.artifacts.items"
              :key="item.projectId"
              class="font-mono"
              :class="item.status === 'ok' ? 'text-textMuted' : 'text-yellow-500'"
            >
              [{{ item.status }}] {{ item.projectId }}<span v-if="item.message"> — {{ item.message }}</span>
            </div>
          </div>
          <div class="text-xs text-textMuted">
            来自 schemaVersion={{ importSummary.manifest.schemaVersion }}，导出时间 {{ importSummary.manifest.exportedAt }}，源 kiteVersion={{ importSummary.manifest.kiteVersion }}
          </div>
        </div>

        <div class="flex justify-end">
          <button
            @click="handleImport"
            :disabled="isImporting || !importFile"
            class="inline-flex items-center px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            <Loader2 v-if="isImporting" class="w-4 h-4 mr-2 animate-spin" />
            <Upload v-else class="w-4 h-4 mr-2" />
            {{ isImporting ? '导入中...' : '开始导入' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
