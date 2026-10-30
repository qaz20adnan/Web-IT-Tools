import { useEffect, useMemo, useState } from 'react'
import { Table } from 'lucide-react'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CodeBlock,
  CopyButton,
  EmptyState,
  Field,
  Select,
  Stat,
  Tab,
  Tabs,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { readJson, writeJson } from '@/lib/storage'
import { downloadTextFile } from '@/lib/utils'
import { csvRowsFromJson, parseCsv, stringifyCsv, type CsvIssue } from '@/lib/csv'

type LabelFn = (en: string, ar: string) => string
type Direction = 'csv-json' | 'json-csv'

const PREFS_KEY = 'nexora.csvjson.prefs.v1'
const PREVIEW_ROWS = 25

const SAMPLE_CSV = `ticket_id,requester,opened_at,note,status
00714,Sara Al-Ghamdi,2026-03-04T08:12:00Z,"VPN profile failed with error 809: ""smart card missing""",open
00715,Khalid Otbi,2026-03-04T09:40:00Z,"Reset password, then re-enrolled device",closed
00716,Noura Salem,2026-03-05T02:15:00Z,"Printer ""HP-4th-floor"" offline; queue has 12 jobs",open
`

const SAMPLE_JSON = `[
  { "ticket_id": "00714", "requester": "Sara Al-Ghamdi", "priority": 1, "blocked": false },
  { "ticket_id": "00715", "requester": "Khalid Otbi", "priority": 3, "blocked": true, "owner": null }
]`

interface CsvPrefs {
  direction: Direction
  delimiter: string
  quoteChar: string
  header: boolean
  coerceTypes: boolean
  skipEmptyLines: boolean
  quoteAll: boolean
  bom: boolean
  lineEnding: 'lf' | 'crlf'
}

const DEFAULT_PREFS: CsvPrefs = {
  direction: 'csv-json',
  delimiter: 'auto',
  quoteChar: '"',
  header: true,
  coerceTypes: false,
  skipEmptyLines: true,
  quoteAll: false,
  bom: false,
  lineEnding: 'lf',
}

const DELIMITER_VALUES = ['auto', ',', ';', '\t', '|']

function delimiterLabel(value: string, L: LabelFn): string {
  if (value === 'auto') return L('Auto-detect', 'كشف تلقائي')
  if (value === ',') return L('Comma ,', 'الفاصلة ,')
  if (value === ';') return L('Semicolon ;', 'الفاصلة المنقوطة ;')
  if (value === '\t') return L('Tab', 'محاذاة تبويب')
  return L('Pipe |', 'الخط العمودي |')
}

function issueText(issue: CsvIssue, L: LabelFn): string {
  const map: Record<string, [string, string]> = {
    'empty-input': ['Nothing to parse.', 'لا يوجد ما يُحلَّل.'],
    'too-large': ['Input is larger than the local limit; parsing stopped early.', 'المدخل أكبر من الحد المحلي؛ توقف التحليل مبكراً.'],
    'unclosed-quote': ['A quoted field is never closed.', 'حقل مقتبس بلا إغلاق.'],
    'text-after-quote': ['Text follows a closing quote; it was kept inside the field.', 'نص بعد علامة الاقتباس المغلقة؛ أُبقي داخل الحقل.'],
    'unexpected-quote': ['A quote appears inside an unquoted field.', 'علامة اقتباس داخل حقل غير مقتبس.'],
    'duplicate-header': ['Two header cells share a name; the second was renamed.', 'خليّتا عنوان متطابقتان؛ أُعيد تسمية الثانية.'],
    'blank-header': ['A header cell is blank; the column got a positional name.', 'خلية عنوان فارغة؛ أُعطي العمود اسماً موقعيّاً.'],
    'ragged-row': ['Row has a different number of fields than the header.', 'عدد حقول هذا السطر يختلف عن عدد أعمدة العنوان.'],
    'invalid-delimiter': ['Delimiter and quote character conflict, or the delimiter is not one character.', 'فاصل الحقول يتعارض مع علامة الاقتباس أو ليس حرفاً واحداً.'],
    'unsupported-json': ['JSON is not an array of records, an array of rows, or a single object.', 'JSON ليس مصفوفة سجلات أو مصفوفة صفوف أو كائناً واحداً.'],
  }
  const entry = map[issue.code]
  const label = entry ? L(entry[0], entry[1]) : issue.code
  return `${issue.line > 0 ? `line ${issue.line}: ` : ''}${label}${issue.found !== undefined ? ` (${issue.found}/${issue.expected})` : ''}`
}

export function CsvJsonTool() {
  const { settings } = useApp()
  const L: LabelFn = (en, ar) => (settings.language === 'ar' ? ar : en)
  const [prefs, setPrefs] = useState<CsvPrefs>(() => ({ ...DEFAULT_PREFS, ...readJson<Partial<CsvPrefs>>(PREFS_KEY, {}) }))
  const [csvInput, setCsvInput] = useState('')
  const [jsonInput, setJsonInput] = useState('')

  useEffect(() => {
    writeJson(PREFS_KEY, prefs)
  }, [prefs])

  const delimiter = prefs.delimiter === 'auto' ? undefined : prefs.delimiter
  const parsed = useMemo(
    () =>
      parseCsv(csvInput, {
        delimiter,
        quoteChar: prefs.quoteChar,
        header: prefs.header,
        coerceTypes: prefs.coerceTypes,
        skipEmptyLines: prefs.skipEmptyLines,
      }),
    [csvInput, delimiter, prefs.quoteChar, prefs.header, prefs.coerceTypes, prefs.skipEmptyLines],
  )

  const fromJson = useMemo(() => csvRowsFromJson(jsonInput), [jsonInput])

  const jsonOutput = useMemo(
    () => (csvInput.trim().length === 0 ? '' : JSON.stringify(parsed.records, null, 2)),
    [csvInput, parsed.records],
  )
  const csvOutput = useMemo(
    () =>
      fromJson.ok
        ? stringifyCsv(fromJson.rows, {
            delimiter: prefs.delimiter === 'auto' ? ',' : prefs.delimiter,
            quoteChar: prefs.quoteChar,
            lineEnding: prefs.lineEnding,
            bom: prefs.bom,
            quoteAll: prefs.quoteAll,
            headers: fromJson.headers,
          })
        : '',
    [fromJson, prefs.delimiter, prefs.quoteChar, prefs.lineEnding, prefs.bom, prefs.quoteAll],
  )

  const set = (patch: Partial<CsvPrefs>) => setPrefs((current) => ({ ...current, ...patch }))

  const csvIssues = parsed.issues
  const jsonIssues = fromJson.ok ? [] : fromJson.issues
  // parseCsv numbers ragged rows over the whole document, so the preview needs the header row subtracted.
  const raggedBodyRows = parsed.raggedRows.map((position) => position - (parsed.hasHeaderRow ? 1 : 0)).filter((position) => position >= 1)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('CSV and JSON converter', 'محوّل CSV و JSON')}
          icon={<Table className="h-4 w-4" />}
          subtitle={L(
            'An RFC 4180 state machine — quoted fields, doubled quotes, embedded newlines, CRLF and bare-LF records — running entirely in this browser.',
            'آلة حالة وفق RFC 4180 — حقول مقتبسة، وعلامات اقتباس مزدوجة، وسطور داخل الحقول، وسجلات CRLF و LF — تعمل داخل المتصفح بالكامل.',
          )}
        />
        <div className="space-y-3 p-4">
          <Tabs value={prefs.direction} onChange={(value) => set({ direction: value === 'json-csv' ? 'json-csv' : 'csv-json' })}>
            <Tab id="csv-json">{L('CSV to JSON', 'من CSV إلى JSON')}</Tab>
            <Tab id="json-csv">{L('JSON to CSV', 'من JSON إلى CSV')}</Tab>
          </Tabs>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={L('Delimiter', 'فاصل الحقول')}>
              <Select value={prefs.delimiter} onChange={(event) => set({ delimiter: event.target.value })}>
                {DELIMITER_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {delimiterLabel(value, L)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L('Quote character', 'علامة الاقتباس')}>
              <Select value={prefs.quoteChar} onChange={(event) => set({ quoteChar: event.target.value })} dir="ltr">
                <option value={'"'}>{'"  (RFC 4180)'}</option>
                <option value="'">{"'  (custom)"}</option>
              </Select>
            </Field>
            {prefs.direction === 'json-csv' ? (
              <Field label={L('Line ending', 'نهاية السطر')}>
                <Select value={prefs.lineEnding} onChange={(event) => set({ lineEnding: event.target.value === 'crlf' ? 'crlf' : 'lf' })} dir="ltr">
                  <option value="lf">LF</option>
                  <option value="crlf">CRLF</option>
                </Select>
              </Field>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => (prefs.direction === 'csv-json' ? setCsvInput(SAMPLE_CSV) : setJsonInput(SAMPLE_JSON))}>
                {L('Load sample', 'تحميل مثال')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (prefs.direction === 'csv-json' ? setCsvInput('') : setJsonInput(''))}>
                {L('Clear', 'مسح')}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {prefs.direction === 'csv-json' ? (
              <>
                <Checkbox label={L('First row is a header', 'السطر الأول عنوان')} checked={prefs.header} onChange={(event) => set({ header: event.target.checked })} />
                <Checkbox
                  label={L('Coerce numbers, booleans and nulls', 'تحويل الأرقام والمنطقية والفراغات')}
                  description={L(
                    'Off by default: ticket IDs and phone numbers keep leading zeros. Even when on, only values that print back exactly are converted.',
                    'متوقف افتراضياً: تبقى معرّفات التذاكر وأرقام الهواتف بأصفارها السابقة. وحتى عند التشغيل لا يُحوَّل إلا ما يعود إلى نصه الأصلي حرفياً.',
                  )}
                  checked={prefs.coerceTypes}
                  onChange={(event) => set({ coerceTypes: event.target.checked })}
                />
                <Checkbox
                  label={L('Ignore blank lines', 'تجاهل الأسطر الفارغة')}
                  checked={prefs.skipEmptyLines}
                  onChange={(event) => set({ skipEmptyLines: event.target.checked })}
                />
              </>
            ) : (
              <>
                <Checkbox label={L('Quote every field', 'اقتباس كل حقل')} checked={prefs.quoteAll} onChange={(event) => set({ quoteAll: event.target.checked })} />
                <Checkbox
                  label={L('Add UTF-8 BOM (Excel)', 'إضافة BOM لـ UTF-8 (لإكسل)')}
                  checked={prefs.bom}
                  onChange={(event) => set({ bom: event.target.checked })}
                />
              </>
            )}
          </div>
        </div>
      </Card>

      {prefs.direction === 'csv-json' ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title={L('CSV input', 'مدخل CSV')} />
            <div className="space-y-3 p-4">
              <Textarea
                value={csvInput}
                onChange={(event) => setCsvInput(event.target.value)}
                className="min-h-52 font-mono text-xs"
                dir="ltr"
                spellCheck={false}
                placeholder={SAMPLE_CSV}
                aria-label={L('CSV text', 'نص CSV')}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!parsed.ok} onClick={() => setJsonInput(jsonOutput)}>
                  {L('Send output to the JSON tab', 'أرسل المخرجات إلى تبويب JSON')}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={L('JSON output', 'مخرج JSON')}
              actions={jsonOutput ? <CopyButton value={jsonOutput} label={L('Copy JSON', 'نسخ JSON')} /> : null}
            />
            <div className="space-y-3 p-4">
              {!parsed.ok && csvInput.trim().length === 0 ? (
                <EmptyState title={L('Paste CSV to convert it.', 'ألصق نص CSV لتحويله.')} description={L('Headered CSV becomes an array of objects.', 'CSV بعنوان يتحول إلى مصفوفة كائنات.')} />
              ) : !parsed.ok ? (
                <Alert tone="danger" title={L('Nothing usable was found', 'لم يُعثر على شيء صالح')}>
                  <ul className="space-y-1">
                    {csvIssues.map((issue, index) => (
                      <li key={index}>{issueText(issue, L)}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Stat label={L('Rows', 'الأسطر')} value={parsed.rowCount} />
                    <Stat label={L('Columns', 'الأعمدة')} value={parsed.columnCount} />
                    <Stat label={L('Ragged rows', 'أسطر غير منتظمة')} value={parsed.raggedRows.length} tone={parsed.raggedRows.length ? 'warning' : undefined} />
                    <Stat label={L('Delimiter', 'الفاصل')} value={parsed.delimiter === '\t' ? 'TAB' : parsed.delimiter} hint={parsed.delimiterDetected ? L('auto-detected', 'كشف تلقائي') : L('chosen', 'محدد')} />
                  </div>

                  {csvIssues.length > 0 ? (
                    <Alert tone={csvIssues.some((issue) => issue.code === 'too-large' || issue.code === 'invalid-delimiter') ? 'danger' : 'warning'} title={L('Parser report', 'تقرير المحلّل')}>
                      <ul className="space-y-1">
                        {csvIssues.slice(0, 12).map((issue, index) => (
                          <li key={index}>{issueText(issue, L)}</li>
                        ))}
                        {csvIssues.length > 12 ? <li>{L(`+ ${csvIssues.length - 12} more`, `و ${csvIssues.length - 12} أخرى`)}</li> : null}
                      </ul>
                    </Alert>
                  ) : null}

                  {parsed.skippedEmptyRows > 0 ? (
                    <p className="text-xs text-subtle">
                      {L(`${parsed.skippedEmptyRows} blank line(s) ignored.`, `تم تجاهل ${parsed.skippedEmptyRows} سطراً فارغاً.`)}
                    </p>
                  ) : null}

                  <PreviewTable headers={parsed.headers} rows={parsed.rows} ragged={raggedBodyRows} L={L} />

                  <CodeBlock code={jsonOutput} title="array of objects" language="json" maxHeight="24rem" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => downloadTextFile('table.json', jsonOutput, 'application/json;charset=utf-8')}>
                      {L('Download .json', 'تنزيل ‎.json')}
                    </Button>
                  </div>
                  <Alert tone="info">
                    {prefs.coerceTypes
                      ? L(
                          'Type coercion is on. Values that cannot be reproduced exactly, such as 007 or 1.50, stay strings on purpose.',
                          'تحويل الأنواع مفعّل. القيم التي لا تُعاد حرفياً مثل 007 و 1.50 تبقى نصاً عن قصد.',
                        )
                      : L(
                          'Type coercion is off, so every field is a JSON string: leading zeros, IDs and phone numbers are preserved byte for byte.',
                          'تحويل الأنواع متوقف، لذا كل حقل هو نص في JSON: الأصفار السابقة والمعرّفات وأرقام الهواتف محفوظة حرفياً.',
                        )}
                  </Alert>
                </>
              )}
            </div>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title={L('JSON input', 'مدخل JSON')} />
            <div className="space-y-3 p-4">
              <Textarea
                value={jsonInput}
                onChange={(event) => setJsonInput(event.target.value)}
                className="min-h-52 font-mono text-xs"
                dir="ltr"
                spellCheck={false}
                placeholder={SAMPLE_JSON}
                aria-label={L('JSON text', 'نص JSON')}
              />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={!fromJson.ok} onClick={() => setCsvInput(csvOutput)}>
                  {L('Send output to the CSV tab', 'أرسل المخرجات إلى تبويب CSV')}
                </Button>
              </div>
              <p className="text-xs text-subtle">
                {L(
                  'Accepted shapes: an array of objects, an array of arrays, an array of scalars, or a single object.',
                  'الأشكال المدعومة: مصفوفة كائنات، أو مصفوفة مصفوفات، أو مصفوفة قيم، أو كائن واحد.',
                )}
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={L('CSV output', 'مخرج CSV')}
              actions={csvOutput ? <CopyButton value={csvOutput} label={L('Copy CSV', 'نسخ CSV')} /> : null}
            />
            <div className="space-y-3 p-4">
              {!fromJson.ok && jsonInput.trim().length === 0 ? (
                <EmptyState title={L('Paste JSON to convert it.', 'ألصق JSON لتحويله.')} description={L('Object keys become the header row.', 'تتحول مفاتيح الكائن إلى سطر العنوان.')} />
              ) : !fromJson.ok ? (
                <Alert tone="danger" title={L('JSON could not be flattened', 'تعذّر تسطيح JSON')}>
                  <ul className="space-y-1">
                    {jsonIssues.map((issue, index) => (
                      <li key={index}>{issueText(issue, L)}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label={L('Rows', 'الأسطر')} value={fromJson.rowCount} />
                    <Stat label={L('Columns', 'الأعمدة')} value={fromJson.headers.length} />
                    <Stat label={L('BOM', 'BOM')} value={prefs.bom ? 'UTF-8' : '—'} hint={prefs.bom ? L('for Excel', 'لإكسل') : L('none', 'بلا')} />
                  </div>
                  <PreviewTable
                    headers={fromJson.headers}
                    rows={fromJson.rows.slice(0, PREVIEW_ROWS).map((cells) => cells.map((cell) => (cell === null ? '' : String(cell))))}
                    ragged={[]}
                    L={L}
                  />
                  <CodeBlock code={csvOutput.replace(/^\uFEFF/, '')} title={L('CSV text', 'نص CSV')} maxHeight="24rem" />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => downloadTextFile('table.csv', csvOutput, 'text/csv;charset=utf-8')}>
                      {L('Download .csv', 'تنزيل ‎.csv')}
                    </Button>
                  </div>
                  <Alert tone="info">
                    {L(
                      'Fields containing the delimiter, a quote, a newline or leading/trailing spaces are quoted defensively; empty fields stay unquoted so round-tripping is lossless.',
                      'تُقتبس الحقول التي تحوي الفاصل أو علامة الاقتباس أو سطراً جديداً أو مسافات طرفية؛ وتبقى الحقول الفارغة بلا اقتباس ليبقى التحويل ذهاباً وإياباً بلا فقدان.',
                    )}
                  </Alert>
                </>
              )}
            </div>
          </Card>
        </div>
      )}

    </div>
  )
}

function PreviewTable({ headers, rows, ragged, L }: { headers: string[]; rows: string[][]; ragged: number[]; L: LabelFn }) {
  const shown = rows.slice(0, PREVIEW_ROWS)
  if (headers.length === 0 && shown.length === 0) return <p className="text-xs text-subtle">{L('Nothing to preview.', 'لا شيء للمعاينة.')}</p>
  const raggedSet = new Set(ragged)
  return (
    <div className="overflow-auto rounded-lg border border-line">
      <table className="w-full text-xs">
        <thead className="bg-surface-2 text-subtle">
          <tr>
            <th className="p-2 text-start font-mono">#</th>
            {headers.map((header, index) => (
              <th key={`${header}-${index}`} className="max-w-40 truncate p-2 text-start" dir="ltr" title={header}>
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((cells, index) => (
            <tr key={index} className={`border-t border-line ${raggedSet.has(index + 1) ? 'bg-warning/10' : ''}`}>
              <td className="p-2 font-mono text-subtle">{index + 1}</td>
              {headers.map((_, column) => (
                <td key={column} className="max-w-48 truncate p-2 font-mono" dir="ltr" title={cells[column] ?? ''}>
                  {cells[column] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-subtle">
          {L(`Preview shows the first ${shown.length} of ${rows.length} rows.`, `تعرض المعاينة أول ${shown.length} من ${rows.length} سطراً.`)}
        </p>
      ) : null}
    </div>
  )
}
