import type { KnowledgeBaseDraft, KnowledgeBaseEntry, ProblemCategory } from '@/types'
import { readJson, scopedStorageKey, STORAGE_KEYS, writeJson } from '@/lib/storage'

export const KB_CATEGORIES: ProblemCategory[] = [
  'windows-client',
  'windows-server',
  'printing',
  'microsoft-365',
  'networking',
  'linux',
  'cybersecurity',
  'datacenter',
  'backup-dr',
  'cloud-devops',
  'other',
]

export const KB_MAX_ENTRIES = 500
const MAX_TITLE = 200
const MAX_PROBLEM = 5000
const MAX_SOLUTION = 12000
const MAX_TAGS = 12
const MAX_TAG_LENGTH = 30

function isCategory(value: unknown): value is ProblemCategory {
  return typeof value === 'string' && (KB_CATEGORIES as string[]).includes(value)
}

function isEntry(value: unknown): value is KnowledgeBaseEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<KnowledgeBaseEntry>
  return (
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.problem === 'string' &&
    typeof entry.solution === 'string' &&
    isCategory(entry.category) &&
    Array.isArray(entry.tags) &&
    entry.tags.every((tag) => typeof tag === 'string') &&
    (entry.source === 'manual' || entry.source === 'troubleshooting' || entry.source === 'tool') &&
    typeof entry.createdAt === 'string' &&
    typeof entry.updatedAt === 'string'
  )
}

function newId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `kb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    result.push(tag)
    if (result.length >= MAX_TAGS) break
  }
  return result
}

export function parseTags(value: string): string[] {
  return normalizeTags(value.split(/[,\n]/))
}

export function createKnowledgeEntry(draft: KnowledgeBaseDraft, now = new Date()): KnowledgeBaseEntry {
  const timestamp = now.toISOString()
  return {
    id: draft.id ?? newId(),
    title: draft.title.trim().slice(0, MAX_TITLE),
    problem: draft.problem.trim().slice(0, MAX_PROBLEM),
    solution: draft.solution.trim().slice(0, MAX_SOLUTION),
    category: isCategory(draft.category) ? draft.category : 'other',
    tags: normalizeTags(draft.tags),
    source: draft.source ?? 'manual',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function loadKnowledgeBase(): KnowledgeBaseEntry[] {
  const raw = readJson<unknown>(scopedStorageKey(STORAGE_KEYS.knowledgeBase), [])
  if (!Array.isArray(raw)) return []
  return raw.filter(isEntry).slice(0, KB_MAX_ENTRIES)
}

export function saveKnowledgeBase(entries: KnowledgeBaseEntry[]): boolean {
  return writeJson(scopedStorageKey(STORAGE_KEYS.knowledgeBase), entries.slice(0, KB_MAX_ENTRIES))
}

export function upsertKnowledgeEntry(
  entries: KnowledgeBaseEntry[],
  draft: KnowledgeBaseDraft,
  now = new Date(),
): { entries: KnowledgeBaseEntry[]; entry: KnowledgeBaseEntry } {
  const existing = draft.id ? entries.find((entry) => entry.id === draft.id) : undefined
  const base = createKnowledgeEntry(draft, now)
  const entry: KnowledgeBaseEntry = existing
    ? { ...base, id: existing.id, createdAt: existing.createdAt }
    : base
  const next = existing
    ? entries.map((item) => (item.id === existing.id ? entry : item))
    : [entry, ...entries]
  return { entries: next.slice(0, KB_MAX_ENTRIES), entry }
}

export function deleteKnowledgeEntry(entries: KnowledgeBaseEntry[], id: string): KnowledgeBaseEntry[] {
  return entries.filter((entry) => entry.id !== id)
}

export function filterKnowledgeBase(
  entries: KnowledgeBaseEntry[],
  options: { query?: string; category?: ProblemCategory | 'all' } = {},
): KnowledgeBaseEntry[] {
  const query = (options.query ?? '').trim().toLowerCase()
  return entries.filter((entry) => {
    if (options.category && options.category !== 'all' && entry.category !== options.category) return false
    if (!query) return true
    return [entry.title, entry.problem, entry.solution, ...entry.tags]
      .join('\n')
      .toLowerCase()
      .includes(query)
  })
}

export function knowledgeEntryToMarkdown(entry: KnowledgeBaseEntry): string {
  return `# ${entry.title}

- Category: ${entry.category}
- Tags: ${entry.tags.length > 0 ? entry.tags.join(', ') : '—'}
- Source: ${entry.source}
- Created: ${entry.createdAt}
- Updated: ${entry.updatedAt}

## Problem

${entry.problem}

## Solution

${entry.solution}
`
}

export function knowledgeBaseToMarkdown(entries: KnowledgeBaseEntry[]): string {
  const header = `# NEXORA AI — Troubleshooting Knowledge Base\n\nExported: ${new Date().toISOString()}\nEntries: ${entries.length}\n`
  return `${header}\n${entries.map(knowledgeEntryToMarkdown).join('\n---\n\n')}`
}

export function knowledgeBaseToJson(entries: KnowledgeBaseEntry[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), entries }, null, 2)
}
