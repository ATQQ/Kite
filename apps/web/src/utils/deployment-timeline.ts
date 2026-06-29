export type TimelineKind =
  | 'start'
  | 'pre-deploy'
  | 'push'
  | 'clean'
  | 'extract'
  | 'post-deploy'
  | 'archive'
  | 'gc'
  | 'manual-mark'
  | 'rollback-start'
  | 'rollback-pre'
  | 'rollback-clean'
  | 'rollback-extract'
  | 'rollback-post'
  | 'success'
  | 'failed'
  | 'running'

export interface TimelineEvent {
  kind: TimelineKind
  label: string
  detail?: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  exitCode?: number
  rawLineIndex?: number
  estimated?: boolean
  tone?: 'success' | 'danger' | 'warning' | 'primary' | 'muted'
}

export interface ParseInput {
  output: string | null | undefined
  startTimeIso: string
  endTimeIso?: string | null
  status: 'running' | 'success' | 'failed'
  triggerSource: string
}

interface RawHit {
  kind: TimelineKind
  label: string
  detail?: string
  lineIndex: number
  tone?: TimelineEvent['tone']
  exitCode?: number
  explicitTime?: number
}

const ISO_AT_RE = /at\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/

const ISO_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\s+/

export interface SplitLine {
  timestamp: number | null
  rest: string
}

export function splitTimestamp(line: string): SplitLine {
  const m = line.match(ISO_PREFIX_RE)
  if (!m) return { timestamp: null, rest: line }
  const ts = Date.parse(m[1])
  return {
    timestamp: Number.isFinite(ts) ? ts : null,
    rest: line.slice(m[0].length),
  }
}

function detectHit(line: string, index: number): RawHit | null {
  const split = splitTimestamp(line)
  const trim = split.rest.trimEnd()
  const explicitFromPrefix = split.timestamp ?? undefined

  const hit = detectHitInner(trim, index)
  if (!hit) return null
  if (hit.explicitTime === undefined && explicitFromPrefix !== undefined) {
    hit.explicitTime = explicitFromPrefix
  }
  return hit
}

function detectHitInner(trim: string, index: number): RawHit | null {
  if (trim.startsWith('[Kite Deploy] Starting deployment')) {
    return { kind: 'start', label: '开始部署', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'primary' }
  }
  if (trim.startsWith('[Kite Deploy] Saved temp zip') || trim.startsWith('[Kite Deploy] Archived zip')) {
    return { kind: 'push', label: '接收产物', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'primary' }
  }
  if (trim.startsWith('[Kite Deploy] Target deploy path')) {
    return { kind: 'push', label: '解析目标路径', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'muted' }
  }
  if (trim.startsWith('[Kite Deploy] Running Pre-deploy')) {
    return { kind: 'pre-deploy', label: 'Pre-deploy', detail: trim.replace(/^\[Kite Deploy\] Running Pre-deploy:\s*/, ''), lineIndex: index, tone: 'primary' }
  }
  if (trim.startsWith('[Kite Deploy] Applying clean strategy') || trim.startsWith('[Kite Deploy] Clean done')) {
    return { kind: 'clean', label: '清理目标目录', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'muted' }
  }
  if (trim.startsWith('[Kite Deploy] Extracting files')) {
    return { kind: 'extract', label: '解压到目标目录', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'primary' }
  }
  if (
    trim.startsWith('[Kite Deploy] Running Post-deploy') ||
    trim.startsWith('[Kite Deploy] Dispatching Post-deploy')
  ) {
    return { kind: 'post-deploy', label: 'Post-deploy', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'primary' }
  }
  if (trim.startsWith('[Kite Deploy] (async) Post-deploy exited with code')) {
    const m = trim.match(/code\s+(-?\d+)/)
    const code = m ? Number(m[1]) : undefined
    return {
      kind: 'post-deploy',
      label: 'Post-deploy 异步退出',
      detail: trim.replace(/^\[Kite Deploy\]\s*/, ''),
      lineIndex: index,
      tone: code === 0 ? 'success' : 'danger',
      exitCode: code,
    }
  }
  if (trim.startsWith('[Kite Deploy] GC:')) {
    return { kind: 'gc', label: '归档 GC', detail: trim.replace(/^\[Kite Deploy\] GC:\s*/, ''), lineIndex: index, tone: 'muted' }
  }
  if (trim.startsWith('[Kite Deploy] Deployment completed successfully')) {
    return { kind: 'success', label: '部署成功', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'success' }
  }
  if (trim.startsWith('[Kite Deploy] Deployment failed')) {
    return { kind: 'failed', label: '部署失败', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'danger' }
  }
  if (trim.startsWith('[Kite Deploy] WARN')) {
    return { kind: 'archive', label: '归档警告', detail: trim.replace(/^\[Kite Deploy\]\s*/, ''), lineIndex: index, tone: 'warning' }
  }
  if (trim.startsWith('[Kite Rollback] Restoring deploy')) {
    return { kind: 'rollback-start', label: '开始回滚', detail: trim.replace(/^\[Kite Rollback\]\s*/, ''), lineIndex: index, tone: 'warning' }
  }
  if (trim.startsWith('[Kite Rollback] Running Pre-deploy')) {
    return { kind: 'rollback-pre', label: 'Pre-deploy', detail: trim.replace(/^\[Kite Rollback\] Running Pre-deploy:\s*/, ''), lineIndex: index, tone: 'warning' }
  }
  if (trim.startsWith('[Kite Rollback] Applying clean strategy') || trim.startsWith('[Kite Rollback] Clean done')) {
    return { kind: 'rollback-clean', label: '清理目标目录', detail: trim.replace(/^\[Kite Rollback\]\s*/, ''), lineIndex: index, tone: 'muted' }
  }
  if (trim.startsWith('[Kite Rollback] Extracting archive')) {
    return { kind: 'rollback-extract', label: '回滚解压', detail: trim.replace(/^\[Kite Rollback\]\s*/, ''), lineIndex: index, tone: 'warning' }
  }
  if (trim.startsWith('[Kite Rollback] Running Post-deploy')) {
    return { kind: 'rollback-post', label: 'Post-deploy', detail: trim.replace(/^\[Kite Rollback\] Running Post-deploy:\s*/, ''), lineIndex: index, tone: 'warning' }
  }
  if (trim.startsWith('[Kite Rollback] Rollback completed successfully')) {
    return { kind: 'success', label: '回滚成功', detail: trim.replace(/^\[Kite Rollback\]\s*/, ''), lineIndex: index, tone: 'success' }
  }
  if (trim.startsWith('[Kite Rollback] Rollback failed')) {
    return { kind: 'failed', label: '回滚失败', detail: trim.replace(/^\[Kite Rollback\]\s*/, ''), lineIndex: index, tone: 'danger' }
  }
  if (trim.startsWith('[Kite] Manually marked as')) {
    const m = trim.match(/Manually marked as\s+(\w+)/)
    const next = m?.[1]
    const isoMatch = trim.match(ISO_AT_RE)
    const explicitTime = isoMatch ? Date.parse(isoMatch[1]) : undefined
    return {
      kind: 'manual-mark',
      label: next === 'failed' ? '手动标记为失败' : '手动标记为成功',
      detail: trim.replace(/^\[Kite\]\s*/, ''),
      lineIndex: index,
      tone: next === 'failed' ? 'danger' : 'success',
      explicitTime,
    }
  }

  return null
}

function toMs(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : undefined
}

export function parseDeploymentEvents(input: ParseInput): TimelineEvent[] {
  const { output, startTimeIso, endTimeIso, status, triggerSource } = input
  const startMs = toMs(startTimeIso)
  const endMs = toMs(endTimeIso) ?? (status === 'running' ? undefined : startMs)

  const lines = (output || '').split('\n')
  const hits: RawHit[] = []
  for (let i = 0; i < lines.length; i++) {
    const hit = detectHit(lines[i], i)
    if (hit) hits.push(hit)
  }

  const isRollback = triggerSource === 'rollback'
  const startKind: TimelineKind = isRollback ? 'rollback-start' : 'start'
  const hasStartHit = hits.length > 0 && (hits[0].kind === 'start' || hits[0].kind === 'rollback-start')
  if (!hasStartHit && startMs !== undefined) {
    hits.unshift({
      kind: startKind,
      label: isRollback ? '开始回滚' : '开始部署',
      lineIndex: 0,
      tone: isRollback ? 'warning' : 'primary',
    })
  }

  const hasOutcomeHit = hits.some(h => h.kind === 'success' || h.kind === 'failed')
  if (!hasOutcomeHit) {
    if (status === 'success') {
      hits.push({
        kind: 'success',
        label: isRollback ? '回滚成功' : '部署成功',
        lineIndex: Math.max(0, lines.length - 1),
        tone: 'success',
      })
    } else if (status === 'failed') {
      hits.push({
        kind: 'failed',
        label: isRollback ? '回滚失败' : '部署失败',
        lineIndex: Math.max(0, lines.length - 1),
        tone: 'danger',
      })
    } else if (status === 'running') {
      hits.push({
        kind: 'running',
        label: '进行中…',
        lineIndex: Math.max(0, lines.length - 1),
        tone: 'primary',
      })
    }
  }

  const totalLines = Math.max(1, lines.length - 1)
  const totalDuration = startMs !== undefined && endMs !== undefined ? Math.max(0, endMs - startMs) : 0

  const events: TimelineEvent[] = hits.map((hit, idx) => {
    let startedAt: number | undefined
    let estimated = false
    if (hit.explicitTime !== undefined) {
      startedAt = hit.explicitTime
    } else if (idx === 0 && startMs !== undefined) {
      startedAt = startMs
    } else if (hit.kind === 'success' || hit.kind === 'failed') {
      startedAt = endMs ?? startMs
    } else if (startMs !== undefined && totalDuration > 0) {
      const ratio = hit.lineIndex / totalLines
      startedAt = startMs + Math.round(totalDuration * ratio)
      estimated = true
    } else {
      startedAt = startMs
      estimated = startMs !== undefined
    }

    return {
      kind: hit.kind,
      label: hit.label,
      detail: hit.detail,
      startedAt,
      exitCode: hit.exitCode,
      rawLineIndex: hit.lineIndex,
      estimated,
      tone: hit.tone,
    }
  })

  for (let i = 0; i < events.length - 1; i++) {
    const cur = events[i]
    const next = events[i + 1]
    cur.endedAt = next.startedAt
    if (cur.startedAt !== undefined && cur.endedAt !== undefined) {
      cur.durationMs = Math.max(0, cur.endedAt - cur.startedAt)
    }
  }
  const last = events[events.length - 1]
  if (last) {
    if (last.kind === 'success' || last.kind === 'failed') {
      last.endedAt = endMs ?? last.startedAt
      if (last.startedAt !== undefined && last.endedAt !== undefined) {
        last.durationMs = Math.max(0, last.endedAt - last.startedAt)
      }
    } else if (last.kind === 'running') {
      last.endedAt = undefined
      last.durationMs = undefined
    }
  }

  return events
}

if (import.meta.env?.DEV) {
  const sampleSuccess = [
    '[Kite Deploy] Starting deployment for demo...',
    '[Kite Deploy] Saved temp zip',
    '[Kite Deploy] Archived zip (12 KB) for rollback',
    '[Kite Deploy] Target deploy path: /var/www/demo',
    '[Kite Deploy] Running Pre-deploy: echo pre',
    '[Kite Deploy] Applying clean strategy: full (protect 0 patterns)',
    '[Kite Deploy] Clean done: removed 0 files (0.0 KB), kept 0',
    '[Kite Deploy] Extracting files...',
    '[Kite Deploy] Running Post-deploy: echo post',
    '[Kite Deploy] Deployment completed successfully in 1.2s.',
  ].join('\n')
  const evs = parseDeploymentEvents({
    output: sampleSuccess,
    startTimeIso: new Date(Date.now() - 1200).toISOString(),
    endTimeIso: new Date().toISOString(),
    status: 'success',
    triggerSource: 'cli',
  })
  console.assert(evs[0].kind === 'start', 'timeline parser: first event should be start')
  console.assert(evs[evs.length - 1].kind === 'success', 'timeline parser: last event should be success')
}
