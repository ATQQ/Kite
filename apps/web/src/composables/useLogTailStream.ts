import { ref, onUnmounted } from 'vue'

export type TailHandlers = {
  onSnapshot?: (payload: { size: number; lines: string[]; binary: boolean }) => void
  onLines?: (payload: { lines: string[] }) => void
  onRotated?: (payload: { at: string }) => void
  onError?: (msg: string) => void
}

export function useLogTailStream(getToken: () => string) {
  const connected = ref(false)
  let abortController: AbortController | null = null

  async function connect(sourceId: string, tailLines: number, handlers: TailHandlers) {
    disconnect()
    abortController = new AbortController()
    connected.value = true

    try {
      const res = await fetch(`/api/log-sources/${sourceId}/stream?tailLines=${tailLines}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
        signal: abortController.signal,
      })
      if (!res.ok || !res.body) {
        handlers.onError?.(`HTTP ${res.status}`)
        connected.value = false
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
            if (eventType === 'snapshot') handlers.onSnapshot?.(data)
            else if (eventType === 'lines') handlers.onLines?.(data)
            else if (eventType === 'rotated') handlers.onRotated?.(data)
            else if (eventType === 'error') handlers.onError?.(data?.message || 'stream error')
          } catch {
            /* swallow parse errors */
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') handlers.onError?.(e?.message || 'connect failed')
    } finally {
      connected.value = false
    }
  }

  function disconnect() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    connected.value = false
  }

  onUnmounted(disconnect)

  return { connected, connect, disconnect }
}
