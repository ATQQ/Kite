<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, Eye, Loader2, ShieldAlert, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { CleanPreviewResult } from '../store/project'
import DeleteTreeView from './DeleteTreeView.vue'

const props = defineProps<{
  open: boolean
  loading?: boolean
  error?: string
  preview?: CleanPreviewResult | null
  mode: 'clean' | 'clean-all'
  protectPaths: string[]
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
}>()

const { t } = useI18n()

const isAll = computed(() => props.mode === 'clean-all')

const summary = computed(() => props.preview?.summary)
const tree = computed(() => props.preview?.tree)

const formatBytes = (n?: number) => {
  if (n == null) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

function close() {
  emit('update:open', false)
}

const localProtect = ref<string[]>([])
watch(() => props.protectPaths, (v) => { localProtect.value = [...(v || [])] }, { immediate: true })
</script>

<template>
  <transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        class="bg-panel border rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85vh]"
        :class="isAll ? 'border-danger/40' : 'border-yellow-400/30'"
      >
        <!-- Header -->
        <div class="px-6 py-4 border-b flex items-start gap-3" :class="isAll ? 'border-danger/30' : 'border-border'">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" :class="isAll ? 'bg-danger/10' : 'bg-yellow-400/10'">
            <ShieldAlert v-if="isAll" class="w-5 h-5 text-danger" />
            <Eye v-else class="w-5 h-5 text-yellow-400" />
          </div>
          <div class="flex-1 min-w-0">
            <h3 class="text-base font-semibold text-textMain">
              {{ t('files.cleanPreviewDialog.title', { mode }) }}
              <span class="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-base border border-border text-textMuted align-middle font-mono">{{ t('files.cleanPreviewDialog.dryRunBadge') }}</span>
            </h3>
            <p class="text-xs text-textMuted mt-1">
              {{ t('files.cleanPreviewDialog.intro') }}
            </p>
          </div>
          <button @click="close" class="text-textMuted hover:text-textMain p-1 rounded" type="button">
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- Banner for clean-all -->
        <div v-if="isAll" class="mx-6 mt-4 p-3 rounded-md bg-danger/10 border border-danger/30 flex items-start gap-2">
          <AlertTriangle class="w-4 h-4 text-danger shrink-0 mt-0.5" />
          <p class="text-xs text-danger leading-relaxed">
            <strong>clean-all</strong> {{ t('files.cleanPreviewDialog.cleanAllWarnPrefix') }} <code class="font-mono bg-base px-1 rounded">.kite-*</code> {{ t('files.cleanPreviewDialog.cleanAllWarnSuffix') }}
          </p>
        </div>

        <!-- Summary -->
        <div class="px-6 py-4 grid grid-cols-3 gap-3 border-b border-border">
          <div class="bg-base border border-border rounded-md p-3">
            <p class="text-[10px] text-textMuted uppercase tracking-wider">{{ t('files.cleanPreviewDialog.summaryDelete') }}</p>
            <p class="text-lg font-bold text-danger font-mono">{{ summary?.deleteFiles ?? '-' }}</p>
            <p class="text-[10px] text-textMuted">{{ formatBytes(summary?.deleteBytes) }}</p>
          </div>
          <div class="bg-base border border-border rounded-md p-3">
            <p class="text-[10px] text-textMuted uppercase tracking-wider">{{ t('files.cleanPreviewDialog.summaryProtect') }}</p>
            <p class="text-lg font-bold text-success font-mono">{{ summary?.protectFiles ?? '-' }}</p>
            <p class="text-[10px] text-textMuted">{{ t('files.cleanPreviewDialog.summaryProtectHit') }}</p>
          </div>
          <div class="bg-base border border-border rounded-md p-3">
            <p class="text-[10px] text-textMuted uppercase tracking-wider">{{ t('files.cleanPreviewDialog.summaryTotal') }}</p>
            <p class="text-lg font-bold text-textMain font-mono">{{ summary?.totalFiles ?? '-' }}</p>
            <p v-if="summary?.truncated" class="text-[10px] text-yellow-400">{{ t('files.cleanPreviewDialog.summaryTruncated') }}</p>
            <p v-else class="text-[10px] text-textMuted">{{ t('files.cleanPreviewDialog.summaryFullScan') }}</p>
          </div>
        </div>

        <!-- Protect chips -->
        <div v-if="localProtect.length" class="px-6 py-3 border-b border-border flex items-center gap-2 flex-wrap">
          <span class="text-xs text-textMuted shrink-0">{{ t('files.cleanPreviewDialog.protectPathsLabel') }}</span>
          <span
            v-for="g in localProtect"
            :key="g"
            class="text-[11px] px-2 py-0.5 rounded bg-success/10 border border-success/30 text-success font-mono"
          >{{ g }}</span>
        </div>

        <!-- Tree -->
        <div class="flex-1 overflow-y-auto px-4 py-3 min-h-[200px]">
          <div v-if="loading" class="flex items-center justify-center py-10 text-textMuted">
            <Loader2 class="w-4 h-4 mr-2 animate-spin" />
            {{ t('files.cleanPreviewDialog.scanning') }}
          </div>
          <div v-else-if="error" class="text-sm text-danger py-6 text-center">{{ error }}</div>
          <div v-else-if="!tree || !tree.children?.length" class="text-textMuted text-sm py-6 text-center">
            {{ t('files.cleanPreviewDialog.emptyDir') }}
          </div>
          <DeleteTreeView v-else :node="tree" :depth="0" :default-expand="true" />
        </div>

        <!-- Footer -->
        <div class="px-6 py-3 border-t border-border flex items-center justify-between">
          <span v-if="preview?.cached" class="text-[11px] text-textMuted">{{ t('files.cleanPreviewDialog.cachedHint') }}</span>
          <span v-else></span>
          <button
            @click="close"
            class="px-4 py-2 text-sm font-medium text-textMuted hover:text-textMain dark:hover:bg-white/5 hover:bg-black/5 rounded-md transition-colors"
            type="button"
          >{{ t('files.cleanPreviewDialog.closeButton') }}</button>
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
