export type DiffOpKind = 'equal' | 'add' | 'remove'

export type LineEnding = 'crlf' | 'lf' | 'cr' | 'none'

export interface DiffFileLine {
  text: string
  ending: LineEnding
}

export interface DiffOp {
  kind: DiffOpKind
  beforeLine: number | null
  afterLine: number | null
  text: string
  ending: LineEnding
  trailingSpace: string
}

export interface DiffOptions {
  ignoreCase?: boolean
  ignoreTrailingWhitespace?: boolean
}

export interface LineEndingProfile {
  lines: number
  crlf: number
  lf: number
  cr: number
  lastLineHasNoNewline: boolean
}

export interface DiffResult {
  ops: DiffOp[]
  added: number
  removed: number
  unchanged: number
  equalPercent: number
  degraded: boolean
  before: LineEndingProfile
  after: LineEndingProfile
}

const MAX_DP_CELLS = 4_000_000

export function splitLines(text: string): DiffFileLine[] {
  if (text.length === 0) return []
  const lines: DiffFileLine[] = []
  let start = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '\n') {
      const crlf = index > start && text[index - 1] === '\r'
      lines.push({ text: text.slice(start, crlf ? index - 1 : index), ending: crlf ? 'crlf' : 'lf' })
      index += 1
      start = index
    } else if (char === '\r' && text[index + 1] !== '\n' && index + 1 < text.length) {
      lines.push({ text: text.slice(start, index), ending: 'cr' })
      index += 1
      start = index
    } else {
      index += 1
    }
  }
  if (start < text.length) lines.push({ text: text.slice(start), ending: 'none' })
  return lines
}

function profileOf(lines: DiffFileLine[]): LineEndingProfile {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (const line of lines) {
    if (line.ending === 'crlf') crlf += 1
    else if (line.ending === 'cr') cr += 1
    else if (line.ending === 'lf') lf += 1
  }
  return {
    lines: lines.length,
    crlf,
    lf,
    cr,
    lastLineHasNoNewline: lines.length > 0 && lines[lines.length - 1].ending === 'none',
  }
}

function compareKey(line: DiffFileLine, options: DiffOptions): string {
  let text = line.text
  if (options.ignoreTrailingWhitespace) text = text.replace(/\s+$/, '')
  if (options.ignoreCase) text = text.toLowerCase()
  // A file whose last line has no terminator is a content change; LF versus CRLF is not.
  return line.ending === 'none' ? `${text}\u0000no-eol` : text
}

function trailingSpaceOf(text: string): string {
  const match = text.match(/\s+$/)
  return match ? match[0] : ''
}

function toOp(kind: DiffOpKind, line: DiffFileLine, beforeLine: number | null, afterLine: number | null): DiffOp {
  return { kind, beforeLine, afterLine, text: line.text, ending: line.ending, trailingSpace: trailingSpaceOf(line.text) }
}

/** Line endings are deliberately not content: a CRLF/LF flip must not look like an edit of every line. */
function lcsOps(before: DiffFileLine[], after: DiffFileLine[], keysBefore: string[], keysAfter: string[], offset: number): DiffOp[] {
  const m = before.length
  const n = after.length
  const ops: DiffOp[] = []
  if (m === 0 && n === 0) return ops
  if (m === 0 || n === 0 || m * n > MAX_DP_CELLS) {
    for (let index = 0; index < m; index += 1) ops.push(toOp('remove', before[index], offset + index + 1, null))
    for (let index = 0; index < n; index += 1) ops.push(toOp('add', after[index], null, offset + index + 1))
    return ops
  }

  const width = n + 1
  const table = new Int32Array((m + 1) * width)
  for (let i = m - 1; i >= 0; i -= 1) {
    const row = i * width
    const nextRow = row + width
    for (let j = n - 1; j >= 0; j -= 1) {
      table[row + j] = keysBefore[i] === keysAfter[j]
        ? table[nextRow + j + 1] + 1
        : Math.max(table[nextRow + j], table[row + j + 1])
    }
  }

  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (keysBefore[i] === keysAfter[j]) {
      ops.push(toOp('equal', before[i], offset + i + 1, offset + j + 1))
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      ops.push(toOp('remove', before[i], offset + i + 1, null))
      i += 1
    } else {
      ops.push(toOp('add', after[j], null, offset + j + 1))
      j += 1
    }
  }
  while (i < m) {
    ops.push(toOp('remove', before[i], offset + i + 1, null))
    i += 1
  }
  while (j < n) {
    ops.push(toOp('add', after[j], null, offset + j + 1))
    j += 1
  }
  return ops
}

export function diffLines(before: string, after: string, options: DiffOptions = {}): DiffResult {
  const beforeLines = splitLines(before)
  const afterLines = splitLines(after)

  const shortest = Math.min(beforeLines.length, afterLines.length)
  let prefix = 0
  while (prefix < shortest && compareKey(beforeLines[prefix], options) === compareKey(afterLines[prefix], options)) prefix += 1

  let suffix = 0
  while (
    suffix < shortest - prefix &&
    compareKey(beforeLines[beforeLines.length - 1 - suffix], options) === compareKey(afterLines[afterLines.length - 1 - suffix], options)
  ) suffix += 1

  const beforeMiddle = beforeLines.slice(prefix, beforeLines.length - suffix)
  const afterMiddle = afterLines.slice(prefix, afterLines.length - suffix)

  const ops: DiffOp[] = []
  for (let index = 0; index < prefix; index += 1) ops.push(toOp('equal', beforeLines[index], index + 1, index + 1))
  ops.push(...lcsOps(beforeMiddle, afterMiddle, beforeMiddle.map((line) => compareKey(line, options)), afterMiddle.map((line) => compareKey(line, options)), prefix))
  for (let index = 0; index < suffix; index += 1) {
    const beforeAt = beforeLines.length - suffix + index
    ops.push(toOp('equal', beforeLines[beforeAt], beforeAt + 1, afterLines.length - suffix + index + 1))
  }

  let added = 0
  let removed = 0
  let unchanged = 0
  for (const op of ops) {
    if (op.kind === 'add') added += 1
    else if (op.kind === 'remove') removed += 1
    else unchanged += 1
  }
  const denominator = Math.max(beforeLines.length, afterLines.length)

  return {
    ops,
    added,
    removed,
    unchanged,
    equalPercent: denominator === 0 ? 100 : Math.round((unchanged / denominator) * 100),
    degraded: beforeMiddle.length * afterMiddle.length > MAX_DP_CELLS,
    before: profileOf(beforeLines),
    after: profileOf(afterLines),
  }
}

export interface SideBySideRow {
  left: DiffOp | null
  right: DiffOp | null
}

/** A removed run is laid against the added run that follows it. */
export function toSideBySide(ops: DiffOp[]): SideBySideRow[] {
  const rows: SideBySideRow[] = []
  let index = 0
  while (index < ops.length) {
    const op = ops[index]
    if (op.kind === 'equal') {
      rows.push({ left: op, right: op })
      index += 1
      continue
    }
    const removes: DiffOp[] = []
    const adds: DiffOp[] = []
    while (index < ops.length && ops[index].kind === 'remove') removes.push(ops[index++])
    while (index < ops.length && ops[index].kind === 'add') adds.push(ops[index++])
    const height = Math.max(removes.length, adds.length)
    for (let row = 0; row < height; row += 1) rows.push({ left: removes[row] ?? null, right: adds[row] ?? null })
  }
  return rows
}

export interface UnifiedDiffOptions {
  context?: number
  beforeName?: string
  afterName?: string
}

function hunkRanges(ops: DiffOp[], context: number): Array<[number, number]> {
  const changed: number[] = []
  ops.forEach((op, index) => {
    if (op.kind !== 'equal') changed.push(index)
  })
  const ranges: Array<[number, number]> = []
  for (const index of changed) {
    const start = Math.max(0, index - context)
    const end = Math.min(ops.length - 1, index + context)
    const last = ranges[ranges.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else ranges.push([start, end])
  }
  return ranges
}

export function toUnifiedDiff(result: DiffResult, options: UnifiedDiffOptions = {}): string {
  const context = Math.max(0, options.context ?? 3)
  const lines: string[] = [`--- ${options.beforeName ?? 'before'}`, `+++ ${options.afterName ?? 'after'}`]
  if (result.ops.length === 0 || result.added + result.removed === 0) return `${lines.join('\n')}\n`

  for (const [start, end] of hunkRanges(result.ops, context)) {
    const group = result.ops.slice(start, end + 1)
    let beforeCount = 0
    let afterCount = 0
    let beforeStart = 0
    let afterStart = 0
    const body: string[] = []
    for (const op of group) {
      if (op.kind !== 'add') {
        beforeCount += 1
        if (beforeStart === 0) beforeStart = op.beforeLine ?? 1
      }
      if (op.kind !== 'remove') {
        afterCount += 1
        if (afterStart === 0) afterStart = op.afterLine ?? 1
      }
      const marker = op.kind === 'add' ? '+' : op.kind === 'remove' ? '-' : ' '
      const terminator = op.ending === 'crlf' || op.ending === 'cr' ? '\r' : ''
      const note = op.ending === 'none' ? '\\ No newline at end of file' : ''
      body.push(`${marker}${op.text}${terminator}${note}`)
    }
    if (beforeCount === 0) beforeStart = result.ops[start - 1]?.beforeLine ?? result.ops[end + 1]?.beforeLine ?? 0
    if (afterCount === 0) afterStart = result.ops[start - 1]?.afterLine ?? result.ops[end + 1]?.afterLine ?? 0
    lines.push(`@@ -${beforeStart},${beforeCount} +${afterStart},${afterCount} @@`)
    lines.push(...body)
  }
  return `${lines.join('\n')}\n`
}
