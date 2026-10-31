import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : []
  })

const SOURCES = walk(join(ROOT, 'src'))

/**
 * The 200 characters before a `<table`, which in this codebase always holds the
 * wrapper element that decides whether the table can be scrolled or is clipped.
 */
function wrappers(source: string): string[] {
  const found: string[] = []
  for (let at = source.indexOf('<table'); at !== -1; at = source.indexOf('<table', at + 1)) {
    found.push(source.slice(Math.max(0, at - 200), at))
  }
  return found
}

const SCROLLS = /overflow-(?:x-)?(?:auto|scroll)/
const CLIPS = /overflow-hidden/

describe('a table that outgrows its column can still be read on a phone', () => {
  it('is never wrapped in overflow-hidden, which clips without a scrollbar', () => {
    // Cells here hold IPv6 literals, resolver hostnames and header values: none
    // of them can break across lines, so the table's minimum width is set by its
    // longest token and exceeds a 360px viewport. overflow-hidden hides the rest
    // with no affordance; overflow-auto hands the visitor a scrollbar.
    const clipped = SOURCES.flatMap((file) =>
      wrappers(readFileSync(file, 'utf8'))
        .filter((before) => CLIPS.test(before) && !SCROLLS.test(before))
        .map(() => file.slice(ROOT.length + 1)),
    )
    expect(clipped).toEqual([])
  })

  it('sits in a scrolling wrapper or declares its own minimum width', () => {
    const unreachable = SOURCES.flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const offenders: string[] = []
      for (let at = source.indexOf('<table'); at !== -1; at = source.indexOf('<table', at + 1)) {
        const tag = source.slice(at, source.indexOf('>', at))
        const before = source.slice(Math.max(0, at - 200), at)
        if (!SCROLLS.test(before) && !/min-w-/.test(tag)) offenders.push(`${file.slice(ROOT.length + 1)} ${tag.slice(0, 60)}`)
      }
      return offenders
    })
    expect(unreachable).toEqual([])
  })
})
