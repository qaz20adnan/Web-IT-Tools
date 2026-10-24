import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_ARTICLES } from '../src/data/knowledge'
import { SCRIPT_TEMPLATES } from '../src/data/scripts'
import { THEMES } from '../src/data/themes'

describe('content inventory integrity', () => {
  it('has unique article ids and slugs', () => {
    expect(new Set(KNOWLEDGE_ARTICLES.map((article) => article.id)).size).toBe(KNOWLEDGE_ARTICLES.length)
    expect(new Set(KNOWLEDGE_ARTICLES.map((article) => article.slug)).size).toBe(KNOWLEDGE_ARTICLES.length)
  })

  it('ships bilingual article content with https sources', () => {
    for (const article of KNOWLEDGE_ARTICLES) {
      expect(article.title.en.trim()).not.toBe('')
      expect(article.title.ar.trim()).not.toBe('')
      expect(article.body.en.trim()).not.toBe('')
      expect(article.body.ar.trim()).not.toBe('')
      expect(article.sources.length).toBeGreaterThan(0)
      for (const source of article.sources) {
        expect(source.url.startsWith('https://')).toBe(true)
      }
    }
  })

  it('has unique script ids and non-empty templates', () => {
    expect(new Set(SCRIPT_TEMPLATES.map((script) => script.id)).size).toBe(SCRIPT_TEMPLATES.length)
    for (const script of SCRIPT_TEMPLATES) {
      expect(script.code.trim()).not.toBe('')
      expect(script.requires.length).toBeGreaterThan(0)
      expect(script.rollback.trim()).not.toBe('')
    }
  })

  it('exposes at least ten themes with unique ids', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(10)
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(THEMES.length)
  })
})
