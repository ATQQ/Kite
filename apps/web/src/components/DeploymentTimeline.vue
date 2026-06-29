<script setup lang="ts">
import { computed } from 'vue'
import {
  Play,
  Terminal,
  Upload,
  Trash2,
  PackageOpen,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RotateCcw,
  Wrench,
  Loader2,
} from 'lucide-vue-next'
import type { TimelineEvent, TimelineKind } from '../utils/deployment-timeline'

const props = defineProps<{
  events: TimelineEvent[]
}>()

const emit = defineEmits<{
  (e: 'jump', rawLineIndex: number): void
}>()

const iconMap: Record<TimelineKind, any> = {
  start: Play,
  'pre-deploy': Terminal,
  push: Upload,
  clean: Trash2,
  extract: PackageOpen,
  'post-deploy': Terminal,
  archive: Save,
  gc: Trash2,
  'manual-mark': Wrench,
  'rollback-start': RotateCcw,
  'rollback-pre': Terminal,
  'rollback-clean': Trash2,
  'rollback-extract': PackageOpen,
  'rollback-post': Terminal,
  success: CheckCircle2,
  failed: AlertCircle,
  running: Loader2,
}

function toneClass(tone?: TimelineEvent['tone']): string {
  switch (tone) {
    case 'success': return 'text-success border-success/50 shadow-[0_0_8px_rgba(16,185,129,0.5)]'
    case 'danger': return 'text-danger border-danger/50 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
    case 'warning': return 'text-yellow-400 border-yellow-400/50 shadow-[0_0_8px_rgba(250,204,21,0.4)]'
    case 'primary': return 'text-primary border-primary/50 shadow-[0_0_8px_rgba(59,130,246,0.4)]'
    default: return 'text-textMuted border-border'
  }
}

function lineClass(tone?: TimelineEvent['tone']): string {
  switch (tone) {
    case 'success': return 'bg-success/40'
    case 'danger': return 'bg-danger/40'
    case 'warning': return 'bg-yellow-400/40'
    case 'primary': return 'bg-primary/40'
    default: return 'bg-border'
  }
}

const items = computed(() => props.events)

function fmtTime(ms?: number): string {
  if (ms === undefined) return '—'
  const d = new Date(ms)
  return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

function fmtDuration(ms?: number): string {
  if (ms === undefined) return ''
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rs = (s - m * 60).toFixed(0)
  return `${m}m ${rs}s`
}

function handleJump(ev: TimelineEvent) {
  if (ev.rawLineIndex === undefined) return
  emit('jump', ev.rawLineIndex)
}
</script>

<template>
  <div class="space-y-0">
    <div v-if="items.length === 0" class="text-textMuted text-sm py-8 text-center font-sans">
      暂无时间线事件
    </div>
    <ol v-else class="relative pl-6">
      <li
        v-for="(ev, idx) in items"
        :key="idx"
        class="relative pb-4 last:pb-0"
      >
        <span
          v-if="idx < items.length - 1"
          class="absolute left-[7px] top-4 bottom-0 w-px"
          :class="lineClass(ev.tone)"
          aria-hidden="true"
        ></span>
        <span
          class="absolute left-0 top-1 w-4 h-4 rounded-full border-2 bg-base flex items-center justify-center"
          :class="toneClass(ev.tone)"
        >
          <span
            v-if="ev.kind === 'running'"
            class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
            aria-hidden="true"
          ></span>
        </span>

        <button
          type="button"
          class="ml-2 w-full text-left bg-panel border border-border hover:border-primary/40 rounded-md p-3 text-xs transition-colors font-sans"
          :class="ev.rawLineIndex === undefined ? 'cursor-default' : 'cursor-pointer'"
          @click="handleJump(ev)"
        >
          <div class="flex items-start gap-2">
            <component
              :is="iconMap[ev.kind]"
              class="w-4 h-4 mt-0.5 shrink-0"
              :class="toneClass(ev.tone).split(' ')[0]"
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-medium text-textMain">{{ ev.label }}</span>
                <span
                  v-if="ev.exitCode !== undefined"
                  class="px-1 py-0 rounded text-[10px] font-mono"
                  :class="ev.exitCode === 0 ? 'bg-success/10 border border-success/30 text-success' : 'bg-danger/10 border border-danger/30 text-danger'"
                >exit {{ ev.exitCode }}</span>
                <span
                  v-if="ev.durationMs !== undefined"
                  class="text-textMuted font-mono ml-auto"
                >{{ fmtDuration(ev.durationMs) }}</span>
              </div>
              <div class="mt-1 text-textMuted font-mono text-[11px] truncate" :title="ev.detail || ''">
                {{ ev.detail || '—' }}
              </div>
              <div class="mt-1 flex items-center gap-2 text-textMuted/70 text-[10px] font-mono">
                <span>{{ fmtTime(ev.startedAt) }}</span>
                <template v-if="ev.endedAt !== undefined && ev.endedAt !== ev.startedAt">
                  <span>→</span>
                  <span>{{ fmtTime(ev.endedAt) }}</span>
                </template>
                <span
                  v-if="ev.estimated"
                  class="ml-auto inline-flex items-center gap-0.5 text-yellow-400/70"
                  title="时间戳为按日志行号比例估算"
                >
                  <AlertTriangle class="w-3 h-3" />
                  仅供参考·点击跳转原始日志
                </span>
              </div>
            </div>
          </div>
        </button>
      </li>
    </ol>
  </div>
</template>
