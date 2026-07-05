import { ref, onUnmounted } from 'vue'
import { apiUrl } from '../lib/base'

export type SearchHit = {
  offset: number
  text: string
  before: string[]
  after: string[]
}

export type SearchParams = {
  q: string
  regex?: boolean
  caseInsensitive?: boolean
  maxHits?: number
  context?: number
  fromOffset?: number
  toOffset?: number
}

export type SearchHandlers = {
  onHit?: (hit: SearchHit) => void
  onTruncated?: (info: { maxHits: number }) => void
  onDone?: (info: { scannedBytes: number }) => void
  onError?: (msg: string) => void
}

export function useLogSearchStream(getToken: () => string) {
  const running = ref(false)
  let abortController: AbortController | null = null

  async function search(sourceId: string, params: SearchParams, handlers: SearchHandlers) {
    abort()
    abortController = new AbortController()
    running.value = true

    const qs = new URLSearchParams()
    qs.set('q', params.q)
    if (params.regex) qs.set('regex', '1')
    if (params.caseInsensitive) qs.set('caseInsensitive', '1')
    if (params.maxHits) qs.set('maxHits', String(params.maxHits))
    if (params.context !== undefined) qs.set('context', String(params.context))
    if (params.fromOffset !== undefined) qs.set('fromOffset', String(params.fromOffset))
    if (params.toOffset !== undefined) qs.set('toOffset', String(params.toOffset))

    try {
      const res = await fetch(apiUrl(`/log-sources/${sourceId}/search?${qs.toString()}`), {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: abortController.signal,
      })
      if (!res.ok || !res.body) {
        handlers.onError?.(`HTTP ${res.status}`)
        running.value = false
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop()!

        for (const part of parts) {
          if (!part.trim() || part.startsWith(':')) continue
          let eventType = 'message'
          let eventData = ''
          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) eventType = line.slice(7)
            else if (line.startsWith('data: ')) eventData += (eventData ? '\n' : '') + line.slice(6)
          }
          if (!eventData) continue
          try {
            const data = JSON.parse(eventData)
            if (eventType === 'hit') handlers.onHit?.(data)
            else if (eventType === 'truncated') handlers.onTruncated?.(data)
            else if (eventType === 'done') handlers.onDone?.(data)
            else if (eventType === 'error') handlers.onError?.(data?.message || 'search error')
          } catch {
            /* swallow */
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') handlers.onError?.(e?.message || 'search failed')
    } finally {
      running.value = false
    }
  }

  function abort() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    running.value = false
  }

  onUnmounted(abort)

  return { running, search, abort }
}
