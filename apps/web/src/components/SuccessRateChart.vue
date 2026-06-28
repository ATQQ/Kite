<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Point { date: string; success: number; failed: number; total: number; rate: number | null }

const props = defineProps<{
  points: Point[]
  loading?: boolean
}>()

const { t } = useI18n()

const VIEWBOX_W = 600
const VIEWBOX_H = 180
const PAD_L = 32
const PAD_R = 12
const PAD_T = 16
const PAD_B = 28

const chart = computed(() => {
  const pts = props.points
  if (!pts.length) return { coords: [] as Array<{ x: number; y: number; p: Point }>, polyline: '', avg: null as number | null }
  const innerW = VIEWBOX_W - PAD_L - PAD_R
  const innerH = VIEWBOX_H - PAD_T - PAD_B
  const stepX = pts.length > 1 ? innerW / (pts.length - 1) : 0
  const coords = pts.map((p, i) => {
    const rate = p.rate ?? 1
    return {
      x: PAD_L + stepX * i,
      y: PAD_T + innerH * (1 - rate),
      p,
    }
  })
  const valid = pts.filter(p => p.rate !== null)
  const avg = valid.length ? valid.reduce((s, p) => s + (p.rate ?? 0), 0) / valid.length : null
  return { coords, polyline: coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '), avg }
})

const xLabels = computed(() => {
  const pts = props.points
  if (!pts.length) return []
  const indices = pts.length <= 7 ? pts.map((_, i) => i) : [0, Math.floor(pts.length / 2), pts.length - 1]
  return indices.map(i => ({ x: chart.value.coords[i]?.x ?? 0, label: pts[i].date.slice(5) }))
})

const totals = computed(() => {
  let success = 0, failed = 0, total = 0
  for (const p of props.points) { success += p.success; failed += p.failed; total += p.total }
  return { success, failed, total }
})

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `${(n * 100).toFixed(1)}%`
}
</script>

<template>
  <div class="bg-panel border border-border rounded-xl p-4 sm:p-6 shadow-sm">
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <div>
        <h3 class="text-base font-semibold text-textMain">{{ t('chart.successRateTitle', { days: points.length }) }}</h3>
        <p class="text-xs text-textMuted mt-1">
          {{ t('chart.successRateSummary', { total: totals.total }) }} <span class="text-success">{{ totals.success }}</span>
          {{ t('chart.successRateFailedLabel') }} <span class="text-danger">{{ totals.failed }}</span>
          {{ t('chart.successRateAvgLabel') }} <span class="font-mono">{{ fmtPct(chart.avg) }}</span>
        </p>
      </div>
    </div>

    <div v-if="loading" class="text-sm text-textMuted py-8 text-center">{{ t('chart.successRateLoading') }}</div>
    <div v-else-if="!totals.total" class="text-sm text-textMuted py-8 text-center">{{ t('chart.successRateEmpty') }}</div>
    <svg v-else :viewBox="`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`" class="w-full h-44 overflow-visible" role="img" :aria-label="t('chart.successRateAria')">
      <g class="text-textMuted" stroke="currentColor" stroke-opacity="0.15">
        <line :x1="PAD_L" :y1="PAD_T" :x2="VIEWBOX_W - PAD_R" :y2="PAD_T" />
        <line :x1="PAD_L" :y1="PAD_T + (VIEWBOX_H - PAD_T - PAD_B) * 0.5" :x2="VIEWBOX_W - PAD_R" :y2="PAD_T + (VIEWBOX_H - PAD_T - PAD_B) * 0.5" />
        <line :x1="PAD_L" :y1="VIEWBOX_H - PAD_B" :x2="VIEWBOX_W - PAD_R" :y2="VIEWBOX_H - PAD_B" />
      </g>
      <g class="text-textMuted" fill="currentColor" font-size="10" font-family="monospace">
        <text :x="PAD_L - 6" :y="PAD_T + 3" text-anchor="end">100%</text>
        <text :x="PAD_L - 6" :y="PAD_T + (VIEWBOX_H - PAD_T - PAD_B) * 0.5 + 3" text-anchor="end">50%</text>
        <text :x="PAD_L - 6" :y="VIEWBOX_H - PAD_B + 3" text-anchor="end">0%</text>
      </g>
      <polyline
        :points="chart.polyline"
        fill="none"
        class="text-primary"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g>
        <circle
          v-for="(c, i) in chart.coords"
          :key="i"
          :cx="c.x"
          :cy="c.y"
          :r="c.p.total === 0 ? 1.5 : 3"
          :class="c.p.rate === null ? 'text-textMuted' : (c.p.rate < 0.8 ? 'text-danger' : 'text-primary')"
          fill="currentColor"
        >
          <title>{{ t('chart.pointTooltip', { date: c.p.date, success: c.p.success, failed: c.p.failed, rate: fmtPct(c.p.rate) }) }}</title>
        </circle>
      </g>
      <g class="text-textMuted" fill="currentColor" font-size="10" font-family="monospace">
        <text v-for="(lbl, i) in xLabels" :key="i" :x="lbl.x" :y="VIEWBOX_H - PAD_B + 14" text-anchor="middle">{{ lbl.label }}</text>
      </g>
    </svg>
  </div>
</template>
