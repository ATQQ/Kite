import { ref, onMounted } from 'vue'
import { GITHUB_REPO } from '../constants'

const CACHE_KEY = `kite:gh-stars:${GITHUB_REPO}`
const TTL_MS = 60 * 60 * 1000
let inflight: Promise<number | null> | null = null

function readCache(): number | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { stars, ts } = JSON.parse(raw)
    if (typeof stars === 'number' && typeof ts === 'number' && Date.now() - ts < TTL_MS) {
      return stars
    }
  } catch {}
  return null
}

function writeCache(stars: number) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ stars, ts: Date.now() }))
  } catch {}
}

async function fetchStars(): Promise<number | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    if (typeof data?.stargazers_count !== 'number') return null
    writeCache(data.stargazers_count)
    return data.stargazers_count
  } catch {
    return null
  }
}

export function formatStars(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

export function useGithubStars() {
  const stars = ref<number | null>(readCache())
  onMounted(() => {
    if (stars.value !== null) return
    if (!inflight) inflight = fetchStars()
    inflight.then((v) => {
      stars.value = v
    })
  })
  return { stars, formatStars }
}
