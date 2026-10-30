import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  FileSearch,
  FileWarning,
  Globe2,
  History,
  ImageIcon,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { Alert, Badge, Button, EmptyState, Field, Input, Skeleton, Tabs, Tab, Textarea } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useDiagnostics, diagnosticToolLabel } from '@/context/DiagnosticsContext'
import { useProviders } from '@/context/ProvidersContext'
import { useToast } from '@/context/ToastContext'
import { analyzeProblem, analyzeUrlSafety, ApiError, type UrlAnalysisResponse, type UrlSignalSeverity } from '@/services/api'
import type { AnalysisResult } from '@/types'
import { scanScript, highestRisk } from '@/lib/scriptScan'
import { setLabDraft } from '@/lib/draft'
import { downloadTextFile, formatBytes, validateImageFile } from '@/lib/utils'
import {
  extractTextFromFile,
  redactSensitiveData,
  scanSensitiveData,
  type SensitiveFinding,
  type TextExtraction,
} from '@/lib/fileInspection'

type LabTab = 'url' | 'file' | 'log' | 'image' | 'history'

const LAB_TABS: readonly LabTab[] = ['url', 'file', 'log', 'image', 'history']

function isLabTab(value: string | null): value is LabTab {
  return value !== null && LAB_TABS.includes(value as LabTab)
}

const SEVERITY_TONE: Record<UrlSignalSeverity, 'default' | 'warning' | 'danger' | 'success'> = {
  info: 'default',
  low: 'default',
  medium: 'warning',
  high: 'danger',
}

const MAX_SCAN_BYTES = 25 * 1024 * 1024
const MAX_LOG_BYTES = 4 * 1024 * 1024

interface FileReport {
  name: string
  size: number
  extension: string
  detectedType: string
  sha256: string
  sha1: string
  entropy: number
  indicators: Array<{ id: string; severity: 'info' | 'medium' | 'high'; title: string; detail: string }>
  textFindings: number
  extraction: TextExtraction
  sensitiveFindings: SensitiveFinding[]
}

interface LogReport {
  name: string
  lines: number
  errors: number
  warnings: number
  infos: number
  uniqueIps: string[]
  uniqueHosts: string[]
  topMessages: Array<{ text: string; count: number }>
  samples: Array<{ line: number; level: 'error' | 'warn'; text: string }>
}

const MAGIC: Array<{ id: string; type: string; bytes: number[]; offset?: number }> = [
  { id: 'pdf', type: 'PDF document', bytes: [0x25, 0x50, 0x44, 0x46] },
  { id: 'zip', type: 'ZIP / Office Open XML container', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { id: 'png', type: 'PNG image', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { id: 'jpeg', type: 'JPEG image', bytes: [0xff, 0xd8, 0xff] },
  { id: 'gif', type: 'GIF image', bytes: [0x47, 0x49, 0x46, 0x38] },
  { id: 'elf', type: 'ELF executable/library', bytes: [0x7f, 0x45, 0x4c, 0x46] },
  { id: 'pe', type: 'Windows PE executable', bytes: [0x4d, 0x5a] },
  { id: 'ole', type: 'Legacy OLE compound document', bytes: [0xd0, 0xcf, 0x11, 0xe0] },
  { id: 'rtf', type: 'RTF document', bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66] },
]

const MACRO_EXTENSIONS = new Set(['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm'])
const SCRIPT_EXTENSIONS = new Set(['ps1', 'psm1', 'bat', 'cmd', 'sh', 'bash', 'zsh', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'hta', 'py', 'reg'])
const CODE_EXTENSIONS = new Set([...SCRIPT_EXTENSIONS, 'txt', 'log', 'json', 'xml', 'html', 'htm', 'css', 'ts', 'tsx', 'jsx', 'yaml', 'yml', 'ini', 'conf', 'sql'])

function detectType(bytes: Uint8Array): string {
  for (const entry of MAGIC) {
    if (entry.bytes.every((byte, index) => bytes[index] === byte)) return entry.type
  }
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 512)).trimStart()
  if (/^[{[<]/.test(head) || /^[\x20-\x7e\r\n\t]+$/.test(head.slice(0, 120))) return 'Text-based content'
  return 'Unrecognized binary'
}

function shannonEntropy(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0
  const counts = new Array<number>(256).fill(0)
  const sample = bytes.length > 1_000_000 ? bytes.slice(0, 1_000_000) : bytes
  for (const byte of sample) counts[byte] += 1
  let entropy = 0
  for (const count of counts) {
    if (count === 0) continue
    const probability = count / sample.length
    entropy -= probability * Math.log2(probability)
  }
  return Math.round(entropy * 100) / 100
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function digest(algorithm: 'SHA-1' | 'SHA-256', bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  return toHex(await crypto.subtle.digest(algorithm, copy))
}

function extensionOf(name: string): string {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

async function analyzeFile(file: File): Promise<FileReport> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const [sha256, sha1] = await Promise.all([digest('SHA-256', bytes), digest('SHA-1', bytes)])
  const extension = extensionOf(file.name)
  const detectedType = detectType(bytes)
  const indicators: FileReport['indicators'] = []
  const lowerName = file.name.toLowerCase()
  const extraction = CODE_EXTENSIONS.has(extension) || extension === 'pdf'
    ? extractTextFromFile(file.name, bytes)
    : { text: '', kind: 'none' as const, truncated: false, note: null }
  const text = extraction.text
  const sensitiveFindings = scanSensitiveData(text)

  if (lowerName.includes('\u202e')) {
    indicators.push({ id: 'rtl-override', severity: 'high', title: 'Right-to-left override in filename', detail: 'The filename contains U+202E, a character used to visually reverse the displayed extension.' })
  }
  if (/\.[a-z0-9]{2,5}\.(exe|scr|bat|cmd|js|vbs|ps1)$/i.test(lowerName)) {
    indicators.push({ id: 'double-extension', severity: 'high', title: 'Double extension', detail: 'The file has two extensions. Attackers use this to disguise executables as documents.' })
  }
  if (MACRO_EXTENSIONS.has(extension)) {
    indicators.push({ id: 'macro-enabled', severity: 'high', title: 'Macro-enabled Office format', detail: 'This format can contain VBA macros. Only enable macros if the sender and content are verified.' })
  }
  if (detectedType.includes('PE executable') && ['exe', 'scr', 'dll', 'sys', 'com'].includes(extension)) {
    indicators.push({ id: 'windows-executable', severity: 'high', title: 'Windows executable', detail: 'The file is a Portable Executable. Do not run it unless it is signed by a trusted publisher and expected.' })
  }
  if (detectedType.includes('ELF') && ['elf', 'so', 'bin', ''].includes(extension)) {
    indicators.push({ id: 'elf-binary', severity: 'medium', title: 'ELF binary', detail: 'The file is a native Linux executable or library. Verify its origin before execution.' })
  }
  if (detectedType.startsWith('ZIP') && !['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'jar', 'apk'].includes(extension)) {
    indicators.push({ id: 'zip-mismatch', severity: 'medium', title: 'Container extension mismatch', detail: 'The content is a ZIP container but the extension is not a known archive or Office format.' })
  }
  if (detectedType.includes('OLE') && ['doc', 'xls', 'ppt', 'msg'].includes(extension)) {
    indicators.push({ id: 'legacy-office', severity: 'medium', title: 'Legacy compound document', detail: 'Legacy Office files can contain macros or embedded objects. This scanner cannot inspect macros; use a dedicated malware scanner.' })
  }
  if (detectedType === 'PDF document' && extension !== 'pdf') {
    indicators.push({ id: 'pdf-mismatch', severity: 'medium', title: 'PDF content with a different extension', detail: 'The magic bytes identify a PDF, but the filename extension differs.' })
  }
  if (detectedType === 'PDF document') {
    const pdfText = new TextDecoder('latin1').decode(bytes.slice(0, Math.min(bytes.length, 4 * 1024 * 1024)))
    const markers: Array<[string, RegExp, string]> = [
      ['pdf-javascript', /\/JavaScript|\/JS\b/, 'PDF JavaScript'],
      ['pdf-openaction', /\/OpenAction\b/, 'automatic PDF action'],
      ['pdf-launch', /\/Launch\b/, 'PDF launch action'],
      ['pdf-embedded', /\/EmbeddedFile\b/, 'embedded PDF file'],
    ]
    for (const [id, pattern, label] of markers) {
      if (pattern.test(pdfText)) {
        indicators.push({ id, severity: 'medium', title: `PDF contains ${label}`, detail: 'The PDF references active or embedded content. Open it only in a hardened viewer and verify its source.' })
      }
    }
  }
  if (SCRIPT_EXTENSIONS.has(extension) && text) {
    const findings = scanScript(text)
    if (findings.length > 0) {
      indicators.push({ id: 'script-risk', severity: highestRisk(findings) === 'critical' || highestRisk(findings) === 'high' ? 'high' : 'medium', title: `${findings.length} script risk pattern${findings.length === 1 ? '' : 's'}`, detail: findings.slice(0, 2).map((finding) => `${finding.title.en} (line ${finding.line})`).join('; ') + '. Static patterns only; this is not an execution sandbox.' })
    }
  }
  if (/powershell[^\n]{0,80}(-enc|-encodedcommand)\s+[A-Za-z0-9+/=]{24,}/i.test(text)) {
    indicators.push({ id: 'encoded-powershell', severity: 'high', title: 'Encoded PowerShell command', detail: 'The file contains a long base64-encoded PowerShell command. Decode and review it in an isolated environment before execution.' })
  }
  const criticalSecrets = sensitiveFindings.filter((entry) => ['private-key', 'api-key', 'password', 'credit-card'].includes(entry.kind))
  if (criticalSecrets.length > 0) {
    indicators.push({
      id: 'sensitive-secrets',
      severity: 'high',
      title: 'Credentials or payment data detected',
      detail: `${criticalSecrets.reduce((total, entry) => total + entry.count, 0)} potential secret value(s) matched (${criticalSecrets.map((entry) => entry.kind).join(', ')}). Rotate any real exposed credentials and avoid sharing this file.`,
    })
  }
  if (sensitiveFindings.some((entry) => entry.kind === 'email' || entry.kind === 'ipv4')) {
    indicators.push({
      id: 'personal-data',
      severity: 'medium',
      title: 'Personal or network identifiers detected',
      detail: 'The text contains email addresses or IP addresses. Treat the extracted preview as sensitive and redact it before sharing.',
    })
  }
  const entropy = shannonEntropy(bytes)
  if (entropy > 7.5 && !detectedType.startsWith('ZIP') && !detectedType.includes('image')) {
    indicators.push({ id: 'high-entropy', severity: 'medium', title: `High entropy (${entropy})`, detail: 'The content appears packed or encrypted. High entropy is not proof of malware, but it limits static visibility.' })
  }
  if (bytes.length === 0) {
    indicators.push({ id: 'empty', severity: 'info', title: 'Empty file', detail: 'The file has no content.' })
  }

  return {
    name: file.name,
    size: file.size,
    extension,
    detectedType,
    sha256,
    sha1,
    entropy,
    indicators,
    textFindings: text ? scanScript(text).length : 0,
    extraction,
    sensitiveFindings,
  }
}

function analyzeLog(name: string, content: string): LogReport {
  const lines = content.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim().length > 0)
  let errors = 0
  let warnings = 0
  let infos = 0
  const ips = new Set<string>()
  const hosts = new Set<string>()
  const messageCounts = new Map<string, number>()
  const samples: LogReport['samples'] = []

  for (const [index, line] of lines.entries()) {
    const level = /\b(fatal|critical|error|fail(?:ed|ure)?|exception)\b/i.test(line) ? 'error' : /\b(warn(?:ing)?)\b/i.test(line) ? 'warn' : null
    if (level === 'error') errors += 1
    else if (level === 'warn') warnings += 1
    else infos += 1
    for (const ip of line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? []) ips.add(ip)
    for (const host of line.match(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|local|lan|internal|cloud|dev|app)\b/gi) ?? []) hosts.add(host.toLowerCase())
    if (level) {
      const normalized = line
        .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
        .replace(/\b(?:[a-f0-9]{8,}|0x[a-f0-9]+)\b/gi, '<id>')
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?/g, '<timestamp>')
        .replace(/\b\d+\b/g, '<n>')
        .slice(0, 220)
      messageCounts.set(normalized, (messageCounts.get(normalized) ?? 0) + 1)
      if (samples.length < 60) samples.push({ line: index + 1, level, text: line.trim().slice(0, 260) })
    }
  }

  return {
    name,
    lines: lines.length,
    errors,
    warnings,
    infos,
    uniqueIps: [...ips].slice(0, 20),
    uniqueHosts: [...hosts].slice(0, 20),
    topMessages: [...messageCounts.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    samples,
  }
}

function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the file.'))
    reader.readAsText(file)
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail ? `${error.message} ${error.detail}` : error.message
  return error instanceof Error ? error.message : 'The request failed.'
}

function VerdictBadge({ verdict, lang }: { verdict: UrlAnalysisResponse['verdict']; lang: 'en' | 'ar' }) {
  const label = (en: string, ar: string) => (lang === 'ar' ? ar : en)
  if (verdict === 'suspicious-indicators-found') return <Badge tone="danger">{label('Suspicious indicators', 'مؤشرات مريبة')}</Badge>
  if (verdict === 'analysis-inconclusive') return <Badge tone="warning">{label('Inconclusive', 'غير حاسم')}</Badge>
  if (verdict === 'external-reputation-unavailable') return <Badge tone="default">{label('Reputation unavailable', 'السمعة غير متاحة')}</Badge>
  return <Badge tone="success">{label('No obvious indicators', 'لا مؤشرات واضحة')}</Badge>
}

export function SecurityLabPage() {
  const { settings } = useApp()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [params] = useSearchParams()
  const requested = params.get('tool') ?? params.get('tab')
  const [tab, setTab] = useState<LabTab>(() => (isLabTab(requested) ? requested : 'url'))

  useEffect(() => {
    if (isLabTab(requested)) setTab(requested)
  }, [requested])

  return (
    <div className="nx-page animate-in">
      <section className="nx-hero mb-5">
        <div className="relative z-10">
          <p className="nx-eyebrow"><ShieldCheck className="h-3.5 w-3.5" />{L('File & URL Security Lab', 'مختبر أمان الملفات والروابط')}</p>
          <h1 className="nx-display mt-2 text-3xl sm:text-4xl">{L('Inspect before you trust.', 'افحص قبل أن تثق.')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {L(
              'Structural URL analysis, file fingerprinting, log triage, and image review. No external reputation feed is configured, so nothing is labelled safe.',
              'تحليل بنيوي للروابط، وبصمات للملفات، وفرز للسجلات، ومراجعة للصور. لا يوجد مزوّد سمعة خارجي، لذلك لا يُصنّف أي شيء كآمن.',
            )}
          </p>
        </div>
      </section>

      <Alert tone="warning" className="mb-4" title={L('This is a triage aid, not a sandbox', 'هذه أداة فرز أولي وليست بيئة معزولة')}>
        {L(
          'Files are analyzed locally in your browser and are never uploaded. Static indicators cannot prove a file is malicious or safe. For real malware, use an isolated sandbox and an organizational incident process.',
          'تُحلّل الملفات محليًا في متصفحك ولا تُرفع. المؤشرات الساكنة لا تثبت أن الملف خبيث أو آمن. للملفات الخطرة استخدم بيئة معزولة وإجراءات الحادث المؤسسية.',
        )}
      </Alert>

      <Tabs value={tab} onChange={(value) => setTab(value as LabTab)} className="mb-4">
        <Tab id="url" icon={<Globe2 className="h-3.5 w-3.5" />}>{L('URL inspector', 'فاحص الروابط')}</Tab>
        <Tab id="file" icon={<FileSearch className="h-3.5 w-3.5" />}>{L('File analysis', 'تحليل الملفات')}</Tab>
        <Tab id="log" icon={<ScanSearch className="h-3.5 w-3.5" />}>{L('Log triage', 'فرز السجلات')}</Tab>
        <Tab id="image" icon={<ImageIcon className="h-3.5 w-3.5" />}>{L('Image review', 'مراجعة الصور')}</Tab>
        <Tab id="history" icon={<History className="h-3.5 w-3.5" />}>{L('History', 'السجل')}</Tab>
      </Tabs>

      <div key={tab} className="animate-fade">
        {tab === 'url' ? <UrlInspector /> : null}
        {tab === 'file' ? <FileAnalyzer /> : null}
        {tab === 'log' ? <LogTriage /> : null}
        {tab === 'image' ? <ImageReview /> : null}
        {tab === 'history' ? <LabHistory /> : null}
      </div>
    </div>
  )
}

function UrlInspector() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UrlAnalysisResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!url.trim()) {
      setError(L('Enter a URL to inspect.', 'أدخل رابطًا لفحصه.'))
      return
    }
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const response = await analyzeUrlSafety(url.trim())
      setResult(response)
      addRecord({
        tool: 'url',
        target: response.domain,
        status: 'success',
        summary: `${response.verdict} · ${response.signals.filter((signal) => signal.severity === 'high').length} high signal(s)`,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      addRecord({ tool: 'url', target: url.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="nx-panel p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="URL" htmlFor="url-input" className="flex-1">
            <Input id="url-input" dir="ltr" className="force-ltr" placeholder="https://example.com/login" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run() }} />
          </Field>
          <Button loading={busy} icon={<Globe2 className="h-4 w-4" />} onClick={() => void run()}>{L('Inspect URL', 'فحص الرابط')}</Button>
        </div>
        <p className="mt-2 text-[10px] text-subtle">{L('Only public http:// and https:// targets are accepted. Private and reserved addresses are blocked.', 'تُقبل أهداف http:// وhttps:// العامة فقط. العناوين الخاصة والمحمية محجوبة.')}</p>
      </section>

      {busy ? <Skeleton className="h-40 w-full" /> : null}
      {!busy && error ? <Alert tone="danger" title={L('Could not analyze this URL', 'تعذر تحليل هذا الرابط')}>{error}</Alert> : null}
      {!busy && !error && !result ? (
        <EmptyState icon={<Globe2 className="h-6 w-6" />} title={L('Paste a link to inspect', 'الصق رابطًا لفحصه')} description={L('The inspector reports structural signals, DNS, HTTP status, redirects, and certificate data — never a “safe” verdict.', 'يعرض الفاحص المؤشرات البنيوية وDNS وحالة HTTP والتحويلات وبيانات الشهادة — دون إصدار حكم “آمن”.')} />
      ) : null}
      {!busy && result ? (
        <div className="space-y-4">
          <div className="nx-panel p-4">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge verdict={result.verdict} lang={settings.language} />
              <span className="text-xs text-muted" dir="ltr">{result.host}</span>
              {result.http ? <Badge tone={result.http.ok ? 'success' : 'warning'}>HTTP {result.http.status}</Badge> : null}
              <Badge tone="default">{L('Analyzed by server', 'تحليل من الخادم')}</Badge>
              <span className="ms-auto text-[10px] text-subtle">{new Date(result.checkedAt).toLocaleString(settings.language === 'ar' ? 'ar' : 'en')}</span>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">DNS</p>
                <p className="mt-1 break-all font-mono text-[11px]">{result.dns?.addresses.join(', ') ?? result.dnsError ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">TLS</p>
                <p className="mt-1 text-[11px]">{result.tls ? `${result.tls.issuer} · ${result.tls.daysRemaining} ${L('days', 'يوم')}` : result.tlsError ?? L('Not applicable', 'لا ينطبق')}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{L('Reputation', 'السمعة')}</p>
                <p className="mt-1 text-[11px] text-warning">{L('Unavailable', 'غير متاح')}</p>
              </div>
            </div>
            {result.http?.redirects.length ? (
              <div className="mt-3">
                <h3 className="mb-1 text-xs font-semibold">{L('Redirect chain', 'سلسلة التحويل')}</h3>
                <ol className="space-y-1">
                  {result.http.redirects.map((hop) => (
                    <li key={hop.url} className="flex items-center gap-2 rounded border border-line px-2 py-1.5 text-[10px]">
                      <span className="font-mono text-warning">{hop.status}</span>
                      <span className="min-w-0 flex-1 truncate font-mono" dir="ltr">{hop.url}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-subtle" />
                      <span className="min-w-0 flex-1 truncate font-mono text-subtle" dir="ltr">{hop.location}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </div>

          <div className="nx-panel p-4">
            <h2 className="text-sm font-semibold">{L('Signals', 'المؤشرات')}</h2>
            {result.signals.length === 0 ? (
              <Alert tone="info" className="mt-3">{L('No structural signals were detected. This is not a safety guarantee.', 'لم تُكتشف مؤشرات بنيوية. هذا ليس ضمانًا للأمان.')}</Alert>
            ) : (
              <ul className="mt-3 space-y-2">
                {[...result.signals].sort((a, b) => ({ high: 3, medium: 2, low: 1, info: 0 }[b.severity] - { high: 3, medium: 2, low: 1, info: 0 }[a.severity])).map((signal) => (
                  <li key={signal.id} className="rounded-lg border border-line bg-surface-2 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[signal.severity]}>{signal.severity}</Badge>
                      <span className="text-xs font-semibold">{signal.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">{signal.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs text-muted">
              <p className="font-semibold text-warning">{L('External reputation unavailable', 'السمعة الخارجية غير متاحة')}</p>
              <p className="mt-1">{result.externalReputation.reason}</p>
            </div>
            <ul className="mt-3 list-disc space-y-1 ps-5 text-[10px] text-subtle">
              {result.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FileAnalyzer() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const { notify } = useToast()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<FileReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const buildReport = (entry: FileReport): string => {
    const lines = [
      'Adnan Tech local file analysis report',
      `Name: ${entry.name}`,
      `Size: ${entry.size} bytes`,
      `Detected type: ${entry.detectedType}`,
      `Extension: ${entry.extension || '(none)'}`,
      `SHA-256: ${entry.sha256}`,
      `SHA-1: ${entry.sha1}`,
      `Entropy: ${entry.entropy} / 8`,
      `Text extraction: ${entry.extraction.kind}${entry.extraction.truncated ? ' (truncated)' : ''}`,
      `Sensitive findings: ${entry.sensitiveFindings.length === 0 ? 'none detected' : entry.sensitiveFindings.map((finding) => `${finding.kind} x${finding.count}`).join(', ')}`,
      '',
      'Indicators:',
      ...(entry.indicators.length === 0 ? ['none matched'] : entry.indicators.map((indicator) => `[${indicator.severity}] ${indicator.title} - ${indicator.detail}`)),
      '',
      'Limitations: Static analysis cannot prove a file is safe. Text is redacted in this report. Scanned or image-only PDFs are not OCR-processed.',
    ]
    if (entry.extraction.note) lines.push('', `Extraction note: ${entry.extraction.note}`)
    if (entry.extraction.text) lines.push('', 'Redacted text preview:', redactSensitiveData(entry.extraction.text).slice(0, 20_000))
    return lines.join('\n')
  }

  const copyReport = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(buildReport(report))
      notify('success', L('The redacted file report was copied.', 'تم نسخ تقرير الملف المنقّح.'), L('Report copied', 'تم نسخ التقرير'))
    } catch {
      notify('error', L('The browser blocked clipboard access.', 'منع المتصفح الوصول إلى الحافظة.'), L('Could not copy', 'تعذر النسخ'))
    }
  }

  const downloadReport = () => {
    if (!report) return
    const safeName = report.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'file'
    downloadTextFile(`${safeName}.adnan-tech-report.txt`, buildReport(report))
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setReport(null)
    if (file.size > MAX_SCAN_BYTES) {
      setError(L('File is larger than the 25 MB local analysis limit.', 'حجم الملف يتجاوز حد التحليل المحلي 25 ميجابايت.'))
      return
    }
    setBusy(true)
    const started = performance.now()
    try {
      const result = await analyzeFile(file)
      setReport(result)
      const high = result.indicators.filter((entry) => entry.severity === 'high').length
      addRecord({
        tool: 'file',
        target: result.name,
        status: high > 0 ? 'partial' : 'success',
        summary: `${result.detectedType} · ${result.indicators.length} indicator(s) · ${high} high`,
        durationMs: Math.round(performance.now() - started),
        location: 'browser',
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : L('The file could not be analyzed.', 'تعذر تحليل الملف.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><FileSearch className="h-4 w-4 text-primary" />{L('Local file analysis', 'تحليل محلي للملفات')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Hashes, type detection, extension checks, entropy, PDF actions, extracted text with secret redaction, and static script patterns. Nothing leaves the browser.', 'بصمات وكشف النوع وفحص الامتداد والإنتروبيا وإجراءات PDF والنص المستخرج مع تنقيح الأسرار وأنماط السكربتات. لا شيء يغادر المتصفح.')}</p>
        <label className="nx-file-drop mt-4 block cursor-pointer" htmlFor="file-input">
          <Upload className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold">{L('Choose a file to analyze locally', 'اختر ملفًا لتحليله محليًا')}</p>
          <p className="mt-1 text-[11px] text-subtle">{L('Up to 25 MB. Nothing is uploaded.', 'حتى 25 ميجابايت. لا يُرفع أي شيء.')}</p>
          <input id="file-input" type="file" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => { void onFile(event.target.files?.[0]); event.target.value = '' }} />
        </label>
      </section>

      {busy ? <Skeleton className="h-32 w-full" /> : null}
      {error ? <Alert tone="danger" title={L('File analysis failed', 'فشل تحليل الملف')}>{error}</Alert> : null}
      {report ? (
        <div className="nx-panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={report.indicators.some((entry) => entry.severity === 'high') ? 'danger' : report.indicators.length > 0 ? 'warning' : 'success'}>
              {report.indicators.some((entry) => entry.severity === 'high') ? L('High-risk indicators', 'مؤشرات عالية الخطورة') : report.indicators.length > 0 ? L('Review suggested', 'يُنصح بالمراجعة') : L('No static indicators', 'لا مؤشرات ساكنة')}
            </Badge>
            <span className="min-w-0 truncate text-xs font-semibold">{report.name}</span>
            <span className="text-[10px] text-subtle">{formatBytes(report.size)} · {report.detectedType}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyReport()}>{L('Copy redacted report', 'نسخ التقرير المنقّح')}</Button>
            <Button size="sm" variant="ghost" onClick={downloadReport}>{L('Download report', 'تنزيل التقرير')}</Button>
            <span className="text-[10px] text-subtle">{L('Processed locally; the report contains redacted text only.', 'تتم المعالجة محليًا؛ يحتوي التقرير على نص منقّح فقط.')}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-line bg-surface-2 p-3 sm:col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">SHA-256</p>
              <p className="mt-1 break-all font-mono text-[10px]" dir="ltr">{report.sha256}</p>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{L('Entropy', 'الإنتروبيا')}</p>
              <p className="mt-1 text-lg font-bold tabular-nums">{report.entropy} <span className="text-[10px] font-normal text-subtle">/ 8</span></p>
            </div>
          </div>
          <details className="mt-2 rounded-lg border border-line px-3 py-2 text-xs">
            <summary className="cursor-pointer text-subtle">SHA-1 · {report.sha1.slice(0, 16)}…</summary>
            <p className="mt-1 break-all font-mono text-[10px]" dir="ltr">{report.sha1}</p>
          </details>
          {report.sensitiveFindings.length > 0 ? (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <p className="text-xs font-semibold text-warning">{L('Sensitive data found in the extracted text', 'بيانات حساسة في النص المستخرج')}</p>
              <ul className="mt-1 space-y-1 text-[10px] text-muted">
                {report.sensitiveFindings.map((finding) => (
                  <li key={finding.kind} className="flex flex-wrap items-center gap-2">
                    <Badge tone={['private-key', 'api-key', 'password', 'credit-card'].includes(finding.kind) ? 'danger' : 'warning'}>{finding.kind}</Badge>
                    <span>{finding.count} {L('match(es)', 'تطابق')}</span>
                    <span className="font-mono" dir="ltr">{finding.samples.join(' · ')}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-subtle">{L('Preview and report text are redacted. Rotate any real credential that was exposed.', 'تُنقّح المعاينة ونص التقرير. غيّر أي بيانات اعتماد حقيقية تعرّضت للكشف.')}</p>
            </div>
          ) : null}
          {report.extraction.text ? (
            <details className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <summary className="cursor-pointer font-semibold">{L('Redacted text preview', 'معاينة النص المنقّح')} <span className="font-normal text-subtle">({report.extraction.text.length.toLocaleString()} {L('characters', 'حرفًا')}{report.extraction.truncated ? L(', truncated', '، مقتطع') : ''})</span></summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-muted" dir="auto">{redactSensitiveData(report.extraction.text).slice(0, 8000)}</pre>
            </details>
          ) : null}
          {report.extraction.note ? <Alert tone="info" className="mt-3">{report.extraction.note}</Alert> : null}
          {report.indicators.length === 0 ? (
            <Alert tone="info" className="mt-3">{L('No static indicators matched. This does not prove the file is safe. Verify the source and scan with an appropriate engine.', 'لم تتطابق مؤشرات ساكنة. هذا لا يثبت أن الملف آمن. تحقق من المصدر وافحصه بمحرك مناسب.')}</Alert>
          ) : (
            <ul className="mt-3 space-y-2">
              {report.indicators.map((indicator) => (
                <li key={indicator.id} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone={indicator.severity === 'high' ? 'danger' : indicator.severity === 'medium' ? 'warning' : 'default'}>{indicator.severity}</Badge><span className="text-xs font-semibold">{indicator.title}</span></div>
                  <p className="mt-1 text-xs text-muted">{indicator.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <Alert tone="warning" className="mt-3">
            {L('Static analysis cannot detect every malicious file, and high entropy or macro support is not proof of malware. Never open a suspicious attachment outside an isolated environment.', 'التحليل الساكن لا يكشف كل ملف خبيث، والإنتروبيا العالية أو دعم الماكرو ليست دليلًا على الخبث. لا تفتح مرفقًا مشبوهًا خارج بيئة معزولة.')}
          </Alert>
        </div>
      ) : null}
      {!busy && !report && !error ? <EmptyState icon={<FileWarning className="h-6 w-6" />} title={L('No file selected', 'لم يتم اختيار ملف')} description={L('Analysis stays on this device. The organizer receives no copy.', 'يبقى التحليل على هذا الجهاز. لا يتلقى النظام أي نسخة.')} /> : null}
    </div>
  )
}

function LogTriage() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [report, setReport] = useState<LogReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const analyze = (label: string, text: string) => {
    if (!text.trim()) {
      setError(L('Paste log lines or choose a log file first.', 'الصق أسطر السجل أو اختر ملف سجل أولًا.'))
      return
    }
    setError(null)
    const result = analyzeLog(label || 'pasted-log.txt', text)
    setReport(result)
    addRecord({ tool: 'log', target: result.name, status: 'success', summary: `${result.lines} lines · ${result.errors} errors · ${result.warnings} warnings`, location: 'browser' })
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_LOG_BYTES) {
      setError(L('Log files are limited to 4 MB for local triage.', 'ملفات السجل محدودة بـ 4 ميجابايت للفرز المحلي.'))
      return
    }
    try {
      const text = await readTextFile(file)
      setContent(text)
      setName(file.name)
      analyze(file.name, text)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : L('The log file could not be read.', 'تعذر قراءة ملف السجل.'))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ScanSearch className="h-4 w-4 text-primary" />{L('Log triage', 'فرز السجلات')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Counters, recurring normalized messages, IPs/hosts, and representative errors. Processed locally.', 'عدّادات ورسائل متكررة معادلة وعناوين IP/مضيفين وأخطاء تمثيلية. تُعالج محليًا.')}</p>
        <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs text-muted hover:border-primary/60" htmlFor="log-file">
          <Upload className="h-3.5 w-3.5" />{L('Load .log / .txt (max 4 MB)', 'تحميل .log / .txt (حتى 4 ميجابايت)')}
          <input id="log-file" type="file" accept=".log,.txt,text/plain" className="sr-only" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        <Field label={L('Or paste log lines', 'أو الصق أسطر السجل')} htmlFor="log-text" className="mt-3">
          <Textarea id="log-text" className="min-h-48 font-mono text-[11px]" dir="ltr" placeholder="2026-01-01T10:00:00Z ERROR ..." value={content} onChange={(event) => setContent(event.target.value)} />
        </Field>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button icon={<ScanSearch className="h-4 w-4" />} onClick={() => analyze(name, content)}>{L('Analyze log', 'تحليل السجل')}</Button>
          <Button variant="ghost" onClick={() => { setContent(''); setName(''); setReport(null); setError(null) }}>{L('Clear', 'مسح')}</Button>
          <span className="text-[10px] text-subtle">{formatBytes(content.length)}</span>
        </div>
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      </section>

      <section className="nx-panel p-4">
        {!report ? <EmptyState icon={<ScanSearch className="h-6 w-6" />} title={L('No log analyzed', 'لا سجل محلل')} description={L('The summary will show real counts from the text you provided.', 'سيعرض الملخص أعدادًا حقيقية من النص الذي قدمته.')} /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={report.errors > 0 ? 'danger' : report.warnings > 0 ? 'warning' : 'success'}>{report.errors} {L('errors', 'أخطاء')}</Badge>
              <span className="text-xs text-subtle">{report.lines} {L('lines', 'سطرًا')} · {report.warnings} {L('warnings', 'تحذيرات')}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-line bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle">{L('Unique IPs', 'عناوين IP فريدة')}</p><p className="mt-1 text-sm font-bold tabular-nums">{report.uniqueIps.length}</p></div>
              <div className="rounded-lg border border-line bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle">{L('Hosts', 'المضيفون')}</p><p className="mt-1 text-sm font-bold tabular-nums">{report.uniqueHosts.length}</p></div>
            </div>
            {report.topMessages.length > 0 ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold">{L('Top recurring messages', 'أكثر الرسائل تكرارًا')}</h3>
                <ul className="space-y-1">
                  {report.topMessages.map((entry) => (
                    <li key={entry.text} className="flex items-start gap-2 rounded border border-line px-2 py-1.5 text-[10px]"><Badge tone="default">{entry.count}×</Badge><span className="min-w-0 flex-1 break-words font-mono text-muted" dir="ltr">{entry.text}</span></li>
                  ))}
                </ul>
              </div>
            ) : null}
            {report.uniqueIps.length > 0 ? <p className="break-all text-[10px] text-subtle" dir="ltr">{report.uniqueIps.join(' · ')}</p> : null}
            {report.samples.length > 0 ? (
              <div>
                <h3 className="mb-1 text-xs font-semibold">{L('Error samples', 'نماذج الأخطاء')}</h3>
                <ul className="max-h-64 space-y-1 overflow-auto">
                  {report.samples.map((sample) => (
                    <li key={`${sample.line}-${sample.text.slice(0, 12)}`} className="flex gap-2 rounded border border-line px-2 py-1.5 text-[10px]">
                      <span className="tabular-nums text-subtle">{sample.line}</span>
                      <span className={sample.level === 'error' ? 'text-danger' : 'text-warning'}>{sample.level}</span>
                      <span className="min-w-0 flex-1 break-words font-mono text-muted" dir="ltr">{sample.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Alert tone="info">{L('Parsing is pattern-based. Absence of errors here does not mean the system is healthy.', 'التحليل قائم على الأنماط. عدم ظهور أخطاء هنا لا يعني أن النظام سليم.')}</Alert>
          </div>
        )}
      </section>
    </div>
  )
}

function ImageReview() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const { credentials, hasClientProvider } = useProviders()
  const { notify } = useToast()
  const navigate = useNavigate()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [image, setImage] = useState<{ dataUrl: string; name: string; type: string; size: number; width: number; height: number; sha256: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<AnalysisResult | null>(null)

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setAiError(null)
    setAiResult(null)
    setConsent(false)
    const validation = await validateImageFile(file)
    if (!validation.ok) {
      setError(validation.reason === 'size' ? L('Image is too large.', 'الصورة كبيرة جدًا.') : validation.reason === 'type' ? L('Only PNG, JPEG, and WebP images are supported.', 'تُدعم صور PNG وJPEG وWebP فقط.') : L('The file content does not match a supported image.', 'محتوى الملف لا يطابق صورة مدعومة.'))
      return
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const sha256 = await digest('SHA-256', bytes)
    const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
      const element = new Image()
      element.onload = () => resolve({ width: element.naturalWidth, height: element.naturalHeight })
      element.onerror = () => resolve({ width: 0, height: 0 })
      element.src = validation.dataUrl
    })
    setImage({ dataUrl: validation.dataUrl, name: file.name, type: file.type, size: file.size, width: dimensions.width, height: dimensions.height, sha256 })
    addRecord({ tool: 'file', target: file.name, status: 'success', summary: `Image ${dimensions.width}×${dimensions.height} · ${formatBytes(file.size)}`, location: 'browser' })
  }

  const runVision = async () => {
    if (!image || !consent || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    const started = performance.now()
    try {
      const result = await analyzeProblem({
        title: `Screenshot review: ${image.name}`.slice(0, 300),
        description: 'Inspect this screenshot for visible error messages, dialogs, device states, or configuration problems. Only report what is visible. If text is unreadable, say so instead of guessing.',
        errorText: '',
        logs: '',
        category: 'other',
        os: '',
        environment: '',
        recentChange: '',
        experience: 'professional',
        priority: 'medium',
        imageDataUrl: image.dataUrl,
        imageName: image.name,
      }, credentials)
      setAiResult(result)
      addRecord({ tool: 'file', target: image.name, status: 'success', summary: `AI vision review · ${result.provider}/${result.model}`, durationMs: Math.round(performance.now() - started), location: 'server' })
      notify('success', L('The configured provider returned a vision review.', 'أعاد المزوّد المهيأ مراجعة بصرية.'), L('Vision review complete', 'اكتملت المراجعة البصرية'))
    } catch (caught) {
      setAiError(errorMessage(caught))
      addRecord({ tool: 'file', target: image.name, status: 'error', summary: errorMessage(caught), durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setAiBusy(false)
    }
  }

  const copyVisionReport = async () => {
    if (!image || !aiResult) return
    const lines = [
      'Adnan Tech image review',
      `File: ${image.name}`,
      `Type: ${image.type || 'unknown'}`,
      `Dimensions: ${image.width}×${image.height}`,
      `Size: ${image.size} bytes`,
      `SHA-256: ${image.sha256}`,
      `Provider: ${aiResult.provider} / ${aiResult.model}`,
      `Generated: ${aiResult.generatedAt}`,
      `Confidence: ${aiResult.confidence.level} - ${aiResult.confidence.reason}`,
      '',
      `Summary: ${aiResult.summary}`,
      '',
      'Visible observations:',
      ...aiResult.symptoms.map((symptom) => `- ${symptom}`),
      '',
      'Possible causes:',
      ...aiResult.causes.map((cause) => `- [${cause.likelihood}] ${cause.cause}`),
      '',
      'Next checks:',
      ...aiResult.diagnosticSteps.map((step) => `${step.order}. ${step.title}: ${step.detail}`),
      '',
      `Limitations: ${aiResult.limitations}`,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      notify('success', L('The vision review was copied.', 'تم نسخ المراجعة البصرية.'), L('Report copied', 'تم نسخ التقرير'))
    } catch {
      notify('error', L('The browser blocked clipboard access.', 'منع المتصفح الوصول إلى الحافظة.'), L('Could not copy', 'تعذر النسخ'))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4 text-primary" />{L('Image review', 'مراجعة الصور')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Local checks validate the real image type, dimensions, size, and SHA-256. No OCR runs locally and metadata is not removed.', 'الفحوص المحلية تتحقق من النوع الحقيقي والأبعاد والحجم وبصمة SHA-256. لا يعمل OCR محليًا ولا تُزال البيانات الوصفية.')}</p>
        <label className="nx-file-drop mt-4 block cursor-pointer" htmlFor="image-input">
          <ImageIcon className="mx-auto h-6 w-6 text-primary" />
          <p className="mt-2 text-sm font-semibold">{L('Choose a PNG, JPEG, or WebP', 'اختر صورة PNG أو JPEG أو WebP')}</p>
          <input id="image-input" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => { void onFile(event.target.files?.[0]); event.target.value = '' }} />
        </label>
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      </section>
      <section className="nx-panel p-4">
        {!image ? <EmptyState icon={<ImageIcon className="h-6 w-6" />} title={L('No image selected', 'لم يتم اختيار صورة')} description={L('A local preview and fingerprints will appear here.', 'ستظهر هنا معاينة محلية وبصمات الملف.')} /> : (
          <div className="space-y-3">
            <img src={image.dataUrl} alt={image.name} className="max-h-56 w-full rounded-lg border border-line object-contain" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">{image.type || L('image', 'صورة')}</Badge>
              <span className="min-w-0 truncate text-xs font-semibold">{image.name}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-line bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle">{L('Size', 'الحجم')}</p><p className="mt-1 text-xs font-bold">{formatBytes(image.size)}</p></div>
              <div className="rounded-lg border border-line bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle">{L('Dimensions', 'الأبعاد')}</p><p className="mt-1 text-xs font-bold" dir="ltr">{image.width}×{image.height}</p></div>
              <div className="rounded-lg border border-line bg-surface-2 p-3"><p className="text-[10px] uppercase tracking-wider text-subtle">{L('Ratio', 'النسبة')}</p><p className="mt-1 text-xs font-bold">{image.height ? (image.width / image.height).toFixed(2) : '—'}</p></div>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-[10px] uppercase tracking-wider text-subtle">SHA-256</p>
              <p className="mt-1 break-all font-mono text-[10px]" dir="ltr">{image.sha256}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                icon={<Sparkles className="h-3.5 w-3.5" />}
                onClick={() => {
                  setLabDraft({ title: `Image review: ${image.name}`, imageDataUrl: image.dataUrl, imageName: image.name })
                  notify('success', L('Image attached to a new lab draft', 'أُرفقت الصورة بمسودة مختبر جديدة'))
                  navigate('/lab')
                }}
              >
                {L('Use in Troubleshooting Lab', 'استخدمها في مختبر الاستكشاف')}
              </Button>
              <Button size="sm" variant="secondary" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => { setImage(null); setAiResult(null); setAiError(null); setConsent(false) }}>{L('Remove image', 'إزالة الصورة')}</Button>
            </div>
            <Alert tone="warning">{L('This is not a privacy tool. EXIF and other metadata may remain in the image.', 'هذه ليست أداة خصوصية. قد تبقى بيانات EXIF وغيرها داخل الصورة.')}</Alert>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-xs font-semibold">{L('AI vision review (optional)', 'مراجعة بصرية بالذكاء الاصطناعي (اختياري)')}</p>
              <p className="mt-1 text-[10px] text-muted">{L('Local mode performs no OCR. If you consent, this image is sent to the AI provider configured for your account or server. The model may misread text; verify every observation against the original image.', 'الوضع المحلي لا ينفذ OCR. عند الموافقة، تُرسل الصورة إلى مزوّد الذكاء الاصطناعي المهيأ لحسابك أو الخادم. قد يخطئ النموذج في قراءة النص؛ تحقق من كل ملاحظة مقابل الصورة الأصلية.')}</p>
              <label className="mt-2 flex items-start gap-2 text-[11px] text-muted">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>{L('I understand this image leaves the browser and consent to AI analysis.', 'أفهم أن هذه الصورة ستغادر المتصفح وأوافق على تحليلها بالذكاء الاصطناعي.')}</span>
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={aiBusy} disabled={!consent} onClick={() => void runVision()}>{L('Analyze image with AI', 'تحليل الصورة بالذكاء الاصطناعي')}</Button>
                {aiResult ? <Button size="sm" variant="secondary" onClick={() => void copyVisionReport()}>{L('Copy AI report', 'نسخ تقرير AI')}</Button> : null}
                <span className="text-[10px] text-subtle">{hasClientProvider ? L('A browser provider is configured; the request still requires a working key.', 'يوجد مزوّد مهيأ في المتصفح؛ لا يزال الطلب يحتاج مفتاحًا صالحًا.') : L('The server provider is used when no browser provider is configured.', 'يُستخدم مزوّد الخادم عند عدم تهيئة مزوّد في المتصفح.')}</span>
              </div>
              {aiError ? <Alert tone="danger" className="mt-2" title={L('AI vision failed', 'فشلت المراجعة البصرية')}>{aiError}</Alert> : null}
              {aiResult ? (
                <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={aiResult.confidence.level === 'high' ? 'success' : aiResult.confidence.level === 'medium' ? 'warning' : 'default'}>{L('Confidence', 'الثقة')}: {aiResult.confidence.level}</Badge>
                    <span className="text-[10px] text-subtle">{aiResult.provider}/{aiResult.model}</span>
                  </div>
                  <p className="text-xs text-muted">{aiResult.summary}</p>
                  {aiResult.symptoms.length > 0 ? (
                    <div><p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{L('Visible observations', 'ملاحظات مرئية')}</p><ul className="mt-1 list-disc space-y-0.5 ps-5 text-[11px] text-muted">{aiResult.symptoms.map((symptom) => <li key={symptom}>{symptom}</li>)}</ul></div>
                  ) : null}
                  {aiResult.causes.length > 0 ? (
                    <div><p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{L('Possible causes', 'أسباب محتملة')}</p><ul className="mt-1 space-y-1 text-[11px] text-muted">{aiResult.causes.slice(0, 5).map((cause) => <li key={cause.cause}><Badge tone={cause.likelihood === 'high' ? 'warning' : 'default'}>{cause.likelihood}</Badge> <span>{cause.cause}</span></li>)}</ul></div>
                  ) : null}
                  {aiResult.diagnosticSteps.length > 0 ? (
                    <div><p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{L('Next checks', 'الفحوص التالية')}</p><ol className="mt-1 list-decimal space-y-0.5 ps-5 text-[11px] text-muted">{aiResult.diagnosticSteps.slice(0, 5).map((step) => <li key={step.order}>{step.title}</li>)}</ol></div>
                  ) : null}
                  <p className="text-[10px] text-subtle">{aiResult.limitations}</p>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function LabHistory() {
  const { settings } = useApp()
  const { records, removeRecord } = useDiagnostics()
  const { notify } = useToast()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const labRecords = useMemo(() => records.filter((entry) => entry.tool === 'url' || entry.tool === 'file' || entry.tool === 'log'), [records])

  return (
    <div className="nx-panel p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-sm font-semibold">{L('Security lab history', 'سجل مختبر الأمان')}</h2><p className="text-xs text-subtle">{L('Local only. File contents are never stored.', 'محلي فقط. لا تُخزّن محتويات الملفات.')}</p></div>
        <Button
          size="sm"
          variant="secondary"
          icon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => {
            if (labRecords.length === 0) return
            if (!window.confirm(L('Clear security lab history?', 'مسح سجل مختبر الأمان؟'))) return
            labRecords.forEach((entry) => removeRecord(entry.id))
            notify('success', L('History cleared', 'تم مسح السجل'))
          }}
        >
          {L('Clear all', 'مسح الكل')}
        </Button>
      </div>
      {labRecords.length === 0 ? (
        <EmptyState className="mt-4" icon={<History className="h-6 w-6" />} title={L('No security analyses yet', 'لا تحليلات أمنية بعد')} description={L('URL, file, and log analyses will appear here.', 'ستظهر تحليلات الروابط والملفات والسجلات هنا.')} />
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {labRecords.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2.5">
              {entry.tool === 'url' ? <Globe2 className="h-4 w-4 shrink-0 text-primary" /> : entry.tool === 'log' ? <ScanSearch className="h-4 w-4 shrink-0 text-primary" /> : <FileSearch className="h-4 w-4 shrink-0 text-primary" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{entry.target}</p>
                <p className="truncate text-[10px] text-subtle">{diagnosticToolLabel(entry.tool)} · {entry.summary} · {new Date(entry.createdAt).toLocaleString(settings.language === 'ar' ? 'ar' : 'en')}</p>
              </div>
              <Badge tone={entry.status === 'success' ? 'success' : entry.status === 'partial' ? 'warning' : 'danger'}>{entry.status}</Badge>
              <button type="button" onClick={() => removeRecord(entry.id)} className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-danger" aria-label={L('Delete record', 'حذف السجل')}><XCircle className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default SecurityLabPage

