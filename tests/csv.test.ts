import { describe, expect, it } from 'vitest'
import { csvRowsFromJson, detectDelimiter, parseCsv, stringifyCsv } from '@/lib/csv'

const codes = (text: string, options?: Parameters<typeof parseCsv>[1]) => parseCsv(text, options).issues.map((issue) => issue.code)

describe('parseCsv', () => {
  it('splits plain records', () => {
    const result = parseCsv('name,city\nSara,Riyadh\nKhalid,Jeddah\n')
    expect(result.headers).toEqual(['name', 'city'])
    expect(result.rows).toEqual([
      ['Sara', 'Riyadh'],
      ['Khalid', 'Jeddah'],
    ])
    expect(result.records).toEqual([
      { name: 'Sara', city: 'Riyadh' },
      { name: 'Khalid', city: 'Jeddah' },
    ])
    expect(result).toMatchObject({ ok: true, rowCount: 2, columnCount: 2, hasHeaderRow: true, delimiter: ',', issues: [] })
  })

  it('keeps a delimiter inside a quoted field', () => {
    const result = parseCsv('a,b\n1,"Riyadh, SA"', { delimiter: ',' })
    expect(result.rows).toEqual([['1', 'Riyadh, SA']])
    expect(result.issues).toEqual([])
  })

  it('unescapes doubled quotes', () => {
    const result = parseCsv('note,x\n"say ""hello""",2')
    expect(result.rows).toEqual([['say "hello"', '2']])
    expect(result.records[0].note).toBe('say "hello"')
  })

  it('supports embedded newlines inside quotes', () => {
    const result = parseCsv('ticket,notes\n42,"line one\nline two"\n7,plain')
    expect(result.rows).toEqual([
      ['42', 'line one\nline two'],
      ['7', 'plain'],
    ])
    expect(result.rowCount).toBe(2)
    expect(result.issues).toEqual([])
  })

  it('handles CRLF, bare LF and lone CR records', () => {
    expect(parseCsv('a,b\r\n1,2\r\n').rows).toEqual([['1', '2']])
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([['1', '2']])
    expect(parseCsv('a,b\r1,2\r').rows).toEqual([['1', '2']])
    expect(parseCsv('a,b\r\n"x\r\ny",2').rows).toEqual([['x\r\ny', '2']])
  })

  it('accepts semicolon, tab and pipe delimiters', () => {
    expect(parseCsv('a;b\n1;2', { delimiter: ';' }).headers).toEqual(['a', 'b'])
    expect(parseCsv('a\tb\n1\t2', { delimiter: '\t' }).rows).toEqual([['1', '2']])
    expect(parseCsv('a|b\n1|2', { delimiter: '|' }).rows).toEqual([['1', '2']])
    expect(detectDelimiter('a;b\n1;2')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
    expect(detectDelimiter('a"b;c";d\n')).toBe(';')
    expect(detectDelimiter('plain text')).toBe(',')
  })

  it('honours a custom quote character', () => {
    const result = parseCsv("a,b\n1,'x,y'", { delimiter: ',', quoteChar: "'" })
    expect(result.rows).toEqual([['1', 'x,y']])
    expect(result.quoteChar).toBe("'")
  })

  it('reports ragged rows without losing cells', () => {
    const result = parseCsv('a,b,c\n1,2\n3,4,5,6')
    expect(result.raggedRows).toEqual([2, 3])
    expect(result.columnCount).toBe(4)
    expect(result.records[1]).toEqual({ a: '3', b: '4', c: '5', col4: '6' })
    expect(result.issues.filter((issue) => issue.code === 'ragged-row')).toHaveLength(2)
  })

  it('keeps empty fields', () => {
    const result = parseCsv('a,b,c\n,,\n1,,3')
    expect(result.rows).toEqual([
      ['', '', ''],
      ['1', '', '3'],
    ])
    expect(result.records[1]).toEqual({ a: '1', b: '', c: '3' })
  })

  it('names duplicate and blank headers so no column is lost', () => {
    const result = parseCsv('id,id,\n1,2,3')
    expect(result.headers).toEqual(['id', 'id #2', 'col3'])
    expect(result.records[0]).toEqual({ id: '1', 'id #2': '2', col3: '3' })
    expect(codes('id,id\n1,2')).toEqual(['duplicate-header'])
  })

  it('uses positional keys when there is no header row', () => {
    const result = parseCsv('Sara,Riyadh\nKhalid,Jeddah', { header: false })
    expect(result.hasHeaderRow).toBe(false)
    expect(result.headers).toEqual(['col1', 'col2'])
    expect(result.rows).toHaveLength(2)
    expect(result.records[0]).toEqual({ col1: 'Sara', col2: 'Riyadh' })
  })

  it('ignores blank lines but reports them', () => {
    const result = parseCsv('a,b\n\n1,2\n\n')
    expect(result.rows).toEqual([['1', '2']])
    expect(result.skippedEmptyRows).toBe(2)
    expect(parseCsv('a,b\n\n1,2', { skipEmptyLines: false }).rows).toEqual([[''], ['1', '2']])
  })

  it('leaves types alone by default', () => {
    const result = parseCsv('id,qty,ratio,flag,stamp\n007,42,1.50,TRUE,2026-01-05\n')
    expect(result.records[0]).toEqual({ id: '007', qty: '42', ratio: '1.50', flag: 'TRUE', stamp: '2026-01-05' })
    expect(result.coerced).toBe(false)
  })

  it('coerces only losslessly when asked', () => {
    const result = parseCsv('id,qty,ratio,flag,stamp,note\n007,42,1.50,TRUE,2026-01-05,"42"', { coerceTypes: true })
    expect(result.records[0]).toEqual({ id: '007', qty: 42, ratio: '1.50', flag: true, stamp: '2026-01-05', note: '42' })
    expect(parseCsv('0,,null,-12', { coerceTypes: true, header: false }).records[0]).toEqual({
      col1: 0,
      col2: null,
      col3: null,
      col4: -12,
    })
    expect(parseCsv('a\n1e3', { coerceTypes: true }).records[0].a).toBe('1e3')
    expect(parseCsv('a\n00', { coerceTypes: true }).records[0].a).toBe('00')
    expect(parseCsv('a\n-0', { coerceTypes: true }).records[0].a).toBe('-0')
  })

  it('warns about malformed armour but keeps every byte', () => {
    const unclosed = parseCsv('a,b\n"oops,2')
    expect(unclosed.rows).toEqual([['oops,2']])
    expect(unclosed.issues.some((issue) => issue.code === 'unclosed-quote')).toBe(true)

    const stray = parseCsv('a,b\n"ok"extra,2')
    expect(stray.rows).toEqual([['okextra', '2']])
    expect(stray.issues.filter((issue) => issue.code === 'text-after-quote')).toHaveLength(1)

    expect(codes('a,b\nx"y",2')).toContain('unexpected-quote')
  })

  it('rejects impossible configurations instead of throwing', () => {
    expect(codes('a,b\n1,2', { delimiter: ';;' })).toContain('invalid-delimiter')
    expect(codes('a,b\n1,2', { delimiter: ',', quoteChar: ',' })).toContain('invalid-delimiter')
    expect(parseCsv('').issues).toEqual([{ code: 'empty-input', line: 1 }])
    expect(parseCsv('').ok).toBe(false)
    expect(parseCsv('\n\n').issues).toEqual([{ code: 'empty-input', line: 1 }])
    const unclosedOnly = parseCsv('"unclosed only', { header: false })
    expect(unclosedOnly.rows).toEqual([['unclosed only']])
    expect(unclosedOnly.issues.map((issue) => issue.code)).toEqual(['unclosed-quote'])
  })

  it('survives adversarial input', () => {
    const junk = ['"', '""', '","', ',,,', '\r\r\r', '"a""', 'a,"b', '\t\t', '👍,é,', '"', '\\', 'a\n"b\nc"\n', '"a""b""c']
    for (const input of junk) {
      expect(() => parseCsv(input)).not.toThrow()
      expect(() => parseCsv(input, { coerceTypes: true, quoteChar: "'", delimiter: '\t' })).not.toThrow()
    }
  })
})

describe('stringifyCsv', () => {
  it('quotes only what needs quoting', () => {
    const text = stringifyCsv([['plain', 'a,b', 'say "hi"', 'line\nbreak', ' leading', 'trailing ', 'tab\there', '']], {
      delimiter: ',',
      lineEnding: 'lf',
    })
    expect(text).toBe('plain,"a,b","say ""hi""","line\nbreak"," leading","trailing ",tab\there,\n')
  })

  it('emits a header row, CRLF and a UTF-8 BOM on request', () => {
    const text = stringifyCsv([['x', 1], ['y', true]], { headers: ['k', 'v'], lineEnding: 'crlf', bom: true })
    expect(text).toBe('\uFEFF' + 'k,v\r\nx,1\r\ny,true\r\n')
    expect(stringifyCsv([['a', 'b']], { quoteAll: true })).toBe('"a","b"\n')
    expect(stringifyCsv([], { headers: ['a'] })).toBe('a\n')
    expect(stringifyCsv([])).toBe('')
  })

  it('refuses a delimiter that cannot be distinguished from the quote character', () => {
    expect(stringifyCsv([['a']], { delimiter: '"', quoteChar: '"' })).toBe('')
    expect(stringifyCsv([['a', 'b']], { delimiter: ';', quoteChar: ';' })).toBe('')
  })

  it('round-trips hostile cells', () => {
    const rows = [
      ['a,b', 'say "hi"', 'line one\nline two', ' leading', 'trailing ', ''],
      ['semi;colon', "quote'single", '007', 'TRUE', '"', '""'],
      ['', '', ',', '\r', 'plain', 'end'],
    ]
    const text = stringifyCsv(rows, { delimiter: ',', lineEnding: 'lf' })
    const back = parseCsv(text, { header: false, skipEmptyLines: false, delimiter: ',' })
    expect(back.rows).toEqual(rows)
    expect(back.raggedRows).toEqual([])
  })
})

describe('csvRowsFromJson', () => {
  it('flattens an array of objects into a column union', () => {
    const result = csvRowsFromJson('[{"id":"007","qty":2},{"id":"008","note":"ok"}]')
    expect(result.ok).toBe(true)
    expect(result.headers).toEqual(['id', 'qty', 'note'])
    expect(result.rows).toEqual([
      ['007', 2, null],
      ['008', null, 'ok'],
    ])
    const roundTrip = parseCsv(stringifyCsv(result.rows, { headers: result.headers }), { coerceTypes: true })
    expect(roundTrip.records[0]).toEqual({ id: '007', qty: 2, note: null })
  })

  it('accepts row arrays, scalars and a single object', () => {
    expect(csvRowsFromJson('[[1,2],[3]]')).toMatchObject({ headers: ['col1', 'col2'], rows: [[1, 2], [3, null]] })
    expect(csvRowsFromJson('["x",3,null]')).toMatchObject({ headers: ['value'], rows: [['x'], [3], [null]] })
    expect(csvRowsFromJson('{"a":1,"b":"two"}').rows).toEqual([[1, 'two']])
  })

  it('keeps nested structures as readable JSON text', () => {
    expect(csvRowsFromJson('[{"a":{"b":1},"c":[1,2]}]').rows).toEqual([['{"b":1}', '[1,2]']])
  })

  it('reports unusable JSON instead of throwing', () => {
    expect(csvRowsFromJson('not json at all').issues[0].code).toBe('unsupported-json')
    expect(csvRowsFromJson('[]').ok).toBe(false)
    expect(csvRowsFromJson('[[]]').ok).toBe(false)
    expect(csvRowsFromJson('').issues[0].code).toBe('empty-input')
    expect(csvRowsFromJson('123').ok).toBe(true)
  })
})
