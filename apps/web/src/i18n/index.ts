import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import it from './locales/it.json'

export const LANGUAGES = ['it', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export const STORAGE_KEY = '3dq.language'

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

/** Stored choice first, then the first supported browser language, then Italian. */
export function detectLanguage(stored: string | null, browser: readonly string[]): Language {
  if (isLanguage(stored)) return stored
  for (const tag of browser) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLanguage(base)) return base
  }
  return 'it'
}

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function initI18n(
  lng: Language = detectLanguage(readStoredLanguage(), navigator.languages ?? []),
) {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: { it: { translation: it }, en: { translation: en } },
      lng,
      fallbackLng: 'it',
      interpolation: { escapeValue: false },
      initAsync: false,
    })
  } else {
    void i18n.changeLanguage(lng)
  }
  document.documentElement.lang = lng
  return i18n
}

/** Changes the UI language and remembers it; persistence failures are ignored. */
export async function setLanguage(lng: Language) {
  await i18n.changeLanguage(lng)
  document.documentElement.lang = lng
  try {
    window.localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    // Storage unavailable (private mode, blocked): the choice lasts for this session only.
  }
}
