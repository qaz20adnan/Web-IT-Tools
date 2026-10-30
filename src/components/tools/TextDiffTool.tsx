import { useEffect, useMemo, useState } from 'react'
import { GitCompare } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CodeBlock,
  CopyButton,
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
import { diffLines, toSideBySide, toUnifiedDiff, type DiffOp, type DiffOptions } from '@/lib/diff'

type LabelFn = (en: string, ar: string) => string

const PREFS_KEY = 'nexora.textdiff.prefs.v1'
const MAX_RENDERED_ROWS = 2000

const SAMPLE_BEFORE = `# httpd.conf
ServerRoot "/etc/httpd"
Listen 80
<Directory "/var/www/html">
    Options Indexes FollowSymLinks
    AllowOverride None
    Require all granted
</Directory>
`

const SAMPLE_AFTER = `# httpd.conf
ServerRoot "/etc/httpd"
Listen 443
Listen 8080
<Directory "/var/www/html">
    Options FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>
`

interface DiffPrefs extends DiffOptions {
  showWhitespace: boolean
  showEndings: boolean
  context: number
}

const DEFAULT_PREFS: DiffPrefs = {
  ignoreCase: false,
  ignoreTrailingWhitespace: false,
  showWhitespace: false,
  showEndings: false,
  context: 3,
}

function endingLabel(ending: DiffOp['ending'], L: LabelFn): string {
  if (ending === 'crlf') return 'CRLF'
  if (ending === 'cr') return 'CR'
  if (ending === 'none') return L('no EOL', 'بلا نهاية سطر')
  return 'LF'
}

function DiffCell({
  op,
  side,
  prefs,
  L,
}: {
  op: DiffOp | null
  side: 'left' | 'right'
  prefs: DiffPrefs
  L: LabelFn
}) {
  const filler = 'bg-surface-2/60'
  if (!op) return <div className={`h-7 ${filler}`} aria-hidden />

  const tone = op.kind === 'equal' ? '' : op.kind === 'add' ? 'bg-success/10' : 'bg-danger/10'
  const gutter = op.kind === 'equal' ? 'text-subtle' : op.kind === 'add' ? 'text-success' : 'text-danger'
  const marker = op.kind === 'add' ? '+' : op.kind === 'remove' ? '-' : ' '
  let text = op.text
  if (prefs.showWhitespace && op.trailingSpace.length > 0) {
    text = `${text.slice(0, text.length - op.trailingSpace.length)}${'·'.repeat(op.trailingSpace.length)}`
  }
  const line = side === 'left' ? op.beforeLine : op.afterLine

  return (
    <div className={`flex h-7 items-start gap-2 overflow-hidden whitespace-pre px-2 font-mono text-xs ${tone}`}>
      <span className="w-8 shrink-0 select-none text-end text-[11px] text-subtle">{line ?? ''}</span>
      <span className={`shrink-0 select-none font-bold ${gutter}`}>{marker}</span>
      <span className="min-w-0 flex-1 truncate" dir="ltr" title={op.text}>
        {text.length > 0 ? text : '\u00A0'}
      </span>
      {prefs.showEndings ? (
        <span className="shrink-0 select-none text-[10px] text-subtle" dir="ltr">
          {endingLabel(op.ending, L)}
        </span>
      ) : null}
    </div>
  )
}

export function TextDiffTool() {
  const { settings } = useApp()
  const L: LabelFn = (en, ar) => (settings.language === 'ar' ? ar : en)
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [prefs, setPrefs] = useState<DiffPrefs>(() => ({ ...DEFAULT_PREFS, ...readJson<Partial<DiffPrefs>>(PREFS_KEY, {}) }))
  const [view, setView] = useState('side')

  useEffect(() => {
    writeJson(PREFS_KEY, prefs)
  }, [prefs])

  const result = useMemo(() => diffLines(before, after, { ignoreCase: prefs.ignoreCase, ignoreTrailingWhitespace: prefs.ignoreTrailingWhitespace }), [before, after, prefs.ignoreCase, prefs.ignoreTrailingWhitespace])
  const rows = useMemo(() => toSideBySide(result.ops), [result.ops])
  const unified = useMemo(
    () => toUnifiedDiff(result, { context: prefs.context, beforeName: 'before', afterName: 'after' }),
    [result, prefs.context],
  )

  const hasInput = before.length > 0 || after.length > 0
  const mixedEndings = (result.before.crlf > 0 && result.before.lf > 0) || (result.after.crlf > 0 && result.after.lf > 0)
  const set = (patch: Partial<DiffPrefs>) => setPrefs((current) => ({ ...current, ...patch }))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('Text and config diff', 'مقارنة نصوص وملفات الإعدادات')}
          icon={<GitCompare className="h-4 w-4" />}
          subtitle={L(
            'Line-based diff computed locally with a longest-common-subsequence walk plus prefix and suffix trimming. Nothing leaves the browser.',
            'مقارنة أسطر تُحسب محلياً بخوارزمية أطول تسلسل مشترك مع تجاهل البادئة واللاحقة. لا يغادر شيء المتصفح.',
          )}
        />
        <div className="space-y-3 p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label={L('Before', 'قبل')}>
              <Textarea
                value={before}
                onChange={(event) => setBefore(event.target.value)}
                className="min-h-44 font-mono text-xs"
                dir="ltr"
                spellCheck={false}
                placeholder={SAMPLE_BEFORE}
              />
            </Field>
            <Field label={L('After', 'بعد')}>
              <Textarea
                value={after}
                onChange={(event) => setAfter(event.target.value)}
                className="min-h-44 font-mono text-xs"
                dir="ltr"
                spellCheck={false}
                placeholder={SAMPLE_AFTER}
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setBefore(SAMPLE_BEFORE)
                setAfter(SAMPLE_AFTER)
              }}
            >
              {L('Load sample', 'تحميل مثال')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBefore('')
                setAfter('')
              }}
            >
              {L('Clear', 'مسح')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBefore(after)} disabled={after.length === 0}>
              {L('Copy after to before', 'نسخ "بعد" إلى "قبل"')}
            </Button>
            <Field label={L('Context lines', 'أسطر السياق')} className="w-32">
              <Select value={String(prefs.context)} onChange={(event) => set({ context: Number(event.target.value) })} dir="ltr">
                <option value="1">1</option>
                <option value="3">3</option>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="9999">{L('all', 'الكل')}</option>
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox label={L('Ignore case', 'تجاهل حالة الأحرف')} checked={prefs.ignoreCase} onChange={(event) => set({ ignoreCase: event.target.checked })} />
            <Checkbox
              label={L('Ignore trailing whitespace', 'تجاهل المسافات اللاحقة')}
              checked={prefs.ignoreTrailingWhitespace}
              onChange={(event) => set({ ignoreTrailingWhitespace: event.target.checked })}
            />
            <Checkbox label={L('Mark trailing whitespace', 'إظهار المسافات اللاحقة')} checked={prefs.showWhitespace} onChange={(event) => set({ showWhitespace: event.target.checked })} />
            <Checkbox label={L('Mark line endings', 'إظهار نهايات الأسطر')} checked={prefs.showEndings} onChange={(event) => set({ showEndings: event.target.checked })} />
          </div>

          {!hasInput ? (
            <Alert tone="info">
              {L(
                'Paste two versions of a file — httpd.conf, hosts, iptables rules, a PowerShell script — to see what changed.',
                'ألصق نسختين من ملف — httpd.conf أو hosts أو قواعد iptables أو سكربت PowerShell — لترى ما تغيّر.',
              )}
            </Alert>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label={L('Added', 'مُضاف')} value={result.added} tone="success" />
              <Stat label={L('Removed', 'مُزال')} value={result.removed} tone="warning" />
              <Stat label={L('Unchanged', 'بدون تغيير')} value={result.unchanged} />
              <Stat label={L('Identical lines', 'أسطر متطابقة')} value={`${result.equalPercent}%`} tone={result.equalPercent === 100 ? 'success' : undefined} />
              <Stat label={L('Lines', 'الأسطر')} value={`${result.before.lines} → ${result.after.lines}`} />
            </div>
          )}

          {result.degraded ? (
            <Alert tone="warning" title={L('Large change region', 'منطقة تغيير كبيرة')}>
              {L(
                'The changed block exceeded the diff budget, so it is reported as one removal run followed by one addition run.',
                'تجاوزت كتلة التغيير حدّ المقارنة، لذا تُعرض كإزالة كاملة يتبعها إضافة كاملة.',
              )}
            </Alert>
          ) : null}

          {prefs.showEndings && mixedEndings ? (
            <Alert tone="info" title={L('Mixed line endings', 'نهايات أسطر مختلطة')}>
              <div className="flex flex-wrap gap-2" dir="ltr">
                <Badge>{L('before', 'قبل')}: CRLF {result.before.crlf} · LF {result.before.lf} · CR {result.before.cr}</Badge>
                <Badge>{L('after', 'بعد')}: CRLF {result.after.crlf} · LF {result.after.lf} · CR {result.after.cr}</Badge>
              </div>
            </Alert>
          ) : null}

          {result.before.lastLineHasNoNewline || result.after.lastLineHasNoNewline ? (
            <Alert tone="warning" title={L('Missing final newline', 'سطر أخير بلا نهاية')}>
              {L(
                'A file whose last line has no line terminator is a real content change, so it is shown as a removal plus an addition.',
                'الملف الذي ينتهي بلا علامة نهاية سطر يُعد تغييراً حقيقياً في المحتوى، لذا يُعرض كإزالة يتبعها إضافة.',
              )}
            </Alert>
          ) : null}
        </div>
      </Card>

      {hasInput ? (
        <Card>
          <CardHeader
            title={L('Result', 'النتيجة')}
            actions={
              view === 'unified' ? (
                <div className="flex gap-2">
                  <CopyButton value={unified} label={L('Copy diff', 'نسخ الفرق')} />
                  <Button size="sm" variant="secondary" onClick={() => downloadTextFile('changes.diff', unified)}>
                    {L('Download .diff', 'تنزيل ‎.diff')}
                  </Button>
                </div>
              ) : null
            }
          />
          <div className="space-y-3 p-4">
            <Tabs value={view} onChange={setView}>
              <Tab id="side" icon={<GitCompare className="h-3.5 w-3.5" />}>
                {L('Side by side', 'جنباً إلى جنب')}
              </Tab>
              <Tab id="unified">{L('Unified diff', 'فرق موحّد')}</Tab>
            </Tabs>

            {view === 'unified' ? (
              result.added + result.removed === 0 ? (
                <p className="text-xs text-muted">{L('The two inputs are identical.', 'الملدان متطابقان.')}</p>
              ) : (
                <CodeBlock code={unified} title="unified diff" maxHeight="30rem" />
              )
            ) : (
              <div className="space-y-2">
                {rows.length > MAX_RENDERED_ROWS ? (
                  <Alert tone="info">
                    {L(
                      `Showing the first ${MAX_RENDERED_ROWS} of ${rows.length} rows. Use the unified view or download the diff for the whole file.`,
                      `يُعرض أول ${MAX_RENDERED_ROWS} سطر من أصل ${rows.length}. استخدم العرض الموحّد أو نزّل الفرق للملف كاملاً.`,
                    )}
                  </Alert>
                ) : null}
                <div className="overflow-hidden rounded-lg border border-line">
                  <div className="grid grid-cols-2 divide-x divide-line border-b border-line bg-surface-2 text-[11px] font-semibold text-subtle">
                    <span className="px-3 py-1.5">{L('Before', 'قبل')}</span>
                    <span className="px-3 py-1.5">{L('After', 'بعد')}</span>
                  </div>
                  <div className="max-h-[32rem] overflow-auto divide-y divide-line/60 text-xs">
                    {rows.slice(0, MAX_RENDERED_ROWS).map((row, index) => (
                      <div key={index} className="grid grid-cols-2 divide-x divide-line">
                        <DiffCell op={row.left} side="left" prefs={prefs} L={L} />
                        <DiffCell op={row.right} side="right" prefs={prefs} L={L} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] text-subtle">
                  <Badge tone="success">{L('added', 'مُضاف')}</Badge>
                  <Badge tone="danger">{L('removed', 'مُزال')}</Badge>
                  <Badge>{L('unchanged', 'بدون تغيير')}</Badge>
                </div>
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
