import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'
import { ar } from '../src/i18n/ar'
import { translate } from '../src/i18n'

describe('translations', () => {
  it('has the same keys in English and Arabic', () => {
    const english = Object.keys(en).sort()
    const arabic = Object.keys(ar).sort()
    expect(arabic.filter((key) => !english.includes(key))).toEqual([])
    expect(english.filter((key) => !arabic.includes(key))).toEqual([])
  })

  it('does not leave empty strings', () => {
    for (const [key, value] of Object.entries({ ...en, ...ar })) {
      expect(typeof value, key).toBe('string')
      expect((value as string).trim(), key).not.toBe('')
    }
  })

  it('interpolates parameters', () => {
    expect(translate('en', 'news.lastFetched', { time: '10:00' })).toContain('10:00')
    expect(translate('ar', 'news.lastFetched', { time: '10:00' })).toContain('10:00')
  })

  it('keeps full-width Arabic text (no replacement characters)', () => {
    for (const value of Object.values(ar)) {
      expect(value).not.toContain('\uFFFD')
    }
  })
})
