export type CsvValue = string | number | boolean | null
export type CsvRecord = Record<string, CsvValue>

export type CsvIssueCode =
  | 'empty-input'
  | 'too-large'
  | 'unclosed-quote'
  | 'text-after-quote'
  | 'unexpected-quote'
  | 'duplicate-header'
  | 'blank-header'
  | 'ragged-row'
  | 'invalid-delimiter'
  | 'unsupported-json'

export interface CsvIssue {
  code: CsvIssueCode
  line: number
  found?: number
  expected?: number
}

export interface CsvParseOptions {
  delimiter?: string
  quoteChar?: string
  header?: boolean
  coerceTypes?: boolean
  skipEmptyLines?: boolean
}

export interface CsvParseResult {
  ok: boolean
  delimiter: string
  quoteChar: string
  delimiterDetected: boolean
  hasHeaderRow: boolean
  headers: string[]
  rows: string[][]
  records: CsvRecord[]
  rowCount: number
  columnCount: number
  raggedRows: number[]
  issues: CsvIssue[]
  coerced: boolean
  skippedEmptyRows: number
  truncated: boolean
}

export interface CsvStringifyOptions {
  delimiter?: string
  quoteChar?: string
  lineEnding?: 'lf' | 'crlf'
  bom?: boolean
  quoteAll?: boolean
  headers?: readonly string[]
}

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const

const MAX_INPUT_CHARS = 4_000_000
const MAX_ROWS = 200_000

function singleChar(value: string | undefined, fallback: string): string {
  return value && value.length === 1 ? value : fallback
}

export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000)
  let best = ','
  let bestScore = -1
  for (const candidate of CSV_DELIMITERS) {
    let count = 0
    let quoted = false
    for (let index = 0; index < sample.length; index += 1) {
      const char = sample[index]
      if (char === '"') quoted = !quoted
      else if (char === candidate && !quoted) count += 1
    }
    if (count > bestScore) {
      bestScore = count
      best = candidate
    }
  }
  return bestScore > 0 ? best : ','
}

function buildHeaders(raw: readonly string[] | undefined, count: number, issues: CsvIssue[]): string[] {
  const seen = new Map<string, number>()
  const headers: string[] = []
  for (let index = 0; index < count; index += 1) {
    const given = raw?.[index]
    const candidate = (given ?? '').trim()
    if (candidate.length === 0) {
      if (given !== undefined) issues.push({ code: 'blank-header', line: 1, found: index + 1 })
      headers.push(`col${index + 1}`)
      continue
    }
    if (seen.has(candidate)) {
      const times = (seen.get(candidate) ?? 1) + 1
      seen.set(candidate, times)
      issues.push({ code: 'duplicate-header', line: 1, found: index + 1 })
      headers.push(`${candidate} #${times}`)
      continue
    }
    seen.set(candidate, 1)
    headers.push(candidate)
  }
  return headers
}

function coerceCell(text: string, wasQuoted: boolean): CsvValue {
  if (wasQuoted) return text
  if (text.length === 0) return null
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true'
  if (/^null$/i.test(text)) return null
  if (!/^[+-]?(\d+|\d*\.\d+|\d+\.\d*)$/.test(text)) return text
  const value = Number(text)
  if (!Number.isFinite(value)) return text
  const canon = text.startsWith('+') ? text.slice(1) : text
  // Only coerce when the number prints back exactly as it was typed, so IDs like 007 keep their zeros.
  if (String(value) !== canon) return text
  return value
}

export function parseCsv(text: string, options: CsvParseOptions = {}): CsvParseResult {
  const issues: CsvIssue[] = []
  const requestedDelimiter = options.delimiter
  const invalidDelimiter = requestedDelimiter !== undefined && (requestedDelimiter.length !== 1 || requestedDelimiter === '\n' || requestedDelimiter === '\r')
  if (invalidDelimiter) issues.push({ code: 'invalid-delimiter', line: 1 })
  let delimiter = invalidDelimiter ? ',' : (requestedDelimiter ?? '')
  if (!invalidDelimiter && delimiter === '') delimiter = detectDelimiter(text)
  const quoteChar = singleChar(options.quoteChar, '"')
  const headerRow = options.header ?? true
  const coerceTypes = options.coerceTypes ?? false
  const skipEmptyLines = options.skipEmptyLines ?? true

  if (quoteChar === delimiter) {
    issues.push({ code: 'invalid-delimiter', line: 1 })
    delimiter = ','
  }
  if (text.length === 0) {
    return {
      ok: false,
      delimiter,
      quoteChar,
      delimiterDetected: requestedDelimiter === undefined,
      hasHeaderRow: false,
      headers: [],
      rows: [],
      records: [],
      rowCount: 0,
      columnCount: 0,
      raggedRows: [],
      issues: [{ code: 'empty-input', line: 1 }],
      coerced: false,
      skippedEmptyRows: 0,
      truncated: false,
    }
  }

  const limit = Math.min(text.length, MAX_INPUT_CHARS)
  let truncated = text.length > MAX_INPUT_CHARS
  if (truncated) issues.push({ code: 'too-large', line: 1 })

  const rows: string[][] = []
  const quoting: boolean[][] = []
  let row: string[] = []
  let rowQuoted: boolean[] = []
  let field = ''
  let inQuotes = false
  let fieldWasQuoted = false
  let atFieldStart = true
  let strayReported = false
  let skipped = 0
  let index = 0

  const flushField = () => {
    row.push(field)
    rowQuoted.push(fieldWasQuoted)
    field = ''
    fieldWasQuoted = false
    atFieldStart = true
    strayReported = false
  }

  const flushRow = () => {
    flushField()
    const blank = row.length === 1 && row[0] === '' && !rowQuoted[0]
    if (blank && skipEmptyLines) skipped += 1
    else {
      rows.push(row)
      quoting.push(rowQuoted)
    }
    row = []
    rowQuoted = []
  }

  const append = (char: string) => {
    if (fieldWasQuoted && !inQuotes && !strayReported) {
      issues.push({ code: 'text-after-quote', line: rows.length + 1, found: row.length + 1 })
      strayReported = true
    }
    field += char
    atFieldStart = false
  }

  const hitRowCap = () => {
    issues.push({ code: 'too-large', line: rows.length + 1 })
    truncated = true
  }

  while (index < limit) {
    const char = text[index]

    if (inQuotes) {
      if (char === quoteChar) {
        if (text[index + 1] === quoteChar) {
          append(quoteChar)
          index += 2
          continue
        }
        inQuotes = false
        index += 1
        continue
      }
      append(char)
      index += 1
      continue
    }

    if (char === '\n' || char === '\r') {
      if (rows.length >= MAX_ROWS) {
        hitRowCap()
        break
      }
      flushRow()
      index += char === '\r' && text[index + 1] === '\n' ? 2 : 1
      continue
    }

    if (char === delimiter) {
      flushField()
      index += 1
      continue
    }

    if (char === quoteChar) {
      if (atFieldStart) {
        inQuotes = true
        fieldWasQuoted = true
        atFieldStart = false
        index += 1
        continue
      }
      if (!fieldWasQuoted) issues.push({ code: 'unexpected-quote', line: rows.length + 1, found: row.length + 1 })
      append(char)
      index += 1
      continue
    }

    append(char)
    index += 1
  }

  if (inQuotes) issues.push({ code: 'unclosed-quote', line: rows.length + 1 })
  if (rows.length < MAX_ROWS) {
    const pendingContent = field.length > 0 || row.length > 0 || fieldWasQuoted
    const trailingTerminator = limit > 0 && (text[limit - 1] === '\n' || text[limit - 1] === '\r')
    if (pendingContent || (!trailingTerminator && rows.length === 0)) flushRow()
  }
  if (rows.length === 0 && !issues.some((issue) => issue.code === 'too-large')) issues.push({ code: 'empty-input', line: 1 })

  const columnCount = rows.reduce((max, cells) => Math.max(max, cells.length), 0)
  const firstLength = rows[0]?.length ?? 0
  const expected = headerRow && rows.length > 0 ? firstLength : columnCount
  const raggedRows: number[] = []
  rows.forEach((cells, position) => {
    if (cells.length !== expected) raggedRows.push(position + 1)
  })
  for (const position of raggedRows) issues.push({ code: 'ragged-row', line: position + (headerRow ? 1 : 0), found: rows[position - 1].length, expected })

  const rawHeaderCells = headerRow && rows.length > 0 ? rows[0] : undefined
  const headers = buildHeaders(rawHeaderCells, columnCount, issues)
  const bodyRows = headerRow && rows.length > 0 ? rows.slice(1) : rows
  const bodyQuoting = headerRow && rows.length > 0 ? quoting.slice(1) : quoting

  const records: CsvRecord[] = bodyRows.map((cells, position) => {
    const record: CsvRecord = {}
    for (let column = 0; column < cells.length; column += 1) {
      const key = headers[column] ?? `col${column + 1}`
      const raw = cells[column]
      record[key] = coerceTypes ? coerceCell(raw, bodyQuoting[position]?.[column] === true) : raw
    }
    return record
  })

  return {
    ok: rows.length > 0,
    delimiter,
    quoteChar,
    delimiterDetected: requestedDelimiter === undefined,
    hasHeaderRow: headerRow && rows.length > 0,
    headers,
    rows: bodyRows,
    records,
    rowCount: bodyRows.length,
    columnCount,
    raggedRows,
    issues,
    coerced: coerceTypes,
    skippedEmptyRows: skipped,
    truncated,
  }
}

function cellToText(value: CsvValue | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return value
}

function needsQuotes(text: string, delimiter: string, quoteChar: string): boolean {
  if (text.length === 0) return false
  if (text.includes(delimiter)) return true
  if (text.includes(quoteChar)) return true
  if (/[\n\r]/.test(text)) return true
  return /^\s/.test(text) || /\s$/.test(text)
}

export function stringifyCsv(rows: readonly (readonly CsvValue[])[], options: CsvStringifyOptions = {}): string {
  const delimiter = singleChar(options.delimiter, ',')
  const quoteChar = singleChar(options.quoteChar, '"')
  if (delimiter === quoteChar || delimiter === '\n' || delimiter === '\r') return ''
  const lineBreak = options.lineEnding === 'crlf' ? '\r\n' : '\n'
  const quoteAll = options.quoteAll ?? false
  const escape = (value: string) => value.replaceAll(quoteChar, quoteChar + quoteChar)

  const render = (cells: readonly CsvValue[]): string =>
    cells
      .map((cell) => cellToText(cell))
      .map((text) => (quoteAll || needsQuotes(text, delimiter, quoteChar) ? `${quoteChar}${escape(text)}${quoteChar}` : text))
      .join(delimiter)

  const out: string[] = []
  if (options.headers) out.push(render([...options.headers]))
  for (const cells of rows) out.push(render(cells))
  const body = out.join(lineBreak)
  return `${options.bom ? '\uFEFF' : ''}${body}${body.length > 0 ? lineBreak : ''}`
}

export interface CsvFromJsonResult {
  ok: boolean
  headers: string[]
  rows: CsvValue[][]
  rowCount: number
  issues: CsvIssue[]
}

function cellFromJsonValue(value: unknown): CsvValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  try {
    return JSON.stringify(value) ?? null
  } catch {
    return null
  }
}

export function csvRowsFromJson(text: string): CsvFromJsonResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false, headers: [], rows: [], rowCount: 0, issues: [{ code: 'empty-input', line: 1 }] }
  if (trimmed.length > MAX_INPUT_CHARS) {
    return { ok: false, headers: [], rows: [], rowCount: 0, issues: [{ code: 'too-large', line: 1 }] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, headers: [], rows: [], rowCount: 0, issues: [{ code: 'unsupported-json', line: 1 }] }
  }

  const list = Array.isArray(parsed) ? parsed : [parsed]
  if (list.length === 0) return { ok: false, headers: [], rows: [], rowCount: 0, issues: [{ code: 'unsupported-json', line: 1 }] }

  const scalarRows = list.every((item) => item === null || typeof item !== 'object')
  if (scalarRows) {
    return {
      ok: true,
      headers: ['value'],
      rows: list.map((item) => [cellFromJsonValue(item)]),
      rowCount: list.length,
      issues: [],
    }
  }

  const headers: string[] = []
  const rows: CsvValue[][] = []
  const seen = new Set<string>()
  const addHeader = (key: string) => {
    if (seen.has(key)) return
    seen.add(key)
    headers.push(key)
  }
  for (const item of list) {
    if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index += 1) addHeader(`col${index + 1}`)
    } else if (item && typeof item === 'object') {
      for (const key of Object.keys(item as CsvRecord)) addHeader(key)
    } else {
      addHeader('value')
    }
  }

  if (headers.length === 0) return { ok: false, headers: [], rows: [], rowCount: 0, issues: [{ code: 'unsupported-json', line: 1 }] }

  for (const item of list) {
    if (Array.isArray(item)) {
      rows.push(headers.map((_, index) => cellFromJsonValue(item[index])))
    } else if (item && typeof item === 'object') {
      rows.push(headers.map((key) => cellFromJsonValue((item as CsvRecord)[key])))
    } else {
      rows.push(headers.map((key) => (key === 'value' ? cellFromJsonValue(item) : null)))
    }
  }

  return { ok: true, headers, rows, rowCount: rows.length, issues: [] }
}
