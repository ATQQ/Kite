import { defineStore } from 'pinia'
import { ref } from 'vue'
import { i18n, detectLocale, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n'

export type { SupportedLocale } from '../i18n'
export { SUPPORTED_LOCALES } from '../i18n'

const applyDocumentLang = (locale: SupportedLocale) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

const isSupportedLocale = (v: unknown): v is SupportedLocale =>
  typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v)

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<SupportedLocale>(detectLocale())

  const applyLocale = (next: SupportedLocale, persist: boolean) => {
    if (!isSupportedLocale(next)) return
    locale.value = next
    if (persist) {
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next)
      } catch {
        /* noop */
      }
    }
    i18n.global.locale.value = next
    applyDocumentLang(next)
  }

  const setLocale = (next: SupportedLocale) => {
    applyLocale(next, true)
  }

  const toggleLocale = () => {
    const idx = SUPPORTED_LOCALES.indexOf(locale.value)
    const nextIdx = (idx + 1) % SUPPORTED_LOCALES.length
    setLocale(SUPPORTED_LOCALES[nextIdx])
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== LOCALE_STORAGE_KEY) return
      if (!event.newValue || !isSupportedLocale(event.newValue)) return
      if (event.newValue === locale.value) return
      applyLocale(event.newValue, false)
    })
  }

  i18n.global.locale.value = locale.value
  applyDocumentLang(locale.value)

  return { locale, setLocale, toggleLocale }
})
