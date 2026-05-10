import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'kite-theme'

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>((localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'dark')

  const getSystemTheme = (): 'light' | 'dark' => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  const resolvedTheme = ref<'light' | 'dark'>(
    mode.value === 'system' ? getSystemTheme() : mode.value
  )

  const applyTheme = (theme: 'light' | 'dark') => {
    resolvedTheme.value = theme
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }

  const setMode = (newMode: ThemeMode) => {
    mode.value = newMode
    localStorage.setItem(STORAGE_KEY, newMode)
    applyTheme(newMode === 'system' ? getSystemTheme() : newMode)
  }

  // Listen for system preference changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', () => {
    if (mode.value === 'system') {
      applyTheme(getSystemTheme())
    }
  })

  // Apply on init
  applyTheme(mode.value === 'system' ? getSystemTheme() : mode.value)

  return { mode, resolvedTheme, setMode }
})
