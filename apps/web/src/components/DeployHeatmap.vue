<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Cell { date: string; count: number }

const props = defineProps<{
  cells: Cell[]
  loading?: boolean
}>()

const { t, tm } = useI18n()

const WEEK_LABELS = computed(() => tm('heatmap.weekdayShort') as string[])

const grid = computed(() => {
  if (!props.cells.length) return { columns: [] as Array<Array<Cell | null>>, max: 0 }
  const sorted = [...props.cells].sort((a, b) => a.date.localeCompare(b.date))
  const first = new Date(sorted[0].date + 'T00:00:00Z')
  const offset = first.getUTCDay()
  const padded: Array<Cell | null> = Array(offset).fill(null).concat(sorted)
  const columns: Array<Array<Cell | null>> = []
  for (let i = 0; i < padded.length; i += 7) {
    columns.push(padded.slice(i, i + 7))
  }
  if (columns.length && columns[columns.length - 1].length < 7) {
    while (columns[columns.length - 1].length < 7) columns[columns.length - 1].push(null)
  }
  const max = sorted.reduce((m, c) => Math.max(m, c.count), 0)
  return { columns, max }
})

function levelClass(count: number, max: number): string {
  if (!count) return 'bg-border/40'
  if (max <= 1) return 'bg-emerald-500'
  const ratio = count / max
  if (ratio >= 0.75) return 'bg-emerald-400'
  if (ratio >= 0.5) return 'bg-emerald-500/80'
  if (ratio >= 0.25) return 'bg-emerald-600/70'
  return 'bg-emerald-700/60'
}

function tooltip(cell: Cell | null): string {
  if (!cell) return ''
  return t('heatmap.cellTooltip', { date: cell.date, count: cell.count })
}

const totalCount = computed(() => props.cells.reduce((s, c) => s + c.count, 0))
</script>

<template>
  <div class="bg-panel border border-border rounded-xl p-4 sm:p-6 shadow-sm">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <div>
        <h3 class="text-base font-semibold text-textMain">{{ t('heatmap.subtitle') }}</h3>
        <p class="text-xs text-textMuted mt-1">{{ t('heatmap.subtitleDetail', { days: cells.length, count: totalCount }) }}</p>
      </div>
      <div class="flex items-center gap-1 text-xs text-textMuted">
        <span class="mr-1">{{ t('heatmap.less') }}</span>
        <span class="w-3 h-3 rounded-sm bg-border/40"></span>
        <span class="w-3 h-3 rounded-sm bg-emerald-700/60"></span>
        <span class="w-3 h-3 rounded-sm bg-emerald-600/70"></span>
        <span class="w-3 h-3 rounded-sm bg-emerald-500/80"></span>
        <span class="w-3 h-3 rounded-sm bg-emerald-400"></span>
        <span class="ml-1">{{ t('heatmap.more') }}</span>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-textMuted py-8 text-center">{{ t('heatmap.loading') }}</div>
    <div v-else-if="!cells.length" class="text-sm text-textMuted py-8 text-center">{{ t('heatmap.empty') }}</div>
    <div v-else class="flex gap-3 overflow-x-auto">
      <div class="flex flex-col justify-around text-[10px] text-textMuted pt-1 pb-1 select-none">
        <span v-for="label in WEEK_LABELS" :key="label" class="h-3 leading-3">{{ label }}</span>
      </div>
      <div class="flex gap-[3px]">
        <div v-for="(col, ci) in grid.columns" :key="ci" class="flex flex-col gap-[3px]">
          <div
            v-for="(cell, ri) in col"
            :key="ri"
            :class="[
              'w-3 h-3 rounded-sm transition-transform hover:scale-125',
              cell ? levelClass(cell.count, grid.max) : 'bg-transparent'
            ]"
            :title="tooltip(cell)"
            :aria-label="tooltip(cell) || t('heatmap.ariaNoData')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
