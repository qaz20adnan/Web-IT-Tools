import { en, type TranslationKey } from './en'
import { ar } from './ar'
import type { Language, LocalizedText } from '@/types'

export type { TranslationKey }
export const translations = { en, ar } as const
export type TranslationParams = Record<string, string | number>

export function translate(lang: Language, key: TranslationKey, params?: TranslationParams): string {
  const dict = translations[lang] ?? en
  let value: string = dict[key] ?? en[key] ?? key
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.replaceAll(`{${name}}`, String(replacement))
    }
  }
  return value
}

export function isRtl(lang: Language): boolean {
  return lang === 'ar'
}

export function pickText(text: LocalizedText, lang: Language): string {
  return text[lang] || text.en
}

export function localeFor(lang: Language): string {
  return lang === 'ar' ? 'ar-SA' : 'en-US'
}

export function formatDate(value: string | number | Date | null | undefined, lang: Language): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date)
}

export function formatDateTime(value: string | number | Date | null | undefined, lang: Language): string {
  if (value === null || value === undefined || value === '') return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(localeFor(lang), {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
