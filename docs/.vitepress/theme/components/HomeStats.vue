<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { fetchStatsPayload, type StatsPayload } from '../utils/stats'

const REPO = 'ATQQ/Kite'
const REPO_URL = `https://github.com/${REPO}`

const data = ref<StatsPayload | null>(null)
const ok = ref(false)

const stars = ref<number | null>(null)
const forks = ref<number | null>(null)

onMounted(async () => {
  try {
    data.value = await fetchStatsPayload(30)
    ok.value = true
  } catch {
    ok.value = false
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}`)
    if (res.ok) {
      const json = await res.json()
      if (typeof json.stargazers_count === 'number') stars.value = json.stargazers_count
      if (typeof json.forks_count === 'number') forks.value = json.forks_count
    }
  } catch {
  }
})

const showPushCard = computed(() => {
  const d = data.value
  if (!d) return false
  return typeof d.totals.pushes === 'number'
})

const starText = computed(() => (stars.value == null ? '—' : stars.value.toLocaleString()))
const forkText = computed(() => (forks.value == null ? '—' : forks.value.toLocaleString()))
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
        <a
          class="home-stats-card home-stats-card-star"
          :href="REPO_URL"
          target="_blank"
          rel="noopener"
        >
          <div class="num">
            <span class="star-icon" aria-hidden="true">★</span>
            {{ starText }}
          </div>
          <div class="label">GitHub Stars · ATQQ/Kite</div>
          <ul class="sub-list">
            <li><span>Forks</span><span>{{ forkText }}</span></li>
            <li><span>点亮 Star 👍🏻</span><span>→</span></li>
          </ul>
        </a>
      </div>
      <p class="home-stats-link">
        <a href="/stats">查看完整面板 →</a>
        <span class="home-stats-note">数据公开透明，零敏感字段</span>
      </p>
    </div>
    <div v-else class="home-stats-fallback">
      <a :href="REPO_URL" target="_blank" rel="noopener" class="fallback-star">
        <span class="star-icon" aria-hidden="true">★</span>
        <span>{{ starText }}</span>
        <span class="fallback-star-label">Star on GitHub</span>
      </a>
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
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.home-stats-fallback a {
  color: var(--vp-c-brand-1);
}
.home-stats-card-star {
  display: block;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s ease, transform 0.2s ease, background 0.2s ease;
}
.home-stats-card-star:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-elv);
  transform: translateY(-1px);
}
.home-stats-card-star .num {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--vp-c-brand-1);
}
.star-icon {
  color: #f5b301;
  font-size: 24px;
  line-height: 1;
}
.fallback-star {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.fallback-star:hover {
  border-color: var(--vp-c-brand-1);
}
.fallback-star-label {
  color: var(--vp-c-text-2);
  font-weight: 400;
}
</style>
