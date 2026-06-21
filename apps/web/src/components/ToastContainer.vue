<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-vue-next'
import { useToast, type ToastType } from '../composables/useToast'

const { items, dismiss } = useToast()

const iconMap = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const

const toneMap: Record<ToastType, { border: string; icon: string; bg: string }> = {
  success: { border: 'border-success/40', icon: 'text-success', bg: 'bg-success/10' },
  error: { border: 'border-danger/40', icon: 'text-danger', bg: 'bg-danger/10' },
  warning: { border: 'border-yellow-400/40', icon: 'text-yellow-400', bg: 'bg-yellow-400/10' },
  info: { border: 'border-primary/40', icon: 'text-primary', bg: 'bg-primary/10' },
}

const list = computed(() => items)
</script>

<template>
  <teleport to="body">
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      <transition-group name="toast" tag="div" class="flex flex-col gap-2">
        <div
          v-for="t in list"
          :key="t.id"
          class="pointer-events-auto bg-panel border rounded-lg shadow-xl p-3 flex items-start gap-3"
          :class="toneMap[t.type].border"
        >
          <div class="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0" :class="toneMap[t.type].bg">
            <component :is="iconMap[t.type]" class="w-4 h-4" :class="toneMap[t.type].icon" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-textMain">{{ t.title }}</div>
            <div v-if="t.message" class="text-xs text-textMuted mt-0.5 break-words">{{ t.message }}</div>
          </div>
          <button
            @click="dismiss(t.id)"
            class="text-textMuted hover:text-textMain p-0.5 rounded flex-shrink-0"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </transition-group>
    </div>
  </teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
.toast-move {
  transition: transform 0.25s ease;
}
</style>
