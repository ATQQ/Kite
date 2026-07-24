<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../store/project'
import type { Category, Tag as TagType } from '../store/project'
import { Plus, MoreVertical, Server, Clock, ScrollText, FolderPlus, Trash2, RefreshCw, XCircle, AlertTriangle, Pencil, FolderOpen, LayoutGrid, List as ListIcon, Tag, FolderTree, ChevronRight, Tags as TagsIcon, X as XIcon, Activity, CheckSquare, Square, MinusSquare } from 'lucide-vue-next'
import { useToast } from '../composables/useToast'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import ProjectTagsEditor from '../components/ProjectTagsEditor.vue'
import BulkActionBar from '../components/BulkActionBar.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { useBulkSelection } from '../composables/useBulkSelection'
import { CHIP_COLOR_PALETTE, chipClass as tagChipClass, pickFreeColor as pickFreeChipColor } from '../utils/color-chip'
import { apiUrl } from '../lib/base'

const projectStore = useProjectStore()
const router = useRouter()
const toast = useToast()
const { t } = useI18n()

const VIEW_KEY = 'kite:projectList:viewMode'
const viewMode = ref<'card' | 'list'>(((): 'card' | 'list' => {
  const v = localStorage.getItem(VIEW_KEY)
  return v === 'list' ? 'list' : 'card'
})())
watch(viewMode, (v) => localStorage.setItem(VIEW_KEY, v))

type GroupBy = 'none' | 'category' | 'env'
const GROUP_BY_KEY = 'kite:projectList:groupBy'
const GROUP_COLLAPSED_KEY = 'kite:projectList:collapsedGroups'
const DEFAULT_GROUP_SUFFIX = '__default__'
const groupBy = ref<GroupBy>(((): GroupBy => {
  const v = localStorage.getItem(GROUP_BY_KEY)
  return v === 'category' || v === 'env' ? v : 'none'
})())
watch(groupBy, (v) => localStorage.setItem(GROUP_BY_KEY, v))
const collapsedGroups = ref<Record<string, boolean>>(((): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(GROUP_COLLAPSED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, boolean> = {}
      for (const k of Object.keys(parsed)) {
        if (typeof parsed[k] === 'boolean') out[k] = parsed[k]
      }
      return out
    }
    return {}
  } catch {
    return {}
  }
})())
watch(collapsedGroups, (v) => localStorage.setItem(GROUP_COLLAPSED_KEY, JSON.stringify(v)), { deep: true })

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
  if (!categoryId) return t('project.list.defaultCategory')
  return categoryMap.value.get(categoryId)?.name ?? t('project.list.defaultCategory')
}

type ProjectGroup = {
  key: string
  label: string
  color: string | null
  isDefault: boolean
  count: number
  projects: typeof projectStore.projects
}

const groupedProjects = computed<ProjectGroup[]>(() => {
  const list = filteredProjects.value
  if (groupBy.value === 'none') {
    return [{
      key: 'all',
      label: '',
      color: null,
      isDefault: false,
      count: list.length,
      projects: list,
    }]
  }

  if (groupBy.value === 'category') {
    const buckets = new Map<string, typeof projectStore.projects>()
    const defaultBucket: typeof projectStore.projects = []
    for (const c of projectStore.categories) buckets.set(c.id, [])
    for (const p of list) {
      const cid = p.categoryId || ''
      if (cid && buckets.has(cid)) buckets.get(cid)!.push(p)
      else defaultBucket.push(p)
    }
    const result: ProjectGroup[] = []
    for (const c of projectStore.categories) {
      const arr = buckets.get(c.id) || []
      if (arr.length === 0) continue
      result.push({
        key: `cat:${c.id}`,
        label: c.name,
        color: c.color ?? null,
        isDefault: false,
        count: arr.length,
        projects: arr,
      })
    }
    if (defaultBucket.length > 0) {
      result.push({
        key: `cat:${DEFAULT_GROUP_SUFFIX}`,
        label: t('project.list.groupDefaultCategory'),
        color: null,
        isDefault: true,
        count: defaultBucket.length,
        projects: defaultBucket,
      })
    }
    return result
  }

  // env
  const buckets = new Map<string, typeof projectStore.projects>()
  const defaultBucket: typeof projectStore.projects = []
  for (const env of envOptions.value) buckets.set(env, [])
  for (const p of list) {
    const env = (p.env || '').trim()
    if (env && buckets.has(env)) buckets.get(env)!.push(p)
    else defaultBucket.push(p)
  }
  const result: ProjectGroup[] = []
  for (const env of envOptions.value) {
    const arr = buckets.get(env) || []
    if (arr.length === 0) continue
    result.push({
      key: `env:${env}`,
      label: env,
      color: null,
      isDefault: false,
      count: arr.length,
      projects: arr,
    })
  }
  if (defaultBucket.length > 0) {
    result.push({
      key: `env:${DEFAULT_GROUP_SUFFIX}`,
      label: t('project.list.groupDefaultEnv'),
      color: null,
      isDefault: true,
      count: defaultBucket.length,
      projects: defaultBucket,
    })
  }
  return result
})

function isGroupCollapsed(key: string): boolean {
  return collapsedGroups.value[key] === true
}

function toggleGroupCollapsed(key: string) {
  const next = { ...collapsedGroups.value }
  if (next[key]) delete next[key]
  else next[key] = true
  collapsedGroups.value = next
}

function groupHeaderChipClass(g: ProjectGroup): string {
  if (groupBy.value === 'category') {
    return categoryChipClass(g.color)
  }
  if (groupBy.value === 'env') {
    if (g.isDefault) return 'bg-base text-textMuted border-border'
    return envChipClass(g.label)
  }
  return 'bg-base text-textMuted border-border'
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return t('project.list.noDeploy')
  const ts = new Date(iso).getTime()
  if (isNaN(ts)) return '—'
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return t('project.list.relativeSec', { n: sec })
  const min = Math.floor(sec / 60)
  if (min < 60) return t('project.list.relativeMin', { n: min })
  const hour = Math.floor(min / 60)
  if (hour < 24) return t('project.list.relativeHour', { n: hour })
  const day = Math.floor(hour / 24)
  if (day < 30) return t('project.list.relativeDay', { n: day })
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
    toast.success(t('project.list.createSuccess'))
  } else {
    const detail = result.conflictProject
      ? t('project.list.conflictOccupied', { name: result.conflictProject })
      : result.error || t('project.list.retryHint')
    toast.error(t('project.list.createFail'), detail)
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
    toast.success(t('project.list.renameSuccess'))
    showRenameModal.value = false
  } catch (e: any) {
    toast.error(t('project.list.renameFailed'), e?.message || t('project.list.retryHint'))
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
      toast.success(t('project.list.deleteSuccess'))
      showDeleteModal.value = false
    } else {
      toast.error(t('project.list.deleteFailed'))
    }
  } catch (e: any) {
    toast.error(t('project.list.deleteFailed'), e?.message || t('project.list.retryHint'))
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
      entry.name = t('project.list.batchNameEmpty')
    } else if (existingNames.value.has(name)) {
      entry.name = t('project.list.batchNameDup')
    } else if (seenNames.has(name)) {
      entry.name = t('project.list.batchNameDupInBatch')
    } else {
      seenNames.set(name, r.id)
    }
    const dp = r.destPath.trim()
    if (!dp) {
      entry.dest = t('project.list.batchDestEmpty')
    } else if (existingDeployPaths.value.has(dp)) {
      entry.dest = t('project.list.batchDestOccupied')
    } else if (seenPaths.has(dp)) {
      entry.dest = t('project.list.batchDestDupInBatch')
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
          ? t('project.list.conflictOccupied', { name: result.conflictProject })
          : result.error || t('project.list.batchCreateFailed')
      }
    }
    const { success, failed } = batchSummary.value
    if (failed === 0) {
      toast.success(t('project.list.batchAllDone'), t('project.list.batchAllDoneDetail', { n: success }))
      batchRows.value = []
      showBatchModal.value = false
    } else {
      toast.error(t('project.list.batchPartialFail'), t('project.list.batchPartialFailDetail', { ok: success, fail: failed }))
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
    const name = categoryId ? (categoryMap.value.get(categoryId)?.name ?? t('project.list.moveCategoryDefault')) : t('project.list.moveCategoryDefault')
    toast.success(t('project.list.moveSuccess', { name }))
    moveSubmenuOpen.value = false
    closeDropdown()
  } catch (e: any) {
    toast.error(t('project.list.moveFailed'), e?.message || t('project.list.retryHint'))
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
      toast.success(t('project.list.categoryCreateSuccess'))
      newCategoryName.value = ''
    } else {
      toast.error(t('project.list.categoryCreateFailed'), res.conflictCategory ? t('project.list.categoryConflict', { name: res.conflictCategory }) : res.error || t('project.list.retryHint'))
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
      toast.success(t('project.list.categoryUpdateSuccess'))
      cancelEditCategory()
    } else {
      toast.error(t('project.list.categoryUpdateFailed'), res.conflictCategory ? t('project.list.categoryConflict', { name: res.conflictCategory }) : res.error || t('project.list.retryHint'))
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
      ? t('project.list.categoryDeleteConfirmWith', { name: c.name, count })
      : t('project.list.categoryDeleteConfirmEmpty', { name: c.name })
  )
  if (!ok) return
  deletingCategoryId.value = c.id
  try {
    const res = await projectStore.deleteCategory(c.id)
    if (res.ok) {
      toast.success(t('project.list.categoryDeleteSuccess'), res.detachedProjects ? t('project.list.categoryDetached', { n: res.detachedProjects }) : undefined)
      if (selectedCategoryFilter.value === c.id) selectedCategoryFilter.value = 'all'
    } else {
      toast.error(t('project.list.deleteFailed'), res.error || t('project.list.retryHint'))
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
    toast.error(t('project.list.tagSaveFailed'), e?.message || t('project.list.retryHint'))
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
      toast.success(t('project.list.tagCreateSuccess'))
      newTagName.value = ''
    } else {
      toast.error(t('project.list.categoryCreateFailed'), res.conflictTag ? t('project.list.tagConflict', { name: res.conflictTag }) : res.error || t('project.list.retryHint'))
    }
  } finally {
    isCreatingTag.value = false
  }
}

function startEditTag(tag: TagType) {
  editingTagId.value = tag.id
  editTagName.value = tag.name
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
      toast.success(t('project.list.tagUpdateSuccess'))
      cancelEditTag()
    } else {
      toast.error(t('project.list.categoryUpdateFailed'), res.conflictTag ? t('project.list.tagConflict', { name: res.conflictTag }) : res.error || t('project.list.retryHint'))
    }
  } finally {
    isSavingTag.value = false
  }
}

async function changeTagColor(tag: TagType, color: string) {
  const res = await projectStore.updateTag(tag.id, { color })
  if (!res.ok) toast.error(t('project.list.categoryUpdateFailed'), res.error || t('project.list.retryHint'))
}

async function deleteTagAction(tag: TagType) {
  if (deletingTagId.value) return
  const count = tag.projectCount || 0
  const ok = window.confirm(
    count > 0
      ? t('project.list.tagDeleteConfirmWith', { name: tag.name, count })
      : t('project.list.tagDeleteConfirmEmpty', { name: tag.name })
  )
  if (!ok) return
  deletingTagId.value = tag.id
  try {
    const res = await projectStore.deleteTag(tag.id)
    if (res.ok) {
      toast.success(t('project.list.tagDeleteSuccess'), res.detachedProjects ? t('project.list.tagDetached', { n: res.detachedProjects }) : undefined)
      selectedTagIds.value = selectedTagIds.value.filter((x) => x !== tag.id)
    } else {
      toast.error(t('project.list.deleteFailed'), res.error || t('project.list.retryHint'))
    }
  } finally {
    deletingTagId.value = null
  }
}

// ---------- Bulk selection ----------
const BULK_MAX = 200
const bulk = useBulkSelection(filteredProjects)
const isBulkSubmitting = ref(false)
const showBulkDelete = ref(false)
const bulkCategoryPanelOpen = ref(false)
const bulkTagPanelOpen = ref<null | 'add' | 'remove'>(null)
const bulkPendingTagIds = ref<string[]>([])

onBeforeRouteLeave(() => {
  bulk.clear()
})

function toggleRowSelection(e: Event, id: string) {
  e.stopPropagation()
  bulk.toggle(id)
}

function toggleAllSelection() {
  if (bulk.isAllSelected.value) {
    bulk.clear()
  } else {
    if (filteredProjects.value.length > BULK_MAX) {
      toast.error(
        t('project.list.bulkLimitExceededTitle'),
        t('project.list.bulkLimitExceededDetail', { max: BULK_MAX })
      )
      return
    }
    bulk.selectAll()
  }
}

function closeBulkPanels() {
  bulkCategoryPanelOpen.value = false
  bulkTagPanelOpen.value = null
}

function openBulkCategoryPanel() {
  bulkTagPanelOpen.value = null
  bulkCategoryPanelOpen.value = !bulkCategoryPanelOpen.value
}

function openBulkTagPanel(mode: 'add' | 'remove') {
  bulkCategoryPanelOpen.value = false
  if (bulkTagPanelOpen.value === mode) {
    bulkTagPanelOpen.value = null
    return
  }
  bulkPendingTagIds.value = []
  bulkTagPanelOpen.value = mode
}

function toggleBulkPendingTag(id: string) {
  const idx = bulkPendingTagIds.value.indexOf(id)
  if (idx === -1) bulkPendingTagIds.value = [...bulkPendingTagIds.value, id]
  else bulkPendingTagIds.value = bulkPendingTagIds.value.filter((x) => x !== id)
}

async function callBulkProjectsApi(payload: Record<string, unknown>): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const res = await fetch(apiUrl('/projects/bulk'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${projectStore.adminToken}`,
      },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` }
    return { ok: true, data }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'network error' }
  }
}

function summarizeBulkResult(data: any): { success: number; failed: number } {
  return {
    success: Number(data?.success || 0),
    failed: Array.isArray(data?.failed) ? data.failed.length : 0,
  }
}

function ensureWithinBulkLimit(): boolean {
  if (bulk.selectedCount.value > BULK_MAX) {
    toast.error(
      t('project.list.bulkLimitExceededTitle'),
      t('project.list.bulkLimitExceededDetail', { max: BULK_MAX })
    )
    return false
  }
  return true
}

async function bulkSetCategory(categoryId: string | null) {
  if (isBulkSubmitting.value) return
  if (bulk.selectedCount.value === 0) return
  if (!ensureWithinBulkLimit()) return
  isBulkSubmitting.value = true
  const ids = Array.from(bulk.selectedIds.value)
  const result = await callBulkProjectsApi({ ids, action: 'setCategory', categoryId })
  isBulkSubmitting.value = false
  if (!result.ok) {
    toast.error(t('project.list.bulkSetCategoryFailed'), result.error)
    return
  }
  const { success, failed } = summarizeBulkResult(result.data)
  const name = categoryId ? (categoryMap.value.get(categoryId)?.name ?? t('project.list.moveCategoryDefault')) : t('project.list.moveCategoryDefault')
  if (failed === 0) {
    toast.success(t('project.list.bulkSetCategorySuccess', { n: success, name }))
  } else {
    toast.error(t('project.list.bulkPartial'), t('project.list.bulkPartialDetail', { ok: success, fail: failed }))
  }
  closeBulkPanels()
  bulk.clear()
  await projectStore.fetchProjects()
}

async function bulkApplyTags(mode: 'add' | 'remove') {
  if (isBulkSubmitting.value) return
  if (bulk.selectedCount.value === 0) return
  if (bulkPendingTagIds.value.length === 0) return
  if (!ensureWithinBulkLimit()) return
  isBulkSubmitting.value = true
  const ids = Array.from(bulk.selectedIds.value)
  const result = await callBulkProjectsApi({
    ids,
    action: mode === 'add' ? 'addTags' : 'removeTags',
    tagIds: bulkPendingTagIds.value,
  })
  isBulkSubmitting.value = false
  if (!result.ok) {
    toast.error(
      mode === 'add' ? t('project.list.bulkAddTagsFailed') : t('project.list.bulkRemoveTagsFailed'),
      result.error
    )
    return
  }
  const { success, failed } = summarizeBulkResult(result.data)
  if (failed === 0) {
    toast.success(
      mode === 'add'
        ? t('project.list.bulkAddTagsSuccess', { n: success })
        : t('project.list.bulkRemoveTagsSuccess', { n: success })
    )
  } else {
    toast.error(t('project.list.bulkPartial'), t('project.list.bulkPartialDetail', { ok: success, fail: failed }))
  }
  closeBulkPanels()
  bulk.clear()
  await Promise.all([projectStore.fetchProjects(), projectStore.fetchTags()])
}

const bulkDeleteRequireText = computed(() => `delete ${bulk.selectedCount.value} projects`)

function openBulkDelete() {
  if (bulk.selectedCount.value === 0) return
  if (!ensureWithinBulkLimit()) return
  closeBulkPanels()
  showBulkDelete.value = true
}

async function confirmBulkDelete() {
  if (isBulkSubmitting.value) return
  const count = bulk.selectedCount.value
  if (count === 0) return
  isBulkSubmitting.value = true
  const ids = Array.from(bulk.selectedIds.value)
  const result = await callBulkProjectsApi({ ids, action: 'delete' })
  isBulkSubmitting.value = false
  if (!result.ok) {
    toast.error(t('project.list.bulkDeleteFailed'), result.error)
    return
  }
  const { success, failed } = summarizeBulkResult(result.data)
  if (failed === 0) {
    toast.success(t('project.list.bulkDeleteSuccess', { n: success }))
  } else {
    toast.error(t('project.list.bulkPartial'), t('project.list.bulkPartialDetail', { ok: success, fail: failed }))
  }
  showBulkDelete.value = false
  bulk.clear()
  await projectStore.fetchProjects()
}
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <div class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-8">
      <div>
        <h1 class="text-2xl font-bold text-textMain tracking-tight">{{ t('project.list.pageTitle') }}</h1>
        <p class="text-textMuted text-sm mt-1">{{ t('project.list.pageSubtitle') }}</p>
      </div>
      <div class="flex items-center flex-wrap gap-2">
        <div class="flex items-center border border-border rounded-md overflow-hidden">
          <button
            @click="viewMode = 'card'"
            :class="viewMode === 'card' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors"
            :title="t('project.list.cardView')"
          >
            <LayoutGrid class="w-3.5 h-3.5" />
          </button>
          <button
            @click="viewMode = 'list'"
            :class="viewMode === 'list' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors border-l border-border"
            :title="t('project.list.listView')"
          >
            <ListIcon class="w-3.5 h-3.5" />
          </button>
        </div>
        <div class="flex items-center border border-border rounded-md overflow-hidden" :title="t('project.list.groupByLabel')">
          <button
            @click="groupBy = 'none'"
            :class="groupBy === 'none' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors"
            :title="t('project.list.groupByNone')"
          >
            {{ t('project.list.groupByNone') }}
          </button>
          <button
            @click="groupBy = 'category'"
            :class="groupBy === 'category' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors border-l border-border"
            :title="t('project.list.groupByCategory')"
          >
            <FolderTree class="w-3.5 h-3.5 mr-1" />
            {{ t('project.list.groupByCategory') }}
          </button>
          <button
            @click="groupBy = 'env'"
            :class="groupBy === 'env' ? 'bg-primary/15 text-primary' : 'text-textMuted hover:text-textMain'"
            class="flex items-center px-2.5 py-1.5 text-xs transition-colors border-l border-border"
            :title="t('project.list.groupByEnv')"
          >
            <Activity class="w-3.5 h-3.5 mr-1" />
            {{ t('project.list.groupByEnv') }}
          </button>
        </div>
        <button
          @click="openCategoryModal"
          class="flex items-center px-3 py-2 border border-border hover:border-primary/50 text-textMain rounded-md transition-all font-medium text-sm"
          :title="t('project.list.manageCategoriesBtn')"
        >
          <FolderTree class="w-4 h-4 mr-2" />
          {{ t('project.list.manageCategoriesBtn') }}
        </button>
        <button
          @click="openTagModal"
          class="flex items-center px-3 py-2 border border-border hover:border-primary/50 text-textMain rounded-md transition-all font-medium text-sm"
          :title="t('project.list.manageTagsBtn')"
        >
          <TagsIcon class="w-4 h-4 mr-2" />
          {{ t('project.list.manageTagsBtn') }}
        </button>
        <button
          @click="openFolderPicker"
          class="flex items-center px-4 py-2 bg-primary hover:bg-primary/90 text-white rounded-md shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all font-medium text-sm"
        >
          <FolderPlus class="w-4 h-4 mr-2" />
          {{ t('project.list.pickFolderCreate') }}
        </button>
        <button
          @click="showCreateModal = true"
          class="flex items-center px-4 py-2 border border-border hover:border-primary/50 text-textMain rounded-md transition-all font-medium text-sm"
        >
          <Plus class="w-4 h-4 mr-2" />
          {{ t('project.list.newProjectBtn') }}
        </button>
      </div>
    </div>

    <!-- Category filter chips -->
    <div class="flex items-center flex-wrap gap-2">
      <span class="text-xs text-textMuted/80 mr-1 shrink-0">{{ t('project.list.filterCategoryLabel') }}</span>
      <button
        @click="selectedCategoryFilter = 'all'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedCategoryFilter === 'all' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
      >
        {{ t('project.list.filterAll') }}
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByCategory.all }}</span>
      </button>
      <button
        @click="selectedCategoryFilter = 'default'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedCategoryFilter === 'default' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
      >
        {{ t('project.list.filterDefault') }}
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
      <span class="text-xs text-textMuted/80 mr-1 shrink-0">{{ t('project.list.filterEnvLabel') }}</span>
      <button
        @click="selectedEnvFilter = 'all'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedEnvFilter === 'all' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
      >
        {{ t('project.list.filterAll') }}
        <span class="ml-1.5 text-[10px] opacity-75">{{ projectCountByEnv.all }}</span>
      </button>
      <button
        v-if="projectCountByEnv.default > 0"
        @click="selectedEnvFilter = 'default'"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedEnvFilter === 'default' ? 'bg-primary/15 text-primary border-primary/40' : 'bg-base text-textMuted border-border hover:text-textMain'"
        :title="t('project.list.filterEnvUnspecifiedTitle')"
      >
        {{ t('project.list.filterEnvUnspecified') }}
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
      <span class="text-xs text-textMuted/80 mr-1 shrink-0">{{ t('project.list.filterTagsLabel') }}</span>
      <button
        v-for="tg in projectStore.tags"
        :key="tg.id"
        @click="toggleTagFilter(tg.id)"
        class="flex items-center px-3 py-1.5 rounded-full text-xs border transition-colors"
        :class="selectedTagIds.includes(tg.id) ? `${tagChipClass(tg.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain hover:border-textMuted/40'"
        :title="selectedTagIds.includes(tg.id) ? t('project.list.filterTagRemoveTitle') : t('project.list.filterTagAddTitle')"
      >
        <Tag class="w-3 h-3 mr-1.5" />
        {{ tg.name }}
        <span v-if="tg.projectCount != null" class="ml-1.5 text-[10px] opacity-75">{{ tg.projectCount }}</span>
      </button>
      <button
        v-if="selectedTagIds.length > 0"
        @click="clearTagFilters"
        class="flex items-center px-2 py-1.5 rounded-full text-[11px] text-textMuted hover:text-textMain transition-colors"
        :title="t('project.list.filterClearTagsTitle')"
      >
        <XIcon class="w-3 h-3 mr-1" /> {{ t('project.list.filterClearTags') }}
      </button>
    </div>

    <!-- Card view -->
    <div v-if="viewMode === 'card'" class="space-y-6">
      <div v-if="filteredProjects.length === 0" class="text-center py-16 text-textMuted text-sm">
        {{ t('project.list.emptyUnderCategory') }}
      </div>
      <template v-else>
        <section v-for="g in groupedProjects" :key="g.key">
          <button
            v-if="groupBy !== 'none'"
            type="button"
            class="flex items-center w-full mb-3 py-2 px-1 text-left group/gh transition-colors"
            @click.stop="toggleGroupCollapsed(g.key)"
          >
            <ChevronRight
              class="w-4 h-4 text-textMuted transition-transform mr-1.5 shrink-0"
              :class="isGroupCollapsed(g.key) ? '' : 'rotate-90'"
            />
            <span
              class="inline-flex items-center px-2 py-0.5 rounded text-[11px] border font-medium"
              :class="groupHeaderChipClass(g)"
            >
              <FolderTree v-if="groupBy === 'category'" class="w-3 h-3 mr-1" />
              <Activity v-else class="w-3 h-3 mr-1" />
              {{ g.label }}
            </span>
            <span class="ml-2 text-xs text-textMuted">{{ t('project.list.groupCount', { n: g.count }) }}</span>
            <span class="ml-3 h-px flex-1 bg-border/50"></span>
          </button>
          <div
            v-if="groupBy === 'none' || !isGroupCollapsed(g.key)"
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6"
          >
            <div
              v-for="project in g.projects"
              :key="project.id"
              class="group bg-panel border rounded-xl p-5 transition-all shadow-sm cursor-pointer relative overflow-hidden"
              :class="bulk.isSelected(project.id) ? 'border-primary/60 ring-1 ring-primary/40' : 'border-border hover:border-primary/50'"
              @click="goToDetail(project.id)"
            >
              <div class="absolute top-0 left-0 w-1 h-full" :class="project.status === 'success' ? 'bg-success' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></div>

              <button
                type="button"
                class="absolute top-3 left-3 p-1 rounded-md transition-all"
                :class="bulk.isSelected(project.id) ? 'opacity-100 text-primary' : 'opacity-0 group-hover:opacity-100 text-textMuted hover:text-textMain'"
                :title="bulk.isSelected(project.id) ? t('project.list.bulkDeselectTitle') : t('project.list.bulkSelectTitle')"
                @click.stop="toggleRowSelection($event, project.id)"
              >
                <CheckSquare v-if="bulk.isSelected(project.id)" class="w-4 h-4" />
                <Square v-else class="w-4 h-4" />
              </button>

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
                <div class="flex items-center space-x-2">
                  <span
                    v-if="project.env"
                    class="inline-flex items-center px-2.5 py-1 rounded-md text-xs border font-mono font-medium"
                    :class="envChipClass(project.env)"
                    :title="project.env"
                  >
                    {{ project.env }}
                  </span>
                  <div class="relative">
                    <button class="p-1 dark:hover:bg-white/10 hover:bg-black/10 rounded-md transition-colors text-textMuted hover:text-textMain" @click.stop="toggleDropdown(project.id, $event)">
                      <MoreVertical class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <p class="text-sm text-textMuted mb-3 line-clamp-2 min-h-[40px]">
                {{ project.description || t('project.list.noDescription') }}
              </p>

              <div class="flex items-center flex-wrap gap-1.5 mb-3">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border" :class="categoryChipClass(categoryMap.get(project.categoryId || '')?.color)">
                  <Tag class="w-3 h-3 mr-1" />
                  {{ categoryNameOf(project.categoryId) }}
                </span>
                <ProjectTagsEditor
                  :model-value="project.tagIds || []"
                  size="sm"
                  :on-persist="(next) => persistProjectTags(project.id, next)"
                  :aria-label="t('project.list.tagsEditAriaLabel', { name: project.name })"
                />
              </div>

              <div class="flex items-center justify-between border-t border-border pt-4 text-xs text-textMuted">
                <div class="flex items-center" :title="project.lastDeployAt ? new Date(project.lastDeployAt).toLocaleString() : t('project.list.noDeploy')">
                  <Clock class="w-3.5 h-3.5 mr-1.5" />
                  <span>{{ formatRelativeTime(project.lastDeployAt) }}</span>
                </div>
                <div class="flex items-center space-x-3">
                  <button
                    @click.stop="goToLogs(project.id)"
                    class="flex items-center text-textMuted hover:text-primary transition-colors"
                    :title="t('project.list.deployLogTitle')"
                  >
                    <ScrollText class="w-3.5 h-3.5 mr-1" />
                    <span>{{ t('project.list.deployLog') }}</span>
                  </button>
                  <button
                    @click.stop="goToRunLogs(project.id)"
                    class="flex items-center text-textMuted hover:text-primary transition-colors"
                    :title="t('project.list.runLogTitle')"
                  >
                    <Activity class="w-3.5 h-3.5 mr-1" />
                    <span>{{ t('project.list.runLog') }}</span>
                  </button>
                  <span class="flex items-center" :class="project.status === 'success' ? 'text-success' : project.status === 'failed' ? 'text-danger' : 'text-primary'">
                    <span class="w-2 h-2 rounded-full mr-1.5" :class="project.status === 'success' ? 'bg-success shadow-[0_0_8px_#10b981]' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></span>
                    {{ project.status === 'success' ? t('project.list.statusNormal') : project.status === 'failed' ? t('project.list.statusAbnormal') : t('project.list.statusIdle') }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- List view -->
    <div v-else class="bg-panel border border-border rounded-xl overflow-hidden">
      <div class="overflow-x-auto">
      <table class="w-full text-sm min-w-[720px]">
        <thead class="text-xs text-textMuted bg-base/40">
          <tr>
            <th class="text-left font-medium px-3 py-3 w-10">
              <button
                type="button"
                class="p-1 rounded text-textMuted hover:text-textMain transition-colors"
                :title="bulk.isAllSelected.value ? t('project.list.bulkDeselectAllTitle') : t('project.list.bulkSelectAllTitle')"
                @click.stop="toggleAllSelection"
              >
                <CheckSquare v-if="bulk.isAllSelected.value" class="w-4 h-4 text-primary" />
                <MinusSquare v-else-if="bulk.isIndeterminate.value" class="w-4 h-4 text-primary" />
                <Square v-else class="w-4 h-4" />
              </button>
            </th>
            <th class="text-left font-medium px-4 py-3 w-24">{{ t('project.list.colEnv') }}</th>
            <th class="text-left font-medium px-4 py-3">{{ t('project.list.colName') }}</th>
            <th class="text-left font-medium px-4 py-3">{{ t('project.list.colDestPath') }}</th>
            <th class="text-left font-medium px-4 py-3 w-28">{{ t('project.list.colCategory') }}</th>
            <th class="text-left font-medium px-4 py-3 w-36">{{ t('project.list.colLastDeploy') }}</th>
            <th class="text-left font-medium px-4 py-3 w-20">{{ t('project.list.colStatus') }}</th>
            <th class="text-right font-medium px-4 py-3 w-12"></th>
          </tr>
        </thead>
        <tbody v-if="filteredProjects.length === 0">
          <tr>
            <td colspan="8" class="px-4 py-12 text-center text-textMuted text-sm">{{ t('project.list.emptyUnderCategory') }}</td>
          </tr>
        </tbody>
        <template v-for="g in groupedProjects" :key="g.key">
          <tbody v-if="filteredProjects.length > 0 && groupBy !== 'none'">
            <tr class="bg-base/40 border-t border-border">
              <td colspan="8" class="px-3 py-2">
                <button
                  type="button"
                  class="flex items-center w-full text-left"
                  @click.stop="toggleGroupCollapsed(g.key)"
                >
                  <ChevronRight
                    class="w-4 h-4 text-textMuted transition-transform mr-1.5 shrink-0"
                    :class="isGroupCollapsed(g.key) ? '' : 'rotate-90'"
                  />
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-[11px] border font-medium"
                    :class="groupHeaderChipClass(g)"
                  >
                    <FolderTree v-if="groupBy === 'category'" class="w-3 h-3 mr-1" />
                    <Activity v-else class="w-3 h-3 mr-1" />
                    {{ g.label }}
                  </span>
                  <span class="ml-2 text-xs text-textMuted">{{ t('project.list.groupCount', { n: g.count }) }}</span>
                </button>
              </td>
            </tr>
          </tbody>
          <tbody v-if="filteredProjects.length > 0 && (groupBy === 'none' || !isGroupCollapsed(g.key))">
            <tr
              v-for="project in g.projects"
              :key="project.id"
              class="border-t border-border cursor-pointer"
              :class="bulk.isSelected(project.id) ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-white/5'"
              @click="goToDetail(project.id)"
            >
              <td class="px-3 py-3 w-10">
                <button
                  type="button"
                  class="p-1 rounded transition-colors"
                  :class="bulk.isSelected(project.id) ? 'text-primary' : 'text-textMuted hover:text-textMain'"
                  :title="bulk.isSelected(project.id) ? t('project.list.bulkDeselectTitle') : t('project.list.bulkSelectTitle')"
                  @click.stop="toggleRowSelection($event, project.id)"
                >
                  <CheckSquare v-if="bulk.isSelected(project.id)" class="w-4 h-4" />
                  <Square v-else class="w-4 h-4" />
                </button>
              </td>
              <td class="px-4 py-3">
                <span v-if="project.env" class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border font-mono" :class="envChipClass(project.env)">{{ project.env }}</span>
                <span v-else class="text-textMuted text-xs">—</span>
              </td>
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
                    :aria-label="t('project.list.tagsEditAriaLabel', { name: project.name })"
                  />
                </div>
              </td>
              <td class="px-4 py-3 text-textMuted text-xs" :title="project.lastDeployAt ? new Date(project.lastDeployAt).toLocaleString() : t('project.list.noDeploy')">
                {{ formatRelativeTime(project.lastDeployAt) }}
              </td>
              <td class="px-4 py-3">
                <span class="inline-flex items-center text-xs" :class="project.status === 'success' ? 'text-success' : project.status === 'failed' ? 'text-danger' : 'text-primary'">
                  <span class="w-2 h-2 rounded-full mr-1.5" :class="project.status === 'success' ? 'bg-success' : project.status === 'failed' ? 'bg-danger' : 'bg-primary'"></span>
                  {{ project.status === 'success' ? t('project.list.statusNormal') : project.status === 'failed' ? t('project.list.statusAbnormal') : t('project.list.statusIdle') }}
                </span>
              </td>
              <td class="px-4 py-3 text-right">
                <button class="p-1 dark:hover:bg-white/10 hover:bg-black/10 rounded-md text-textMuted hover:text-textMain" @click.stop="toggleDropdown(project.id, $event)">
                  <MoreVertical class="w-4 h-4" />
                </button>
              </td>
            </tr>
          </tbody>
        </template>
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
            {{ t('project.list.ddRename') }}
          </button>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click.stop="(() => { const id = openDropdownId; closeDropdown(); if (id) goToFiles(id) })()"
          >
            <FolderOpen class="w-3.5 h-3.5 mr-2 text-textMuted" />
            {{ t('project.list.ddViewFiles') }}
          </button>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click="(() => { const id = openDropdownId; closeDropdown(); if (id) goToLogs(id) })()"
          >
            <ScrollText class="w-3.5 h-3.5 mr-2 text-textMuted" />
            {{ t('project.list.deployLog') }}
          </button>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
            @click="(() => { const id = openDropdownId; closeDropdown(); if (id) goToRunLogs(id) })()"
          >
            <Activity class="w-3.5 h-3.5 mr-2 text-textMuted" />
            {{ t('project.list.runLog') }}
          </button>
          <div class="border-t border-border my-1"></div>
          <div class="relative">
            <button
              class="flex items-center justify-between w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
              @click="openMoveSubmenu($event)"
            >
              <span class="flex items-center">
                <FolderTree class="w-3.5 h-3.5 mr-2 text-textMuted" />
                {{ t('project.list.ddMoveCategory') }}
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
                <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border bg-base text-textMuted border-border">{{ t('project.list.moveDefaultChip') }}</span>
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
                {{ t('project.list.noCategoriesHint') }}
              </div>
            </div>
          </div>
          <div class="border-t border-border my-1"></div>
          <button
            class="flex items-center w-full px-3 py-2 text-sm text-danger hover:bg-danger/10 transition-colors"
            @click="(() => { const p = projectStore.projects.find(x => x.id === openDropdownId); if (p) openDelete(p.id, p.name) })()"
          >
            <Trash2 class="w-3.5 h-3.5 mr-2" />
            {{ t('project.list.ddDeleteProject') }}
          </button>
        </div>
      </transition>
    </Teleport>

    <!-- Create Modal -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div class="bg-panel border border-border rounded-xl w-full max-w-md p-6 shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto">
        <h2 class="text-xl font-bold text-textMain mb-6">{{ t('project.list.createTitle') }}</h2>
        
        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createNameLabel') }}</label>
            <input 
              v-model="newProject.name"
              type="text" 
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              :placeholder="t('project.list.createNamePlaceholder')"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createDestPathLabel') }}</label>
            <input
              v-model="newProject.destPath"
              type="text"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              :placeholder="t('project.list.createDestPathPlaceholder')"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createEnvLabel') }}</label>
            <input
              v-model="newProject.env"
              type="text"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
              :placeholder="t('project.list.createEnvPlaceholder')"
            />
            <p class="text-xs text-textMuted mt-1.5">
              {{ t('project.list.envInputHintPart1') }} <code class="font-mono text-textMain">kite.config.{`{env}`}.json</code> {{ t('project.list.envInputHintPart2') }}
              <code class="font-mono text-textMain">kite push --env {`{name}`}</code> {{ t('project.list.envInputHintPart3') }}
              <span class="text-primary/80">{{ t('project.list.createEnvHintScene') }}</span>
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createCategoryLabel') }}</label>
            <select
              v-model="newProject.categoryId"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm"
            >
              <option value="">{{ t('project.list.defaultCategory') }}</option>
              <option v-for="c in projectStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createTagsLabel') }}</label>
            <div v-if="projectStore.tags.length === 0" class="text-xs text-textMuted">
              {{ t('project.list.createTagsEmpty') }}
            </div>
            <div v-else class="flex items-center flex-wrap gap-1.5">
              <button
                v-for="tg in projectStore.tags"
                :key="tg.id"
                type="button"
                @click="toggleTagOnForm(newProject, tg.id)"
                class="inline-flex items-center px-2 py-1 rounded text-[11px] border transition-colors"
                :class="newProject.tagIds.includes(tg.id) ? `${tagChipClass(tg.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain hover:border-textMuted/40'"
              >
                <Tag class="w-3 h-3 mr-1" />
                {{ tg.name }}
              </button>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createDescLabel') }}</label>
            <textarea
              v-model="newProject.description"
              class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm h-24 resize-none"
              :placeholder="t('project.list.createDescPlaceholder')"
            ></textarea>
          </div>
        </div>

        <div class="mt-8 flex justify-end space-x-3">
          <button 
            @click="showCreateModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
          >
            {{ t('common.cancel') }}
          </button>
          <button 
            @click="createProject"
            :disabled="!newProject.name || !newProject.destPath"
            class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {{ t('project.list.createConfirm') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Folder Picker Dialog -->
    <FolderPickerDialog
      v-model:open="showFolderPicker"
      mode="multi"
      :title="t('project.list.pickerTitle')"
      @confirm="onPickerConfirm"
    />

    <!-- Batch Create Modal -->
    <div v-if="showBatchModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" @click.self="closeBatchModal">
      <div class="bg-panel border border-border rounded-xl w-full max-w-6xl shadow-2xl flex flex-col" style="max-height: 85vh;">
        <div class="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <h2 class="text-xl font-bold text-textMain">{{ t('project.list.batchTitle') }}</h2>
            <p class="text-xs text-textMuted mt-1">{{ t('project.list.batchSubtitle', { count: batchRows.length }) }}</p>
          </div>
          <button @click="closeBatchModal" :disabled="isBatchSubmitting" class="text-textMuted hover:text-textMain p-1 disabled:opacity-40">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="px-6 py-3 border-b border-border bg-yellow-400/15 dark:bg-yellow-400/5 flex items-start space-x-2">
          <AlertTriangle class="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
          <p class="text-xs text-yellow-800 dark:text-yellow-200/90">
            {{ t('project.list.batchWarning') }}
          </p>
        </div>

        <div class="flex-1 overflow-auto px-2">
          <table class="w-full text-sm table-fixed">
            <thead class="text-xs text-textMuted sticky top-0 bg-panel">
              <tr class="border-b border-border">
                <th class="text-left font-medium px-3 py-2 w-[16%]">{{ t('project.list.batchColName') }}</th>
                <th class="text-left font-medium px-3 py-2 w-[30%]">{{ t('project.list.batchColDestPath') }}</th>
                <th class="text-left font-medium px-3 py-2 w-[10%]">{{ t('project.list.batchColEnv') }}</th>
                <th class="text-left font-medium px-3 py-2 w-[12%]">{{ t('project.list.batchColCategory') }}</th>
                <th class="text-left font-medium px-3 py-2 w-[16%]">{{ t('project.list.batchColTags') }}</th>
                <th class="text-left font-medium px-3 py-2 w-[16%]">{{ t('project.list.batchColDesc') }}</th>
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
                    :placeholder="t('project.list.batchEnvPlaceholder')"
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
                    <option value="">{{ t('project.list.filterDefault') }}</option>
                    <option v-for="c in projectStore.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                  </select>
                </td>
                <td class="px-3 py-2">
                  <div v-if="projectStore.tags.length === 0" class="text-[11px] text-textMuted">{{ t('project.list.batchTagsNone') }}</div>
                  <div v-else class="flex items-center flex-wrap gap-1">
                    <button
                      v-for="tg in projectStore.tags"
                      :key="tg.id"
                      type="button"
                      :disabled="row.status === 'success' || isBatchSubmitting"
                      @click="toggleTagOnForm(row, tg.id)"
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border transition-colors disabled:opacity-60"
                      :class="row.tagIds.includes(tg.id) ? `${tagChipClass(tg.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain hover:border-textMuted/40'"
                    >
                      {{ tg.name }}
                    </button>
                  </div>
                </td>
                <td class="px-3 py-2">
                  <div class="flex items-start gap-2">
                    <input
                      v-model="row.description"
                      type="text"
                      :placeholder="t('project.list.batchDescPlaceholder')"
                      :disabled="row.status === 'success' || isBatchSubmitting"
                      class="flex-1 min-w-0 bg-base border border-border rounded px-2 py-1.5 text-textMain text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
                    />
                    <button
                      v-if="row.status !== 'success'"
                      @click="removeBatchRow(row.id)"
                      :disabled="isBatchSubmitting"
                      class="shrink-0 mt-1.5 text-textMuted hover:text-danger disabled:opacity-40"
                      :title="t('project.list.batchRemoveRow')"
                    >
                      <Trash2 class="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="batchRows.length === 0">
                <td colspan="6" class="px-3 py-8 text-center text-textMuted text-sm">{{ t('project.list.batchEmptyRow') }}</td>
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
              <FolderPlus class="w-3.5 h-3.5 mr-1.5" /> {{ t('project.list.batchContinueAdd') }}
            </button>
            <div class="text-xs text-textMuted">
              {{ t('project.list.batchSummary', { total: batchSummary.total, pending: batchSummary.pending, success: batchSummary.success, failed: batchSummary.failed }) }}
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <button
              @click="closeBatchModal"
              :disabled="isBatchSubmitting"
              class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50"
            >{{ batchSummary.success > 0 ? t('project.list.batchDone') : t('project.list.batchCancel') }}</button>
            <button
              @click="submitBatch"
              :disabled="!canSubmitBatch"
              class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
            >
              <RefreshCw v-if="isBatchSubmitting" class="w-4 h-4 mr-2 animate-spin" />
              {{ isBatchSubmitting ? t('project.list.batchSubmitting') : t('project.list.batchSubmit', { count: batchSummary.pending }) }}
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
        <h2 class="text-lg font-semibold text-textMain mb-4">{{ t('project.list.renameTitle') }}</h2>
        <div>
          <label class="block text-sm font-medium text-textMuted mb-1.5">{{ t('project.list.createNameLabel') }}</label>
          <input
            v-model="renameInput"
            type="text"
            :disabled="isRenaming"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all text-sm disabled:opacity-60"
            :placeholder="t('project.list.renameNamePlaceholder')"
            @keydown.enter.prevent="confirmRename"
          />
        </div>
        <div class="mt-6 flex justify-end space-x-3">
          <button
            @click="showRenameModal = false"
            :disabled="isRenaming"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50"
          >{{ t('common.cancel') }}</button>
          <button
            @click="confirmRename"
            :disabled="isRenaming || !renameInput.trim() || renameInput.trim() === renameTarget?.name"
            class="px-4 py-2 text-sm font-medium bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isRenaming" class="w-4 h-4 mr-2 animate-spin" />
            {{ t('project.list.renameConfirm') }}
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
            <h2 class="text-lg font-semibold text-textMain">{{ t('project.list.deleteTitle') }}</h2>
            <p class="text-sm text-textMuted mt-1">
              {{ t('project.list.deleteIntro') }}
              <span class="font-mono text-textMain">{{ deleteTarget?.name }}</span>{{ t('project.list.deleteIntro2') }}
            </p>
          </div>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-textMuted mb-1.5">
            {{ t('project.list.deleteConfirmInputLabel') }} <span class="font-mono text-textMain">{{ deleteTarget?.name }}</span> {{ t('project.list.deleteConfirmInputLabel2') }}
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
          >{{ t('common.cancel') }}</button>
          <button
            @click="confirmDelete"
            :disabled="!canConfirmDelete"
            class="px-4 py-2 text-sm font-medium bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center"
          >
            <RefreshCw v-if="isDeleting" class="w-4 h-4 mr-2 animate-spin" />
            <Trash2 v-else class="w-4 h-4 mr-2" />
            {{ isDeleting ? t('project.list.deleteDeleting') : t('project.list.deletePermanent') }}
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
            <h2 class="text-xl font-bold text-textMain">{{ t('project.list.categoryModalTitle') }}</h2>
            <p class="text-xs text-textMuted mt-1">{{ t('project.list.categoryModalSubtitle') }}</p>
          </div>
          <button @click="showCategoryModal = false" class="text-textMuted hover:text-textMain p-1">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="px-6 py-4 border-b border-border">
          <label class="block text-sm font-medium text-textMuted mb-2">{{ t('project.list.categoryNewLabel') }}</label>
          <div class="flex items-center gap-2">
            <input
              v-model="newCategoryName"
              type="text"
              :placeholder="t('project.list.categoryNewPlaceholder')"
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
              {{ t('project.list.categoryNewBtn') }}
            </button>
          </div>
          <p class="text-xs text-textMuted mt-2">{{ t('project.list.categoryColorHint') }}</p>
        </div>

        <div class="flex-1 overflow-auto px-6 py-4">
          <div v-if="projectStore.categories.length === 0" class="text-center py-8 text-textMuted text-sm">
            {{ t('project.list.categoryEmptyTip') }}
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
                >{{ t('project.list.categorySaveBtn') }}</button>
                <button
                  @click="cancelEditCategory"
                  :disabled="isSavingCategory"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors"
                >{{ t('common.cancel') }}</button>
              </template>
              <template v-else>
                <span class="inline-flex items-center px-2 py-1 rounded text-xs border" :class="categoryChipClass(c.color)">
                  <Tag class="w-3 h-3 mr-1.5" />
                  {{ c.name }}
                </span>
                <span class="text-xs text-textMuted flex-1">{{ t('project.list.categoryProjectCount', { n: projectCountByCategory[c.id] || 0 }) }}</span>
                <button
                  @click="startEditCategory(c)"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors flex items-center"
                >
                  <Pencil class="w-3 h-3 mr-1" />
                  {{ t('project.list.categoryEditBtn') }}
                </button>
                <button
                  @click="deleteCategoryAction(c)"
                  :disabled="deletingCategoryId === c.id"
                  class="px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 rounded-md transition-colors flex items-center disabled:opacity-50"
                >
                  <RefreshCw v-if="deletingCategoryId === c.id" class="w-3 h-3 mr-1 animate-spin" />
                  <Trash2 v-else class="w-3 h-3 mr-1" />
                  {{ t('project.list.categoryDeleteBtn') }}
                </button>
              </template>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-end px-6 py-4 border-t border-border">
          <button
            @click="showCategoryModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
          >{{ t('project.list.categoryDoneBtn') }}</button>
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
            <h2 class="text-xl font-bold text-textMain">{{ t('project.list.tagModalTitle') }}</h2>
            <p class="text-xs text-textMuted mt-1">{{ t('project.list.tagModalSubtitle') }}</p>
          </div>
          <button @click="showTagModal = false" class="text-textMuted hover:text-textMain p-1">
            <XCircle class="w-5 h-5" />
          </button>
        </div>

        <div class="px-6 py-4 border-b border-border">
          <label class="block text-sm font-medium text-textMuted mb-2">{{ t('project.list.tagNewLabel') }}</label>
          <div class="flex items-center gap-2">
            <input
              v-model="newTagName"
              type="text"
              :placeholder="t('project.list.tagNewPlaceholder')"
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
              {{ t('project.list.categoryNewBtn') }}
            </button>
          </div>
          <p class="text-xs text-textMuted mt-2">{{ t('project.list.tagColorHint') }}</p>
        </div>

        <div class="flex-1 overflow-auto px-6 py-4">
          <div v-if="projectStore.tags.length === 0" class="text-center py-8 text-textMuted text-sm">
            {{ t('project.list.tagEmptyTip') }}
          </div>
          <ul v-else class="divide-y divide-border">
            <li
              v-for="tg in projectStore.tags"
              :key="tg.id"
              class="py-3 flex items-center justify-between gap-3 flex-wrap"
            >
              <template v-if="editingTagId === tg.id">
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
                >{{ t('project.list.categorySaveBtn') }}</button>
                <button
                  @click="cancelEditTag"
                  :disabled="isSavingTag"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors"
                >{{ t('common.cancel') }}</button>
              </template>
              <template v-else>
                <span class="inline-flex items-center px-2 py-1 rounded text-xs border" :class="tagChipClass(tg.color)">
                  <Tag class="w-3 h-3 mr-1.5" />
                  {{ tg.name }}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    v-for="color in CHIP_COLOR_PALETTE"
                    :key="color"
                    type="button"
                    :title="t('project.list.tagColorChangeTitle', { color })"
                    @click="changeTagColor(tg, color)"
                    class="w-4 h-4 rounded-full border"
                    :class="[tagChipClass(color), tg.color === color ? 'ring-2 ring-primary' : '']"
                  />
                </div>
                <span class="text-xs text-textMuted flex-1 min-w-[60px]">{{ t('project.list.categoryProjectCount', { n: tg.projectCount || 0 }) }}</span>
                <button
                  @click="startEditTag(tg)"
                  class="px-3 py-1.5 text-xs font-medium text-textMuted hover:text-textMain transition-colors flex items-center"
                >
                  <Pencil class="w-3 h-3 mr-1" />
                  {{ t('project.list.categoryEditBtn') }}
                </button>
                <button
                  @click="deleteTagAction(tg)"
                  :disabled="deletingTagId === tg.id"
                  class="px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/10 rounded-md transition-colors flex items-center disabled:opacity-50"
                >
                  <RefreshCw v-if="deletingTagId === tg.id" class="w-3 h-3 mr-1 animate-spin" />
                  <Trash2 v-else class="w-3 h-3 mr-1" />
                  {{ t('project.list.categoryDeleteBtn') }}
                </button>
              </template>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-end px-6 py-4 border-t border-border">
          <button
            @click="showTagModal = false"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
          >{{ t('project.list.categoryDoneBtn') }}</button>
        </div>
      </div>
    </div>

    <!-- Bulk Action Bar -->
    <BulkActionBar :count="bulk.selectedCount.value" :total="filteredProjects.length" @clear="bulk.clear">
      <template #actions>
        <div class="relative">
          <button
            type="button"
            :disabled="isBulkSubmitting"
            class="flex items-center px-2.5 py-1.5 text-xs rounded-md border border-border hover:border-primary/50 text-textMain transition-colors disabled:opacity-50"
            @click="openBulkCategoryPanel"
          >
            <FolderTree class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.list.bulkSetCategory') }}
          </button>
          <div
            v-if="bulkCategoryPanelOpen"
            class="absolute bottom-full left-0 mb-2 bg-panel border border-border rounded-lg shadow-xl py-1 min-w-[180px] max-h-64 overflow-auto"
            style="z-index: 70"
            @click.stop
          >
            <button
              type="button"
              class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
              :disabled="isBulkSubmitting"
              @click="bulkSetCategory(null)"
            >
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border bg-base text-textMuted border-border">{{ t('project.list.moveDefaultChip') }}</span>
            </button>
            <button
              v-for="c in projectStore.categories"
              :key="c.id"
              type="button"
              class="flex items-center w-full px-3 py-2 text-sm text-textMain hover:bg-white/5 transition-colors"
              :disabled="isBulkSubmitting"
              @click="bulkSetCategory(c.id)"
            >
              <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border" :class="categoryChipClass(c.color)">
                <Tag class="w-3 h-3 mr-1" />{{ c.name }}
              </span>
            </button>
            <div v-if="projectStore.categories.length === 0" class="px-3 py-2 text-xs text-textMuted">
              {{ t('project.list.noCategoriesHint') }}
            </div>
          </div>
        </div>

        <div class="relative">
          <button
            type="button"
            :disabled="isBulkSubmitting"
            class="flex items-center px-2.5 py-1.5 text-xs rounded-md border border-border hover:border-primary/50 text-textMain transition-colors disabled:opacity-50"
            @click="openBulkTagPanel('add')"
          >
            <TagsIcon class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.list.bulkAddTags') }}
          </button>
          <div
            v-if="bulkTagPanelOpen === 'add'"
            class="absolute bottom-full left-0 mb-2 bg-panel border border-border rounded-lg shadow-xl p-3 min-w-[240px] max-w-[320px]"
            style="z-index: 70"
            @click.stop
          >
            <p class="text-xs text-textMuted mb-2">{{ t('project.list.bulkTagPickHint') }}</p>
            <div v-if="projectStore.tags.length === 0" class="text-xs text-textMuted py-2">{{ t('project.list.bulkNoTagsHint') }}</div>
            <div v-else class="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-auto">
              <button
                v-for="tg in projectStore.tags"
                :key="tg.id"
                type="button"
                class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border transition-colors"
                :class="bulkPendingTagIds.includes(tg.id) ? `${tagChipClass(tg.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain'"
                @click="toggleBulkPendingTag(tg.id)"
              >
                <Tag class="w-3 h-3 mr-1" />{{ tg.name }}
              </button>
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="px-2.5 py-1 text-xs text-textMuted hover:text-textMain transition-colors"
                @click="bulkTagPanelOpen = null"
              >{{ t('common.cancel') }}</button>
              <button
                type="button"
                :disabled="isBulkSubmitting || bulkPendingTagIds.length === 0"
                class="px-2.5 py-1 text-xs bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                @click="bulkApplyTags('add')"
              >{{ t('project.list.bulkApplyAdd') }}</button>
            </div>
          </div>
        </div>

        <div class="relative">
          <button
            type="button"
            :disabled="isBulkSubmitting"
            class="flex items-center px-2.5 py-1.5 text-xs rounded-md border border-border hover:border-primary/50 text-textMain transition-colors disabled:opacity-50"
            @click="openBulkTagPanel('remove')"
          >
            <XIcon class="w-3.5 h-3.5 mr-1.5" />
            {{ t('project.list.bulkRemoveTags') }}
          </button>
          <div
            v-if="bulkTagPanelOpen === 'remove'"
            class="absolute bottom-full left-0 mb-2 bg-panel border border-border rounded-lg shadow-xl p-3 min-w-[240px] max-w-[320px]"
            style="z-index: 70"
            @click.stop
          >
            <p class="text-xs text-textMuted mb-2">{{ t('project.list.bulkTagPickHint') }}</p>
            <div v-if="projectStore.tags.length === 0" class="text-xs text-textMuted py-2">{{ t('project.list.bulkNoTagsHint') }}</div>
            <div v-else class="flex flex-wrap gap-1.5 mb-3 max-h-40 overflow-auto">
              <button
                v-for="tg in projectStore.tags"
                :key="tg.id"
                type="button"
                class="inline-flex items-center px-2 py-0.5 rounded text-[10px] border transition-colors"
                :class="bulkPendingTagIds.includes(tg.id) ? `${tagChipClass(tg.color)} ring-1 ring-primary/40` : 'bg-base text-textMuted border-border hover:text-textMain'"
                @click="toggleBulkPendingTag(tg.id)"
              >
                <Tag class="w-3 h-3 mr-1" />{{ tg.name }}
              </button>
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="px-2.5 py-1 text-xs text-textMuted hover:text-textMain transition-colors"
                @click="bulkTagPanelOpen = null"
              >{{ t('common.cancel') }}</button>
              <button
                type="button"
                :disabled="isBulkSubmitting || bulkPendingTagIds.length === 0"
                class="px-2.5 py-1 text-xs bg-danger text-white rounded-md hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                @click="bulkApplyTags('remove')"
              >{{ t('project.list.bulkApplyRemove') }}</button>
            </div>
          </div>
        </div>

        <button
          type="button"
          :disabled="isBulkSubmitting"
          class="flex items-center px-2.5 py-1.5 text-xs rounded-md border border-danger/40 text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
          @click="openBulkDelete"
        >
          <Trash2 class="w-3.5 h-3.5 mr-1.5" />
          {{ t('project.list.bulkDeleteAction') }}
        </button>
      </template>
    </BulkActionBar>

    <ConfirmDialog
      v-model:open="showBulkDelete"
      tone="danger"
      :title="t('project.list.bulkDeleteTitle')"
      :message="t('project.list.bulkDeleteMessage', { n: bulk.selectedCount.value })"
      :confirm-text="t('project.list.bulkDeleteConfirm')"
      :cancel-text="t('common.cancel')"
      :require-text="bulkDeleteRequireText"
      :require-text-hint="t('project.list.bulkDeleteHint', { expected: bulkDeleteRequireText })"
      :loading="isBulkSubmitting"
      @confirm="confirmBulkDelete"
    />
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
