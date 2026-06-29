import { defineStore } from 'pinia'
import { ref } from 'vue'

export const usePaletteStore = defineStore('palette', () => {
  const isOpen = ref(false)
  const recent = ref<string[]>([])

  function open() { isOpen.value = true }
  function close() { isOpen.value = false }
  function toggle() { isOpen.value = !isOpen.value }

  function pushRecent(q: string) {
    const trimmed = q.trim()
    if (!trimmed) return
    const next = [trimmed, ...recent.value.filter(item => item !== trimmed)]
    recent.value = next.slice(0, 5)
  }
  function clearRecent() { recent.value = [] }

  return { isOpen, recent, open, close, toggle, pushRecent, clearRecent }
})
