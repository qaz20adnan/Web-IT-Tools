import { describe, expect, it } from 'vitest'
import { buildScriptExport, duplicateScript, filterScripts, parseScriptImport } from '../src/lib/scriptLibrary'
import type { ScriptTemplate } from '../src/types'

const base: ScriptTemplate = {
  id: 'builtin-1',
  title: { en: 'Disk health', ar: 'صحة القرص' },
  description: { en: 'Read SMART data', ar: 'قراءة بيانات SMART' },
  language: 'powershell',
  risk: 'low',
  category: 'windows-server',
  code: 'Get-PhysicalDisk',
  requires: ['Administrator'],
  rollback: 'Read-only; no rollback required.',
  verification: 'reviewed',
  createdAt: '2026-01-01T00:00:00.000Z',
  version: '1.0.0',
}

describe('script library import and export', () => {
  it('round-trips a bundle and generates new ids on import collisions', () => {
    const bundle = JSON.parse(buildScriptExport([base])) as unknown
    const imported = parseScriptImport(bundle, [base], 'merge')
    expect(imported).toHaveLength(1)
    expect(imported[0].id).toBe('builtin-1-2')
    expect(imported[0].code).toBe('Get-PhysicalDisk')
  })

  it('accepts a bare array and normalizes missing optional fields', () => {
    const imported = parseScriptImport([{ id: 'custom', title: 'Check', code: 'Write-Output ok' }], [], 'merge')
    expect(imported[0]).toMatchObject({
      id: 'custom',
      language: 'powershell',
      risk: 'high',
      category: 'general',
      verification: 'template',
    })
    expect(imported[0].title).toEqual({ en: 'Check', ar: 'Check' })
  })

  it('rejects empty and invalid imports', () => {
    expect(() => parseScriptImport([], [])).toThrow(/No scripts/)
    expect(() => parseScriptImport([{ title: 'No code' }], [])).toThrow(/valid code/)
    expect(() => parseScriptImport({ scripts: 'not-an-array' }, [])).toThrow(/No scripts/)
  })

  it('duplicates built-ins with a readable id and copy title', () => {
    const copy = duplicateScript(base, new Set(['builtin-1']), '2026-02-02T00:00:00.000Z')
    expect(copy.id).toBe('builtin-1-copy')
    expect(copy.title.en).toContain('copy')
    expect(copy.title.ar).toContain('نسخة')
    expect(copy.verification).toBe('template')
    expect(copy.createdAt).toBe('2026-02-02T00:00:00.000Z')
  })
})

describe('script filtering', () => {
  const second: ScriptTemplate = {
    ...base,
    id: 'builtin-2',
    title: { en: 'Bash ports', ar: 'منافذ باش' },
    description: { en: 'List listening ports', ar: 'سرد المنافذ' },
    language: 'bash',
    code: 'ss -lntp',
  }

  it('filters by search, language, and favorites', () => {
    expect(filterScripts([base, second], { search: 'smart' })).toHaveLength(1)
    expect(filterScripts([base, second], { search: 'listening' })[0].id).toBe('builtin-2')
    expect(filterScripts([base, second], { language: 'bash' })[0].id).toBe('builtin-2')
    expect(filterScripts([base, second], { favoritesOnly: true, favorites: ['builtin-2'] })).toHaveLength(1)
    expect(filterScripts([base, second], { language: 'all' })).toHaveLength(2)
  })
})
