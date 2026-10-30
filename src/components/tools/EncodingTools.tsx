import { useMemo, useRef, useState } from 'react'
import { Braces, Clock3, FileJson, Hash, Link2, Play, Regex, TerminalSquare, TextCursorInput } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, CopyButton, Field, Input, Select, Textarea } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { nextCronRuns, validateCron } from '@/lib/cron'
import { renderMarkdown } from '@/lib/markdown'
import { downloadTextFile } from '@/lib/utils'
import { parse as parseYaml } from 'yaml'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

const encoder = new TextEncoder()

function toBase64(text: string, urlSafe: boolean): string {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const standard = btoa(binary)
  // RFC 4648 base64url: "-" and "_" replace "+" and "/", and the "=" padding is dropped.
  return urlSafe ? standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : standard
}

function base64From(value: string): Uint8Array {
  const standard = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(standard)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function digest(algo: 'SHA-1' | 'SHA-256' | 'SHA-512', data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest(algo, data)
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function HashTool() {
  const L = useLabels()
  const { notify } = useToast()
  const [text, setText] = useState('')
  const [algo, setAlgo] = useState<'SHA-1' | 'SHA-256' | 'SHA-512'>('SHA-256')
  const [digestValue, setDigestValue] = useState('')
  const [fileInfo, setFileInfo] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const run = async (buffer: ArrayBuffer, label: string) => {
    try {
      const value = await digest(algo, buffer)
      setDigestValue(value)
      setFileInfo(label)
    } catch {
      notify('error', L('Hashing failed in this browser.', 'فشل حساب البصمة في هذا المتصفح.'))
    }
  }

  return (
    <Card>
      <CardHeader title={L('Hash Calculator', 'حاسبة البصمة')} icon={<Hash className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <Field label={L('Text to hash', 'النص')} htmlFor="hash-text">
          <Textarea id="hash-text" value={text} onChange={(event) => setText(event.target.value)} className="min-h-20" dir="ltr" />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={L('Algorithm', 'الخوارزمية')} htmlFor="hash-algo">
            <Select id="hash-algo" value={algo} onChange={(event) => setAlgo(event.target.value as typeof algo)} className="w-36">
              <option value="SHA-1">SHA-1</option>
              <option value="SHA-256">SHA-256</option>
              <option value="SHA-512">SHA-512</option>
            </Select>
          </Field>
          <Button onClick={() => void run(encoder.encode(text).buffer as ArrayBuffer, L('Text input', 'النص المدخل'))}>{L('Hash text', 'احسب البصمة')}</Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>{L('Hash a file', 'احسب بصمة ملف')}</Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              if (file.size > 50 * 1024 * 1024) {
                notify('warning', L('Files above 50 MB are not hashed in the browser.', 'لا تُحسب بصمة الملفات فوق 50 ميجابايت في المتصفح.'))
                return
              }
              await run(await file.arrayBuffer(), file.name)
            }}
          />
        </div>
        {digestValue ? (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="text-[10px] uppercase text-subtle">{algo} {fileInfo}</p>
            <p className="mt-1 break-all font-mono text-xs" dir="ltr">{digestValue}</p>
            <div className="mt-2 flex justify-end"><CopyButton value={digestValue} label={L('Copy digest', 'نسخ البصمة')} /></div>
          </div>
        ) : null}
        <p className="text-[10px] text-subtle">
          {L('SHA-1 is shown for legacy comparison only; do not use it for integrity or signatures.', 'تُعرض SHA-1 للمقارنة القديمة فقط؛ لا تستخدمها للتحقق من السلامة أو التوقيعات.')}
        </p>
      </div>
    </Card>
  )
}

export function Base64Tool() {
  const L = useLabels()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [urlSafe, setUrlSafe] = useState(false)

  const convert = (mode: 'encode' | 'decode') => {
    setError(null)
    if (mode === 'encode') {
      setOutput(toBase64(input, urlSafe))
      return
    }
    let bytes: Uint8Array
    try {
      bytes = base64From(input)
    } catch {
      setOutput('')
      setError(L('Invalid Base64 input.', 'مدخل Base64 غير صالح.'))
      return
    }
    try {
      setOutput(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
      setOutput('')
      setError(L('The decoded bytes are not valid UTF-8 text; the source may be binary data.', 'البايتات المفكوكة ليست نصًا بصيغة UTF-8 صالحة؛ قد يكون المصدر بيانات ثنائية.'))
    }
  }

  return (
    <Card>
      <CardHeader title={L('Base64 Encode / Decode', 'ترميز وفك Base64')} />
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <Field label={L('Input', 'المدخل')} htmlFor="b64-input">
          <Textarea id="b64-input" value={input} onChange={(event) => setInput(event.target.value)} className="min-h-40 font-mono text-xs" dir="ltr" />
        </Field>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Button size="sm" onClick={() => convert('encode')}>{L('Encode', 'ترميز')}</Button>
            <Button size="sm" variant="secondary" onClick={() => convert('decode')}>{L('Decode', 'فك')}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setInput(''); setOutput(''); setError(null) }}>{L('Clear', 'مسح')}</Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={urlSafe} onChange={(event) => setUrlSafe(event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            {L('URL-safe output (base64url, no padding)', 'خرج آمن للروابط (base64url بدون حشو)')}
          </label>
          <div className="min-h-40 flex-1 rounded-lg border border-line bg-surface-2 p-3">
            {error ? <p className="text-xs text-danger">{error}</p> : <p className="break-all font-mono text-xs" dir="ltr">{output || L('Output appears here.', 'تظهر النتيجة هنا.')}</p>}
          </div>
          {output ? <CopyButton value={output} label={L('Copy output', 'نسخ النتيجة')} /> : null}
          <p className="text-[10px] text-subtle">
            {L('Decoding accepts both the standard and URL-safe alphabets.', 'يقبل فك الترميز كلا الأبجدية القياسية والآمنة للروابط.')}
          </p>
        </div>
      </div>
    </Card>
  )
}

export function UrlTool() {
  const L = useLabels()
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (mode: 'encode' | 'decode') => {
    setError(null)
    try {
      setOutput(mode === 'encode' ? encodeURIComponent(input) : decodeURIComponent(input))
    } catch {
      setOutput('')
      setError(L('Malformed percent-encoding.', 'ترميز نسبي غير صالح.'))
    }
  }

  return (
    <Card>
      <CardHeader title={L('URL Encode / Decode', 'ترميز وفك URL')} icon={<Link2 className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <Field label={L('Input', 'المدخل')} htmlFor="url-input">
          <Input id="url-input" value={input} onChange={(event) => setInput(event.target.value)} dir="ltr" placeholder="https://example.com/search?q=hello world" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run('encode')}>{L('Encode component', 'ترميز المكوّن')}</Button>
          <Button size="sm" variant="secondary" onClick={() => run('decode')}>{L('Decode', 'فك')}</Button>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {output ? (
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <p className="break-all font-mono text-xs" dir="ltr">{output}</p>
            <div className="mt-2 flex justify-end"><CopyButton value={output} /></div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export function JsonTool() {
  const L = useLabels()
  const [input, setInput] = useState('{"name":"value","items":[1,2,3]}')
  const [output, setOutput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = (mode: 'format' | 'minify') => {
    setError(null)
    try {
      const parsed = JSON.parse(input)
      setOutput(mode === 'format' ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed))
    } catch (caught) {
      setOutput('')
      setError(caught instanceof Error ? caught.message : L('Invalid JSON.', 'JSON غير صالح.'))
    }
  }

  return (
    <Card>
      <CardHeader title={L('JSON Formatter & Validator', 'منسّق ومدقق JSON')} icon={<FileJson className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-40 font-mono text-xs" dir="ltr" aria-label="JSON" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => run('format')}>{L('Format', 'تنسيق')}</Button>
          <Button size="sm" variant="secondary" onClick={() => run('minify')}>{L('Minify', 'تصغير')}</Button>
          <Button size="sm" variant="ghost" onClick={() => { setInput(output || input); setError(null) }} disabled={!output}>{L('Use output as input', 'استخدام النتيجة كمدخل')}</Button>
          {output ? <CopyButton value={output} /> : null}
        </div>
        {error ? <Alert tone="danger" title={L('JSON error', 'خطأ JSON')}>{error}</Alert> : null}
        {output ? (
          <div className="rounded-lg border border-success/30">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
              <Badge tone="success">{L('Valid JSON', 'JSON صالح')}</Badge>
              <span className="text-[10px] text-subtle">{output.length} {L('characters', 'حرفًا')}</span>
            </div>
            <pre className="max-h-80 overflow-auto p-3 text-xs" dir="ltr">{output}</pre>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export function RegexTool() {
  const L = useLabels()
  const [pattern, setPattern] = useState('(\\w+)@(\\w+\\.\\w+)')
  const [flags, setFlags] = useState('gi')
  const [sample, setSample] = useState('Contact admin@example.com or noc@example.net for support.')
  const { matches, error } = useMemo(() => {
    try {
      if (!pattern) return { matches: [], error: null }
      const regex = new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`)
      const found: Array<{ value: string; index: number; groups: string[] }> = []
      let match: RegExpExecArray | null
      while ((match = regex.exec(sample)) !== null) {
        found.push({ value: match[0], index: match.index, groups: match.slice(1) })
        if (match[0] === '') break
        if (found.length > 500) break
      }
      return { matches: found, error: null }
    } catch (caught) {
      return { matches: [], error: caught instanceof Error ? caught.message : 'Invalid regex' }
    }
  }, [pattern, flags, sample])

  return (
    <Card>
      <CardHeader title={L('Regex Tester', 'اختبار التعبيرات النمطية')} icon={<Regex className="h-4 w-4" />} />
      <div className="grid gap-3 p-4 sm:grid-cols-[1fr_8rem]">
        <Field label={L('Pattern', 'النمط')} htmlFor="regex-pattern">
          <Input id="regex-pattern" value={pattern} onChange={(event) => setPattern(event.target.value)} className="font-mono" dir="ltr" />
        </Field>
        <Field label={L('Flags', 'الأعلام')} htmlFor="regex-flags">
          <Input id="regex-flags" value={flags} onChange={(event) => setFlags(event.target.value.replace(/[^gimsuy]/g, ''))} className="font-mono" dir="ltr" />
        </Field>
      </div>
      <div className="px-4">
        <Field label={L('Sample text', 'النص التجريبي')} htmlFor="regex-sample">
          <Textarea id="regex-sample" value={sample} onChange={(event) => setSample(event.target.value)} className="min-h-28" dir="ltr" />
        </Field>
      </div>
      <div className="p-4">
        {error ? <Alert tone="danger">{error}</Alert> : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Badge tone={matches.length ? 'success' : 'default'}>{matches.length} {L('matches', 'تطابقًا')}</Badge>
            </div>
            {matches.length ? (
              <div className="max-h-64 overflow-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-subtle">
                    <tr>
                      <th className="p-2 text-start">#</th>
                      <th className="p-2 text-start">{L('Match', 'التطابق')}</th>
                      <th className="p-2 text-start">{L('Index', 'الموضع')}</th>
                      <th className="p-2 text-start">{L('Groups', 'المجموعات')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matches.map((match, index) => (
                      <tr key={`${match.index}-${index}`} className="border-t border-line">
                        <td className="p-2">{index + 1}</td>
                        <td className="break-all p-2 font-mono" dir="ltr">{match.value}</td>
                        <td className="p-2 font-mono">{match.index}</td>
                        <td className="break-all p-2 font-mono" dir="ltr">{match.groups.join(' | ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-xs text-muted">{L('No matches.', 'لا توجد تطابقات.')}</p>}
          </>
        )}
      </div>
    </Card>
  )
}

const INITIAL_TIMESTAMP = String(Math.floor(Date.now() / 1000))

export function TimestampTool() {
  const L = useLabels()
  const [value, setValue] = useState(INITIAL_TIMESTAMP)
  const parsed = useMemo(() => {
    const trimmed = value.trim()
    if (!trimmed) return null
    // Digit-only input is ambiguous, so length decides: up to 10 is seconds, 11-13 is milliseconds.
    if (/^\d{1,10}$/.test(trimmed)) return { date: new Date(Number(trimmed) * 1000), unit: 'seconds' as const }
    if (/^\d{11,13}$/.test(trimmed)) return { date: new Date(Number(trimmed)), unit: 'milliseconds' as const }
    if (/^\d{14,}$/.test(trimmed)) return null
    const date = new Date(trimmed)
    return Number.isNaN(date.getTime()) ? null : { date, unit: 'text' as const }
  }, [value])

  const note = parsed
    ? parsed.unit === 'seconds'
      ? L('Interpreted as Unix seconds.', 'تُفسر كثوانٍ Unix.')
      : parsed.unit === 'milliseconds'
        ? L('Interpreted as Unix milliseconds.', 'تُفسر كمللي ثانية Unix.')
        : L('Parsed as a date string.', 'تم تحليلها كنص تاريخ.')
    : null

  return (
    <Card>
      <CardHeader title={L('Timestamp Converter', 'محوّل الطوابع الزمنية')} icon={<Clock3 className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label={L('Unix seconds, milliseconds or ISO 8601', 'ثوانٍ أو مللي ثانية Unix أو ISO 8601')} htmlFor="ts-input" className="flex-1">
            <Input id="ts-input" value={value} onChange={(event) => setValue(event.target.value)} dir="ltr" />
          </Field>
          <Button variant="secondary" onClick={() => setValue(String(Math.floor(Date.now() / 1000)))}>{L('Now', 'الآن')}</Button>
        </div>
        {parsed ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                [L('Unix seconds', 'ثواني Unix'), String(Math.floor(parsed.date.getTime() / 1000))],
                [L('Unix milliseconds', 'مللي ثانية Unix'), String(parsed.date.getTime())],
                [L('ISO 8601 (UTC)', 'ISO 8601 (UTC)'), parsed.date.toISOString()],
                [L('Local time', 'الوقت المحلي'), parsed.date.toLocaleString()],
              ].map(([label, result]) => (
                <div key={label} className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <p className="text-[10px] uppercase text-subtle">{label}</p>
                  <p className="break-all font-mono text-xs" dir="ltr">{result}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-subtle" dir="auto">
              {note}{' '}
              {L('Digit-only input up to 10 digits is read as seconds and 11-13 digits as milliseconds; longer digit strings are rejected.', 'المدخل الرقمي حتى 10 أرقام يُقرأ كثوانٍ، ومن 11 إلى 13 رقمًا كمللي ثانية، وما طال عن ذلك يُرفض.')}
            </p>
          </>
        ) : <Alert tone="danger">{L('Unrecognized timestamp or date.', 'طابع زمني أو تاريخ غير معروف.')}</Alert>}
      </div>
    </Card>
  )
}

export function CronTool() {
  const L = useLabels()
  const [expression, setExpression] = useState('*/15 9-17 * * 1-5')
  const validation = useMemo(() => validateCron(expression), [expression])
  const [base] = useState(() => new Date())
  const runs = validation.valid ? nextCronRuns(expression, base, 5) : null

  return (
    <Card>
      <CardHeader title={L('Cron Expression Helper', 'مساعد تعبيرات Cron')} icon={<Clock3 className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <Field label={L('5-field expression (minute hour day month weekday)', 'تعبير من 5 حقول (دقيقة ساعة يوم شهر يوم الأسبوع)')} htmlFor="cron-input">
          <Input id="cron-input" value={expression} onChange={(event) => setExpression(event.target.value)} className="font-mono" dir="ltr" />
        </Field>
        {validation.valid ? (
          <Alert tone="success">{L('Valid expression. Next runs are computed in your local time zone.', 'تعبير صالح. تُحسب التشغيلات التالية حسب منطقتك الزمنية.')}</Alert>
        ) : (
          <Alert tone="danger">{validation.error}</Alert>
        )}
        {runs && runs.length > 0 ? (
          <ol className="space-y-1 rounded-lg border border-line p-3 text-xs">
            {runs.map((run) => (
              <li key={run.toISOString()} className="flex justify-between gap-2">
                <span className="text-subtle">{L('Next run', 'التشغيل التالي')}</span>
                <span className="font-mono" dir="ltr">{run.toLocaleString()}</span>
              </li>
            ))}
          </ol>
        ) : runs ? <p className="text-xs text-warning">{L('No runs in the next year.', 'لا توجد تشغيلات خلال السنة القادمة.')}</p> : null}
        <p className="text-[10px] text-subtle">
          {L('Supports *, lists, ranges, steps and 3-letter month/weekday names. It does not interpret @reboot or seconds fields.', 'يدعم * والقوائم والنطاقات والخطوات وأسماء الشهر واليوم بثلاثة أحرف. لا يفسر @reboot أو حقول الثواني.')}
        </p>
      </div>
    </Card>
  )
}

export function YamlTool() {
  const L = useLabels()
  const [input, setInput] = useState('services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"')
  const { parsed, error } = useMemo(() => {
    try {
      return { parsed: parseYaml(input), error: null }
    } catch (caught) {
      return { parsed: null, error: caught instanceof Error ? caught.message : 'Invalid YAML' }
    }
  }, [input])

  return (
    <Card>
      <CardHeader title={L('YAML Validator', 'مدقق YAML')} icon={<Braces className="h-4 w-4" />} />
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-64 font-mono text-xs" dir="ltr" aria-label="YAML" />
        <div className="rounded-lg border border-line">
          {error ? (
            <pre className="p-3 text-xs text-danger" dir="ltr">{error}</pre>
          ) : (
            <pre className="max-h-64 overflow-auto p-3 text-xs" dir="ltr">{JSON.stringify(parsed, null, 2)}</pre>
          )}
        </div>
      </div>
      {error ? <div className="px-4 pb-4"><Alert tone="danger">{L('YAML syntax error — check indentation and tabs.', 'خطأ في صياغة YAML — تحقق من الإزاحة وعلامات الجدولة.')}</Alert></div> : null}
    </Card>
  )
}

export function MarkdownTool() {
  const L = useLabels()
  const [input, setInput] = useState('# Incident note\n\n- **Service:** Exchange Online\n- **Impact:** mail delay\n\n```powershell\nGet-OrganizationConfig\n```')
  const html = useMemo(() => renderMarkdown(input), [input])

  return (
    <Card>
      <CardHeader
        title={L('Markdown Editor', 'محرر Markdown')}
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<TextCursorInput className="h-3.5 w-3.5" />} onClick={() => downloadTextFile('adnan-tech-note.md', input, 'text/markdown;charset=utf-8')}>{L('Export .md', 'تصدير .md')}</Button>
            <CopyButton value={input} />
          </>
        }
      />
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-80 font-mono text-xs" dir="ltr" aria-label="Markdown" />
        <div className="prose-nexus max-h-80 overflow-auto rounded-lg border border-line p-4" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </Card>
  )
}

export function LogFormatTool() {
  const L = useLabels()
  const [input, setInput] = useState('{"time":"2026-10-22T09:14:02Z","level":"error","msg":"Update failed","code":"0x800f081f"}\n{"time":"2026-10-22T09:15:11Z","level":"info","msg":"Retry started"}')
  const [pretty, setPretty] = useState(true)
  const lines = input.split(/\r?\n/).filter((line) => line.trim())
  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line) as unknown
    } catch {
      return null
    }
  })
  const invalid = parsed.filter((item) => item === null).length

  return (
    <Card>
      <CardHeader title={L('Log Formatter', 'منسّق السجلات')} icon={<TerminalSquare className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <Textarea value={input} onChange={(event) => setInput(event.target.value)} className="min-h-48 font-mono text-xs" dir="ltr" aria-label="Logs" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={pretty} onChange={(event) => setPretty(event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            {L('Pretty-print JSON', 'تنسيق JSON')}
          </label>
          <Badge tone={invalid ? 'warning' : 'success'}>{lines.length - invalid} JSON {L('lines', 'سطرًا')}</Badge>
          {invalid > 0 ? <Badge tone="warning">{invalid} {L('non-JSON lines', 'سطرًا غير JSON')}</Badge> : null}
        </div>
        <pre className="max-h-96 overflow-auto rounded-lg border border-line p-3 text-xs" dir="ltr">
          {parsed.map((line, index) => (
            line === null ? lines[index] : pretty ? JSON.stringify(line, null, 2) : JSON.stringify(line)
          )).join('\n\n')}
        </pre>
      </div>
    </Card>
  )
}

interface ApiResult {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
  elapsedMs: number
}

export function ApiTool() {
  const L = useLabels()
  const [url, setUrl] = useState('https://httpbin.org/get')
  const [method, setMethod] = useState('GET')
  const [headers, setHeaders] = useState('{"Accept":"application/json"}')
  const [body, setBody] = useState('')
  const [result, setResult] = useState<ApiResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const send = async () => {
    setError(null)
    setResult(null)
    const parseHeaders = (): Record<string, string> | null => {
      try {
        return headers.trim() ? (JSON.parse(headers) as Record<string, string>) : {}
      } catch {
        return null
      }
    }
    const parsedHeaders = parseHeaders()
    if (!parsedHeaders) {
      setError(L('Headers must be valid JSON.', 'يجب أن تكون الرؤوس JSON صالحًا.'))
      return
    }
    let target: URL
    try {
      target = new URL(url)
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('protocol')
    } catch {
      setError(L('Enter a valid http(s) URL.', 'أدخل رابط http(s) صالحًا.'))
      return
    }
    if (!['GET', 'HEAD'].includes(method) && !body.trim()) {
      setError(L('This method usually needs a request body.', 'تتطلب هذه الطريقة عادةً جسم طلب.'))
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    const started = performance.now()
    try {
      const response = await fetch(target.toString(), {
        method,
        headers: parsedHeaders,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
        signal: controller.signal,
      })
      const text = await response.text()
      setResult({
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body: text.slice(0, 20000),
        elapsedMs: Math.round(performance.now() - started),
      })
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === 'AbortError'
          ? L('The request timed out after 15 seconds.', 'انتهت مهلة الطلب بعد 15 ثانية.')
          : L('Request failed. The target may not allow cross-origin requests (CORS).', 'فشل الطلب. قد لا يسمح الهدف بطلبات المصادر المتقاطعة (CORS).'),
      )
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader title={L('API Request Builder', 'منشئ طلبات API')} icon={<Play className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[7rem_1fr]">
          <Select value={method} onChange={(event) => setMethod(event.target.value)} aria-label="HTTP method">
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </Select>
          <Input value={url} onChange={(event) => setUrl(event.target.value)} dir="ltr" aria-label="URL" />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label={L('Headers (JSON)', 'الرؤوس (JSON)')} htmlFor="api-headers">
            <Textarea id="api-headers" value={headers} onChange={(event) => setHeaders(event.target.value)} className="min-h-24 font-mono text-xs" dir="ltr" />
          </Field>
          <Field label={L('Request body', 'جسم الطلب')} htmlFor="api-body">
            <Textarea id="api-body" value={body} onChange={(event) => setBody(event.target.value)} className="min-h-24 font-mono text-xs" dir="ltr" />
          </Field>
        </div>
        <Button onClick={() => void send()} loading={loading} icon={<Play className="h-4 w-4" />}>{L('Send request', 'إرسال الطلب')}</Button>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.status < 400 ? 'success' : 'danger'}>{result.status} {result.statusText}</Badge>
              <Badge>{result.elapsedMs} ms</Badge>
              <CopyButton value={result.body} />
            </div>
            <details className="rounded-lg border border-line p-2 text-xs">
              <summary className="cursor-pointer text-muted">{L('Response headers', 'رؤوس الاستجابة')}</summary>
              <pre className="mt-2 max-h-40 overflow-auto" dir="ltr">{result.headers.map(([key, value]) => `${key}: ${value}`).join('\n')}</pre>
            </details>
            <pre className="max-h-80 overflow-auto rounded-lg border border-line bg-[var(--code-bg)] p-3 text-xs" dir="ltr">{result.body}</pre>
          </div>
        ) : null}
        <p className="text-[10px] text-subtle">{L('Requests run directly from your browser. Cross-origin targets must allow CORS; credentials are never attached automatically.', 'تُنفذ الطلبات من متصفحك مباشرة. يجب أن تسمح الأهداف المتقاطعة بـ CORS، ولا تُرفق بيانات الاعتماد تلقائيًا.')}</p>
      </div>
    </Card>
  )
}
