import { ref, onUnmounted, watch, type Ref } from 'vue'

export function useDeployStream(deployId: Ref<string | null>, adminToken: Ref<string>) {
  const lines = ref<string[]>([])
  const status = ref<string>('')
  let abortController: AbortController | null = null
  let initialized = false

  async function connect(id: string) {
    disconnect()
    lines.value = []
    status.value = ''
    initialized = false

    abortController = new AbortController()

    try {
      const res = await fetch(`/api/logs/${id}/stream`, {
        headers: { 'Authorization': `Bearer ${adminToken.value}` },
        signal: abortController.signal,
      })

      if (!res.ok || !res.body) return

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
          if (!part.trim()) continue

          let eventType = 'message'
          let eventData = ''

          for (const line of part.split('\n')) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7)
            } else if (line.startsWith('data: ')) {
              eventData = line.slice(6)
            }
          }

          if (eventType === 'log') {
            const text = JSON.parse(eventData)
            if (!initialized) {
              // Initial load: replace all lines with full history
              lines.value = text.split('\n')
              initialized = true
            } else {
              // Subsequent: append new line
              lines.value.push(text)
            }
          } else if (eventType === 'status') {
            const data = JSON.parse(eventData)
            status.value = data.status
            disconnect()
            return
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('SSE connection error:', e)
      }
    }
  }

  function disconnect() {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
  }

  watch(deployId, (id) => {
    if (id) {
      connect(id)
    } else {
      disconnect()
    }
  })

  onUnmounted(disconnect)

  return { lines, status, disconnect }
}
