<script setup lang="ts">
import {
  ChevronRight, Folder, FolderOpen, FileText, FileCode, FileImage,
  FileJson, FileCog, Loader2
} from 'lucide-vue-next'

interface TreeNode {
  name: string
  path: string
  isDir: boolean
  size?: number
  expanded?: boolean
  children?: TreeNode[]
  loading?: boolean
}

const props = defineProps<{
  node: TreeNode
  depth: number
  selectedFile: string
}>()

const emit = defineEmits<{
  toggle: [node: TreeNode]
  select: [node: TreeNode]
}>()

function getIcon(name: string, isDir: boolean, expanded?: boolean) {
  if (isDir) return expanded ? FolderOpen : Folder
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['json', 'jsonc'].includes(ext)) return FileJson
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h'].includes(ext)) return FileCode
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return FileImage
  if (['yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'env'].includes(ext)) return FileCog
  return FileText
}
</script>

<template>
  <div>
    <button
      class="w-full flex items-center py-1.5 text-sm hover:bg-primary/5 transition-colors"
      :class="selectedFile === node.path && !node.isDir ? 'bg-primary/10 text-primary' : 'text-textMain'"
      :style="{ paddingLeft: (depth * 16 + 12) + 'px' }"
      @click="node.isDir ? emit('toggle', node) : emit('select', node)"
    >
      <ChevronRight
        v-if="node.isDir"
        class="w-3.5 h-3.5 mr-1 shrink-0 transition-transform"
        :class="node.expanded ? 'rotate-90' : ''"
      />
      <span v-else class="w-3.5 mr-1"></span>
      <component
        :is="getIcon(node.name, node.isDir, node.expanded)"
        class="w-4 h-4 mr-1.5 shrink-0"
        :class="node.isDir ? 'text-primary/70' : 'text-textMuted'"
      />
      <span class="truncate">{{ node.name }}</span>
    </button>

    <div v-if="node.isDir && node.expanded">
      <div v-if="node.loading" class="py-1 text-textMuted text-xs flex items-center" :style="{ paddingLeft: (depth * 16 + 28) + 'px' }">
        <Loader2 class="w-3 h-3 animate-spin mr-1" />
        加载中...
      </div>
      <template v-else-if="node.children">
        <FileTreeNode
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          :selected-file="selectedFile"
          @toggle="emit('toggle', $event)"
          @select="emit('select', $event)"
        />
      </template>
    </div>
  </div>
</template>
