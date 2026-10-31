import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_ARTICLES } from '@/data/knowledge'
import { KNOWLEDGE_META } from '@/data/knowledgeMeta'

/**
 * M-18: the catalog holds both the metadata every list surface reads and the full
 * article bodies, which exactly one route reads. A bundler cannot split an object
 * literal, so importing it for a title pinned ~250 kB of prose to the entry chunk.
 * src/data/knowledgeMeta.ts is that catalog with `body` removed — generated, but
 * checked here against the real thing so the two cannot drift apart.
 */
describe('the generated metadata index is the catalog', () => {
  it('carries every article, in order', () => {
    expect(KNOWLEDGE_META.map((article) => article.id)).toEqual(KNOWLEDGE_ARTICLES.map((article) => article.id))
    expect(KNOWLEDGE_META.map((article) => article.slug)).toEqual(KNOWLEDGE_ARTICLES.map((article) => article.slug))
  })

  it('matches the catalog field for field, minus the body', () => {
    for (const [index, source] of KNOWLEDGE_ARTICLES.entries()) {
      const meta = KNOWLEDGE_META[index]
      // Adding the body back has to reproduce the catalog entry exactly, which
      // catches a missing field, a changed value and an extra one alike.
      expect({ ...meta, body: source.body }, `article ${source.slug}`).toEqual(source)
      expect(meta).not.toHaveProperty('body')
    }
  })

  it('keeps every field the surfaces that read it use', () => {
    // Search reads title, summary and tags; the lists read domain, updatedAt and
    // difficulty; the cards read verification, productVersion and sources.
    for (const article of KNOWLEDGE_META) {
      expect(typeof article.title.en).toBe('string')
      expect(typeof article.title.ar).toBe('string')
      expect(typeof article.summary.en).toBe('string')
      expect(Array.isArray(article.tags)).toBe(true)
      expect(typeof article.domain).toBe('string')
      expect(/^\d{4}-\d{2}-\d{2}$/.test(article.updatedAt)).toBe(true)
      expect(['beginner', 'intermediate', 'advanced']).toContain(article.difficulty)
      expect(typeof article.verification).toBe('string')
      expect(Array.isArray(article.sources)).toBe(true)
    }
  })
})

describe('the entry chunk stays free of article bodies', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('exposes the index without a single body field', () => {
    const source = read('../src/data/knowledgeMeta.ts')
    expect(source).not.toMatch(/^\s*body:/m)
    expect(source).toContain('Omit<KnowledgeArticle')
  })

  it('lets only the article route import the full catalog', () => {
    // Anything else that imports '@/data/knowledge' drags every body back into the
    // graph that imports it, which is the exact shape M-18 was filed against.
    const offenders = [
      'src/components/layout/CommandPalette.tsx',
      'src/pages/DashboardPage.tsx',
      'src/pages/KnowledgePage.tsx',
      'src/pages/DocsHubPage.tsx',
      'src/pages/DomainPage.tsx',
    ].filter((file) => /from '@\/data\/knowledge'/.test(read(`../${file}`)))
    expect(offenders).toEqual([])
    expect(/from '@\/data\/knowledge'/.test(read('../src/pages/ArticlePage.tsx'))).toBe(true)
  })

  it('regenerates the index as part of the build, so a new article cannot ship unsearchable', () => {
    const pkg = JSON.parse(read('../package.json'))
    expect(pkg.scripts['build:knowledge-index']).toBe('node scripts/build-knowledge-index.mjs')
    const build: string = pkg.scripts.build
    // Contained first: indexOf returns -1 when the step is gone, and -1 sorts
    // before every real index, so an ordering assertion alone passes on a build
    // that dropped the step entirely.
    expect(build).toContain('build:knowledge-index')
    expect(build.indexOf('build:knowledge-index')).toBeLessThan(build.indexOf('vite build'))
  })
})
