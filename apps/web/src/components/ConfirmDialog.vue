<script setup lang="ts">
import { computed, watch, nextTick, ref } from 'vue'
import { AlertTriangle, Info, RefreshCw, X } from 'lucide-vue-next'

type Tone = 'danger' | 'warning' | 'info'

const props = withDefaults(defineProps<{
  open: boolean
  title?: string
  message?: string
  tone?: Tone
  confirmText?: string
  cancelText?: string
  loading?: boolean
  /** When set, user must type this exact string to enable confirm */
  requireText?: string
  requireTextPlaceholder?: string
  requireTextHint?: string
}>(), {
  title: '确认操作',
  message: '',
  tone: 'info',
  confirmText: '确认',
  cancelText: '取消',
  loading: false,
  requireText: '',
  requireTextPlaceholder: '',
  requireTextHint: '',
})

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
  (e: 'update:open', v: boolean): void
}>()

const typed = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const toneIcon = computed(() => props.tone === 'info' ? Info : AlertTriangle)

const toneClasses = computed(() => {
  switch (props.tone) {
    case 'danger':
      return {
        border: 'border-danger/30',
        iconBg: 'bg-danger/10',
        iconText: 'text-danger',
        confirmBtn: 'bg-danger text-white hover:bg-danger/90',
      }
    case 'warning':
      return {
        border: 'border-yellow-400/30',
        iconBg: 'bg-yellow-400/10',
        iconText: 'text-yellow-400',
        confirmBtn: 'bg-yellow-400 text-black hover:bg-yellow-300',
      }
    default:
      return {
        border: 'border-border',
        iconBg: 'bg-primary/10',
        iconText: 'text-primary',
        confirmBtn: 'bg-primary text-white hover:bg-primary/90',
      }
  }
})

const needsTypeMatch = computed(() => props.requireText.length > 0)
const canConfirm = computed(() => {
  if (props.loading) return false
  if (!needsTypeMatch.value) return true
  return typed.value.trim() === props.requireText
})

function onCancel() {
  if (props.loading) return
  emit('cancel')
  emit('update:open', false)
}

function onConfirm() {
  if (!canConfirm.value) return
  emit('confirm')
}

watch(() => props.open, async (v) => {
  if (v) {
    typed.value = ''
    await nextTick()
    inputRef.value?.focus()
  }
})
</script>

<template>
  <transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="onCancel"
    >
      <div
        class="bg-panel border rounded-xl w-full max-w-lg p-6 shadow-2xl"
        :class="toneClasses.border"
        @keydown.esc="onCancel"
      >
        <div class="flex items-start space-x-4">
          <div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" :class="toneClasses.iconBg">
            <component :is="toneIcon" class="w-5 h-5" :class="toneClasses.iconText" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-semibold text-textMain">{{ title }}</h3>
            <p v-if="message" class="text-sm text-textMuted mt-1 whitespace-pre-line">{{ message }}</p>
            <slot />
          </div>
          <button
            @click="onCancel"
            :disabled="loading"
            class="text-textMuted hover:text-textMain rounded p-1 disabled:opacity-50"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <div v-if="needsTypeMatch" class="mt-5">
          <p v-if="requireTextHint" class="text-xs text-textMuted mb-2">{{ requireTextHint }}</p>
          <input
            ref="inputRef"
            v-model="typed"
            type="text"
            :disabled="loading"
            :placeholder="requireTextPlaceholder || requireText"
            class="w-full bg-base border border-border rounded-md px-3 py-2 text-textMain font-mono focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 text-sm disabled:opacity-60"
            @keydown.enter.prevent="onConfirm"
          />
        </div>

        <div class="mt-6 flex items-center justify-end space-x-2">
          <button
            @click="onCancel"
            :disabled="loading"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >{{ cancelText }}</button>
          <button
            @click="onConfirm"
            :disabled="!canConfirm"
            class="px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
            :class="toneClasses.confirmBtn"
          >
            <RefreshCw v-if="loading" class="w-4 h-4 mr-2 animate-spin" />
            {{ loading ? '处理中...' : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
