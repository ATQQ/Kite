import { reactive } from 'vue'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastItem {
  id: number
  type: ToastType
  title: string
  message?: string
  duration: number
}

const state = reactive<{ items: ToastItem[] }>({ items: [] })
let seed = 1

function push(type: ToastType, title: string, message?: string, duration = 3200) {
  const id = seed++
  state.items.push({ id, type, title, message, duration })
  if (duration > 0) {
    setTimeout(() => dismiss(id), duration)
  }
  return id
}

function dismiss(id: number) {
  const idx = state.items.findIndex(t => t.id === id)
  if (idx >= 0) state.items.splice(idx, 1)
}

export function useToast() {
  return {
    items: state.items,
    dismiss,
    success: (title: string, message?: string, duration?: number) => push('success', title, message, duration),
    error: (title: string, message?: string, duration?: number) => push('error', title, message, duration ?? 5000),
    info: (title: string, message?: string, duration?: number) => push('info', title, message, duration),
    warning: (title: string, message?: string, duration?: number) => push('warning', title, message, duration),
  }
}
