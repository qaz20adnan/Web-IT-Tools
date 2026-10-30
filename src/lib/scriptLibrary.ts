import type { LocalizedText, ProblemCategory, RiskLevel, ScriptLanguage, ScriptTemplate } from '@/types'

const LANGUAGES: ScriptLanguage[] = ['powershell', 'cmd', 'bash', 'python', 'sql', 'network']
const RISKS: RiskLevel[] = ['low', 'medium', 'high', 'critical']
const VERIFICATIONS: ScriptTemplate['verification'][] = ['template', 'ai-generated', 'reviewed', 'tested']
const CATEGORIES: Array<ProblemCategory | 'general'> = [
  'windows-client', 'windows-server', 'printing', 'microsoft-365', 'networking', 'linux', 'cybersecurity',
  'datacenter', 'backup-dr', 'cloud-devops', 'other', 'general',
]

export interface ScriptExportBundle {
  format: 'nexora-scripts'
  version: 1
  exportedAt: string
  scripts: ScriptTemplate[]
}

function text(value: unknown, fallback: string): LocalizedText {
  if (typeof value === 'string' && value.trim()) return { en: value.trim(), ar: value.trim() }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const en = typeof record.en === 'string' ? record.en.trim() : ''
    const ar = typeof record.ar === 'string' ? record.ar.trim() : ''
    if (en || ar) return { en: en || ar, ar: ar || en }
  }
  return { en: fallback, ar: fallback }
}

function stringList(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim()).slice(0, max)
}

function localizedList(value: unknown): LocalizedText | undefined {
  if (!value) return undefined
  const converted = text(value, '')
  return converted.en ? converted : undefined
}

function uniqueId(base: string, used: Set<string>): string {
  const clean = base.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'imported-script'
  if (!used.has(clean)) return clean
  let index = 2
  while (used.has(`${clean}-${index}`)) index += 1
  return `${clean}-${index}`
}

export function normalizeImportedScript(raw: unknown, usedIds: Set<string> = new Set()): ScriptTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record.code !== 'string' || !record.code.trim()) return null
  if (record.code.length > 100_000) return null
  const language = LANGUAGES.includes(record.language as ScriptLanguage) ? record.language as ScriptLanguage : 'powershell'
  const risk = RISKS.includes(record.risk as RiskLevel) ? record.risk as RiskLevel : 'high'
  const verification = VERIFICATIONS.includes(record.verification as ScriptTemplate['verification'])
    ? record.verification as ScriptTemplate['verification']
    : 'template'
  const category = CATEGORIES.includes(record.category as ProblemCategory | 'general')
    ? record.category as ProblemCategory | 'general'
    : 'general'
  const title = text(record.title, 'Imported script')
  const id = uniqueId(typeof record.id === 'string' ? record.id : title.en, usedIds)
  usedIds.add(id)
  return {
    id,
    title,
    description: text(record.description, 'Imported from a local JSON file. Review every command before running it.'),
    language,
    risk,
    category,
    code: record.code,
    requires: stringList(record.requires),
    rollback: typeof record.rollback === 'string' ? record.rollback.slice(0, 4000) : 'Restore from a verified backup or snapshot if the change is not reversible.',
    verification,
    createdAt: typeof record.createdAt === 'string' && !Number.isNaN(Date.parse(record.createdAt)) ? record.createdAt : new Date().toISOString(),
    version: typeof record.version === 'string' ? record.version.slice(0, 30) : '1.0.0',
    operatingSystems: stringList(record.operatingSystems),
    permissions: stringList(record.permissions),
    dependencies: stringList(record.dependencies),
    expectedOutput: localizedList(record.expectedOutput),
    usage: localizedList(record.usage),
    validation: localizedList(record.validation),
    testNotes: localizedList(record.testNotes),
  }
}

export function parseScriptImport(payload: unknown, existing: ScriptTemplate[] = [], mode: 'merge' | 'replace' = 'merge'): ScriptTemplate[] {
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { scripts?: unknown }).scripts)
      ? (payload as { scripts: unknown[] }).scripts
      : []
  if (list.length === 0) throw new Error('No scripts were found in the import file.')
  if (list.length > 500) throw new Error('The import file contains too many scripts (maximum 500).')
  const used = new Set(mode === 'merge' ? existing.map((script) => script.id) : [])
  const imported: ScriptTemplate[] = []
  for (const entry of list) {
    const normalized = normalizeImportedScript(entry, used)
    if (normalized) imported.push(normalized)
  }
  if (imported.length === 0) throw new Error('None of the imported entries contained a valid code field.')
  return imported
}

export function buildScriptExport(scripts: ScriptTemplate[]): string {
  const bundle: ScriptExportBundle = {
    format: 'nexora-scripts',
    version: 1,
    exportedAt: new Date().toISOString(),
    scripts: scripts.map((script) => ({ ...script, id: script.id })),
  }
  return JSON.stringify(bundle, null, 2)
}

export function duplicateScript(script: ScriptTemplate, existingIds: Set<string>, createdAt = new Date().toISOString()): ScriptTemplate {
  const id = uniqueId(`${script.id}-copy`, existingIds)
  return {
    ...script,
    id,
    title: {
      en: `${script.title.en} (copy)`,
      ar: `${script.title.ar} (نسخة)`,
    },
    verification: 'template',
    createdAt,
    version: '1.0.0',
  }
}

export function filterScripts(
  scripts: ScriptTemplate[],
  options: { search?: string; language?: ScriptLanguage | 'all'; favoritesOnly?: boolean; favorites?: string[] },
): ScriptTemplate[] {
  const search = (options.search ?? '').trim().toLowerCase()
  const favoriteSet = new Set(options.favorites ?? [])
  return scripts.filter((script) => {
    if (options.language && options.language !== 'all' && script.language !== options.language) return false
    if (options.favoritesOnly && !favoriteSet.has(script.id)) return false
    if (!search) return true
    const haystack = [
      script.title.en, script.title.ar, script.description.en, script.description.ar,
      script.language, script.category, script.code.slice(0, 2000), ...script.requires,
    ].join(' ').toLowerCase()
    return haystack.includes(search)
  })
}
