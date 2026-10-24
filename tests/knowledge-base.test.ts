import { beforeEach, describe, expect, it } from 'vitest'
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  filterKnowledgeBase,
  KB_MAX_ENTRIES,
  knowledgeBaseToJson,
  knowledgeBaseToMarkdown,
  knowledgeEntryToMarkdown,
  loadKnowledgeBase,
  normalizeTags,
  parseTags,
  saveKnowledgeBase,
  upsertKnowledgeEntry,
} from '@/services/knowledge-base'
import type { KnowledgeBaseEntry } from '@/types'

const draft = {
  title: '  Printer queue stuck  ',
  problem: 'Jobs remain in the spooler after a driver update.',
  solution: 'Restart the spooler and clear the queue.',
  category: 'printing' as const,
  tags: ['Spooler', 'spooler', ' Windows '],
  source: 'manual' as const,
}

describe('knowledge base service', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('normalizes tags and trims entry fields', () => {
    expect(normalizeTags([' A ', 'a', 'B', ''])).toEqual(['A', 'B'])
    expect(parseTags('one, two\nthree, one')).toEqual(['one', 'two', 'three'])
    const entry = createKnowledgeEntry(draft, new Date('2026-10-23T10:00:00.000Z'))
    expect(entry.title).toBe('Printer queue stuck')
    expect(entry.tags).toEqual(['Spooler', 'Windows'])
    expect(entry.createdAt).toBe('2026-10-23T10:00:00.000Z')
    expect(entry.updatedAt).toBe(entry.createdAt)
  })

  it('creates and updates entries while preserving identity', () => {
    const first = upsertKnowledgeEntry([], draft, new Date('2026-10-23T10:00:00.000Z'))
    expect(first.entries).toHaveLength(1)
    const created = first.entry
    expect(created.source).toBe('manual')

    const second = upsertKnowledgeEntry(
      first.entries,
      { ...draft, id: created.id, title: 'Updated title' },
      new Date('2026-10-23T11:00:00.000Z'),
    )
    expect(second.entries).toHaveLength(1)
    expect(second.entry.id).toBe(created.id)
    expect(second.entry.createdAt).toBe(created.createdAt)
    expect(second.entry.updatedAt).toBe('2026-10-23T11:00:00.000Z')
    expect(second.entry.title).toBe('Updated title')
  })

  it('persists valid entries and ignores malformed records', () => {
    const entry = createKnowledgeEntry(draft)
    expect(saveKnowledgeBase([entry])).toBe(true)
    expect(loadKnowledgeBase()).toEqual([entry])

    localStorage.setItem('nexora.kb.v1', JSON.stringify([{ id: 'broken' }, entry]))
    expect(loadKnowledgeBase()).toEqual([entry])
  })

  it('filters by query and category', () => {
    const printing = createKnowledgeEntry(draft)
    const network = createKnowledgeEntry({
      ...draft,
      title: 'DNS failure',
      problem: 'Clients cannot resolve internal names.',
      solution: 'Fix the forwarder and flush the DNS cache.',
      category: 'networking',
      tags: ['dns'],
    })
    const entries = [printing, network]
    expect(filterKnowledgeBase(entries, { query: 'driver' })).toEqual([printing])
    expect(filterKnowledgeBase(entries, { category: 'networking' })).toEqual([network])
    expect(filterKnowledgeBase(entries, { query: 'dns' })).toEqual([network])
    expect(filterKnowledgeBase(entries, { category: 'all', query: '' })).toHaveLength(2)
  })

  it('deletes entries and caps the collection', () => {
    const entry = createKnowledgeEntry(draft)
    expect(deleteKnowledgeEntry([entry], entry.id)).toEqual([])
    const many: KnowledgeBaseEntry[] = Array.from({ length: KB_MAX_ENTRIES + 10 }, (_, index) =>
      createKnowledgeEntry({ ...draft, title: `Entry ${index}` }),
    )
    expect(saveKnowledgeBase(many)).toBe(true)
    expect(loadKnowledgeBase()).toHaveLength(KB_MAX_ENTRIES)
  })

  it('exports Markdown and JSON', () => {
    const entry = createKnowledgeEntry(draft)
    const markdown = knowledgeEntryToMarkdown(entry)
    expect(markdown).toContain('# Printer queue stuck')
    expect(markdown).toContain('## Problem')
    expect(markdown).toContain('## Solution')
    expect(knowledgeBaseToMarkdown([entry])).toContain('Entries: 1')
    expect(JSON.parse(knowledgeBaseToJson([entry])).entries[0].title).toBe('Printer queue stuck')
  })
})
