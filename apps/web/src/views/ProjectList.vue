<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import { Plus, MoreVertical, Server, Clock, ScrollText, FolderPlus, Trash2, RefreshCw, XCircle, AlertTriangle, Pencil, FolderOpen } from 'lucide-vue-next'
import { useToast } from '../composables/useToast'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'

const projectStore = useProjectStore()
const router = useRouter()
const toast = useToast()

onMounted(() => {
  projectStore.fetchProjects()
})

const showCreateModal = ref(false)
const newProject = ref({ name: '', description: '', destPath: '', env: '' })

const createProject = async () => {
  if (!newProject.value.name || !newProject.value.destPath) return
  const result = await projectStore.addProject(newProject.value)
  if (result.ok) {
    showCreateModal.value = false
    newProject.value = { name: '', description: '', destPath: '', env: '' }
    toast.success('项目创建成功')
  } else {
    const detail = result.conflictProject
      ? `部署目录已被项目「${result.conflictProject}」占用`
      : result.error || '请稍后重试'
    toast.error('创建失败', detail)
  }
}

const goToDetail = (id: string) => {
  router.push(`/projects/${id}`)
}

const goToLogs = (id: string) => {
  router.push({ path: '/logs', query: { projectId: id } })
}

const goToFiles = (id: string) => {
  router.push(`/projects/${id}/files`)
}

// ---------- Card dropdown menu ----------
const openDropdownId = ref<string | null>(null)
const dropdownStyle = ref<Record<string, string>>({})
const DROPDOWN_WIDTH = 160
const DROPDOWN_HEIGHT = 196

async function toggleDropdown(id: string, e: Event) {
  e.stopPropagation()
  if (openDropdownId.value === id) {
    openDropdownId.value = null
    return
  }
  const trigger = e.currentTarget as HTMLElement
  const rect = trigger.getBoundingClientRect()
  const viewportH = window.innerHeight
  const viewportW = window.innerWidth
  const spaceBelow = viewportH - rect.bottom
  const openUpward = spaceBelow < DROPDOWN_HEIGHT + 12 && rect.top > DROPDOWN_HEIGHT + 12
  const top = openUpward
    ? Math.max(8, rect.top - DROPDOWN_HEIGHT - 4)
    : Math.min(viewportH - DROPDOWN_HEIGHT - 8, rect.bottom + 4)
  const left = Math.min(
    viewportW - DROPDOWN_WIDTH - 8,
    Math.max(8, rect.right - DROPDOWN_WIDTH),
  )
  dropdownStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${DROPDOWN_WIDTH}px`,
  }
  openDropdownId.value = id
  await nextTick()
}

function closeDropdown() {
  openDropdownId.value = null
}

function handleWindowChange() {
  if (openDropdownId.value) closeDropdown()
}

onMounted(() => {
  window.addEventListener('scroll', handleWindowChange, true)
  window.addEventListener('resize', handleWindowChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleWindowChange, true)
  window.removeEventListener('resize', handleWindowChange)
})

// ---------- Rename ----------
const showRenameModal = ref(false)
const renameTarget = ref<{ id: string; name: string } | null>(null)
const renameInput = ref('')
const isRenaming = ref(false)

function openRename(projectId: string, currentName: string) {
  closeDropdown()
  renameTarget.value = { id: projectId, name: currentName }
  renameInput.value = currentName
  showRenameModal.value = true
}

async function confirmRename() {
  if (!renameTarget.value) return
  const newName = renameInput.value.trim()
  if (!newName || newName === renameTarget.value.name) {
    showRenameModal.value = false
    return
  }
  isRenaming.value = true
  try {
    await projectStore.updateProject(renameTarget.value.id, { name: newName })
    toast.success('重命名成功')
    showRenameModal.value = false
  } catch (e: any) {
    toast.error('重命名失败', e?.message || '请稍后重试')
  } finally {
    isRenaming.value = false
  }
}

// ---------- Delete ----------
const showDeleteModal = ref(false)
const deleteTarget = ref<{ id: string; name: string } | null>(null)
const deleteConfirmText = ref('')
const isDeleting = ref(false)

function openDelete(projectId: string, projectName: string) {
  closeDropdown()
  deleteTarget.value = { id: projectId, name: projectName }
  deleteConfirmText.value = ''
  showDeleteModal.value = true
}

const canConfirmDelete = computed(() =>
  deleteTarget.value &&
  deleteConfirmText.value.trim() === deleteTarget.value.name &&
  !isDeleting.value
)

async function confirmDelete() {
  if (!deleteTarget.value || !canConfirmDelete.value) return
  isDeleting.value = true
  try {
    const success = await projectStore.removeProject(deleteTarget.value.id)
    if (success) {
      toast.success('项目已删除')
      showDeleteModal.value = false
    } else {
      toast.error('删除失败')
    }
  } catch (e: any) {
    toast.error('删除失败', e?.message || '请稍后重试')
  } finally {
    isDeleting.value = false
  }
}

// ---------- Folder picker + batch create ----------
const showFolderPicker = ref(false)
const showBatchModal = ref(false)
const isBatchSubmitting = ref(false)

type BatchStatus = 'pending' | 'submitting' | 'success' | 'failed'
interface BatchRow {
  id: number
  name: string
  destPath: string
  env: string
  description: string
  status: BatchStatus
  errorMsg?: string
}

const batchRows = ref<BatchRow[]>([])
let batchRowSeq = 0

function basenameOf(p: string): string {
  const norm = p.replace(/[\\/]+$/, '')
  const segs = norm.split(/[\\/]/)
  return segs[segs.length - 1] || norm || 'project'
}

function openFolderPicker() {
  showFolderPicker.value = true
}

function onFolderPicked(paths: string[]) {
  batchRows.value = paths.map((p) => ({
    id: ++batchRowSeq,
    name: basenameOf(p),
    destPath: p,
    env: '',
    description: '',
    status: 'pending' as BatchStatus,
  }))
  showBatchModal.value = true
}

function addRowsFromPicker(paths: string[]) {
  const existPaths = new Set(batchRows.value.map((r) => r.destPath))
  for (const p of paths) {
    if (existPaths.has(p)) continue
    batchRows.value.push({
      id: ++batchRowSeq,
      name: basenameOf(p),
      destPath: p,
      env: '',
      description: '',
      status: 'pending',
    })
  }
}

const pickerForAppend = ref(false)
function openPickerForAppend() {
  pickerForAppend.value = true
  showFolderPicker.value = true
}

function onPickerConfirm(paths: string[]) {
  if (pickerForAppend.value) {
    addRowsFromPicker(paths)
    pickerForAppend.value = false
  } else {
    onFolderPicked(paths)
  }
}

function removeBatchRow(id: number) {
  batchRows.value = batchRows.value.filter((r) => r.id !== id)
}

const existingNames = computed(() => new Set(projectStore.projects.map((p) => p.name)))
const existingDeployPaths = computed(() => new Set(projectStore.projects.map((p) => p.destPath).filter(Boolean)))

const batchValidation = computed(() => {
  const seenNames = new Map<string, number>()
  const seenPaths = new Map<string, number>()
  const result = new Map<number, { name?: string; dest?: string }>()
  for (const r of batchRows.value) {
    const entry: { name?: string; dest?: string } = {}
    const name = r.name.trim()
    if (!name) {
      entry.name = '项目名不能为空'
    } else if (existingNames.value.has(name)) {
      entry.name = '与已有项目重名'
    } else if (seenNames.has(name)) {
      entry.name = '本次批量内重名'
    } else {
      seenNames.set(name, r.id)
    }
    const dp = r.destPath.trim()
    if (!dp) {
      entry.dest = '部署目录不能为空'
    } else if (existingDeployPaths.value.has(dp)) {
      entry.dest = '该部署目录已被其他项目占用'
    } else if (seenPaths.has(dp)) {
      entry.dest = '本次批量内部署目录重复'
    } else {
      seenPaths.set(dp, r.id)
    }
    if (entry.name || entry.dest) result.set(r.id, entry)
  }
  return result
})

const canSubmitBatch = computed(() => {
  if (batchRows.value.length === 0) return false
  if (isBatchSubmitting.value) return false
  if (batchValidation.value.size > 0) return false
  return true
})

const batchSummary = computed(() => {
  let success = 0, failed = 0, pending = 0
  for (const r of batchRows.value) {
    if (r.status === 'success') success++
    else if (r.status === 'failed') failed++
    else pending++
  }
  return { success, failed, pending, total: batchRows.value.length }
})

async function submitBatch() {
  if (!canSubmitBatch.value) return
  isBatchSubmitting.value = true
  try {
    for (const row of batchRows.value) {
      if (row.status === 'success') continue
      row.status = 'submitting'
      row.errorMsg = undefined
      const result = await projectStore.addProject({
        name: row.name.trim(),
        description: row.description?.trim() || undefined,
        destPath: row.destPath,
        env: row.env?.trim() || undefined,
      })
      if (result.ok) {
        row.status = 'success'
      } else {
        row.status = 'failed'
        row.errorMsg = result.conflictProject
          ? `部署目录已被项目「${result.conflictProject}」占用`
          : result.error || '创建失败'
      }
    }
    const { success, failed } = batchSummary.value
    if (failed === 0) {
      toast.success(`批量创建完成`, `成功 ${success} 个`)
      batchRows.value = []
      showBatchModal.value = false
    } else {
      toast.error(`部分创建失败`, `成功 ${success} 个，失败 ${failed} 个`)
    }
  } finally {
    isBatchSubmitting.value = false
  }
}

function closeBatchModal() {
  if (isBatchSubmitting.value) return
  showBatchModal.value = false
  batchRows.value = []
}
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-2xl font-bold text-textMain tracking-tight">项目管理</h1>
        <p class="text-textMuted text-sm mt-1">管理所有可部署的应用服务与脚本配置</p>
      </div>
      <div class="flex items-center space-x-2">
        <button
          @click="openFolderPicker"
          class="flex items-center px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all font-medium text-sm"
        >
          <FolderPlus class="w-4 h-4 mr-2" />
          选择文件夹新建
        </button>
        <button
          @click="showCreateModal = true"
          class="flex items-center px-4 py-2 border border-border hover:border-primary/50 text-textMain rounded-md transition-all font-medium text-sm"
        >
          <Plus class="w-4 h-4 mr-2" />
          手动填写
        </button>
      </div>
    </div>

    <!-- Project Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      <div
        v-for="project in projectStore.projects"
        :key="project.id"
        class="group bg-panel border border-border rounded-xl p-5 hover:border-primary/50 transition-all shadow-sm cursor-pointer relative overflow-hidden"
        @click="goToDetail(project.id)"
      >
        <div class="absolute top-0 left-0 w-1 h-full" :class="project.status === 'success' ? 'bg-success' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></div>
        
        <div class="flex justify-between items-start mb-4">
          <div class="flex items-center space-x-3">
            <div class="p-2 rounded-lg bg-base border border-border group-hover:border-primary/30 transition-colors">
              <Server class="w-5 h-5 text-textMain group-hover:text-primary transition-colors" />
            </div>
            <div>
              <h3 class="font-semibold text-textMain text-base">{{ project.name }}</h3>
              <p class="text-xs text-textMuted font-mono mt-0.5">{{ project.id }}</p>
            </div>
          </div>
          <div class="relative">
            <button class="p-1 dark:hover:bg-white/10 hover:bg-black/10 rounded-md transition-colors text-textMuted hover:text-textMain" @click.stop="toggleDropdown(project.id, $event)">
              <MoreVertical class="w-4 h-4" />
            </button>
          </div>
        </div>

        <p class="text-sm text-textMuted mb-5 line-clamp-2 min-h-[40px]">
          {{ project.description || '暂无描述' }}
        </p>

        <div class="flex items-center justify-between border-t border-border pt-4 text-xs text-textMuted">
          <div class="flex items-center">
            <Clock class="w-3.5 h-3.5 mr-1.5" />
            <span>{{ new Date(project.updatedAt).toLocaleDateString() }}</span>
          </div>
          <div class="flex items-center space-x-3">
            <button
              @click.stop="goToLogs(project.id)"
              class="flex items-center text-textMuted hover:text-primary transition-colors"
              title="查看部署日志"
            >
              <ScrollText class="w-3.5 h-3.5 mr-1" />
              <span>日志</span>
            </button>
            <span class="flex items-center" :class="project.status === 'success' ? 'text-success' : project.status === 'failed' ? 'text-danger' : 'text-primary'">
              <span class="w-2 h-2 rounded-full mr-1.5" :class="project.status === 'success' ? 'bg-success shadow-[0_0_8px_#10b981]' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></span>
              {{ project.status === 'success' ? '正常' : project.status === 'failed' ? '异常' : '空闲' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Card dropdown (teleported to body to avoid being clipped by card's overflow:hidden) -->
    <Teleport to="body">
      <transition name="fade">
        <div
          v-if="openDropdownId"
          class="bg-panel border border-border rounded-lg shadow-xl py-1"
          :style="{ ...dropdownStyle, zIndex: 60 }"
          @click.stop
        >
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click="(() => { const p = projectStore.projects.find(x => x.id === openDropdownId); if (p) openRename(p.id, p.name) })()"
          >
            <Pencil class="w-3.5 h-3.5 mr-2 text-textMuted" />
            重命名
          </button>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click.stop="(() => { const id = openDropdownId; closeDropdown(); if (id) goToFiles(id) })()"
          >
            <FolderOpen class="w-3.5 h-3.5 mr-2 text-textMuted" />
            查看文件
          </button>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click="(() => { const id = openDropdownId; closeDropdown(); if (id) goToLogs(id) })()"
          >
            <ScrollText class="w-3.5 h-3.5 mr-2 text-textMuted" />
            部署日志
          </button>
          <div class="border-t border-border my-1"></div>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-danger hover:bg-danger/10 transition-colors"
            @click="(() => { const p = projectStore.projects.find(x => x.id === openDropdownId); if (p) openDelete(p.id, p.name) })()"
          >
            <Trash2 class="w-3.5 h-3.5 mr-2" />
            删除项目
          </button>
        </div>
      </transition>
    </Teleport>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="bg-panel border border-border rounded-xl w-full max-w-md p-6 shadow-2xl transform transition-all">
        <h2 class="text-xl font-bold text-textMain mb-6">新建部署项目</h2>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">项目名称</label>
            <input 
              v-model="newProject.name"
              type="text" 
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              placeholder="e.g. Kite Web Frontend"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">部署目录绝对路径 (Destination Path)</label>
            <input
              v-model="newProject.destPath"
              type="text"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              placeholder="e.g. /var/www/my-project"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">部署环境标识 (可选)</label>
            <input
              v-model="newProject.env"
              type="text"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              placeholder="e.g. test, staging, prod"
            />
            <p class="text-xs text-textMuted mt-1.5">
              用于区分同一项目的不同部署环境。设置后，CLI 会生成 <code class="font-mono text-textMain">kite.config.{`{env}`}.json</code> 配置文件，
              <code class="font-mono text-textMain">kite push --env {`{name}`}</code> 可精准推送到对应环境。
              <span class="text-primary/80">常见场景：同一项目部署到测试/预发/生产等不同机器。</span>
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">描述 (可选)</label>
            <textarea
              v-model="newProject.description"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm h-24 resize-none"
              placeholder="简要描述项目的用途..."
            ></textarea>
          </div>
        </div>

        <div class="mt-8 flex justify-end space-x-3">
          <button 
            @click="showCreateModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
          >
            取消
          </button>
          <button 
            @click="createProject"
            :disabled="!newProject.name || !newProject.destPath"
            class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            确认创建
          </button>
        </div>
      </div>
    </div>

    <!-- Folder Picker Dialog -->
    <FolderPickerDialog
      v-model:open="showFolderPicker"
      mode="multi"
      title="选择部署目录"
      @confirm="onPickerConfirm"
    />

    <!-- Batch Create Modal -->
    <div v-if="showBatchModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" @click.self="closeBatchModal">
      <div class="bg-panel border border-border rounded-xl w-full max-w-6xl shadow-2xl flex flex-col" style="max-height: 85vh;">
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 class="text-xl font-bold text-textMain">批量创建部署项目</h2>
            <p class="text-xs text-textMuted mt-1">将创建 {{ batchRows.length }} 个项目，默认使用目录名作为项目名，可逐行修改</p>
          </div>
          <button @click="closeBatchModal" :disabled="isBatchSubmitting" class="text-textMuted hover:text-textMain p-1 disabled:opacity-40">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="px-6 py-3 border-b border-border bg-yellow-400/15 dark:bg-yellow-400/5 flex items-start space-x-2">
          <AlertTriangle class="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-yellow-800 dark:text-yellow-200/90">
            请确认所选目录用于部署。每次部署会在该目录下解压新构建产物，请勿选择关键系统目录或包含重要个人文件的目录。
          </p>
        </div>

        <div class="flex-1 overflow-auto px-2">
          <table class="w-full text-sm table-fixed">
            <thead class="text-xs text-textMuted sticky top-0 bg-panel">
              <tr class="border-b border-border">
                <th class="text-left font-medium px-3 py-2 w-[20%]">项目名</th>
                <th class="text-left font-medium px-3 py-2 w-[42%]">部署目录</th>
                <th class="text-left font-medium px-3 py-2 w-[14%]">环境标识</th>
                <th class="text-left font-medium px-3 py-2 w-[24%]">描述</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in batchRows"
                :key="row.id"
                class="border-b border-border/60 align-top"
                :class="row.status === 'success' ? 'opacity-60' : ''"
              >
                <td class="px-3 py-2">
                  <input
                    v-model="row.name"
                    type="text"
                    :disabled="row.status === 'success' || isBatchSubmitting"
                    class="w-full bg-base border rounded px-2 py-1.5 text-textMain text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
                    :class="batchValidation.get(row.id)?.name ? 'border-danger' : 'border-border focus:border-primary'"
                  />
                  <p v-if="batchValidation.get(row.id)?.name" class="text-[11px] text-danger mt-1">{{ batchValidation.get(row.id)?.name }}</p>
                </td>
                <td class="px-3 py-2">
                  <textarea
                    v-model="row.destPath"
                    rows="2"
                    spellcheck="false"
                    :disabled="row.status === 'success' || isBatchSubmitting"
                    class="w-full bg-base border rounded px-2 py-1.5 text-textMain font-mono text-xs leading-5 focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60 resize-y whitespace-pre-wrap break-all"
                    :class="batchValidation.get(row.id)?.dest ? 'border-danger' : 'border-border focus:border-primary'"
                    :title="row.destPath"
                  ></textarea>
                  <p v-if="batchValidation.get(row.id)?.dest" class="text-[11px] text-danger mt-1">{{ batchValidation.get(row.id)?.dest }}</p>
                  <p v-if="row.status === 'failed' && row.errorMsg" class="text-[11px] text-danger mt-1 break-all">{{ row.errorMsg }}</p>
                </td>
                <td class="px-3 py-2">
                  <input
                    v-model="row.env"
                    type="text"
                    placeholder="test/prod"
                    :disabled="row.status === 'success' || isBatchSubmitting"
                    class="w-full bg-base border border-border rounded px-2 py-1.5 text-textMain font-mono text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
                  />
                </td>
                <td class="px-3 py-2">
                  <div class="flex items-start gap-2">
                    <input
                      v-model="row.description"
                      type="text"
                      placeholder="可选"
                      :disabled="row.status === 'success' || isBatchSubmitting"
                      class="flex-1 min-w-0 bg-base border border-border rounded px-2 py-1.5 text-textMain text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
                    />
                    <button
                      v-if="row.status !== 'success'"
                      @click="removeBatchRow(row.id)"
                      :disabled="isBatchSubmitting"
                      class="shrink-0 mt-1.5 text-textMuted hover:text-danger disabled:opacity-40"
                      title="移除该行"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="batchRows.length === 0">
                <td colspan="4" class="px-3 py-8 text-center text-textMuted text-sm">没有待创建的项目</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex items-center justify-between px-6 py-4 border-t border-border">
          <div class="flex items-center space-x-3">
            <button
              @click="openPickerForAppend"
              :disabled="isBatchSubmitting"
              class="flex items-center px-3 py-1.5 text-xs border border-border rounded-md text-textMuted hover:text-textMain disabled:opacity-40"
            >
              <FolderPlus class="w-3.5 h-3.5 mr-1.5" /> 继续添加
            </button>
            <div class="text-xs text-textMuted">
              共 {{ batchSummary.total }} · 待提交 {{ batchSummary.pending }} · 成功 {{ batchSummary.success }} · 失败 {{ batchSummary.failed }}
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <button
              @click="closeBatchModal"
              :disabled="isBatchSubmitting"
              class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50"
            >{{ batchSummary.success > 0 ? '完成' : '取消' }}</button>
            <button
              @click="submitBatch"
              :disabled="!canSubmitBatch"
              class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <RefreshCw v-if="isBatchSubmitting" class="w-4 h-4 mr-2 animate-spin" />
              {{ isBatchSubmitting ? '提交中…' : `提交（${batchSummary.pending}）` }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Dropdown click-outside overlay -->
    <Teleport to="body">
      <div
        v-if="openDropdownId"
        class="fixed inset-0"
        style="z-index: 55"
        @click="closeDropdown"
      ></div>
    </Teleport>

    <!-- Rename Modal -->
    <div
      v-if="showRenameModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="showRenameModal = false"
    >
      <div class="bg-panel border border-border rounded-xl w-full max-w-md p-6 shadow-2xl">
        <h2 class="text-lg font-semibold text-textMain mb-4">重命名项目</h2>
        <div>
          <label class="block text-sm font-medium text-textMuted mb-1.5">项目名称</label>
          <input
            v-model="renameInput"
            type="text"
            :disabled="isRenaming"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm disabled:opacity-60"
            placeholder="输入新的项目名称"
            @keydown.enter.prevent="confirmRename"
          />
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button
            @click="showRenameModal = false"
            :disabled="isRenaming"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50"
          >取消</button>
          <button
            @click="confirmRename"
            :disabled="isRenaming || !renameInput.trim() || renameInput.trim() === renameTarget?.name"
            class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isRenaming" class="w-4 h-4 mr-2 animate-spin" />
            确认
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Modal -->
    <div
      v-if="showDeleteModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="!isDeleting && (showDeleteModal = false)"
    >
      <div class="bg-panel border border-danger/30 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div class="flex items-start space-x-3 mb-5">
          <div class="p-2 rounded-lg bg-danger/10 border border-danger/20 shrink-0">
            <AlertTriangle class="w-5 h-5 text-danger" />
          </div>
          <div>
            <h2 class="text-lg font-semibold text-textMain">确认删除项目</h2>
            <p class="text-sm text-textMuted mt-1">
              即将删除项目
              <span class="font-mono text-textMain">{{ deleteTarget?.name }}</span>，
              此操作不可恢复。
            </p>
          </div>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-textMuted mb-1.5">
            请输入项目名称 <span class="font-mono text-textMain">{{ deleteTarget?.name }}</span> 以确认删除
          </label>
          <input
            v-model="deleteConfirmText"
            type="text"
            :disabled="isDeleting"
            :placeholder="deleteTarget?.name"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-danger focus:ring-1 focus:ring-danger/50 transition-all text-sm disabled:opacity-60"
            @keydown.enter.prevent="confirmDelete"
          />
        </div>

        <div class="flex justify-end space-x-3">
          <button
            @click="showDeleteModal = false"
            :disabled="isDeleting"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50"
          >取消</button>
          <button
            @click="confirmDelete"
            :disabled="!canConfirmDelete"
            class="px-4 py-2 text-sm font-medium bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isDeleting" class="w-4 h-4 mr-2 animate-spin" />
            <Trash2 v-else class="w-4 h-4 mr-2" />
            {{ isDeleting ? '正在删除...' : '永久删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.12s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
