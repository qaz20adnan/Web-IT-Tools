import { describe, expect, it } from 'vitest'
import { diffLines, splitLines, toSideBySide, toUnifiedDiff } from '@/lib/diff'

const kinds = (text: string, other: string) => diffLines(text, other).ops.map((op) => op.kind)
const summary = (text: string, other: string) => {
  const result = diffLines(text, other)
  return { added: result.added, removed: result.removed, unchanged: result.unchanged, equalPercent: result.equalPercent }
}

describe('splitLines', () => {
  it('splits LF, CRLF and a missing final newline', () => {
    expect(splitLines('a\nb\n').map((line) => [line.text, line.ending])).toEqual([
      ['a', 'lf'],
      ['b', 'lf'],
    ])
    expect(splitLines('a\r\nb').map((line) => [line.text, line.ending])).toEqual([
      ['a', 'crlf'],
      ['b', 'none'],
    ])
    expect(splitLines('')).toHaveLength(0)
    expect(splitLines('\n').map((line) => line.text)).toEqual([''])
  })
})

describe('diffLines', () => {
  it('reports identical input as fully equal', () => {
    const text = 'one\ntwo\nthree\n'
    const result = diffLines(text, text)
    expect(result.ops.every((op) => op.kind === 'equal')).toBe(true)
    expect(result.added).toBe(0)
    expect(result.removed).toBe(0)
    expect(summary(text, text).equalPercent).toBe(100)
  })

  it('handles empty sides', () => {
    expect(diffLines('', '')).toMatchObject({ ops: [], added: 0, removed: 0, equalPercent: 100 })
    expect(kinds('', 'a\nb\n')).toEqual(['add', 'add'])
    expect(kinds('a\nb\n', '')).toEqual(['remove', 'remove'])
    expect(summary('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0, unchanged: 2, equalPercent: 100 })
  })

  it('detects a pure insertion in the middle', () => {
    const result = diffLines('a\nb\nc\n', 'a\nx\nb\nc\n')
    expect(result.ops.map((op) => [op.kind, op.text])).toEqual([
      ['equal', 'a'],
      ['add', 'x'],
      ['equal', 'b'],
      ['equal', 'c'],
    ])
    expect(result.added).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.ops[1].afterLine).toBe(2)
    expect(result.ops[1].beforeLine).toBe(null)
  })

  it('detects a pure deletion', () => {
    const result = diffLines('a\nx\nb\n', 'a\nb\n')
    expect(result.ops.map((op) => [op.kind, op.text])).toEqual([
      ['equal', 'a'],
      ['remove', 'x'],
      ['equal', 'b'],
    ])
    expect(result.removed).toBe(1)
    expect(result.added).toBe(0)
  })

  it('does not let prefix and suffix trimming swallow a real change', () => {
    const result = diffLines('a\nb\na\n', 'a\nz\na\n')
    expect(result.ops.map((op) => [op.kind, op.text])).toEqual([
      ['equal', 'a'],
      ['remove', 'b'],
      ['add', 'z'],
      ['equal', 'a'],
    ])
    expect(result.equalPercent).toBe(67)
    const boundary = diffLines('a\n', 'a\na\n')
    expect(boundary.ops.map((op) => op.kind)).toEqual(['equal', 'add'])
    const headAndTail = diffLines('x\nsame\ny\n', 'same\n')
    expect(headAndTail.ops.map((op) => op.kind)).toEqual(['remove', 'equal', 'remove'])
  })

  it('shows a moved block as delete plus insert, never as unchanged', () => {
    const before = 'A\nB\nC\nX\nY\n'
    const after = 'X\nY\nA\nB\nC\n'
    const result = diffLines(before, after)
    const moved = result.ops.filter((op) => op.text === 'X' || op.text === 'Y')
    expect(moved.filter((op) => op.kind === 'equal')).toHaveLength(0)
    expect(moved.map((op) => op.kind).sort()).toEqual(['add', 'add', 'remove', 'remove'])
    expect(result.unchanged).toBe(3)
    expect(result.added).toBe(2)
    expect(result.removed).toBe(2)
  })

  it('pairs edits by line numbers', () => {
    const result = diffLines('keep\nold\n', 'keep\nnew\n')
    const removed = result.ops.find((op) => op.kind === 'remove')
    const added = result.ops.find((op) => op.kind === 'add')
    expect(removed?.beforeLine).toBe(2)
    expect(added?.afterLine).toBe(2)
  })

  it('honours ignoreCase and ignoreTrailingWhitespace', () => {
    expect(kinds('ServerName foo\n', 'servername foo\n')).toEqual(['remove', 'add'])
    expect(diffLines('ServerName foo\n', 'servername foo\n', { ignoreCase: true }).ops.map((op) => op.kind)).toEqual(['equal'])
    expect(diffLines('value   \n', 'value\n', { ignoreTrailingWhitespace: true }).ops).toHaveLength(1)
    expect(diffLines('value   \n', 'value\n').ops).toHaveLength(2)
    const result = diffLines('value   \n', 'value\n')
    expect(result.ops[0].trailingSpace).toBe('   ')
    expect(result.ops[1].trailingSpace).toBe('')
  })

  it('treats a CRLF rewrite as equal content but reports the endings', () => {
    const result = diffLines('a\nb\n', 'a\r\nb\r\n')
    expect(result.ops.map((op) => op.kind)).toEqual(['equal', 'equal'])
    expect(result.before.crlf).toBe(0)
    expect(result.after.crlf).toBe(2)
    expect(result.ops[0].ending).toBe('lf')
    expect(result.ops[1].ending).toBe('lf')
  })

  it('treats a missing final newline as a real change', () => {
    const result = diffLines('a\nb\n', 'a\nb')
    expect(result.ops.map((op) => [op.kind, op.text, op.ending])).toEqual([
      ['equal', 'a', 'lf'],
      ['remove', 'b', 'lf'],
      ['add', 'b', 'none'],
    ])
    expect(result.after.lastLineHasNoNewline).toBe(true)
    expect(result.before.lastLineHasNoNewline).toBe(false)
    expect(result.equalPercent).toBe(50)
  })

  it('stays correct on large inputs thanks to prefix and suffix trimming', () => {
    const big = Array.from({ length: 20_000 }, (_, index) => `line ${index}`).join('\n')
    const result = diffLines(`${big}\n`, `${big}\nappended\n`)
    expect(result.added).toBe(1)
    expect(result.removed).toBe(0)
    expect(result.degraded).toBe(false)
    expect(result.ops).toHaveLength(20_001)
  })

  it('degrades instead of blocking on an oversized changed region', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `b${index}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, index) => `a${index}`).join('\n')
    const result = diffLines(before, after)
    expect(result.degraded).toBe(true)
    expect(result.added).toBe(3000)
    expect(result.removed).toBe(3000)
    expect(result.unchanged).toBe(0)
  })
})

describe('views', () => {
  it('renders a unified diff with context and hunk headers', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n'
    const after = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nK\nl\n'
    const text = toUnifiedDiff(diffLines(before, after), { beforeName: 'httpd.conf', afterName: 'httpd.conf.new' })
    expect(text.split('\n')[0]).toBe('--- httpd.conf')
    expect(text.split('\n')[1]).toBe('+++ httpd.conf.new')
    const hunks = text.split('\n').filter((line) => line.startsWith('@@'))
    expect(hunks).toEqual(['@@ -1,5 +1,5 @@', '@@ -8,5 +8,5 @@'])
    expect(text).toContain('-b')
    expect(text).toContain('+B')
    expect(text).toContain('-k')
    expect(text).toContain('+K')
  })

  it('marks a missing trailing newline and an empty diff', () => {
    expect(toUnifiedDiff(diffLines('a\n', 'a'))).toContain('\\ No newline at end of file')
    expect(toUnifiedDiff(diffLines('same\n', 'same\n'))).toBe('--- before\n+++ after\n')
    expect(toUnifiedDiff(diffLines('', ''))).toBe('--- before\n+++ after\n')
  })

  it('pairs removals with additions side by side', () => {
    const rows = toSideBySide(diffLines('a\nx\ny\nc\n', 'a\nz\nc\n').ops)
    expect(rows.map((row) => [row.left?.text ?? null, row.right?.text ?? null])).toEqual([
      ['a', 'a'],
      ['x', 'z'],
      ['y', null],
      ['c', 'c'],
    ])
  })
})
