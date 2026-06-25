<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectStore } from '../store/project'
import FileTreeNode from '../components/FileTreeNode.vue'
import { ArrowLeft, File, Loader2, ChevronRight, Home, PanelLeft } from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()

const projectId = route.params.id as string
const project = computed(() => projectStore.getProjectById(projectId))

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  isHidden?: boolean
  size?: number
  mtime?: string
  expanded?: boolean
  children?: TreeNode[]
  loading?: boolean
}

const tree = ref<TreeNode[]>([])
const selectedFile = ref('')
const fileContent = ref<any>(null)
const contentLoading = ref(false)
const treeLoading = ref(true)
const showTreeMobile = ref(true)

onMounted(async () => {
  await projectStore.fetchProjects()
  if (!project.value) {
    router.replace('/projects')
    return
  }
  await loadTree('')
})

async function loadTree(dirPath: string) {
  treeLoading.value = true
  const items = await projectStore.fetchFiles(projectId, dirPath)
  tree.value = items.map((item: any) => ({
    ...item,
    expanded: false,
    children: undefined as TreeNode[] | undefined,
    loading: false
  }))
  treeLoading.value = false
}

async function toggleDir(node: TreeNode) {
  if (!node.isDir) return
  if (node.expanded) {
    node.expanded = false
    return
  }
  node.expanded = true
  if (!node.children) {
    node.loading = true
    const items = await projectStore.fetchFiles(projectId, node.path)
    node.children = items.map((item: any) => ({
      ...item,
      expanded: false,
      children: undefined as TreeNode[] | undefined,
      loading: false
    }))
    node.loading = false
  }
}

async function selectFile(node: TreeNode) {
  if (node.isDir) return
  selectedFile.value = node.path
  contentLoading.value = true
  fileContent.value = null
  fileContent.value = await projectStore.fetchFileContent(projectId, node.path)
  contentLoading.value = false
  showTreeMobile.value = false
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function getBreadcrumbParts(filePath: string) {
  if (!filePath) return []
  return filePath.split('/').map((part, i, parts) => ({
    name: part,
    path: parts.slice(0, i + 1).join('/')
  }))
}

const breadcrumb = computed(() => getBreadcrumbParts(selectedFile.value))
</script>

<template>
  <div class="h-[calc(100vh-4rem)] flex flex-col p-4 md:p-0">
    <!-- Header -->
    <div class="flex items-center space-x-3 sm:space-x-4 mb-4">
      <button
        @click="router.push(`/projects/${projectId}`)"
        class="p-2 dark:hover:bg-white/10 hover:bg-black/10 rounded-full transition-colors text-textMuted hover:text-textMain shrink-0"
      >
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div class="min-w-0 flex-1">
        <h1 class="text-xl font-bold text-textMain tracking-tight truncate">
          {{ project?.name || '项目' }} <span class="text-textMuted font-normal">/ 文件浏览</span>
        </h1>
      </div>
      <button
        @click="showTreeMobile = !showTreeMobile"
        class="md:hidden p-2 dark:hover:bg-white/10 hover:bg-black/10 rounded-md transition-colors text-textMuted hover:text-textMain shrink-0"
        :class="showTreeMobile ? 'text-primary' : ''"
        type="button"
      >
        <PanelLeft class="w-5 h-5" />
      </button>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col md:flex-row border border-border rounded-xl overflow-hidden bg-panel min-h-0">
      <!-- File Tree Sidebar -->
      <aside
        class="w-full md:w-64 md:border-r border-b md:border-b-0 border-border overflow-auto bg-base/50 shrink-0 max-h-64 md:max-h-full"
        :class="showTreeMobile ? 'block' : 'hidden md:block'"
      >
        <div v-if="treeLoading" class="flex items-center justify-center py-8 text-textMuted">
          <Loader2 class="w-5 h-5 animate-spin mr-2" />
          <span class="text-sm">加载中...</span>
        </div>
        <div v-else-if="tree.length === 0" class="py-8 text-center text-textMuted text-sm">
          暂无文件
        </div>
        <div v-else class="py-2">
          <FileTreeNode
            v-for="node in tree"
            :key="node.path"
            :node="node"
            :depth="0"
            :selected-file="selectedFile"
            @toggle="toggleDir"
            @select="selectFile"
          />
        </div>
      </aside>

      <!-- File Content Area -->
      <div class="flex-1 flex flex-col min-w-0 min-h-0">
        <!-- Breadcrumb -->
        <div v-if="selectedFile" class="flex items-center px-4 py-2 border-b border-border text-sm bg-base/30 overflow-x-auto">
          <Home class="w-3.5 h-3.5 text-textMuted mr-1 shrink-0" />
          <span
            v-for="(part, i) in breadcrumb"
            :key="part.path"
            class="flex items-center shrink-0"
          >
            <ChevronRight class="w-3 h-3 text-textMuted mx-1" />
            <span
              :class="i === breadcrumb.length - 1 ? 'text-textMain font-medium' : 'text-textMuted'"
            >{{ part.name }}</span>
          </span>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-auto">
          <!-- Empty state -->
          <div v-if="!selectedFile" class="h-full flex items-center justify-center text-textMuted p-4">
            <div class="text-center">
              <File class="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p class="text-sm">选择左侧文件查看内容</p>
            </div>
          </div>

          <!-- Loading -->
          <div v-else-if="contentLoading" class="h-full flex items-center justify-center text-textMuted">
            <Loader2 class="w-6 h-6 animate-spin" />
          </div>

          <!-- Binary file -->
          <div v-else-if="fileContent?.type === 'binary'" class="h-full flex items-center justify-center text-textMuted p-4">
            <div class="text-center">
              <File class="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p class="text-sm">二进制文件，无法预览</p>
              <p v-if="fileContent.size" class="text-xs mt-1">大小: {{ formatSize(fileContent.size) }}</p>
            </div>
          </div>

          <!-- Text content -->
          <pre v-else-if="fileContent?.type === 'text'" class="p-4 text-sm font-mono text-textMain leading-relaxed whitespace-pre-wrap break-all overflow-x-auto"><code>{{ fileContent.content }}</code></pre>
        </div>
      </div>
    </div>
  </div>
</template>
