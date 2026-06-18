<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChevronRight, ChevronDown, FileText, Folder, ShieldCheck, Trash2 } from 'lucide-vue-next'
import type { CleanPreviewNode } from '../store/project'

const props = defineProps<{
  node: CleanPreviewNode
  depth?: number
  defaultExpand?: boolean
}>()

const depth = computed(() => props.depth ?? 0)
const expanded = ref<boolean>(props.defaultExpand ?? depth.value < 1)

const hasChildren = computed(() => !!props.node.children && props.node.children.length > 0)

const formatSize = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const toneClass = computed(() => {
  if (props.node.type === 'dir') {
    if (!hasChildren.value) return 'text-textMuted'
    return props.node.willDelete ? 'text-danger' : 'text-textMain'
  }
  return props.node.willDelete ? 'text-danger' : 'text-success'
})
</script>

<template>
  <div class="select-none">
    <div
      class="flex items-center gap-1.5 py-0.5 px-1 rounded text-xs hover:bg-white/[0.03] dark:hover:bg-white/[0.04]"
      :style="{ paddingLeft: `${depth * 14 + 4}px` }"
    >
      <button
        v-if="hasChildren"
        @click="expanded = !expanded"
        class="w-4 h-4 flex items-center justify-center text-textMuted hover:text-textMain"
        type="button"
      >
        <ChevronDown v-if="expanded" class="w-3 h-3" />
        <ChevronRight v-else class="w-3 h-3" />
      </button>
      <span v-else class="w-4 h-4 inline-block"></span>

      <Folder v-if="node.type === 'dir'" class="w-3.5 h-3.5 shrink-0" :class="toneClass" />
      <FileText v-else class="w-3.5 h-3.5 shrink-0" :class="toneClass" />

      <span class="font-mono truncate flex-1" :class="toneClass">{{ node.name || '/' }}</span>
      <span class="text-textMuted shrink-0 font-mono">{{ formatSize(node.size) }}</span>
      <Trash2 v-if="node.willDelete && node.type === 'file'" class="w-3 h-3 text-danger/80 shrink-0" />
      <ShieldCheck v-else-if="!node.willDelete && node.type === 'file'" class="w-3 h-3 text-success/80 shrink-0" />
    </div>
    <template v-if="expanded && hasChildren">
      <DeleteTreeView
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
      />
    </template>
  </div>
</template>
