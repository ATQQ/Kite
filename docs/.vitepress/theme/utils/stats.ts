export const DEFAULT_TELEMETRY_OVERVIEW_URL =
  'https://kite.sugarat.top/api/public/telemetry/overview'

export const FALLBACK_STATS_JSON = '/stats.json'

export interface StatsTotals {
  instances: number
  startups: number
  pushes?: number
}

export interface StatsPayload {
  schema: number
  updatedAt: string
  source: 'api' | 'static'
  totals: StatsTotals
  activeInstances30d: number
  startupsLast30d: number
  pushesLast30d?: number
  startupsTrend30d: number[]
  pushTrend30d?: number[]
  osDistribution: Array<{ os: string; count: number }>
  archDistribution: Array<{ arch: string; count: number }>
  topVersions: Array<{ version: string; count: number }>
  days: number
}

interface OverviewDailyRow {
  date: string
  serveStartup: number
  pushStart: number
  activeInstances: number
}

interface OverviewResponse {
  days: number
  generatedAt: string
  totals: {
    events: number
    serveStartup: number
    pushStart: number
    uniqueInstances: number
  }
  daily: OverviewDailyRow[]
  versions: Array<{ kiteVersion: string; events: number }>
  os: Array<{ os: string; events: number }>
  arch: Array<{ arch: string; events: number }>
}

function normalizeOverview(raw: OverviewResponse): StatsPayload {
  const daily = Array.isArray(raw.daily) ? raw.daily : []
  const startupsTrend = daily.map(d => Number(d.serveStartup) || 0)
  const pushTrend = daily.map(d => Number(d.pushStart) || 0)
  const activeSum = daily.reduce((sum, d) => sum + (Number(d.activeInstances) || 0), 0)
  const activeAvg = daily.length ? Math.round(activeSum / daily.length) : 0

  return {
    schema: 2,
    updatedAt: raw.generatedAt || new Date().toISOString(),
    source: 'api',
    days: raw.days,
    totals: {
      instances: raw.totals?.uniqueInstances ?? 0,
      startups: raw.totals?.serveStartup ?? 0,
      pushes: raw.totals?.pushStart ?? 0,
    },
    activeInstances30d: raw.totals?.uniqueInstances ?? activeAvg,
    startupsLast30d: startupsTrend.reduce((a, b) => a + b, 0),
    pushesLast30d: pushTrend.reduce((a, b) => a + b, 0),
    startupsTrend30d: startupsTrend,
    pushTrend30d: pushTrend,
    osDistribution: (raw.os || []).map(r => ({ os: r.os, count: r.events })),
    archDistribution: (raw.arch || []).map(r => ({ arch: r.arch, count: r.events })),
    topVersions: (raw.versions || []).map(r => ({ version: r.kiteVersion, count: r.events })),
  }
}

function normalizeLegacy(raw: any): StatsPayload {
  return {
    schema: Number(raw?.schema) || 1,
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
    source: 'static',
    days: 30,
    totals: {
      instances: raw?.totals?.instances ?? 0,
      startups: raw?.totals?.startups ?? 0,
      pushes: raw?.totals?.pushes,
    },
    activeInstances30d: raw?.activeInstances30d ?? 0,
    startupsLast30d: raw?.startupsLast30d ?? 0,
    pushesLast30d: raw?.pushesLast30d,
    startupsTrend30d: Array.isArray(raw?.startupsTrend30d) ? raw.startupsTrend30d : [],
    pushTrend30d: Array.isArray(raw?.pushTrend30d) ? raw.pushTrend30d : undefined,
    osDistribution: Array.isArray(raw?.osDistribution) ? raw.osDistribution : [],
    archDistribution: [],
    topVersions: Array.isArray(raw?.topVersions) ? raw.topVersions : [],
  }
}

function resolveOverviewUrl(): string {
  if (typeof window !== 'undefined') {
    const w = window as any
    if (typeof w.__KITE_TELEMETRY_OVERVIEW__ === 'string' && w.__KITE_TELEMETRY_OVERVIEW__) {
      return w.__KITE_TELEMETRY_OVERVIEW__
    }
  }
  return DEFAULT_TELEMETRY_OVERVIEW_URL
}

export async function fetchStatsPayload(days = 30): Promise<StatsPayload> {
  const url = `${resolveOverviewUrl()}?days=${days}`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = (await res.json()) as OverviewResponse
    return normalizeOverview(json)
  } catch (apiErr) {
    const res = await fetch(FALLBACK_STATS_JSON, { cache: 'no-store' })
    if (!res.ok) throw apiErr
    const json = await res.json()
    return normalizeLegacy(json)
  }
}
