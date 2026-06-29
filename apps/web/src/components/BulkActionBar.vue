<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  count: number
  total?: number
  label?: string
  show?: boolean
}>(), {
  total: undefined,
  label: undefined,
  show: undefined,
})

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const { t } = useI18n()

const visible = computed(() => (props.show ?? props.count > 0))

const resolvedLabel = computed(() => {
  if (props.label) return props.label
  if (props.total != null) {
    return t('bulk.selectedOfTotal', { count: props.count, total: props.total })
  }
  return t('bulk.selectedCount', { count: props.count })
})
</script>

<template>
  <transition name="bar">
    <div
      v-if="visible"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-[min(96vw,720px)]"
    >
      <div
        class="flex items-center gap-3 bg-panel/95 backdrop-blur-md border border-border rounded-xl shadow-2xl px-4 py-3"
      >
        <button
          type="button"
          class="text-textMuted hover:text-textMain rounded p-1 transition-colors"
          :title="t('bulk.clear')"
          @click="emit('clear')"
        >
          <X class="w-4 h-4" />
        </button>
        <div class="text-sm text-textMain font-medium whitespace-nowrap">
          {{ resolvedLabel }}
        </div>
        <div class="h-5 w-px bg-border" />
        <div class="flex items-center gap-2 flex-wrap">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.bar-enter-active,
.bar-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
