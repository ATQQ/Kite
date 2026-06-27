import { ref, shallowRef, type Ref } from 'vue'

export type TerminalWsStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface UseTerminalSocketOptions {
  token: Ref<string>
  onData?: (chunk: string) => void
  onReady?: (info: { sessionId: string; pid: number; shell: string; cwd: string; projectId: string | null }) => void
  onExit?: (info: { exitCode: number | null; signal: number | string | null }) => void
  onError?: (info: { reason?: string; message?: string }) => void
  onStatus?: (s: TerminalWsStatus) => void
}

export const TERMINAL_SUBPROTOCOL = 'kite-admin-token'

export function useTerminalSocket(opts: UseTerminalSocketOptions) {
  const status = ref<TerminalWsStatus>('idle')
  const lastError = ref<string | null>(null)
  const socketRef = shallowRef<WebSocket | null>(null)

  function setStatus(s: TerminalWsStatus) {
    status.value = s
    opts.onStatus?.(s)
  }

  function connect(params: { cwd?: string; projectId?: string | null; cols: number; rows: number }) {
    disconnect()
    setStatus('connecting')
    lastError.value = null

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = new URL(`${proto}//${window.location.host}/api/terminal/ws`)
    if (params.projectId) url.searchParams.set('projectId', params.projectId)
    else if (params.cwd) url.searchParams.set('cwd', params.cwd)
    url.searchParams.set('cols', String(params.cols))
    url.searchParams.set('rows', String(params.rows))

    const ws = new WebSocket(url.toString(), [TERMINAL_SUBPROTOCOL, opts.token.value])
    socketRef.value = ws

    ws.onopen = () => setStatus('open')
    ws.onclose = () => setStatus('closed')
    ws.onerror = () => {
      lastError.value = '连接错误'
      setStatus('error')
    }
    ws.onmessage = (ev) => {
      let msg: any
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') } catch { return }
      if (!msg || typeof msg !== 'object') return
      switch (msg.type) {
        case 'ready':
          opts.onReady?.({
            sessionId: msg.sessionId,
            pid: msg.pid,
            shell: msg.shell,
            cwd: msg.cwd,
            projectId: msg.projectId ?? null,
          })
          break
        case 'data':
          if (typeof msg.data === 'string') opts.onData?.(msg.data)
          break
        case 'exit':
          opts.onExit?.({ exitCode: msg.exitCode ?? null, signal: msg.signal ?? null })
          break
        case 'error':
          lastError.value = msg.message || msg.reason || 'unknown error'
          opts.onError?.({ reason: msg.reason, message: msg.message })
          break
        case 'pong':
          break
      }
    }
  }

  function sendInput(data: string) {
    const ws = socketRef.value
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'input', data }))
  }

  function sendResize(cols: number, rows: number) {
    const ws = socketRef.value
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'resize', cols, rows }))
  }

  function disconnect() {
    const ws = socketRef.value
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try { ws.close(1000, 'client closed') } catch {}
    }
    socketRef.value = null
  }

  return {
    status,
    lastError,
    connect,
    sendInput,
    sendResize,
    disconnect,
  }
}
