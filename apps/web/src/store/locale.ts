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

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref<SupportedLocale>(detectLocale())

  const setLocale = (next: SupportedLocale) => {
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(next)) return
    locale.value = next
    localStorage.setItem(LOCALE_STORAGE_KEY, next)
    i18n.global.locale.value = next
    applyDocumentLang(next)
  }

  const toggleLocale = () => {
    const idx = SUPPORTED_LOCALES.indexOf(locale.value)
    const nextIdx = (idx + 1) % SUPPORTED_LOCALES.length
    setLocale(SUPPORTED_LOCALES[nextIdx])
  }

  i18n.global.locale.value = locale.value
  applyDocumentLang(locale.value)

  return { locale, setLocale, toggleLocale }
})
