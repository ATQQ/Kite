import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'
export const LOCALE_STORAGE_KEY = 'kite-locale'

const isSupported = (l: string): l is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(l)

export const detectLocale = (): SupportedLocale => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored && isSupported(stored)) return stored
    const nav = (navigator.language || '').toLowerCase()
    if (nav.startsWith('zh')) return 'zh-CN'
    if (nav.startsWith('en')) return 'en-US'
  }
  return DEFAULT_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
  missingWarn: false,
  fallbackWarn: false,
})

export const t = i18n.global.t
