<script setup lang="ts">
import { computed } from 'vue'
import LogPane from './LogPane.vue'

type PaneSource = {
  id: string
  label: string
  filePath: string
}

const props = defineProps<{
  sources: PaneSource[]
}>()

const emit = defineEmits<{
  (e: 'remove', id: string): void
}>()

const gridClass = computed(() => {
  const n = props.sources.length
  if (n <= 1) return 'grid-cols-1'
  if (n === 2) return 'grid-cols-1 lg:grid-cols-2'
  if (n === 3) return 'grid-cols-1 lg:grid-cols-3'
  return 'grid-cols-1 lg:grid-cols-2 lg:grid-rows-2'
})
</script>

<template>
  <div
    class="grid gap-3 w-full h-full"
    :class="gridClass"
    style="min-height: 540px;"
  >
    <div
      v-for="s in sources"
      :key="s.id"
      class="bg-panel border border-border rounded-lg flex flex-col min-h-0 overflow-hidden"
      style="min-height: 320px;"
    >
      <LogPane
        :source-id="s.id"
        :label="s.label"
        :file-path="s.filePath"
        :show-close="true"
        @close="emit('remove', s.id)"
      />
    </div>
  </div>
</template>
