import { useMemo, useState } from 'react'
import { Bug, ClipboardList, Download, FileCheck2, FileText, Plus, ScanSearch, ShieldAlert, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Checkbox, CodeBlock, CopyButton, EmptyState, Field, Input, Select, Textarea } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { CHECKLISTS } from '@/data/checklists'
import { calculateCvss, DEFAULT_CVSS, parseCvssVector, type CvssMetric, type CvssSeverity, type CvssVector } from '@/lib/cvss'
import { readJson, writeJson } from '@/lib/storage'
import { downloadTextFile, uid } from '@/lib/utils'
import { pickText } from '@/i18n'
import type { Priority } from '@/types'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

const CVSS_OPTIONS: Array<{
  key: keyof CvssVector
  label: [string, string]
  values: Array<[string, string, string]>
}> = [
  { key: 'AV', label: ['Attack vector', 'متجه الهجوم'], values: [['N', 'Network', 'شبكة'], ['A', 'Adjacent', 'مجاور'], ['L', 'Local', 'محلي'], ['P', 'Physical', 'مادي']] },
  { key: 'AC', label: ['Attack complexity', 'تعقيد الهجوم'], values: [['L', 'Low', 'منخفض'], ['H', 'High', 'مرتفع']] },
  { key: 'PR', label: ['Privileges required', 'الامتيازات المطلوبة'], values: [['N', 'None', 'لا شيء'], ['L', 'Low', 'منخفضة'], ['H', 'High', 'مرتفعة']] },
  { key: 'UI', label: ['User interaction', 'تفاعل المستخدم'], values: [['N', 'None', 'لا شيء'], ['R', 'Required', 'مطلوب']] },
  { key: 'S', label: ['Scope', 'النطاق'], values: [['U', 'Unchanged', 'دون تغيير'], ['C', 'Changed', 'متغير']] },
  { key: 'C', label: ['Confidentiality', 'السرية'], values: [['H', 'High', 'مرتفع'], ['L', 'Low', 'منخفض'], ['N', 'None', 'لا شيء']] },
  { key: 'I', label: ['Integrity', 'السلامة'], values: [['H', 'High', 'مرتفع'], ['L', 'Low', 'منخفض'], ['N', 'None', 'لا شيء']] },
  { key: 'A', label: ['Availability', 'الإتاحة'], values: [['H', 'High', 'مرتفع'], ['L', 'Low', 'منخفض'], ['N', 'None', 'لا شيء']] },
]

const SEVERITY_LABELS: Record<CvssSeverity, [string, string]> = {
  None: ['None', 'لا شيء'],
  Low: ['Low', 'منخفضة'],
  Medium: ['Medium', 'متوسطة'],
  High: ['High', 'عالية'],
  Critical: ['Critical', 'حرجة'],
}

const SEVERITY_TONE: Record<CvssSeverity, 'success' | 'default' | 'warning' | 'danger'> = {
  None: 'success',
  Low: 'success',
  Medium: 'default',
  High: 'warning',
  Critical: 'danger',
}

export function CvssTool() {
  const L = useLabels()
  const [vector, setVector] = useState<CvssVector>(DEFAULT_CVSS)
  const [importValue, setImportValue] = useState('')
  const [defaulted, setDefaulted] = useState<CvssMetric[] | null>(null)
  const result = useMemo(() => calculateCvss(vector), [vector])
  const severityLabel = L(SEVERITY_LABELS[result.severity][0], SEVERITY_LABELS[result.severity][1])
  const metricLabel = (key: CvssMetric) => {
    const option = CVSS_OPTIONS.find((entry) => entry.key === key)
    return option ? `${key} — ${L(option.label[0], option.label[1])}` : key
  }

  return (
    <Card>
      <CardHeader title={L('CVSS v3.1 Base Score', 'درجة CVSS v3.1 الأساسية')} icon={<ShieldAlert className="h-4 w-4" />} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CVSS_OPTIONS.map((option) => (
            <Field key={option.key} label={L(option.label[0], option.label[1])} htmlFor={`cvss-${option.key}`}>
              <Select
                id={`cvss-${option.key}`}
                value={vector[option.key]}
                onChange={(event) => setVector((current) => ({ ...current, [option.key]: event.target.value }))}
              >
                {option.values.map(([value, en, ar]) => (
                  <option key={value} value={value}>{value} — {L(en, ar)}</option>
                ))}
              </Select>
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2 p-4">
          <div role="status" aria-live="polite" className="flex items-center gap-3">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-line-strong font-mono text-xl font-bold"
              role="img"
              aria-label={`${L('Base score', 'الدرجة الأساسية')}: ${result.baseScore.toFixed(1)} — ${severityLabel}`}
            >
              <span dir="ltr">{result.baseScore.toFixed(1)}</span>
            </div>
            <div>
              <Badge tone={SEVERITY_TONE[result.severity]}>{severityLabel}</Badge>
              <p className="mt-1 font-mono text-xs" dir="ltr">{result.vector}</p>
            </div>
          </div>
          <div className="ms-auto flex gap-2">
            <CopyButton value={result.vector} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={L('Import an existing vector', 'استيراد متجه موجود')} htmlFor="cvss-import" className="flex-1">
            <Input id="cvss-import" value={importValue} onChange={(event) => setImportValue(event.target.value)} placeholder="CVSS:3.1/AV:N/..." dir="ltr" />
          </Field>
          <Button
            variant="secondary"
            onClick={() => {
              const parsed = parseCvssVector(importValue)
              if (!parsed) {
                setDefaulted(null)
                return
              }
              setVector(parsed.vector)
              setDefaulted(parsed.defaulted)
            }}
            disabled={!importValue.trim()}
          >
            {L('Load vector', 'تحميل المتجه')}
          </Button>
        </div>
        {defaulted && defaulted.length > 0 ? (
          <Alert tone="warning" title={L('Incomplete vector', 'متجه غير مكتمل')}>
            {L(
              'These metrics were missing or invalid and were set to a default value, so the score is not the score of the vector you pasted:',
              'المقاييس التالية كانت مفقودة أو غير صالحة وضُبطت على قيمة افتراضية، لذلك الدرجة ليست درجة المتجه الذي لصقته:',
            )}{' '}
            <span dir="ltr">{defaulted.map(metricLabel).join(', ')}</span>
          </Alert>
        ) : null}
        <p className="text-[10px] text-subtle">
          {L('Uses the official CVSS v3.1 base metric equations and round-up rule. Temporal and environmental metrics are not included.', 'يستخدم معادلات CVSS v3.1 الأساسية وقاعدة التقريب لأعلى. لا تشمل المقاييس الزمنية والبيئية.')}
        </p>
      </div>
    </Card>
  )
}

const HEADERS = [
  {
    name: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
    why: ['Forces HTTPS for future visits. Preload only after confirming all subdomains support HTTPS.', 'يفرض HTTPS للزيارات القادمة. لا تستخدم preload قبل التأكد من دعم كل النطاقات الفرعية.'],
  },
  {
    name: 'Content-Security-Policy',
    value: "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    why: ['Restricts resource loading. Start with report-only, then tighten after reviewing violations.', 'يقيّد تحميل الموارد. ابدأ بوضع التقرير فقط ثم شدّد بعد مراجعة الانتهاكات.'],
  },
  {
    name: 'X-Content-Type-Options',
    value: 'nosniff',
    why: ['Stops MIME sniffing that can turn text into executable content.', 'يمنع تخمين نوع المحتوى الذي قد يحوّل النص إلى محتوى قابل للتنفيذ.'],
  },
  {
    name: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
    why: ['Limits referrer leakage to other origins while preserving same-origin analytics.', 'يحدّ من تسريب المُحيل إلى أصول أخرى مع الحفاظ على التحليلات الداخلية.'],
  },
  {
    name: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
    why: ['Disables powerful browser features the application does not need.', 'يعطّل ميزات المتصفح القوية التي لا يحتاجها التطبيق.'],
  },
  {
    name: 'Cross-Origin-Opener-Policy',
    value: 'same-origin',
    why: ['Isolates the browsing context from cross-origin windows.', 'يعزل سياق التصفح عن النوافذ من أصول أخرى.'],
  },
  {
    name: 'X-Frame-Options',
    value: 'DENY',
    why: ['Legacy clickjacking defense; frame-ancestors is preferred in CSP.', 'دفاع قديم ضد اختطاف النقر؛ يُفضّل frame-ancestors في CSP.'],
  },
]

export function HeadersTool() {
  const L = useLabels()
  return (
    <Card>
      <CardHeader title={L('HTTP Security Headers', 'رؤوس HTTP الأمنية')} icon={<FileCheck2 className="h-4 w-4" />} subtitle={L('Reference values, not a drop-in policy for every application.', 'قيم مرجعية وليست سياسة جاهزة لكل تطبيق.')} />
      <div className="divide-y divide-line">
        {HEADERS.map((header) => (
          <div key={header.name} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <code className="font-mono text-xs font-semibold" dir="ltr">{header.name}</code>
              <CopyButton value={`${header.name}: ${header.value}`} />
            </div>
            <pre className="mt-1 overflow-auto rounded bg-[var(--code-bg)] p-2 text-[11px]" dir="ltr">{header.value}</pre>
            <p className="mt-1.5 text-xs text-muted">{L(header.why[0], header.why[1])}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function ChecklistTool() {
  const L = useLabels()
  const { settings } = useApp()
  const { saveItem, isSaved } = useLibrary()
  const { notify } = useToast()
  const [selectedId, setSelectedId] = useState(CHECKLISTS[0]?.id ?? '')
  const checklist = CHECKLISTS.find((entry) => entry.id === selectedId) ?? CHECKLISTS[0]
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState('')

  if (!checklist) return null
  const done = checklist.items.filter((item) => checked[item.id]).length
  const percent = Math.round((done / checklist.items.length) * 100)

  const buildMarkdown = () => {
    const lines = [
      `# ${pickText(checklist.title, settings.language)}`,
      '',
      pickText(checklist.description, settings.language),
      '',
      `Progress: ${done}/${checklist.items.length} (${percent}%)`,
      '',
      ...checklist.items.map((item) => `- [${checked[item.id] ? 'x' : ' '}] ${pickText(item.text, settings.language)}${item.critical ? ' **(critical)**' : ''}`),
    ]
    if (notes.trim()) lines.push('', '## Notes', '', notes.trim())
    return lines.join('\n')
  }

  return (
    <Card>
      <CardHeader
        title={L('Operational Checklists', 'قوائم التحقق التشغيلية')}
        icon={<ClipboardList className="h-4 w-4" />}
        actions={
          <>
            <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadTextFile(`${checklist.id}.md`, buildMarkdown(), 'text/markdown;charset=utf-8')}>{L('Export', 'تصدير')}</Button>
            <Button
              size="sm"
              disabled={isSaved(`checklist-${checklist.id}`)}
              onClick={() => {
                saveItem({ kind: 'solution', title: pickText(checklist.title, settings.language), refId: `checklist-${checklist.id}`, payload: { checked, notes } })
                notify('success', L('Checklist saved to your library.', 'تم حفظ القائمة في مكتبتك.'))
              }}
            >
              {isSaved(`checklist-${checklist.id}`) ? L('Saved', 'محفوظة') : L('Save', 'حفظ')}
            </Button>
          </>
        }
      />
      <div className="space-y-4 p-4">
        <Field label={L('Checklist', 'القائمة')} htmlFor="checklist-select">
          <Select id="checklist-select" value={checklist.id} onChange={(event) => { setSelectedId(event.target.value); setChecked({}); setNotes('') }}>
            {CHECKLISTS.map((entry) => <option key={entry.id} value={entry.id}>{pickText(entry.title, settings.language)}</option>)}
          </Select>
        </Field>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted"><span>{done}/{checklist.items.length}</span><span>{percent}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
        </div>
        <ul className="space-y-1">
          {checklist.items.map((item) => (
            <li key={item.id} className="rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <Checkbox
                checked={Boolean(checked[item.id])}
                onChange={(event) => setChecked((current) => ({ ...current, [item.id]: event.target.checked }))}
                label={<span>{pickText(item.text, settings.language)} {item.critical ? <Badge tone="warning" className="ms-1">{L('Critical', 'حرج')}</Badge> : null}</span>}
              />
            </li>
          ))}
        </ul>
        <Field label={L('Notes / evidence references', 'ملاحظات / مراجع الأدلة')} htmlFor="checklist-notes">
          <Textarea id="checklist-notes" value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20" />
        </Field>
        {percent === 100 ? <Alert tone="success">{L('All items checked. Confirm evidence is attached before closing the task.', 'تم تحديد كل البنود. تأكد من إرفاق الأدلة قبل إغلاق المهمة.')}</Alert> : null}
      </div>
    </Card>
  )
}

type Verdict = 'unknown' | 'benign' | 'suspicious' | 'malicious'

interface IocRow {
  id: string
  type: 'ip' | 'domain' | 'url' | 'hash' | 'email'
  value: string
  verdict: Verdict
  notes: string
}

export function IocTool() {
  const L = useLabels()
  const { notify } = useToast()
  const [rows, setRows] = useState<IocRow[]>(() => readJson<IocRow[]>('nexora.ioc.v1', []))
  const [value, setValue] = useState('')
  const [type, setType] = useState<IocRow['type']>('ip')
  const [verdict, setVerdict] = useState<Verdict>('unknown')
  const [notes, setNotes] = useState('')

  const persist = (next: IocRow[]) => {
    setRows(next)
    writeJson('nexora.ioc.v1', next)
  }

  const exportMarkdown = () => {
    const lines = ['# IOC investigation notes', '', '| Type | Indicator | Verdict | Notes |', '| --- | --- | --- | --- |', ...rows.map((row) => `| ${row.type} | \`${row.value}\` | ${row.verdict} | ${row.notes.replace(/\|/g, '\\|')} |`)]
    downloadTextFile('ioc-notes.md', lines.join('\n'), 'text/markdown;charset=utf-8')
    notify('success', L('IOC notes exported.', 'تم تصدير ملاحظات IOC.'))
  }

  return (
    <Card>
      <CardHeader
        title={L('IOC Investigation Notes', 'ملاحظات تحليل IOC')}
        icon={<ScanSearch className="h-4 w-4" />}
        actions={<Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportMarkdown} disabled={rows.length === 0}>{L('Export Markdown', 'تصدير Markdown')}</Button>}
      />
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-[8rem_1fr_9rem]">
          <Select value={type} onChange={(event) => setType(event.target.value as IocRow['type'])} aria-label={L('Indicator type', 'نوع المؤشر')}>
            {(['ip', 'domain', 'url', 'hash', 'email'] as const).map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </Select>
          <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder={L('Indicator value', 'قيمة المؤشر')} dir="ltr" />
          <Select value={verdict} onChange={(event) => setVerdict(event.target.value as Verdict)} aria-label={L('Verdict', 'الحكم')}>
            {(['unknown', 'benign', 'suspicious', 'malicious'] as const).map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </Select>
        </div>
        <div className="flex gap-2">
          <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={L('Source, context or evidence', 'المصدر أو السياق أو الدليل')} className="flex-1" />
          <Button
            icon={<Plus className="h-4 w-4" />}
            disabled={!value.trim()}
            onClick={() => {
              persist([{ id: uid('ioc'), type, value: value.trim(), verdict, notes: notes.trim() }, ...rows])
              setValue('')
              setNotes('')
            }}
          >
            {L('Add', 'إضافة')}
          </Button>
        </div>
        {rows.length === 0 ? <EmptyState title={L('No indicators yet.', 'لا توجد مؤشرات بعد.')} description={L('Indicators are stored only in this browser.', 'تُخزّن المؤشرات في هذا المتصفح فقط.')} /> : (
          <div className="overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-subtle">
                <tr>
                  <th className="p-2 text-start">{L('Type', 'النوع')}</th>
                  <th className="p-2 text-start">{L('Indicator', 'المؤشر')}</th>
                  <th className="p-2 text-start">{L('Verdict', 'الحكم')}</th>
                  <th className="p-2 text-start">{L('Notes', 'ملاحظات')}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="p-2 uppercase">{row.type}</td>
                    <td className="break-all p-2 font-mono" dir="ltr">{row.value}</td>
                    <td className="p-2"><Badge tone={row.verdict === 'malicious' ? 'danger' : row.verdict === 'suspicious' ? 'warning' : row.verdict === 'benign' ? 'success' : 'default'}>{row.verdict}</Badge></td>
                    <td className="p-2 text-muted">{row.notes || '—'}</td>
                    <td className="p-2"><Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => persist(rows.filter((entry) => entry.id !== row.id))} aria-label={L('Delete', 'حذف')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

type VulnStatus = 'open' | 'mitigated' | 'accepted' | 'closed'

interface VulnRow {
  id: string
  cve: string
  asset: string
  severity: Priority
  owner: string
  due: string
  status: VulnStatus
}

export function VulnTool() {
  const L = useLabels()
  const { notify } = useToast()
  const [rows, setRows] = useState<VulnRow[]>(() => readJson<VulnRow[]>('nexora.vulns.v1', []))
  const [draft, setDraft] = useState<Omit<VulnRow, 'id'>>({ cve: '', asset: '', severity: 'high', owner: '', due: '', status: 'open' })

  const persist = (next: VulnRow[]) => {
    setRows(next)
    writeJson('nexora.vulns.v1', next)
  }

  const exportCsv = () => {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`
    const csv = [['CVE', 'Asset', 'Severity', 'Owner', 'Due', 'Status'], ...rows.map((row) => [row.cve, row.asset, row.severity, row.owner, row.due, row.status])]
      .map((line) => line.map(escape).join(','))
      .join('\n')
    downloadTextFile('vulnerability-tracker.csv', csv, 'text/csv;charset=utf-8')
    notify('success', L('Tracker exported as CSV.', 'تم تصدير المتتبع بصيغة CSV.'))
  }

  return (
    <Card>
      <CardHeader
        title={L('Vulnerability Remediation Tracker', 'متتبع معالجة الثغرات')}
        icon={<Bug className="h-4 w-4" />}
        actions={<Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv} disabled={rows.length === 0}>{L('Export CSV', 'تصدير CSV')}</Button>}
      />
      <div className="space-y-4 p-4">
        <div className="grid gap-2 lg:grid-cols-6">
          <Input value={draft.cve} onChange={(event) => setDraft({ ...draft, cve: event.target.value })} placeholder="CVE-2026-0000" dir="ltr" />
          <Input value={draft.asset} onChange={(event) => setDraft({ ...draft, asset: event.target.value })} placeholder={L('Asset', 'الأصل')} />
          <Select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as Priority })} aria-label={L('Severity', 'الخطورة')}>
            {(['low', 'medium', 'high', 'critical'] as const).map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </Select>
          <Input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder={L('Owner', 'المالك')} />
          <Input type="date" value={draft.due} onChange={(event) => setDraft({ ...draft, due: event.target.value })} aria-label={L('Due date', 'تاريخ الاستحقاق')} />
          <Button
            icon={<Plus className="h-4 w-4" />}
            disabled={!draft.cve.trim() || !draft.asset.trim()}
            onClick={() => {
              persist([{ ...draft, cve: draft.cve.trim(), asset: draft.asset.trim(), id: uid('vuln') }, ...rows])
              setDraft({ cve: '', asset: '', severity: 'high', owner: '', due: '', status: 'open' })
            }}
          >
            {L('Add', 'إضافة')}
          </Button>
        </div>
        {rows.length === 0 ? <EmptyState title={L('No vulnerabilities tracked.', 'لا توجد ثغرات متتبعة.')} description={L('This is a local record, not a vulnerability scanner.', 'هذا سجل محلي وليس ماسحًا للثغرات.')} /> : (
          <div className="overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-subtle">
                <tr>
                  <th className="p-2 text-start">CVE</th>
                  <th className="p-2 text-start">{L('Asset', 'الأصل')}</th>
                  <th className="p-2 text-start">{L('Severity', 'الخطورة')}</th>
                  <th className="p-2 text-start">{L('Owner', 'المالك')}</th>
                  <th className="p-2 text-start">{L('Due', 'الاستحقاق')}</th>
                  <th className="p-2 text-start">{L('Status', 'الحالة')}</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="p-2 font-mono" dir="ltr">{row.cve}</td>
                    <td className="p-2">{row.asset}</td>
                    <td className="p-2"><Badge tone={row.severity === 'critical' || row.severity === 'high' ? 'danger' : row.severity === 'medium' ? 'warning' : 'success'}>{row.severity}</Badge></td>
                    <td className="p-2">{row.owner || '—'}</td>
                    <td className="p-2">{row.due || '—'}</td>
                    <td className="p-2">
                      <Select value={row.status} onChange={(event) => persist(rows.map((entry) => entry.id === row.id ? { ...entry, status: event.target.value as VulnStatus } : entry))} className="min-w-28 !py-1 text-xs">
                        {(['open', 'mitigated', 'accepted', 'closed'] as const).map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                      </Select>
                    </td>
                    <td className="p-2"><Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => persist(rows.filter((entry) => entry.id !== row.id))} aria-label={L('Delete', 'حذف')} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}

interface Finding {
  id: string
  title: string
  severity: Priority
  evidence: string
  recommendation: string
}

export function AuditTool() {
  const L = useLabels()
  const { notify } = useToast()
  const [scope, setScope] = useState('')
  const [auditor, setAuditor] = useState('')
  const [findings, setFindings] = useState<Finding[]>([])
  const [draft, setDraft] = useState({ title: '', severity: 'medium' as Priority, evidence: '', recommendation: '' })

  const exportReport = () => {
    const lines = [
      '# Security audit report',
      '',
      `- Scope: ${scope || 'Not specified'}`,
      `- Auditor: ${auditor || 'Not specified'}`,
      `- Generated: ${new Date().toISOString()}`,
      '',
      '## Findings',
      '',
      ...(findings.length
        ? findings.flatMap((finding, index) => [
            `### ${index + 1}. ${finding.title} (${finding.severity})`,
            '',
            `**Evidence:** ${finding.evidence || 'Not recorded'}`,
            '',
            `**Recommendation:** ${finding.recommendation || 'Not recorded'}`,
            '',
          ])
        : ['No findings recorded.']),
      '',
      '> Generated locally by Adnan Tech. Verify evidence and severity before distribution.',
    ]
    downloadTextFile('security-audit-report.md', lines.join('\n'), 'text/markdown;charset=utf-8')
    notify('success', L('Audit report exported.', 'تم تصدير تقرير التدقيق.'))
  }

  return (
    <Card>
      <CardHeader
        title={L('Security Audit Report Builder', 'منشئ تقرير التدقيق الأمني')}
        icon={<FileText className="h-4 w-4" />}
        actions={<Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={exportReport} disabled={findings.length === 0}>{L('Export report', 'تصدير التقرير')}</Button>}
      />
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={L('Scope', 'النطاق')} htmlFor="audit-scope"><Input id="audit-scope" value={scope} onChange={(event) => setScope(event.target.value)} /></Field>
          <Field label={L('Auditor', 'المدقق')} htmlFor="audit-auditor"><Input id="audit-auditor" value={auditor} onChange={(event) => setAuditor(event.target.value)} /></Field>
        </div>
        <div className="rounded-lg border border-line p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={L('Finding title', 'عنوان النتيجة')} />
            <Select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as Priority })} aria-label={L('Severity', 'الخطورة')}>
              {(['low', 'medium', 'high', 'critical'] as const).map((entry) => <option key={entry} value={entry}>{entry}</option>)}
            </Select>
          </div>
          <Textarea value={draft.evidence} onChange={(event) => setDraft({ ...draft, evidence: event.target.value })} placeholder={L('Evidence observed', 'الدليل الملاحظ')} className="mt-2 min-h-16" />
          <Textarea value={draft.recommendation} onChange={(event) => setDraft({ ...draft, recommendation: event.target.value })} placeholder={L('Recommendation', 'التوصية')} className="mt-2 min-h-16" />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              icon={<Plus className="h-3.5 w-3.5" />}
              disabled={!draft.title.trim()}
              onClick={() => {
                setFindings([...findings, { ...draft, id: uid('finding'), title: draft.title.trim() }])
                setDraft({ title: '', severity: 'medium', evidence: '', recommendation: '' })
              }}
            >
              {L('Add finding', 'إضافة نتيجة')}
            </Button>
          </div>
        </div>
        {findings.length === 0 ? <EmptyState title={L('No findings recorded.', 'لا توجد نتائج مسجلة.')} /> : (
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li key={finding.id} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{finding.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge tone={finding.severity === 'critical' || finding.severity === 'high' ? 'danger' : finding.severity === 'medium' ? 'warning' : 'success'}>{finding.severity}</Badge>
                    <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setFindings(findings.filter((entry) => entry.id !== finding.id))} aria-label={L('Delete', 'حذف')} />
                  </div>
                </div>
                {finding.evidence ? <p className="mt-1 text-xs text-muted">{finding.evidence}</p> : null}
                {finding.recommendation ? <p className="mt-1 text-xs text-subtle">{finding.recommendation}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

interface CommandScenario {
  id: string
  title: [string, string]
  risk: 'low' | 'medium' | 'high'
  requires: [string, string]
  steps: Array<{ label: [string, string]; command: string }>
}

const COMMAND_SCENARIOS: CommandScenario[] = [
  {
    id: 'sfc-dism',
    title: ['System file repair', 'إصلاح ملفات النظام'],
    risk: 'medium',
    requires: ['Administrative PowerShell or CMD. A tested backup or restore point.', 'PowerShell أو CMD إداري، ونسخة احتياطية أو نقطة استعادة مختبَرة.'],
    steps: [
      { label: ['Check component store health', 'فحص صحة مخزن المكونات'], command: 'DISM /Online /Cleanup-Image /CheckHealth' },
      { label: ['Scan for component store corruption', 'فحص تلف مخزن المكونات'], command: 'DISM /Online /Cleanup-Image /ScanHealth' },
      { label: ['Repair the component store', 'إصلاح مخزن المكونات'], command: 'DISM /Online /Cleanup-Image /RestoreHealth' },
      { label: ['Run System File Checker', 'تشغيل فاحص ملفات النظام'], command: 'sfc /scannow' },
    ],
  },
  {
    id: 'windows-update',
    title: ['Windows Update reset', 'إعادة ضبط Windows Update'],
    risk: 'medium',
    requires: ['Record current update state first. This stops update services temporarily.', 'سجّل حالة التحديث الحالية أولًا. سيؤدي هذا إلى إيقاف خدمات التحديث مؤقتًا.'],
    steps: [
      { label: ['Stop update and BITS services', 'إيقاف خدمات التحديث وBITS'], command: 'net stop wuauserv /y\nnet stop bits /y' },
      { label: ['Rename the update cache', 'إعادة تسمية ذاكرة التحديث المؤقتة'], command: 'ren C:\\Windows\\SoftwareDistribution SoftwareDistribution.old' },
      { label: ['Start the services again', 'بدء الخدمات مرة أخرى'], command: 'net start wuauserv\nnet start bits' },
      { label: ['Trigger a scan', 'بدء فحص التحديثات'], command: 'UsoClient StartScan' },
    ],
  },
  {
    id: 'printing',
    title: ['Printer queue diagnostics', 'تشخيص طابور الطباعة'],
    risk: 'low',
    requires: ['Confirm no print jobs are actively processing when clearing the queue.', 'تأكد من عدم وجود مهام طباعة قيد التنفيذ عند مسح الطابور.'],
    steps: [
      { label: ['Show unreachable or error printers', 'عرض الطابعات غير المتاحة أو التي بها أخطاء'], command: 'Get-Printer | Where-Object Status -ne "Normal"' },
      { label: ['List queued print jobs', 'سرد مهام الطباعة في الطابور'], command: 'Get-PrintJob -PrinterName "<PrinterName>"' },
      { label: ['Restart the spooler', 'إعادة تشغيل خدمة الطباعة'], command: 'Restart-Service Spooler -Force' },
      { label: ['Check spooler service state', 'فحص حالة خدمة الطباعة'], command: 'Get-Service Spooler | Select-Object Status, StartType' },
    ],
  },
  {
    id: 'network',
    title: ['Network diagnostics', 'تشخيص الشبكة'],
    risk: 'low',
    requires: ['Run from an elevated PowerShell prompt. No changes are made.', 'شغّل من PowerShell إداري. لا تُجرى تغييرات.'],
    steps: [
      { label: ['Adapter and address summary', 'ملخص المحول والعنوان'], command: 'Get-NetIPConfiguration | Format-List' },
      { label: ['Test DNS resolution', 'اختبار تحليل DNS'], command: 'Resolve-DnsName microsoft.com -ErrorAction SilentlyContinue' },
      { label: ['Test gateway reachability', 'اختبار الوصول إلى البوابة'], command: 'Test-NetConnection -ComputerName (Get-NetRoute -DestinationPrefix "0.0.0.0/0").NextHop -InformationLevel Detailed' },
      { label: ['Trace the route', 'تتبع المسار'], command: 'tracert -d 8.8.8.8' },
    ],
  },
]

export function CommandBuilderTool() {
  const L = useLabels()
  const [scenarioId, setScenarioId] = useState(COMMAND_SCENARIOS[0].id)
  const scenario = COMMAND_SCENARIOS.find((entry) => entry.id === scenarioId) ?? COMMAND_SCENARIOS[0]
  const allCommands = scenario.steps.map((step) => step.command).join('\n\n')

  return (
    <Card>
      <CardHeader title={L('Windows Command Builder', 'منشئ أوامر Windows')} icon={<ShieldAlert className="h-4 w-4" />} />
      <div className="space-y-3 p-4">
        <Field label={L('Scenario', 'السيناريو')} htmlFor="cmd-scenario">
          <Select id="cmd-scenario" value={scenario.id} onChange={(event) => setScenarioId(event.target.value)}>
            {COMMAND_SCENARIOS.map((entry) => <option key={entry.id} value={entry.id}>{L(entry.title[0], entry.title[1])}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={scenario.risk === 'high' ? 'danger' : scenario.risk === 'medium' ? 'warning' : 'success'}>{scenario.risk}</Badge>
          <span className="text-xs text-muted">{L(scenario.requires[0], scenario.requires[1])}</span>
        </div>
        <CodeBlock code={allCommands} language="powershell" title={L('Review before running', 'راجع قبل التشغيل')} />
        <div className="space-y-2">
          {scenario.steps.map((step) => (
            <div key={step.command} className="rounded-lg border border-line">
              <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
                <span className="text-xs font-medium">{L(step.label[0], step.label[1])}</span>
                <CopyButton value={step.command} />
              </div>
              <pre className="overflow-auto p-3 text-xs" dir="ltr">{step.command}</pre>
            </div>
          ))}
        </div>
        <Alert tone="warning">{L('Commands are examples for review, not a blind fix. Confirm the output at every step and verify the rollback path.', 'الأوامر أمثلة للمراجعة وليست إصلاحًا أعمى. تحقق من الناتج في كل خطوة ومن مسار التراجع.')}</Alert>
      </div>
    </Card>
  )
}
