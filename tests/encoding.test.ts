import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(process.cwd())
const textExtensions = /\.(ts|tsx|js|jsx|css|html|json)$/
const skippedDirectories = new Set(['node_modules', 'dist', '.git', '.netlify', 'coverage'])

function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory)) {
    if (skippedDirectories.has(name)) continue
    const fullPath = join(directory, name)
    if (statSync(fullPath).isDirectory()) {
      files.push(...sourceFiles(fullPath))
    } else if (textExtensions.test(name)) {
      files.push(fullPath)
    }
  }
  return files
}

const files = [
  ...sourceFiles(join(root, 'src')),
  ...sourceFiles(join(root, 'netlify')),
  ...sourceFiles(join(root, 'tests')),
  join(root, 'index.html'),
]

const read = (file: string) => readFileSync(file, 'utf8')

describe('source encoding', () => {
  it('has no UTF-8 BOM or replacement characters', () => {
    for (const file of files) {
      const label = relative(root, file)
      const buffer = readFileSync(file)
      expect(buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf, `${label} starts with a UTF-8 BOM`).toBe(false)
      expect(read(file), label).not.toContain('\uFFFD')
    }
  })

  it('has no UTF-8 text decoded as a single-byte Arabic or Latin code page', () => {
    const mojibake = /ط[\u00A1-\u00BF\u2018-\u201D]|ظ[\u2013-\u2021\u201E]|[ÃÂ][\u0080-\u00BF]|[ØÙ][\u0080-\u00BF]/
    for (const file of files) {
      expect(read(file), relative(root, file)).not.toMatch(mojibake)
    }
  })

  it('keeps the expected Arabic copy in the newly added screens', () => {
    expect(read(join(root, 'src/pages/DashboardPage.tsx'))).toContain('لتشخيص المشكلات التقنية')
    expect(read(join(root, 'src/pages/NetworkDiagnosticsPage.tsx'))).toContain('مركز تشخيص الشبكة')
    expect(read(join(root, 'src/pages/SecurityLabPage.tsx'))).toContain('مختبر أمان الملفات والروابط')
    expect(read(join(root, 'src/components/layout/Topbar.tsx'))).toContain('حتى يعود الاتصال')
  })

  it('declares UTF-8 in the HTML document', () => {
    expect(read(join(root, 'index.html'))).toContain('<meta charset="UTF-8" />')
  })
})
