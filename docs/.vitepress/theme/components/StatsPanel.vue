<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'

interface StatsTotals {
  instances: number
  startups: number
  pushes?: number
}

interface StatsPayload {
  schema: number
  updatedAt: string
  totals: StatsTotals
  activeInstances30d: number
  startupsLast30d: number
  pushesLast30d?: number
  startupsTrend30d: number[]
  pushTrend30d?: number[]
  osDistribution: Array<{ os: string; count: number }>
  topVersions: Array<{ version: string; count: number }>
}

const data = ref<StatsPayload | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)

const STATS_URL = '/stats.json'

async function fetchStats() {
  loading.value = true
  error.value = null
  try {
    const res = await fetch(STATS_URL, { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    data.value = (await res.json()) as StatsPayload
  } catch (err: any) {
    error.value = err?.message || String(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => { fetchStats() })

const showPushBlock = computed(() => {
  const d = data.value
  if (!d) return false
  return (d.schema ?? 1) >= 2 && typeof d.pushesLast30d === 'number'
})

function maxOf(arr: number[] | undefined): number {
  if (!arr || arr.length === 0) return 0
  return Math.max(...arr)
}

function formatTime(iso: string): string {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}
</script>

<template>
  <ClientOnly>
    <div>
      <p v-if="loading" class="stats-meta">加载中…</p>

      <div v-else-if="error" class="stats-error">
        <strong>暂时无法加载数据</strong>
        <p class="stats-meta">{{ error }}</p>
        <p class="stats-meta">
          数据更新可能延迟，请稍后再试，或直接访问
          <a href="/stats.json">/stats.json</a> /
          <a href="/stats.csv">/stats.csv</a>。
        </p>
      </div>

      <div v-else-if="data">
        <p class="stats-meta">
          数据更新时间：{{ formatTime(data.updatedAt) }} · schema v{{ data.schema }}
        </p>

        <div class="stats-grid">
          <div class="stats-card">
            <div class="num">{{ data.activeInstances30d.toLocaleString() }}</div>
            <div class="label">活跃实例</div>
            <ul class="sub-list">
              <li><span>累计匿名实例</span><span>{{ data.totals.instances.toLocaleString() }}</span></li>
              <li><span>累计启动次数</span><span>{{ data.totals.startups.toLocaleString() }}</span></li>
            </ul>
          </div>
          <div v-if="showPushBlock && typeof data.totals.pushes === 'number'" class="stats-card">
            <div class="num">{{ (data.totals.pushes || 0).toLocaleString() }}</div>
            <div class="label">累计 Push 次数</div>
          </div>
        </div>

        <h2>启动趋势（近 30 天）</h2>
        <div class="stats-bar-wrap">
          <div
            v-for="(v, i) in data.startupsTrend30d"
            :key="'s' + i"
            class="stats-bar"
            :class="{ empty: v === 0 }"
            :style="{ height: (maxOf(data.startupsTrend30d) ? (v / maxOf(data.startupsTrend30d) * 100) : 0) + '%' }"
            :title="'第 ' + (i + 1) + ' 天: ' + v"
          />
        </div>

        <template v-if="showPushBlock && data.pushTrend30d && data.pushTrend30d.length">
          <h2>Push 趋势（近 30 天）</h2>
          <div class="stats-bar-wrap">
            <div
              v-for="(v, i) in data.pushTrend30d"
              :key="'p' + i"
              class="stats-bar"
              :class="{ empty: v === 0 }"
              :style="{ height: (maxOf(data.pushTrend30d) ? (v / maxOf(data.pushTrend30d) * 100) : 0) + '%' }"
              :title="'第 ' + (i + 1) + ' 天: ' + v"
            />
          </div>
        </template>

        <h2>操作系统分布</h2>
        <ul class="stats-list">
          <li v-for="item in data.osDistribution" :key="item.os">
            <span>{{ item.os }}</span>
            <span>{{ item.count.toLocaleString() }}</span>
          </li>
        </ul>

        <h2>版本分布（Top）</h2>
        <ul class="stats-list">
          <li v-for="item in data.topVersions" :key="item.version">
            <span>{{ item.version }}</span>
            <span>{{ item.count.toLocaleString() }}</span>
          </li>
        </ul>

        <p class="stats-meta">
          原始数据下载：<a href="/stats.json">/stats.json</a> · <a href="/stats.csv">/stats.csv</a>
        </p>
      </div>
    </div>
  </ClientOnly>
</template>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.stats-card {
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.stats-card .num {
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
.stats-card .label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-top: 4px;
}
.stats-card .sub-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  border-top: 1px solid var(--vp-c-divider);
}
.stats-card .sub-list li {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}
.stats-card .sub-list li + li {
  border-top: 1px dashed var(--vp-c-divider);
}
.stats-bar-wrap {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 60px;
  margin: 8px 0 4px;
}
.stats-bar {
  flex: 1 1 0;
  min-width: 4px;
  background: var(--vp-c-brand-1);
  border-radius: 2px 2px 0 0;
  opacity: 0.85;
}
.stats-bar.empty { background: var(--vp-c-divider); opacity: 0.4; }
.stats-list {
  list-style: none;
  padding: 0;
  margin: 8px 0;
}
.stats-list li {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  font-variant-numeric: tabular-nums;
}
.stats-error {
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  color: var(--vp-c-text-2);
}
.stats-meta {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-top: 4px;
}
</style>
