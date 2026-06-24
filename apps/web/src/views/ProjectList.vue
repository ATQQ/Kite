<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import type { Category, Tag as TagType } from '../store/project'
import { Plus, MoreVertical, Server, Clock, ScrollText, FolderPlus, Trash2, RefreshCw, XCircle, AlertTriangle, Pencil, FolderOpen, LayoutGrid, List as ListIcon, Tag, FolderTree, ChevronRight, Tags as TagsIcon, X as XIcon, Activity } from 'lucide-vue-next'
import { useToast } from '../composables/useToast'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import ProjectTagsEditor from '../components/ProjectTagsEditor.vue'
import { CHIP_COLOR_PALETTE, chipClass as tagChipClass, pickFreeColor as pickFreeChipColor } from '../utils/color-chip'

const projectStore = useProjectStore()
const router = useRouter()
const toast = useToast()

const VIEW_KEY = 'kite:projectList:viewMode'
const viewMode = ref<'card' | 'list'>(((): 'card' | 'list' => {
  const v = localStorage.getItem(VIEW_KEY)
  return v === 'list' ? 'list' : 'card'
})())
watch(viewMode, (v) => localStorage.setItem(VIEW_KEY, v))

const selectedCategoryFilter = ref<string>('all') // 'all' | 'default' | <categoryId>
const selectedEnvFilter = ref<string>('all') // 'all' | 'default'(no env) | <envName>
const selectedTagIds = ref<string[]>([])

onMounted(() => {
  projectStore.fetchProjects()
  projectStore.fetchCategories()
  projectStore.fetchTags()
})

const categoryMap = computed<Map<string, Category>>(() => {
  const m = new Map<string, Category>()
  for (const c of projectStore.categories) m.set(c.id, c)
  return m
})

const filteredProjects = computed(() => {
  const list = projectStore.projects
  const tagIds = selectedTagIds.value
  return list.filter((p) => {
    if (selectedCategoryFilter.value === 'default') {
      if (p.categoryId) return false
    } else if (selectedCategoryFilter.value !== 'all') {
      if (p.categoryId !== selectedCategoryFilter.value) return false
    }
    const env = (p.env || '').trim()
    if (selectedEnvFilter.value === 'default') {
      if (env) return false
    } else if (selectedEnvFilter.value !== 'all') {
      if (env !== selectedEnvFilter.value) return false
    }
    if (tagIds.length > 0) {
      const projectTagIds = p.tagIds || []
      for (const id of tagIds) {
        if (!projectTagIds.includes(id)) return false
      }
    }
    return true
  })
})

const projectCountByCategory = computed(() => {
  const m: Record<string, number> = { all: projectStore.projects.length, default: 0 }
  for (const c of projectStore.categories) m[c.id] = 0
  for (const p of projectStore.projects) {
    if (!p.categoryId || !m.hasOwnProperty(p.categoryId)) m.default++
    else m[p.categoryId]++
  }
  return m
})

const envOptions = computed<string[]>(() => {
  const set = new Set<string>()
  for (const p of projectStore.projects) {
    const env = (p.env || '').trim()
    if (env) set.add(env)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
})

const projectCountByEnv = computed(() => {
  const m: Record<string, number> = { all: projectStore.projects.length, default: 0 }
  for (const env of envOptions.value) m[env] = 0
  for (const p of projectStore.projects) {
    const env = (p.env || '').trim()
    if (!env) m.default++
    else m[env] = (m[env] || 0) + 1
  }
  return m
})

watch([envOptions, projectCountByEnv], () => {
  const v = selectedEnvFilter.value
  if (v === 'all') return
  if (v === 'default') {
    if (projectCountByEnv.value.default === 0) selectedEnvFilter.value = 'all'
    return
  }
  if (!envOptions.value.includes(v)) selectedEnvFilter.value = 'all'
})

const categoryColorClass: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  green: 'bg-green-500/15 text-green-500 border-green-500/30',
  yellow: 'bg-yellow-500/15 text-yellow-500 border-yellow-500/30',
  purple: 'bg-purple-500/15 text-purple-500 border-purple-500/30',
  pink: 'bg-pink-500/15 text-pink-500 border-pink-500/30',
  cyan: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',
  gray: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}
function categoryChipClass(color?: string | null) {
  if (color && categoryColorClass[color]) return categoryColorClass[color]
  return 'bg-base text-textMuted border-border'
}

const ENV_COLOR_PALETTE = ['blue', 'green', 'yellow', 'purple', 'pink', 'cyan', 'gray'] as const
function envChipClass(env?: string | null): string {
  const key = (env || '').trim().toLowerCase()
  if (!key) return 'bg-base text-textMuted border-border'
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  const color = ENV_COLOR_PALETTE[hash % ENV_COLOR_PALETTE.length]
  return categoryColorClass[color]
}

function categoryNameOf(categoryId?: string | null): string {
  if (!categoryId) return '默认'
  return categoryMap.value.get(categoryId)?.name ?? '默认'
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '从未部署'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diff = Date.now() - t
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  return new Date(iso).toLocaleDateString()
}

const showCreateModal = ref(false)
const newProject = ref({ name: '', description: '', destPath: '', env: '', categoryId: '' as string, tagIds: [] as string[] })

const createProject = async () => {
  if (!newProject.value.name || !newProject.value.destPath) return
  const result = await projectStore.addProject({
    name: newProject.value.name,
    description: newProject.value.description,
    destPath: newProject.value.destPath,
    env: newProject.value.env,
    categoryId: newProject.value.categoryId || null,
    tagIds: newProject.value.tagIds.length > 0 ? [...newProject.value.tagIds] : undefined,
  })
  if (result.ok) {
    showCreateModal.value = false
    newProject.value = { name: '', description: '', destPath: '', env: '', categoryId: '', tagIds: [] }
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

const goToRunLogs = (id: string) => {
  router.push(`/projects/${id}/logs`)
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
  moveSubmenuOpen.value = false
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
  categoryId: string
  tagIds: string[]
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
    categoryId: selectedCategoryFilter.value && selectedCategoryFilter.value !== 'all' && selectedCategoryFilter.value !== 'default'
      ? selectedCategoryFilter.value
      : '',
    tagIds: selectedTagIds.value.length > 0 ? [...selectedTagIds.value] : [],
    status: 'pending' as BatchStatus,
  }))
  showBatchModal.value = true
  projectStore.fetchCategories()
  projectStore.fetchTags()
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
      categoryId: '',
      tagIds: [],
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
        categoryId: row.categoryId || null,
        tagIds: row.tagIds.length > 0 ? [...row.tagIds] : undefined,
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

// ---------- Move to category ----------
const moveSubmenuOpen = ref(false)
const isMovingCategory = ref(false)

function openMoveSubmenu(e: Event) {
  e.stopPropagation()
  moveSubmenuOpen.value = !moveSubmenuOpen.value
}

async function moveProjectToCategory(projectId: string, categoryId: string | null) {
  if (isMovingCategory.value) return
  isMovingCategory.value = true
  try {
    await projectStore.updateProject(projectId, { categoryId })
    const name = categoryId ? (categoryMap.value.get(categoryId)?.name ?? '分类') : '默认'
    toast.success(`已移动到「${name}」`)
    moveSubmenuOpen.value = false
    closeDropdown()
  } catch (e: any) {
    toast.error('移动失败', e?.message || '请稍后重试')
  } finally {
    isMovingCategory.value = false
  }
}

// ---------- Manage categories modal ----------
const showCategoryModal = ref(false)
const newCategoryName = ref('')
const isCreatingCategory = ref(false)
const editingCategoryId = ref<string | null>(null)
const editCategoryName = ref('')
const isSavingCategory = ref(false)
const deletingCategoryId = ref<string | null>(null)

const ALL_COLORS = ['blue', 'green', 'yellow', 'purple', 'pink', 'cyan', 'gray']

function pickFreeColor(excludeId?: string | null): string {
  const used = new Set<string>()
  for (const c of projectStore.categories) {
    if (excludeId && c.id === excludeId) continue
    if (c.color) used.add(c.color)
  }
  for (const color of ALL_COLORS) {
    if (!used.has(color)) return color
  }
  return ALL_COLORS[projectStore.categories.length % ALL_COLORS.length]
}

function openCategoryModal() {
  showCategoryModal.value = true
  newCategoryName.value = ''
  editingCategoryId.value = null
  projectStore.fetchCategories()
}

async function submitCreateCategory() {
  const name = newCategoryName.value.trim()
  if (!name) return
  isCreatingCategory.value = true
  try {
    const res = await projectStore.createCategory({ name, color: pickFreeColor() })
    if (res.ok) {
      toast.success('分类创建成功')
      newCategoryName.value = ''
    } else {
      toast.error('创建失败', res.conflictCategory ? `分类名「${res.conflictCategory}」已存在` : res.error || '请稍后重试')
    }
  } finally {
    isCreatingCategory.value = false
  }
}

function startEditCategory(c: Category) {
  editingCategoryId.value = c.id
  editCategoryName.value = c.name
}

function cancelEditCategory() {
  editingCategoryId.value = null
  editCategoryName.value = ''
}

async function submitEditCategory() {
  if (!editingCategoryId.value) return
  const name = editCategoryName.value.trim()
  if (!name) return
  isSavingCategory.value = true
  try {
    const res = await projectStore.updateCategory(editingCategoryId.value, { name })
    if (res.ok) {
      toast.success('分类已更新')
      cancelEditCategory()
    } else {
      toast.error('更新失败', res.conflictCategory ? `分类名「${res.conflictCategory}」已存在` : res.error || '请稍后重试')
    }
  } finally {
    isSavingCategory.value = false
  }
}

async function deleteCategoryAction(c: Category) {
  if (deletingCategoryId.value) return
  const count = projectCountByCategory.value[c.id] || 0
  const ok = window.confirm(
    count > 0
      ? `分类「${c.name}」下还有 ${count} 个项目，删除后这些项目会回落到默认。是否继续？`
      : `确认删除分类「${c.name}」？`
  )
  if (!ok) return
  deletingCategoryId.value = c.id
  try {
    const res = await projectStore.deleteCategory(c.id)
    if (res.ok) {
      toast.success('分类已删除', res.detachedProjects ? `${res.detachedProjects} 个项目已回落到默认` : undefined)
      if (selectedCategoryFilter.value === c.id) selectedCategoryFilter.value = 'all'
    } else {
      toast.error('删除失败', res.error || '请稍后重试')
    }
  } finally {
    deletingCategoryId.value = null
  }
}

// ---------- Tag helpers ----------
function toggleTagFilter(id: string) {
  const idx = selectedTagIds.value.indexOf(id)
  if (idx === -1) selectedTagIds.value = [...selectedTagIds.value, id]
  else selectedTagIds.value = selectedTagIds.value.filter((x) => x !== id)
}

function clearTagFilters() {
  selectedTagIds.value = []
}

// 卡片 / 行内直接编辑标签：本地乐观更新 + 调用 store 持久化
async function persistProjectTags(projectId: string, next: string[]) {
  const target = projectStore.projects.find((p) => p.id === projectId)
  if (target) target.tagIds = [...next]
  try {
    await projectStore.updateProject(projectId, { tagIds: [...next] })
  } catch (e: any) {
    toast.error('保存标签失败', e?.message || '请稍后重试')
  }
}

function toggleTagOnForm(target: { tagIds: string[] }, id: string) {
  const idx = target.tagIds.indexOf(id)
  if (idx === -1) target.tagIds = [...target.tagIds, id]
  else target.tagIds = target.tagIds.filter((x) => x !== id)
}

// ---------- Manage tags modal ----------
const showTagModal = ref(false)
const newTagName = ref('')
const isCreatingTag = ref(false)
const editingTagId = ref<string | null>(null)
const editTagName = ref('')
const isSavingTag = ref(false)
const deletingTagId = ref<string | null>(null)

function openTagModal() {
  showTagModal.value = true
  newTagName.value = ''
  editingTagId.value = null
  projectStore.fetchTags()
}

async function submitCreateTag() {
  const name = newTagName.value.trim()
  if (!name) return
  isCreatingTag.value = true
  try {
    const color = pickFreeChipColor(projectStore.tags)
    const res = await projectStore.createTag({ name, color })
    if (res.ok) {
      toast.success('标签创建成功')
      newTagName.value = ''
    } else {
      toast.error('创建失败', res.conflictTag ? `标签名「${res.conflictTag}」已存在` : res.error || '请稍后重试')
    }
  } finally {
    isCreatingTag.value = false
  }
}

function startEditTag(t: TagType) {
  editingTagId.value = t.id
  editTagName.value = t.name
}

function cancelEditTag() {
  editingTagId.value = null
  editTagName.value = ''
}

async function submitEditTag() {
  if (!editingTagId.value) return
  const name = editTagName.value.trim()
  if (!name) return
  isSavingTag.value = true
  try {
    const res = await projectStore.updateTag(editingTagId.value, { name })
    if (res.ok) {
      toast.success('标签已更新')
      cancelEditTag()
    } else {
      toast.error('更新失败', res.conflictTag ? `标签名「${res.conflictTag}」已存在` : res.error || '请稍后重试')
    }
  } finally {
    isSavingTag.value = false
  }
}

async function changeTagColor(t: TagType, color: string) {
  const res = await projectStore.updateTag(t.id, { color })
  if (!res.ok) toast.error('更新失败', res.error || '请稍后重试')
}

async function deleteTagAction(t: TagType) {
  if (deletingTagId.value) return
  const count = t.projectCount || 0
  const ok = window.confirm(
    count > 0
      ? `标签「${t.name}」当前关联了 ${count} 个项目，删除后这些关联会被解除。是否继续？`
      : `确认删除标签「${t.name}」？`
  )
  if (!ok) return
  deletingTagId.value = t.id
  try {
    const res = await projectStore.deleteTag(t.id)
    if (res.ok) {
      toast.success('标签已删除', res.detachedProjects ? `${res.detachedProjects} 个项目已解除关联` : undefined)
      selectedTagIds.value = selectedTagIds.value.filter((x) => x !== t.id)
    } else {
      toast.error('删除失败', res.error || '请稍后重试')
    }
  } finally {
    deletingTagId.value = null
  }
}
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-8">
      <div>
        <h1 class="text-2xl font-bold text-textMain tracking-tight">项目管理</h1>
        <p class="text-textMuted text-sm mt-1">管理所有可部署的应用服务与脚本配置</p>
      </div>
      <div class="flex items-center flex-wrap gap-2">
        <div class="flex items-center border border-border rounded-md overflow-hidden">
          <button
            @click="viewMode = 'card'"
            :class="viewMode === 'card' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors"
            title="卡片视图"
          >
            <LayoutGrid class="w-3.5 h-3.5" />
          </button>
          <button
            @click="viewMode = 'list'"
            :class="viewMode === 'list' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors border-l border-border"
            title="列表视图"
          >
            <ListIcon class="w-3.5 h-3.5" />
          </button>
        </div>
        <button
          @click="openCategoryModal"
          class="flex items-center px-3 py-2 border border-border hover:border-primary/50 text-textMain rounded-md transition-all font-medium text-sm"
          title="管理分类"
        >
          <FolderTree class="w-4 h-4 mr-2" />
          管理分类
        </button>
        <button
          @click="openTagModal"
          class="flex items-center px-3 py-2 border border-border hover:border-primary/50 text-textMain rounded-md transition-all font-medium text-sm"
          title="管理标签"
        >
          <TagsIcon class="w-4 h-4 mr-2" />
          管理标签
        </button>
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
          新建项目
        </button>
      </div>
    </div>

    <!-- Category filter chips -->
    <div class="flex items-center flex-wrap gap-2">
      <span class="text-xs text-textMuted/80 mr-1 shrink-0">分类</span>
      <button
        @click="selectedCategoryFilter = 'all'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedCategoryFilter === 'all' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
      >
        全部
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByCategory.all }}</span>
      </button>
      <button
        @click="selectedCategoryFilter = 'default'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedCategoryFilter === 'default' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
      >
        默认
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByCategory.default }}</span>
      </button>
      <button
        v-for="c in projectStore.categories"
        :key="c.id"
        @click="selectedCategoryFilter = c.id"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedCategoryFilter === c.id ? 'bg-primary/15 text-primary border-primary/40' : `${categoryChipClass(c.color)} hover:opacity-90`"
      >
        <Tag class="w-3 h-3 mr-1.5" />
        {{ c.name }}
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByCategory[c.id] || 0 }}</span>
      </button>
    </div>

    <!-- Environment filter chips -->
    <div v-if="envOptions.length > 0" class="flex items-center flex-wrap gap-2">
      <span class="text-xs text-textMuted/80 mr-1 shrink-0">环境</span>
      <button
        @click="selectedEnvFilter = 'all'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedEnvFilter === 'all' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
      >
        全部
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByEnv.all }}</span>
      </button>
      <button
        v-if="projectCountByEnv.default > 0"
        @click="selectedEnvFilter = 'default'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedEnvFilter === 'default' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
        title="未指定环境的项目"
      >
        未指定
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByEnv.default }}</span>
      </button>
      <button
        v-for="env in envOptions"
        :key="env"
        @click="selectedEnvFilter = env"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors font-mono"
        :class="selectedEnvFilter === env ? 'bg-primary/15 text-primary border-primary/40' : `${envChipClass(env)} hover:opacity-90`"
      >
        {{ env }}
        <span class="ml-1.5 text-[10px] opacity-75 font-sans">{{ projectCountByEnv[env] || 0 }}</span>
      </button>
    </div>

    <!-- Tag filter chips (multi-select AND) -->
    <div v-if="projectStore.tags.length > 0" class="flex items-center flex-wrap gap-2">
      <span class="text-xs text-textMuted/80 mr-1 shrink-0">标签</span>
      <button
        v-for="t in projectStore.tags"
        :key="t.id"
        @click="toggleTagFilter(t.id)"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedTagIds.includes(t.id) ? `${tagChipClass(t.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain hover:border-textMuted/40'"
        :title="selectedTagIds.includes(t.id) ? '点击取消该标签筛选' : '点击叠加该标签筛选（多选为「与」逻辑）'"
      >
        <Tag class="w-3 h-3 mr-1.5" />
        {{ t.name }}
        <span v-if="t.projectCount != null" class="ml-1.5 text-[10px] opacity-75">{{ t.projectCount }}</span>
      </button>
      <button
        v-if="selectedTagIds.length > 0"
        @click="clearTagFilters"
        class="flex items-center px-2 py-1.5 rounded-full text-[11px] text-textMuted hover:text-textMain transition-colors"
        title="清空标签筛选"
      >
        <XIcon class="w-3 h-3 mr-1" /> 清空
      </button>
    </div>

    <!-- Card view -->
    <div v-if="viewMode === 'card'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
      <div
        v-for="project in filteredProjects"
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

        <p class="text-sm text-textMuted mb-3 line-clamp-2 min-h-[40px]">
          {{ project.description || '暂无描述' }}
        </p>

        <div class="flex items-center flex-wrap gap-1.5 mb-3">
          <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border" :class="categoryChipClass(categoryMap.get(project.categoryId || '')?.color)">
            <Tag class="w-3 h-3 mr-1" />
            {{ categoryNameOf(project.categoryId) }}
          </span>
          <span v-if="project.env" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border font-mono" :class="envChipClass(project.env)">{{ project.env }}</span>
          <ProjectTagsEditor
            :model-value="project.tagIds || []"
            size="sm"
            :on-persist="(next) => persistProjectTags(project.id, next)"
            :aria-label="`编辑「${project.name}」的标签`"
          />
        </div>

        <div class="flex items-center justify-between border-t border-border pt-4 text-xs text-textMuted">
          <div class="flex items-center" :title="project.lastDeployAt ? new Date(project.lastDeployAt).toLocaleString() : '从未部署'">
            <Clock class="w-3.5 h-3.5 mr-1.5" />
            <span>{{ formatRelativeTime(project.lastDeployAt) }}</span>
          </div>
          <div class="flex items-center space-x-3">
            <button
              @click.stop="goToLogs(project.id)"
              class="flex items-center text-textMuted hover:text-primary transition-colors"
              title="查看部署日志"
            >
              <ScrollText class="w-3.5 h-3.5 mr-1" />
              <span>部署日志</span>
            </button>
            <button
              @click.stop="goToRunLogs(project.id)"
              class="flex items-center text-textMuted hover:text-primary transition-colors"
              title="查看运行日志"
            >
              <Activity class="w-3.5 h-3.5 mr-1" />
              <span>运行日志</span>
            </button>
            <span class="flex items-center" :class="project.status === 'success' ? 'text-success' : project.status === 'failed' ? 'text-danger' : 'text-primary'">
              <span class="w-2 h-2 rounded-full mr-1.5" :class="project.status === 'success' ? 'bg-success shadow-[0_0_8px_#10b981]' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></span>
              {{ project.status === 'success' ? '正常' : project.status === 'failed' ? '异常' : '空闲' }}
            </span>
          </div>
        </div>
      </div>
      <div v-if="filteredProjects.length === 0" class="col-span-full text-center py-16 text-textMuted text-sm">
        当前分类下没有项目
      </div>
    </div>

    <!-- List view -->
    <div v-else class="bg-panel border border-border rounded-xl overflow-hidden">
      <div class="overflow-x-auto">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="text-xs text-textMuted bg-base/40">
          <tr>
            <th class="text-left font-medium px-4 py-3">项目名</th>
            <th class="text-left font-medium px-4 py-3">部署目录</th>
            <th class="text-left font-medium px-4 py-3 w-28">分类</th>
            <th class="text-left font-medium px-4 py-3 w-24">环境</th>
            <th class="text-left font-medium px-4 py-3 w-36">上次部署</th>
            <th class="text-left font-medium px-4 py-3 w-20">状态</th>
            <th class="text-right font-medium px-4 py-3 w-12"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="project in filteredProjects"
            :key="project.id"
            class="border-t border-border hover:bg-white/5 cursor-pointer"
            @click="goToDetail(project.id)"
          >
            <td class="px-4 py-3">
              <div class="flex items-center space-x-2">
                <Server class="w-4 h-4 text-textMuted" />
                <div>
                  <div class="text-textMain font-medium">{{ project.name }}</div>
                  <div class="text-[11px] text-textMuted font-mono">{{ project.id }}</div>
                </div>
              </div>
            </td>
            <td class="px-4 py-3 text-textMuted font-mono text-xs break-all max-w-xs">{{ project.destPath || '—' }}</td>
            <td class="px-4 py-3">
              <div class="flex items-center flex-wrap gap-1">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border" :class="categoryChipClass(categoryMap.get(project.categoryId || '')?.color)">
                  <Tag class="w-3 h-3 mr-1" />
                  {{ categoryNameOf(project.categoryId) }}
                </span>
                <ProjectTagsEditor
                  :model-value="project.tagIds || []"
                  size="sm"
                  :on-persist="(next) => persistProjectTags(project.id, next)"
                  :aria-label="`编辑「${project.name}」的标签`"
                />
              </div>
            </td>
            <td class="px-4 py-3">
              <span v-if="project.env" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border font-mono" :class="envChipClass(project.env)">{{ project.env }}</span>
              <span v-else class="text-textMuted text-xs">—</span>
            </td>
            <td class="px-4 py-3 text-textMuted text-xs" :title="project.lastDeployAt ? new Date(project.lastDeployAt).toLocaleString() : '从未部署'">
              {{ formatRelativeTime(project.lastDeployAt) }}
            </td>
            <td class="px-4 py-3">
              <span class="inline-flex items-center text-xs" :class="project.status === 'success' ? 'text-success' : project.status === 'failed' ? 'text-danger' : 'text-primary'">
                <span class="w-2 h-2 rounded-full mr-1.5" :class="project.status === 'success' ? 'bg-success' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></span>
                {{ project.status === 'success' ? '正常' : project.status === 'failed' ? '异常' : '空闲' }}
              </span>
            </td>
            <td class="px-4 py-3 text-right">
              <button class="p-1 dark:hover:bg-white/10 hover:bg-black/10 rounded-md text-textMuted hover:text-textMain" @click.stop="toggleDropdown(project.id, $event)">
                <MoreVertical class="w-4 h-4" />
              </button>
            </td>
          </tr>
          <tr v-if="filteredProjects.length === 0">
            <td colspan="7" class="px-4 py-12 text-center text-textMuted text-sm">当前分类下没有项目</td>
          </tr>
        </tbody>
      </table>
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
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click="(() => { const id = openDropdownId; closeDropdown(); if (id) goToRunLogs(id) })()"
          >
            <Activity class="w-3.5 h-3.5 mr-2 text-textMuted" />
            运行日志
          </button>
          <div class="border-t border-border my-1"></div>
          <div class="relative">
            <button
              class="flex items-center justify-between w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
              @click="openMoveSubmenu($event)"
            >
              <span class="flex items-center">
                <FolderTree class="w-3.5 h-3.5 mr-2 text-textMuted" />
                移动到分类
              </span>
              <ChevronRight class="w-3.5 h-3.5 text-textMuted" />
            </button>
            <div
              v-if="moveSubmenuOpen"
              class="absolute top-0 right-full mr-1 bg-panel border border-border rounded-lg shadow-xl py-1 min-w-[160px] max-h-64 overflow-auto"
              style="z-index: 61"
              @click.stop
            >
              <button
                class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
                :disabled="isMovingCategory"
                @click="openDropdownId && moveProjectToCategory(openDropdownId, null)"
              >
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border bg-base text-textMuted border-border">默认</span>
              </button>
              <button
                v-for="c in projectStore.categories"
                :key="c.id"
                class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
                :disabled="isMovingCategory"
                @click="openDropdownId && moveProjectToCategory(openDropdownId, c.id)"
              >
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border" :class="categoryChipClass(c.color)">
                  <Tag class="w-3 h-3 mr-1" />{{ c.name }}
                </span>
              </button>
              <div v-if="projectStore.categories.length === 0" class="px-3 py-2 text-xs text-textMuted">
                还没有分类，请先在「管理分类」中创建
              </div>
            </div>
          </div>
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
    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div class="bg-panel border border-border rounded-xl w-full max-w-md p-6 shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto">
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
            <label class="block text-sm font-medium text-textMuted mb-1.5">分类 (可选)</label>
            <select
              v-model="newProject.categoryId"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
            >
              <option value="">默认</option>
              <option v-for="c in projectStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">标签 (可选，可多选)</label>
            <div v-if="projectStore.tags.length === 0" class="text-xs text-textMuted">
              还没有标签，可前往「管理标签」创建。
            </div>
            <div v-else class="flex items-center flex-wrap gap-1.5">
              <button
                v-for="t in projectStore.tags"
                :key="t.id"
                type="button"
                @click="toggleTagOnForm(newProject, t.id)"
                class="inline-flex items-center px-2 py-1 rounded text-[11px] border transition-colors"
                :class="newProject.tagIds.includes(t.id) ? 'bg-primary/15 text-primary border-primary/40' : `${tagChipClass(t.color)} hover:opacity-90`"
              >
                <Tag class="w-3 h-3 mr-1" />
                {{ t.name }}
              </button>
            </div>
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
    <div v-if="showBatchModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" @click.self="closeBatchModal">
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
                <th class="text-left font-medium px-3 py-2 w-[16%]">项目名</th>
                <th class="text-left font-medium px-3 py-2 w-[30%]">部署目录</th>
                <th class="text-left font-medium px-3 py-2 w-[10%]">环境标识</th>
                <th class="text-left font-medium px-3 py-2 w-[12%]">分类</th>
                <th class="text-left font-medium px-3 py-2 w-[16%]">标签</th>
                <th class="text-left font-medium px-3 py-2 w-[16%]">描述</th>
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
                  <select
                    v-model="row.categoryId"
                    :disabled="row.status === 'success' || isBatchSubmitting"
                    class="w-full bg-base border border-border rounded px-2 py-1.5 text-textMain text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
                  >
                    <option value="">默认</option>
                    <option v-for="c in projectStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </td>
                <td class="px-3 py-2">
                  <div v-if="projectStore.tags.length === 0" class="text-[11px] text-textMuted">无</div>
                  <div v-else class="flex items-center flex-wrap gap-1">
                    <button
                      v-for="t in projectStore.tags"
                      :key="t.id"
                      type="button"
                      :disabled="row.status === 'success' || isBatchSubmitting"
                      @click="toggleTagOnForm(row, t.id)"
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border transition-colors disabled:opacity-60"
                      :class="row.tagIds.includes(t.id) ? 'bg-primary/15 text-primary border-primary/40' : `${tagChipClass(t.color)} hover:opacity-90`"
                    >
                      {{ t.name }}
                    </button>
                  </div>
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
                <td colspan="6" class="px-3 py-8 text-center text-textMuted text-sm">没有待创建的项目</td>
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
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showRenameModal = false"
    >
      <div class="bg-panel border border-border rounded-xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="!isDeleting && (showDeleteModal = false)"
    >
      <div class="bg-panel border border-danger/30 rounded-xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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

    <!-- Manage Categories Modal -->
    <div
      v-if="showCategoryModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showCategoryModal = false"
    >
      <div class="bg-panel border border-border rounded-xl w-full max-w-2xl shadow-2xl flex flex-col" style="max-height: 85vh;">
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 class="text-xl font-bold text-textMain">管理分类</h2>
            <p class="text-xs text-textMuted mt-1">创建、编辑、删除分类。删除分类后，相关项目将回落到「默认」。</p>
          </div>
          <button @click="showCategoryModal = false" class="text-textMuted hover:text-textMain p-1">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="px-6 py-4 border-b border-border">
          <label class="block text-sm font-medium text-textMuted mb-2">新建分类</label>
          <div class="flex items-center gap-2">
            <input
              v-model="newCategoryName"
              type="text"
              placeholder="如：前端 / 后端 / 测试环境"
              :disabled="isCreatingCategory"
              class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm disabled:opacity-60"
              @keydown.enter.prevent="submitCreateCategory"
            />
            <button
              @click="submitCreateCategory"
              :disabled="isCreatingCategory || !newCategoryName.trim()"
              class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <RefreshCw v-if="isCreatingCategory" class="w-4 h-4 mr-2 animate-spin" />
              <Plus v-else class="w-4 h-4 mr-1" />
              新建
            </button>
          </div>
          <p class="text-xs text-textMuted mt-2">颜色将自动分配，不同分类之间不重复。</p>
        </div>

        <div class="flex-1 overflow-auto px-6 py-4">
          <div v-if="projectStore.categories.length === 0" class="text-center py-8 text-textMuted text-sm">
            还没有分类，新建一个吧
          </div>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="c in projectStore.categories"
              :key="c.id"
              class="py-3 flex items-center justify-between gap-3"
            >
              <template v-if="editingCategoryId === c.id">
                <input
                  v-model="editCategoryName"
                  type="text"
                  :disabled="isSavingCategory"
                  class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm disabled:opacity-60"
                  @keydown.enter.prevent="submitEditCategory"
                />
                <button
                  @click="submitEditCategory"
                  :disabled="isSavingCategory || !editCategoryName.trim()"
                  class="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >保存</button>
                <button
                  @click="cancelEditCategory"
                  :disabled="isSavingCategory"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors"
                >取消</button>
              </template>
              <template v-else>
                <span class="inline-flex items-center px-2 py-1 rounded text-xs border" :class="categoryChipClass(c.color)">
                  <Tag class="w-3 h-3 mr-1.5" />
                  {{ c.name }}
                </span>
                <span class="text-xs text-textMuted flex-1">{{ projectCountByCategory[c.id] || 0 }} 个项目</span>
                <button
                  @click="startEditCategory(c)"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors flex items-center"
                >
                  <Pencil class="w-3 h-3 mr-1" />
                  编辑
                </button>
                <button
                  @click="deleteCategoryAction(c)"
                  :disabled="deletingCategoryId === c.id"
                  class="px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 rounded-md transition-colors flex items-center disabled:opacity-50"
                >
                  <RefreshCw v-if="deletingCategoryId === c.id" class="w-3 h-3 mr-1 animate-spin" />
                  <Trash2 v-else class="w-3 h-3 mr-1" />
                  删除
                </button>
              </template>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-end px-6 py-4 border-t border-border">
          <button
            @click="showCategoryModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
          >完成</button>
        </div>
      </div>
    </div>

    <!-- Manage Tags Modal -->
    <div
      v-if="showTagModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      @click.self="showTagModal = false"
    >
      <div class="bg-panel border border-border rounded-xl w-full max-w-2xl shadow-2xl flex flex-col" style="max-height: 85vh;">
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 class="text-xl font-bold text-textMain">管理标签</h2>
            <p class="text-xs text-textMuted mt-1">创建、编辑、删除项目标签。删除标签会解除其与项目的关联。</p>
          </div>
          <button @click="showTagModal = false" class="text-textMuted hover:text-textMain p-1">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="px-6 py-4 border-b border-border">
          <label class="block text-sm font-medium text-textMuted mb-2">新建标签</label>
          <div class="flex items-center gap-2">
            <input
              v-model="newTagName"
              type="text"
              placeholder="如：前端 / Node / PM2"
              :disabled="isCreatingTag"
              class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm disabled:opacity-60"
              @keydown.enter.prevent="submitCreateTag"
            />
            <button
              @click="submitCreateTag"
              :disabled="isCreatingTag || !newTagName.trim()"
              class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <RefreshCw v-if="isCreatingTag" class="w-4 h-4 mr-2 animate-spin" />
              <Plus v-else class="w-4 h-4 mr-1" />
              新建
            </button>
          </div>
          <p class="text-xs text-textMuted mt-2">颜色将自动分配，可在下方点击色块切换。</p>
        </div>

        <div class="flex-1 overflow-auto px-6 py-4">
          <div v-if="projectStore.tags.length === 0" class="text-center py-8 text-textMuted text-sm">
            还没有标签，新建一个吧
          </div>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="t in projectStore.tags"
              :key="t.id"
              class="py-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <template v-if="editingTagId === t.id">
                <input
                  v-model="editTagName"
                  type="text"
                  :disabled="isSavingTag"
                  class="flex-1 bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm disabled:opacity-60"
                  @keydown.enter.prevent="submitEditTag"
                />
                <button
                  @click="submitEditTag"
                  :disabled="isSavingTag || !editTagName.trim()"
                  class="px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >保存</button>
                <button
                  @click="cancelEditTag"
                  :disabled="isSavingTag"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors"
                >取消</button>
              </template>
              <template v-else>
                <span class="inline-flex items-center px-2 py-1 rounded text-xs border" :class="tagChipClass(t.color)">
                  <Tag class="w-3 h-3 mr-1.5" />
                  {{ t.name }}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    v-for="color in CHIP_COLOR_PALETTE"
                    :key="color"
                    type="button"
                    :title="`切换为 ${color}`"
                    @click="changeTagColor(t, color)"
                    class="w-4 h-4 rounded-full border"
                    :class="[tagChipClass(color), t.color === color ? 'ring-2 ring-primary' : '']"
                  />
                </div>
                <span class="text-xs text-textMuted flex-1 min-w-[60px]">{{ t.projectCount || 0 }} 个项目</span>
                <button
                  @click="startEditTag(t)"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors flex items-center"
                >
                  <Pencil class="w-3 h-3 mr-1" />
                  编辑
                </button>
                <button
                  @click="deleteTagAction(t)"
                  :disabled="deletingTagId === t.id"
                  class="px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 rounded-md transition-colors flex items-center disabled:opacity-50"
                >
                  <RefreshCw v-if="deletingTagId === t.id" class="w-3 h-3 mr-1 animate-spin" />
                  <Trash2 v-else class="w-3 h-3 mr-1" />
                  删除
                </button>
              </template>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-end px-6 py-4 border-t border-border">
          <button
            @click="showTagModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
          >完成</button>
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
