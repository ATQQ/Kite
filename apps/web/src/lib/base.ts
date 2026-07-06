function readInjectedBase(): string {
  if (typeof window === 'undefined') return ''
  const raw = (window as any).__KITE_BASE__
  if (typeof raw !== 'string') return ''
  // Placeholder that was never replaced (dev mode / raw index.html) → treat as root
  if (raw === '%KITE_BASE%' || raw === '') return ''
  const stripped = raw.replace(/^\/+|\/+$/g, '')
  return stripped ? '/' + stripped : ''
}

export const BASE_PATH = readInjectedBase()

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : '/' + path
  return `${BASE_PATH}/api${p}`
}

export function pageUrl(path: string): string {
  const p = path.startsWith('/') ? path : '/' + path
  return `${BASE_PATH}${p}` || '/'
}

export function wsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const p = path.startsWith('/') ? path : '/' + path
  return `${proto}//${window.location.host}${BASE_PATH}/api${p}`
}

export function routerBase(): string {
  return BASE_PATH || '/'
}
