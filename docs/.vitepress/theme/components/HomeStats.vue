<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'

interface StatsPayload {
  schema: number
  totals: { instances: number; startups: number; pushes?: number }
  activeInstances30d: number
  startupsLast30d: number
}

const data = ref<StatsPayload | null>(null)
const ok = ref(false)

onMounted(async () => {
  try {
    const res = await fetch('/stats.json', { cache: 'no-store' })
    if (!res.ok) return
    data.value = await res.json()
    ok.value = true
  } catch {
    ok.value = false
  }
})

const showPushCard = computed(() => {
  const d = data.value
  if (!d) return false
  return (d.schema ?? 1) >= 2 && typeof d.totals.pushes === 'number'
})
</script>

<template>
  <section class="home-stats">
    <div v-if="ok && data" class="home-stats-inner">
      <h2 class="home-stats-title">实时使用统计</h2>
      <div class="home-stats-grid">
        <div class="home-stats-card">
          <div class="num">{{ data.activeInstances30d.toLocaleString() }}</div>
          <div class="label">活跃实例</div>
          <ul class="sub-list">
            <li><span>累计匿名实例</span><span>{{ data.totals.instances.toLocaleString() }}</span></li>
            <li><span>累计启动次数</span><span>{{ data.totals.startups.toLocaleString() }}</span></li>
          </ul>
        </div>
        <div v-if="showPushCard" class="home-stats-card">
          <div class="num">{{ (data.totals.pushes || 0).toLocaleString() }}</div>
          <div class="label">累计 Push 次数</div>
        </div>
      </div>
      <p class="home-stats-link">
        <a href="/stats">查看完整面板 →</a>
        <span class="home-stats-note">数据公开透明，零敏感字段</span>
      </p>
    </div>
    <div v-else class="home-stats-fallback">
      <a href="/stats">查看完整使用统计 →</a>
    </div>
  </section>
</template>

<style scoped>
.home-stats {
  max-width: 1152px;
  margin: 48px auto 0;
  padding: 0 24px;
}
.home-stats-title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 16px;
}
.home-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.home-stats-card {
  padding: 16px 20px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.home-stats-card .num {
  font-size: 28px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.home-stats-card .label {
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-top: 4px;
}
.home-stats-card .sub-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  border-top: 1px solid var(--vp-c-divider);
}
.home-stats-card .sub-list li {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
  font-variant-numeric: tabular-nums;
}
.home-stats-card .sub-list li + li {
  border-top: 1px dashed var(--vp-c-divider);
}
.home-stats-link {
  margin-top: 12px;
  font-size: 13px;
}
.home-stats-link a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
.home-stats-note {
  margin-left: 12px;
  color: var(--vp-c-text-3);
}
.home-stats-fallback {
  text-align: center;
  font-size: 13px;
}
.home-stats-fallback a {
  color: var(--vp-c-brand-1);
}
</style>
