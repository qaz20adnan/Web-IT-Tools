import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Clock3,
  Globe2,
  History,
  Network,
  Radar,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Waypoints,
  Wifi,
  XCircle,
} from 'lucide-react'
import { Alert, Badge, Button, Checkbox, EmptyState, Field, Input, Select, Skeleton, Tabs, Tab } from '@/components/ui'
import { DonutChart, LineChart } from '@/components/charts'
import { DnsTool, TlsTool } from '@/components/tools/NetworkLookup'
import { useApp } from '@/context/AppContext'
import { buildDiagnosticAnalytics, diagnosticToolLabel, useDiagnostics, type DiagnosticStatus } from '@/context/DiagnosticsContext'
import { useToast } from '@/context/ToastContext'
import {
  checkHttpEndpoint,
  checkPublicPorts,
  runLatencyProbe,
  runPathProbe,
  type HttpCheckResponse,
  type LatencyResponse,
  type PathResponse,
  type PortCheckResponse,
} from '@/services/api'
import { describeError } from '@/services/apiError'
import { cn } from '@/lib/utils'

type DiagnosticTab = 'overview' | 'latency' | 'path' | 'dns' | 'ports' | 'http' | 'ssl' | 'history'

const DIAGNOSTIC_TABS: readonly DiagnosticTab[] = ['overview', 'latency', 'path', 'dns', 'ports', 'http', 'ssl', 'history']

function isDiagnosticTab(value: string | null): value is DiagnosticTab {
  return value !== null && DIAGNOSTIC_TABS.includes(value as DiagnosticTab)
}

const PORT_OPTIONS = [
  { port: 80, service: 'HTTP' },
  { port: 443, service: 'HTTPS' },
  { port: 22, service: 'SSH' },
  { port: 25, service: 'SMTP' },
  { port: 110, service: 'POP3' },
  { port: 143, service: 'IMAP' },
  { port: 465, service: 'SMTPS' },
  { port: 587, service: 'Submission' },
  { port: 993, service: 'IMAPS' },
  { port: 995, service: 'POP3S' },
  { port: 3389, service: 'RDP' },
  { port: 8080, service: 'HTTP alt' },
  { port: 8443, service: 'HTTPS alt' },
]

const STATUS_TONE: Record<DiagnosticStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  success: 'success',
  partial: 'warning',
  failure: 'danger',
  blocked: 'warning',
  error: 'danger',
}

function statusLabel(status: DiagnosticStatus, lang: 'en' | 'ar'): string {
  const labels: Record<DiagnosticStatus, { en: string; ar: string }> = {
    success: { en: 'Success', ar: 'ناجح' },
    partial: { en: 'Partial', ar: 'جزئي' },
    failure: { en: 'Failed', ar: 'فاشل' },
    blocked: { en: 'Blocked', ar: 'محجوب' },
    error: { en: 'Error', ar: 'خطأ' },
  }
  return lang === 'ar' ? labels[status].ar : labels[status].en
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      {hint ? <p className="text-[10px] text-subtle">{hint}</p> : null}
    </div>
  )
}

function Runner({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
}

export function NetworkDiagnosticsPage() {
  const { settings } = useApp()
  const { notify } = useToast()
  const { records, removeRecord, clearRecords } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [params] = useSearchParams()
  const requested = params.get('tool') ?? params.get('tab')
  const [tab, setTab] = useState<DiagnosticTab>(() => (isDiagnosticTab(requested) ? requested : 'overview'))
  const analytics = useMemo(() => buildDiagnosticAnalytics(records), [records])

  useEffect(() => {
    if (isDiagnosticTab(requested)) setTab(requested)
  }, [requested])

  return (
    <div className="nx-page animate-in">
      <section className="nx-hero mb-5">
        <div className="relative z-10">
          <p className="nx-eyebrow">
            <Radar className="h-3.5 w-3.5" />
            {L('Network Diagnostics Center', 'مركز تشخيص الشبكة')}
          </p>
          <h1 className="nx-display mt-2 text-3xl sm:text-4xl">
            {L('Measure the path, then change one thing.', 'قِس المسار، ثم غيّر شيئًا واحدًا.')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            {L(
              'Live probes run from the platform server runtime. Every result states where it was measured and what it does not prove.',
              'تُنفّذ الفحوص من بيئة تشغيل الخادم. كل نتيجة توضح مكان القياس وما لا يمكن إثباته.',
            )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<Wifi className="h-4 w-4" />} onClick={() => setTab('latency')}>
              {L('Measure latency', 'قِس زمن الاستجابة')}
            </Button>
            <Button variant="secondary" icon={<Waypoints className="h-4 w-4" />} onClick={() => setTab('path')}>
              {L('Map the path', 'ارسم المسار')}
            </Button>
            <Link to="/security-lab" className="btn btn-ghost">
              <ShieldCheck className="h-4 w-4" />
              {L('Open Security Lab', 'افتح مختبر الأمان')}
            </Link>
          </div>
        </div>
      </section>

      <Alert tone="info" className="mb-4">
        {L(
          'Public diagnostics only. Private, loopback, link-local, and reserved addresses are blocked. Only probe systems you own or are authorized to test.',
          'التشخيص للأهداف العامة فقط. العناوين الخاصة والحلقية والمحمية محجوبة. افحص فقط الأنظمة التي تملكها أو لديك تصريح بفحصها.',
        )}
      </Alert>

      <Tabs value={tab} onChange={(value) => setTab(value as DiagnosticTab)} className="mb-4">
        <Tab id="overview" icon={<Activity className="h-3.5 w-3.5" />}>{L('Overview', 'نظرة عامة')}</Tab>
        <Tab id="latency" icon={<Wifi className="h-3.5 w-3.5" />}>{L('Latency', 'الزمن')}</Tab>
        <Tab id="path" icon={<Waypoints className="h-3.5 w-3.5" />}>{L('Path', 'المسار')}</Tab>
        <Tab id="dns" icon={<Globe2 className="h-3.5 w-3.5" />}>DNS</Tab>
        <Tab id="ports" icon={<Server className="h-3.5 w-3.5" />}>{L('Ports', 'المنافذ')}</Tab>
        <Tab id="http" icon={<Network className="h-3.5 w-3.5" />}>HTTP</Tab>
        <Tab id="ssl" icon={<ShieldCheck className="h-3.5 w-3.5" />}>SSL</Tab>
        <Tab id="history" icon={<History className="h-3.5 w-3.5" />}>{L('History', 'السجل')}</Tab>
      </Tabs>

      <div key={tab} className="animate-fade">
        {tab === 'overview' ? <OverviewPanel /> : null}
        {tab === 'latency' ? <LatencyPanel /> : null}
        {tab === 'path' ? <PathPanel /> : null}
        {tab === 'dns' ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <DnsTool />
          </div>
        ) : null}
        {tab === 'ports' ? <PortsPanel /> : null}
        {tab === 'http' ? <HttpPanel /> : null}
        {tab === 'ssl' ? (
          <div className="rounded-xl border border-line bg-surface p-4">
            <TlsTool />
          </div>
        ) : null}
        {tab === 'history' ? (
          <HistoryPanel
            records={records}
            removeRecord={removeRecord}
            clearRecords={clearRecords}
            language={settings.language}
            notify={notify}
          />
        ) : null}
      </div>
    </div>
  )

  function OverviewPanel() {
    const latest = records.slice(0, 6)
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={L('Total probes', 'إجمالي الفحوص')} value={analytics.total} hint={L('Stored on this device only', 'محفوظة على هذا الجهاز فقط')} />
          <Metric label={L('Today', 'اليوم')} value={analytics.todayCount} hint={L('Diagnostics started today', 'فحوص بدأت اليوم')} />
          <Metric
            label={L('Success rate', 'نسبة النجاح')}
            value={analytics.successRate === null ? '—' : `${analytics.successRate}%`}
            hint={L('Excludes errors before a result', 'لا تشمل أخطاء ما قبل النتيجة')}
          />
          <Metric
            label={L('Average latency', 'متوسط الزمن')}
            value={analytics.avgLatencyMs === null ? '—' : `${analytics.avgLatencyMs} ms`}
            hint={L('Successful TCP connects only', 'عمليات اتصال TCP الناجحة فقط')}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="nx-chart-card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{L('Activity · last 14 days', 'النشاط · آخر 14 يومًا')}</h2>
              <Badge tone="default">{L('Local history', 'سجل محلي')}</Badge>
            </div>
            <LineChart
              ariaLabel={L('Diagnostic activity over the last 14 days', 'نشاط التشخيص خلال آخر 14 يومًا')}
              lang={settings.language}
              series={[
                {
                  id: 'activity',
                  label: L('Probes', 'الفحوص'),
                  color: '#35d6f2',
                  points: analytics.activity.map((entry) => ({ label: entry.label, value: entry.count })),
                },
              ]}
              height={180}
            />
          </div>
          <div className="nx-chart-card">
            <h2 className="mb-2 text-sm font-semibold">{L('Tool mix', 'توزيع الأدوات')}</h2>
            <DonutChart
              ariaLabel={L('Diagnostics by tool', 'التشخيص حسب الأداة')}
              lang={settings.language}
              data={analytics.byTool.slice(0, 6).map((entry) => ({ label: entry.label, value: entry.count }))}
              centerLabel={L('probes', 'فحص')}

            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="nx-panel p-4">
            <h2 className="text-sm font-semibold">{L('Recent results', 'أحدث النتائج')}</h2>
            {latest.length === 0 ? (
              <EmptyState
                className="mt-3"
                icon={<Activity className="h-6 w-6" />}
                title={L('No diagnostics yet', 'لا توجد فحوص بعد')}
                description={L('Run a latency or HTTP check to build real history.', 'نفّذ فحص زمن أو فحص HTTP لبناء سجل حقيقي.')}
              />
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {latest.map((record) => (
                  <li key={record.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{record.target}</p>
                      <p className="text-[10px] text-subtle">
                        {diagnosticToolLabel(record.tool)} · {new Date(record.createdAt).toLocaleString(settings.language === 'ar' ? 'ar' : 'en')}
                      </p>
                    </div>
                    <Badge tone={STATUS_TONE[record.status]}>{statusLabel(record.status, settings.language)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="nx-panel p-4">
            <h2 className="text-sm font-semibold">{L('Where results come from', 'مصدر النتائج')}</h2>
            <div className="mt-3 space-y-3 text-xs text-muted">
              <p className="flex gap-2"><Server className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{L('Latency, path, ports, HTTP, SSL, and URL checks are executed by the serverless runtime, not the browser.', 'تُنفّذ فحوص الزمن والمسار والمنافذ وHTTP وSSL والروابط من بيئة الخادم، وليس من المتصفح.')}</p>
              <p className="flex gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{L('A refused or timed-out TCP connect proves the port did not answer from this location. It does not prove the host is offline — a firewall in front of it can produce the same result.', 'رفض اتصال TCP أو انتهائه بالمهلة يثبت أن المنفذ لم يستجب من هذا الموقع، ولا يثبت أن المضيف متوقف؛ فقد يعطي جدار الحماية النتيجة نفسها.')}</p>
              <p className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{L('No external reputation provider is configured, so URL analysis never claims a link is safe.', 'لا يوجد مزوّد سمعة خارجي مُهيّأ، لذلك لا يدّعي تحليل الروابط أن الرابط آمن.')}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

const LATENCY_ERROR_LABELS: Record<string, { en: string; ar: string }> = {
  ECONNREFUSED: { en: 'Refused', ar: 'مرفوض' },
  ETIMEDOUT: { en: 'Timed out', ar: 'انتهت المهلة' },
  EHOSTUNREACH: { en: 'Host unreachable', ar: 'المضيف غير متاح' },
  ENETUNREACH: { en: 'Network unreachable', ar: 'الشبكة غير متاحة' },
  EADDRNOTAVAIL: { en: 'No route from here', ar: 'لا مسار من هنا' },
  EACCES: { en: 'Blocked', ar: 'محجوب' },
}

function latencyErrorLabel(code: string | null, lang: 'en' | 'ar'): string {
  if (!code) return '—'
  const known = LATENCY_ERROR_LABELS[code]
  return known ? (lang === 'ar' ? known.ar : known.en) : code
}

function LatencyPanel() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [target, setTarget] = useState('')
  const [port, setPort] = useState(443)
  const [samples, setSamples] = useState(5)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LatencyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!target.trim()) {
      setError(L('Enter a public hostname or IP address.', 'أدخل اسم مضيف عام أو عنوان IP.'))
      return
    }
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const response = await runLatencyProbe(target.trim(), port, samples, 1500)
      setResult(response)
      const { summary } = response
      const serviceReached = summary.connected > 0
      const notMeasured = summary.sent === 0 && summary.platformFailures > 0
      addRecord({
        tool: 'latency',
        target: `${response.target}:${response.port}`,
        status: notMeasured ? 'error' : !serviceReached ? 'failure' : summary.lossPercent > 0 || response.truncated ? 'partial' : 'success',
        summary: notMeasured
          ? `${summary.platformFailures} attempt(s) could not be started from this platform`
          : `${summary.connected}/${summary.sent} connects on :${response.port} · ${summary.lossPercent}% loss${summary.avgMs === null ? '' : ` · avg ${summary.avgMs} ms`}`,
        latencyMs: summary.avgMs ?? undefined,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = describeError(caught, settings.language, L('The request failed.', 'تعذر تنفيذ الطلب.'))
      setError(message)
      addRecord({ tool: 'latency', target: target.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  const successful = result ? result.samples.filter((entry) => entry.ok && entry.latencyMs !== null) : []

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Wifi className="h-4 w-4 text-primary" />{L('TCP latency', 'زمن الاستجابة TCP')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Repeated connects to one service port, measured from the server runtime.', 'عمليات اتصال متكررة لمنفذ خدمة واحد، مقاسة من بيئة الخادم.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('Hostname or IP', 'اسم المضيف أو IP')} htmlFor="latency-target">
            <Input id="latency-target" dir="ltr" className="force-ltr" placeholder="example.com" value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run() }} />
          </Field>
          <Field label={L('Service port', 'منفذ الخدمة')} htmlFor="latency-port">
            <Select id="latency-port" value={port} onChange={(event) => setPort(Number(event.target.value))}>
              {PORT_OPTIONS.map((option) => <option key={option.port} value={option.port}>{option.port} · {option.service}</option>)}
            </Select>
          </Field>
          <Field label={L('Connect attempts', 'عدد محاولات الاتصال')} htmlFor="latency-samples">
            <Select id="latency-samples" value={samples} onChange={(event) => setSamples(Number(event.target.value))}>
              {[1, 3, 5, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Runner>
            <Button loading={busy} icon={<Wifi className="h-4 w-4" />} onClick={() => void run()}>{L('Measure', 'قياس')}</Button>
            {result ? <Button variant="ghost" onClick={() => { setResult(null); setError(null) }}>{L('Clear', 'مسح')}</Button> : null}
          </Runner>
        </div>
        <p className="mt-3 text-[10px] text-subtle">{L(
          'Serverless hosting cannot send ICMP, so this measures the TCP handshake instead. It answers the question that matters for support work: does the service accept connections, how quickly, and how steadily.',
          'لا يمكن لبيئة الاستضافة بدون خوادم إرسال ICMP، لذلك يقيس هذا مصافحة TCP بدلًا منها. يجيب على السؤال الأهم في الدعم الفني: هل يقبل الخدمة الاتصال، وبأي سرعة، وبأي استقرار.',
        )}</p>
      </section>

      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-48 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('Measurement failed', 'فشل القياس')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Wifi className="h-6 w-6" />} title={L('Ready when you are', 'جاهز عندما تبدأ')} description={L('Results show connect time, jitter, and loss per attempt.', 'تعرض النتائج زمن الاتصال والتذبذب والفقد لكل محاولة.')} /> : null}
        {!busy && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.summary.sent === 0 && result.summary.platformFailures > 0 ? 'warning' : successful.length === 0 ? 'danger' : result.summary.lossPercent > 0 || result.truncated ? 'warning' : 'success'}>
                {result.summary.sent === 0 && result.summary.platformFailures > 0
                  ? L('Not measurable from this platform', 'لا يمكن القياس من هذه المنصة')
                  : successful.length === 0
                    ? L('Port did not answer', 'لم يستجب المنفذ')
                    : result.truncated
                      ? L('Answered, sample truncated', 'استجاب مع قطع العينة')
                      : L('Service accepting', 'الخدمة تقبل الاتصال')}
              </Badge>
              <span className="text-xs text-muted" dir="ltr">{result.target} → {result.address}:{result.port}</span>
              {result.addresses.length > 1 ? <Badge tone="default">{L(`${result.addresses.length} addresses`, `${result.addresses.length} عناوين`)}</Badge> : null}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label={L('Connected', 'متصل')} value={`${result.summary.connected}/${result.summary.sent}`} hint={result.summary.platformFailures > 0 ? L(`${result.summary.platformFailures} attempt(s) not counted`, `${result.summary.platformFailures} محاولة غير محسوبة`) : undefined} />
              <Metric label={L('Loss', 'الفقد')} value={`${result.summary.lossPercent}%`} />
              <Metric label={L('Average', 'المتوسط')} value={result.summary.avgMs === null ? '—' : `${result.summary.avgMs} ms`} />
              <Metric label={L('Jitter', 'التذبذب')} value={result.summary.jitterMs === null ? '—' : `${result.summary.jitterMs} ms`} hint={L('Mean change between samples', 'متوسط التغير بين العينات')} />
            </div>
            {result.note ? <Alert tone="warning" title={L('What the numbers exclude', 'ما تستثنيه الأرقام')}>{result.note}</Alert> : null}
            {successful.length > 1 ? (
              <div className="nx-chart-card">
                <h3 className="mb-2 text-xs font-semibold">{L('Connect time per attempt', 'زمن الاتصال لكل محاولة')}</h3>
                <LineChart
                  ariaLabel={L('TCP connect latency for each attempt', 'زمن اتصال TCP لكل محاولة')}
                  lang={settings.language}
                  series={[{
                    id: 'rtt',
                    label: L('Latency', 'الزمن'),
                    color: '#35d6f2',
                    points: successful.map((entry) => ({ label: `#${entry.sequence}`, value: entry.latencyMs as number })),
                  }]}
                  height={160}
                />
              </div>
            ) : null}
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-start text-[10px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-3 py-2 text-start">#</th>
                    <th className="px-3 py-2 text-start">{L('Result', 'النتيجة')}</th>
                    <th className="px-3 py-2 text-start">{L('Address', 'العنوان')}</th>
                    <th className="px-3 py-2 text-start">{L('Connect', 'الاتصال')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.samples.map((sample) => (
                    <tr key={sample.sequence}>
                      <td className="px-3 py-1.5 text-subtle">{sample.sequence}</td>
                      <td className="px-3 py-1.5">
                        {sample.ok ? (
                          <span className="text-success">{L('Connected', 'اتصل')}</span>
                        ) : (
                          <span className={sample.failureKind === 'platform' ? 'text-subtle' : 'text-warning'}>
                            {latencyErrorLabel(sample.errorCode, settings.language)}
                            {sample.failureKind === 'platform' ? ` · ${L('this platform, not the target', 'من هذه المنصة لا من الهدف')}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[10px] text-muted" dir="ltr">{sample.address}</td>
                      <td className="px-3 py-1.5 tabular-nums">{sample.latencyMs === null ? '—' : `${sample.latencyMs} ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Alert tone="info">
              {L(
                `Measured from the platform runtime in ${result.elapsedMs} ms. A refused connect means nothing is listening on that port here; a timeout usually means a firewall dropped the packet. Neither proves the host is offline.`,
                `قيس من بيئة تشغيل المنصة في ${result.elapsedMs} مللي ثانية. الرفض يعني أن لا شيء يستمع على هذا المنفذ هنا، والمهلة تعني غالبًا أن جدار حماية أسقط الحزمة. أيًّا منهما لا يثبت أن المضيف متوقف.`,
              )}
            </Alert>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function PathPanel() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PathResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!target.trim()) {
      setError(L('Enter a public hostname.', 'أدخل اسم مضيف عام.'))
      return
    }
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const response = await runPathProbe(target.trim())
      setResult(response)
      const answered = response.addresses.v4.length + response.addresses.v6.length > 0
      addRecord({
        tool: 'path',
        target: response.target,
        status: !answered ? 'failure' : response.disagreement ? 'partial' : 'success',
        summary: answered
          ? `${[...response.addresses.v4, ...response.addresses.v6].join(', ')}${response.ownership?.asn ? ` · ${response.ownership.asn}` : ''}`
          : L('The name did not resolve', 'لم يُحلّ الاسم'),
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = describeError(caught, settings.language, L('The request failed.', 'تعذر تنفيذ الطلب.'))
      setError(message)
      addRecord({ tool: 'path', target: target.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Waypoints className="h-4 w-4 text-primary" />{L('Path intelligence', 'ذكاء المسار')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Where a name really lands: resolvers, ownership, reverse DNS, authority, and the edge that asked.', 'أين يستقر الاسم فعليًا: المحلّلات، والمُلكية، والعكس، والسلطة، والحافة التي سألت.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('Hostname', 'اسم المضيف')} htmlFor="path-target">
            <Input id="path-target" dir="ltr" className="force-ltr" placeholder="example.com" value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run() }} />
          </Field>
          <Runner>
            <Button loading={busy} icon={<Waypoints className="h-4 w-4" />} onClick={() => void run()}>{L('Map the path', 'ارسم المسار')}</Button>
            {result ? <Button variant="ghost" onClick={() => { setResult(null); setError(null) }}>{L('Clear', 'مسح')}</Button> : null}
          </Runner>
        </div>
        <p className="mt-3 text-[10px] text-subtle">{L(
          'Hop-by-hop traceroute needs raw sockets, which serverless hosting does not grant. This answers the support question traceroute is usually opened for: is the name pointing where it should, who hosts it, and is DNS consistent.',
          'تتبّع القفزات يتطلب مقابس خام لا تتيحها الاستضافة بدون خوادم. يجيب هذا على السؤال الذي يُفتح التتبع لأجله عادةً: هل يشير الاسم إلى المكان الصحيح، ومن يستضيفه، وهل DNS متسق.',
        )}</p>
      </section>

      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-48 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('Path lookup failed', 'فشل المسار')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Waypoints className="h-6 w-6" />} title={L('Nothing mapped yet', 'لم يُرسم شيء بعد')} description={L('The answer shows addresses, hosting, reverse DNS, and resolver agreement.', 'تظهر النتيجة العناوين والاستضافة والعكس واتفاق المحلّلات.')} /> : null}
        {!busy && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.addresses.v4.length + result.addresses.v6.length === 0 ? 'danger' : result.disagreement ? 'warning' : 'success'}>
                {result.addresses.v4.length + result.addresses.v6.length === 0
                  ? L('Not resolved', 'غير محلّل')
                  : result.disagreement
                    ? L('Resolvers disagree', 'المحلّلات مختلفة')
                    : L('Resolved consistently', 'محلّل باتساق')}
              </Badge>
              <span className="text-xs text-muted" dir="ltr">{result.target}</span>
              <Badge tone="default">{L('Public resolvers', 'محلّلات عامة')}</Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">IPv4</p>
                {result.addresses.v4.length === 0 ? <p className="mt-1 text-xs text-subtle">{L('No A record', 'لا سجل A')}</p> : (
                  <ul className="mt-1 space-y-0.5 font-mono text-xs" dir="ltr">{result.addresses.v4.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                )}
              </div>
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">IPv6</p>
                {result.addresses.v6.length === 0 ? <p className="mt-1 text-xs text-subtle">{L('No AAAA record', 'لا سجل AAAA')}</p> : (
                  <ul className="mt-1 space-y-0.5 font-mono text-[10px]" dir="ltr">{result.addresses.v6.map((entry) => <li key={entry}>{entry}</li>)}</ul>
                )}
              </div>
            </div>

            {result.canonicalName.length > 0 ? (
              <p className="text-xs text-muted">{L('Canonical name', 'الاسم النهائي')} · <span className="font-mono" dir="ltr">{result.canonicalName.join(' → ')}</span></p>
            ) : null}

            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-start text-[10px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="px-3 py-2 text-start">{L('Resolver', 'المحلّل')}</th>
                    <th className="px-3 py-2 text-start">{L('Answer', 'الجواب')}</th>
                    <th className="px-3 py-2 text-start">{L('Records', 'السجلات')}</th>
                    <th className="px-3 py-2 text-start">{L('Lowest TTL', 'أقل TTL')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {result.crossResolver.map((entry) => (
                    <tr key={entry.resolver}>
                      <td className="px-3 py-1.5 font-semibold">{entry.resolver}</td>
                      <td className="px-3 py-1.5">{dnsOutcomeLabel(entry.outcome, settings.language)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{entry.answers}</td>
                      <td className="px-3 py-1.5 tabular-nums">{entry.lowestTtl === null ? '—' : `${entry.lowestTtl}s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="nx-panel p-3">
                <h3 className="text-xs font-semibold">{L('Hosting', 'الاستضافة')}</h3>
                {result.ownership ? (
                  <dl className="mt-2 space-y-1.5 text-xs">
                    <OwnershipRow label={L('ASN', 'الرقم')} value={result.ownership.asn} lang={settings.language} />
                    <OwnershipRow label={L('Owner', 'المالك')} value={result.ownership.organisation} lang={settings.language} />
                    <OwnershipRow label={L('Provider', 'المزوّد')} value={result.ownership.internetServiceProvider} lang={settings.language} />
                    <OwnershipRow label={L('Location', 'الموقع')} value={[result.ownership.city, result.ownership.region, result.ownership.country].filter(Boolean).join(', ')} lang={settings.language} />
                  </dl>
                ) : <p className="mt-2 text-xs text-subtle">{L('No public address to attribute.', 'لا يوجد عنوان عام للنسبة.')}</p>}
              </div>
              <div className="nx-panel p-3">
                <h3 className="text-xs font-semibold">{L('Authority', 'السلطة')}</h3>
                <dl className="mt-2 space-y-1.5 text-xs">
                  <OwnershipRow label={L('Zone', 'النطاق')} value={result.authority.zone} lang={settings.language} />
                  <OwnershipRow label="NS" value={result.authority.nameservers.join(', ')} lang={settings.language} />
                  <OwnershipRow label={L('SOA serial', 'رقم SOA')} value={result.authority.soaSerial} lang={settings.language} />
                  <OwnershipRow label={L('Reverse', 'العكس')} value={result.reverse[0]?.names.join(', ')} lang={settings.language} />
                  <OwnershipRow label={L('Measured from', 'قيس من')} value={result.probeOrigin.pointOfPresence} lang={settings.language} />
                </dl>
              </div>
            </div>

            <Alert tone="info">{L('This is the public internet view of the target: what resolvers answer, who owns the address, and which edge asked.', 'هذا منظور الإنترنت العام للهدف: ما تجيب به المحلّلات، ومن يملك العنوان، وأي حافة سألت.')}</Alert>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function dnsOutcomeLabel(outcome: string, lang: 'en' | 'ar'): string {
  const labels: Record<string, { en: string; ar: string }> = {
    answered: { en: 'Answered', ar: 'أجاب' },
    nxdomain: { en: 'No such name', ar: 'لا يوجد هذا الاسم' },
    'no-data': { en: 'No records', ar: 'لا سجلات' },
    servfail: { en: 'Server failure', ar: 'عطل في الخادم' },
    refused: { en: 'Refused', ar: 'مرفوض' },
    error: { en: 'Resolver unavailable', ar: 'المحلّل غير متاح' },
  }
  const known = labels[outcome]
  return known ? (lang === 'ar' ? known.ar : known.en) : outcome
}

function OwnershipRow({ label, value, lang }: { label: string; value: string | null; lang: 'en' | 'ar' }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-end text-xs" dir="ltr">{value || (lang === 'ar' ? 'غير متاح' : 'Not available')}</dd>
    </div>
  )
}

function PortsPanel() {
  const { settings } = useApp()
  const { notify } = useToast()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [target, setTarget] = useState('')
  const [selected, setSelected] = useState<number[]>([443])
  const [manualPort, setManualPort] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(2400)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PortCheckResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = (port: number) => {
    setSelected((current) => current.includes(port) ? current.filter((entry) => entry !== port) : current.length >= 8 ? current : [...current, port])
  }

  const addManualPort = () => {
    const port = Number(manualPort.trim())
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError(L('Enter a valid port number between 1 and 65535.', 'أدخل رقم منفذ صالح بين 1 و65535.'))
      return
    }
    if (selected.includes(port)) {
      setError(L('That port is already selected.', 'هذا المنفذ محدد بالفعل.'))
      return
    }
    if (selected.length >= 8) {
      setError(L('You can check up to eight ports per run.', 'يمكن فحص ثمانية منافذ كحد أقصى لكل تشغيل.'))
      return
    }
    setSelected((current) => [...current, port].sort((a, b) => a - b))
    setManualPort('')
    setError(null)
  }

  const clear = () => {
    setSelected([])
    setManualPort('')
    setResult(null)
    setError(null)
  }

  const copyReport = async () => {
    if (!result) return
    const lines = [
      `Adnan Tech TCP port report`,
      `Target: ${result.target}`,
      `Address: ${result.address}`,
      `Scope: ${result.scope}`,
      `Checked at: ${result.checkedAt}`,
      `Timeout: ${result.timeoutMs} ms`,
      '',
      ...result.ports.map((port) => `${port.port}/tcp\t${port.state}\t${port.latencyMs === null ? '-' : `${port.latencyMs} ms`}\t${port.service ?? '-'}${port.errorCode ? `\t${port.errorCode}` : ''}`),
      '',
      result.note,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      notify('success', L('The port report was copied to the clipboard.', 'تم نسخ تقرير المنافذ إلى الحافظة.'), L('Report copied', 'تم نسخ التقرير'))
    } catch {
      notify('error', L('The browser blocked clipboard access.', 'منع المتصفح الوصول إلى الحافظة.'), L('Could not copy', 'تعذر النسخ'))
    }
  }

  const run = async () => {
    if (!target.trim()) {
      setError(L('Enter a public hostname or IP address.', 'أدخل اسم مضيف عام أو عنوان IP.'))
      return
    }
    if (selected.length === 0) {
      setError(L('Select at least one port.', 'اختر منفذًا واحدًا على الأقل.'))
      return
    }
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const response = await checkPublicPorts(target.trim(), selected, { timeoutMs })
      setResult(response)
      const open = response.ports.filter((entry) => entry.state === 'open').length
      addRecord({
        tool: 'port',
        target: response.target,
        status: open > 0 ? 'success' : 'failure',
        summary: `${open}/${response.ports.length} TCP ports open`,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = describeError(caught, settings.language, L('The request failed.', 'تعذر تنفيذ الطلب.'))
      setError(message)
      addRecord({ tool: 'port', target: target.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Server className="h-4 w-4 text-primary" />{L('TCP port reachability', 'وصول منافذ TCP')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Manual ports up to eight per run. TCP only.', 'منافذ يدوية حتى ثمانية لكل تشغيل. TCP فقط.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('Hostname or IP', 'اسم المضيف أو IP')} htmlFor="port-target">
            <Input id="port-target" dir="ltr" className="force-ltr" placeholder="example.com" value={target} onChange={(event) => setTarget(event.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">{L('Common ports', 'منافذ شائعة')} <span className="text-subtle">({selected.length}/8)</span></p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PORT_OPTIONS.map((option) => {
                const checked = selected.includes(option.port)
                return (
                  <label key={option.port} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition-colors', checked ? 'border-primary/60 bg-primary/10 text-text' : 'border-line text-muted hover:border-line-strong')}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={checked} disabled={!checked && selected.length >= 8} onChange={() => toggle(option.port)} />
                    <span className="tabular-nums">{option.port}</span>
                    <span className="truncate text-subtle">{option.service}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <Field label={L('Manual port (1–65535)', 'منفذ يدوي (1–65535)')} htmlFor="port-manual">
            <div className="flex gap-2">
              <Input
                id="port-manual"
                dir="ltr"
                className="force-ltr"
                inputMode="numeric"
                placeholder="3389"
                value={manualPort}
                onChange={(event) => setManualPort(event.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addManualPort()
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addManualPort}>{L('Add', 'إضافة')}</Button>
            </div>
          </Field>
          <Field label={L('Timeout per port', 'المهلة لكل منفذ')} htmlFor="port-timeout">
            <Select id="port-timeout" value={String(timeoutMs)} onChange={(event) => setTimeoutMs(Number(event.target.value))}>
              <option value="1000">1 {L('second', 'ثانية')}</option>
              <option value="2400">2.4 {L('seconds', 'ثوانٍ')}</option>
              <option value="5000">5 {L('seconds', 'ثوانٍ')}</option>
              <option value="10000">10 {L('seconds', 'ثوانٍ')}</option>
            </Select>
          </Field>
          <Runner>
            <Button loading={busy} icon={<Server className="h-4 w-4" />} onClick={() => void run()}>{L('Check ports', 'فحص المنافذ')}</Button>
            <Button type="button" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={clear}>{L('Clear', 'مسح')}</Button>
          </Runner>
        </div>
        <p className="mt-3 text-[10px] text-subtle">{L('Private and loopback targets require NET_PROBE_ALLOW_PRIVATE on a local or self-hosted server. Only test systems you are authorized to check.', 'الأهداف الخاصة والعنوان المحلي تتطلب NET_PROBE_ALLOW_PRIVATE على خادم محلي أو مستضاف ذاتيًا. افحص فقط الأنظمة المصرّح لك بفحصها.')}</p>
      </section>
      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-40 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('Port check failed', 'فشل فحص المنافذ')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Server className="h-6 w-6" />} title={L('No port results yet', 'لا نتائج منافذ بعد')} description={L('Each port reports open, closed, filtered, timeout, or error. A filtered or timed-out result is inconclusive.', 'كل منفذ يعرض مفتوحًا أو مغلقًا أو مفلترًا أو مهلة أو خطأ. النتيجة المفلترة أو المنتهية بالمهلة غير حاسمة.')} /> : null}
        {!busy && result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted"><span dir="ltr">{result.target} → {result.address}</span></p>
              <div className="flex items-center gap-2">
                <Badge tone={result.scope === 'private' ? 'warning' : 'default'}>{result.scope}</Badge>
                <Button size="sm" variant="secondary" onClick={() => void copyReport()}>{L('Copy report', 'نسخ التقرير')}</Button>
              </div>
            </div>
            <p className="text-[10px] text-subtle">{L('Server-side TCP probe', 'فحص TCP من الخادم')} · {new Date(result.checkedAt).toLocaleString()} · {result.timeoutMs} ms</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {result.ports.map((port) => (
                <div key={port.port} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold" dir="ltr">{port.port}/tcp</span>
                    <Badge tone={port.state === 'open' ? 'success' : port.state === 'closed' ? 'default' : 'warning'}>{port.state}</Badge>
                  </div>
                  <p className="mt-1 text-[10px] text-subtle">{port.service ?? '—'} · {port.latencyMs === null ? '—' : `${port.latencyMs} ms`}</p>
                  {port.errorCode ? <p className="mt-1 font-mono text-[10px] text-subtle" dir="ltr">{port.errorCode}</p> : null}
                </div>
              ))}
            </div>
            <Alert tone="info">{result.note}</Alert>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function normalizeHttpInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (!parsed.hostname || parsed.hostname.includes(' ')) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function HttpPanel() {
  const { settings } = useApp()
  const { notify } = useToast()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState<'HEAD' | 'GET'>('HEAD')
  const [follow, setFollow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<HttpCheckResponse | null>(null)
  const [checkedAt, setCheckedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parts = (() => {
    if (!result) return null
    try {
      const parsed = new URL(result.finalUrl)
      return {
        protocol: parsed.protocol.replace(':', ''),
        host: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
        path: `${parsed.pathname}${parsed.search}${parsed.hash}` || '/',
      }
    } catch {
      return null
    }
  })()

  const copyReport = async () => {
    if (!result) return
    const lines = [
      'Adnan Tech URL report',
      `Requested: ${result.requestedUrl}`,
      `Final URL: ${result.finalUrl}`,
      `Status: ${result.status} ${result.statusText}`,
      `Method: ${result.method}`,
      `Latency: ${result.latencyMs} ms`,
      `Checked at: ${checkedAt ?? new Date().toISOString()}`,
      `Source: server-side probe`,
      `Content-Type: ${result.contentType ?? '-'}`,
      `Content-Length: ${result.contentLength === null ? '-' : result.contentLength}`,
      `TLS: ${result.tls ? `${result.tls.issuer} · ${result.tls.protocol ?? 'TLS'} · ${result.tls.daysRemaining} days` : result.tlsError ?? 'not applicable'}`,
      '',
      'Redirects:',
      ...(result.redirects.length === 0 ? ['none'] : result.redirects.map((hop) => `${hop.status} ${hop.url} -> ${hop.location}`)),
      '',
      'Headers:',
      ...Object.entries(result.headers).map(([key, value]) => `${key}: ${value}`),
      '',
      result.note,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      notify('success', L('The URL report was copied to the clipboard.', 'تم نسخ تقرير الرابط إلى الحافظة.'), L('Report copied', 'تم نسخ التقرير'))
    } catch {
      notify('error', L('The browser blocked clipboard access.', 'منع المتصفح الوصول إلى الحافظة.'), L('Could not copy', 'تعذر النسخ'))
    }
  }

  const run = async () => {
    const normalized = normalizeHttpInput(url)
    if (!normalized) {
      setError(L('Enter a valid http:// or https:// URL or hostname.', 'أدخل رابطًا صالحًا يبدأ بـ http:// أو https:// أو اسم مضيف.'))
      return
    }
    setUrl(normalized)
    setBusy(true)
    setError(null)
    setResult(null)
    setCheckedAt(null)
    const started = performance.now()
    try {
      const response = await checkHttpEndpoint(normalized, { method, followRedirects: follow, timeoutMs: 8000 })
      setResult(response)
      setCheckedAt(new Date().toISOString())
      addRecord({
        tool: 'http',
        target: response.finalUrl,
        status: response.status === 0 ? 'failure' : response.status >= 500 ? 'failure' : response.status >= 400 ? 'partial' : 'success',
        summary: `HTTP ${response.status} ${response.statusText}`.trim(),
        latencyMs: response.latencyMs,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = describeError(caught, settings.language, L('The request failed.', 'تعذر تنفيذ الطلب.'))
      setError(message)
      addRecord({ tool: 'http', target: normalized, status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Network className="h-4 w-4 text-primary" />{L('HTTP check', 'فحص HTTP')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Headers, redirect chain, and TLS summary. Page content is not downloaded. A bare hostname uses HTTPS.', 'الترويسات وسلسلة التحويل وملخص TLS. لا يُنزّل محتوى الصفحة. اسم المضيف وحده يستخدم HTTPS.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('URL or hostname', 'الرابط أو اسم المضيف')} htmlFor="http-url">
            <Input id="http-url" dir="ltr" className="force-ltr" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run() }} />
          </Field>
          <Field label={L('Method', 'الطريقة')} htmlFor="http-method">
            <Select id="http-method" value={method} onChange={(event) => setMethod(event.target.value as 'HEAD' | 'GET')}>
              <option value="HEAD">HEAD</option>
              <option value="GET">GET</option>
            </Select>
          </Field>
          <Checkbox label={L('Follow redirects (max 3)', 'اتبع التحويلات (3 كحد أقصى)')} checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          <Runner><Button loading={busy} icon={<Network className="h-4 w-4" />} onClick={() => void run()}>{L('Run URL check', 'تشغيل فحص الرابط')}</Button></Runner>
        </div>
      </section>
      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-48 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('HTTP check failed', 'فشل فحص HTTP')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Network className="h-6 w-6" />} title={L('Inspect a response', 'افحص استجابة')} description={L('Status, latency, redirects, and security headers appear here.', 'تظهر الحالة والزمن والتحويلات وترويسات الأمان هنا.')} /> : null}
        {!busy && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={result.status >= 200 && result.status < 400 ? 'success' : result.status >= 400 ? 'danger' : 'warning'}>{result.status} {result.statusText}</Badge>
                <span className="text-xs text-muted">{result.latencyMs} ms · {result.method} · {L('measured by server', 'قياس من الخادم')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void copyReport()}>{L('Copy report', 'نسخ التقرير')}</Button>
                <Button size="sm" variant="ghost" icon={<Globe2 className="h-3.5 w-3.5" />} onClick={() => window.open(result.finalUrl, '_blank', 'noopener,noreferrer')}>{L('Open link', 'فتح الرابط')}</Button>
              </div>
            </div>
            <p className="text-[10px] text-subtle">{L('Checked', 'تم الفحص')} {checkedAt ? new Date(checkedAt).toLocaleString() : '—'} · {L('source: server-side probe', 'المصدر: فحص من الخادم')}</p>
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
              <p className="break-all font-mono" dir="ltr">{result.finalUrl}</p>
              {result.requestedUrl !== result.finalUrl ? <p className="mt-1 break-all font-mono text-[10px] text-subtle" dir="ltr">{L('Requested', 'المطلوب')}: {result.requestedUrl}</p> : null}
              {parts ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] sm:grid-cols-4">
                  <div><dt className="text-subtle">{L('Scheme', 'المخطط')}</dt><dd className="font-mono" dir="ltr">{parts.protocol}</dd></div>
                  <div><dt className="text-subtle">{L('Host', 'المضيف')}</dt><dd className="truncate font-mono" dir="ltr">{parts.host}</dd></div>
                  <div><dt className="text-subtle">{L('Port', 'المنفذ')}</dt><dd className="font-mono" dir="ltr">{parts.port}</dd></div>
                  <div><dt className="text-subtle">{L('Path', 'المسار')}</dt><dd className="truncate font-mono" dir="ltr">{parts.path}</dd></div>
                </dl>
              ) : null}
              {result.contentType ? <p className="mt-1 text-subtle">{result.contentType}{result.contentLength === null ? '' : ` · ${result.contentLength} bytes`}</p> : null}
            </div>
            {result.redirects.length > 0 ? (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold">{L('Redirect chain', 'سلسلة التحويل')}</h3>
                <ol className="space-y-1">
                  {result.redirects.map((hop) => (
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
            <div>
              <h3 className="mb-1.5 text-xs font-semibold">{L('Response headers', 'ترويسات الاستجابة')}</h3>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-[11px]">
                  <tbody className="divide-y divide-line">
                    {Object.entries(result.headers).map(([key, value]) => (
                      <tr key={key}><td className="w-2/5 px-3 py-1.5 font-mono text-subtle">{key}</td><td className="break-all px-3 py-1.5 font-mono" dir="ltr">{value}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {result.tls ? <Alert tone="success" title={L('Certificate summary', 'ملخص الشهادة')}>{result.tls.issuer} · {result.tls.protocol ?? 'TLS'} · {result.tls.daysRemaining} {L('days remaining', 'يومًا متبقيًا')}</Alert> : null}
            {result.tlsError ? <Alert tone="warning" title={L('TLS check incomplete', 'فحص TLS غير مكتمل')}>{result.tlsError}</Alert> : null}
            <Alert tone="info">{result.note}</Alert>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function HistoryPanel({
  records,
  removeRecord,
  clearRecords,
  language,
  notify,
}: {
  records: ReturnType<typeof useDiagnostics>['records']
  removeRecord: (id: string) => void
  clearRecords: () => void
  language: 'en' | 'ar'
  notify: (tone: 'success' | 'error' | 'info', message: string) => void
}) {
  const L = (en: string, ar: string) => (language === 'ar' ? ar : en)
  const [tool, setTool] = useState('all')
  const [query, setQuery] = useState('')
  const filtered = records.filter((entry) => (tool === 'all' || entry.tool === tool) && entry.target.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <div className="nx-panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{L('Diagnostic history', 'سجل التشخيص')}</h2>
          <p className="text-xs text-subtle">{L('Stored on this device. Never uploaded automatically.', 'محفوظ على هذا الجهاز. لا يُرفع تلقائيًا.')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input aria-label={L('Filter target', 'تصفية الهدف')} placeholder={L('Filter target…', 'تصفية الهدف…')} value={query} onChange={(event) => setQuery(event.target.value)} className="w-40" />
          <Select aria-label={L('Filter tool', 'تصفية الأداة')} value={tool} onChange={(event) => setTool(event.target.value)} className="w-36">
            <option value="all">{L('All tools', 'كل الأدوات')}</option>
            {(['latency', 'path', 'dns', 'port', 'http', 'tls', 'url', 'file', 'log', 'speed'] as const).map((entry) => <option key={entry} value={entry}>{diagnosticToolLabel(entry)}</option>)}
          </Select>
          <Button
            variant="secondary"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => {
              if (records.length === 0) return
              if (!window.confirm(L('Clear all local diagnostic history?', 'مسح كل سجل التشخيص المحلي؟'))) return
              clearRecords()
              notify('success', L('History cleared', 'تم مسح السجل'))
            }}
          >
            {L('Clear', 'مسح')}
          </Button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <EmptyState className="mt-4" icon={<History className="h-6 w-6" />} title={L('Nothing matches', 'لا توجد نتائج مطابقة')} description={L('Run a diagnostic, or adjust the filters.', 'نفّذ تشخيصًا أو عدّل عوامل التصفية.')} />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="border-b border-line text-[10px] uppercase tracking-wider text-subtle">
              <tr><th className="px-2 py-2 text-start">{L('Tool', 'الأداة')}</th><th className="px-2 py-2 text-start">{L('Target', 'الهدف')}</th><th className="px-2 py-2 text-start">{L('Status', 'الحالة')}</th><th className="px-2 py-2 text-start">{L('Summary', 'الملخص')}</th><th className="px-2 py-2 text-start">{L('When', 'الوقت')}</th><th className="px-2 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-2 py-2 font-medium">{diagnosticToolLabel(entry.tool)}</td>
                  <td className="max-w-[180px] truncate px-2 py-2 font-mono text-[10px]" dir="ltr">{entry.target}</td>
                  <td className="px-2 py-2"><Badge tone={STATUS_TONE[entry.status]}>{statusLabel(entry.status, language)}</Badge></td>
                  <td className="max-w-[260px] truncate px-2 py-2 text-muted">{entry.summary}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-subtle">{new Date(entry.createdAt).toLocaleString(language === 'ar' ? 'ar' : 'en')}</td>
                  <td className="px-2 py-2 text-end"><button type="button" className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-danger" aria-label={L('Delete record', 'حذف السجل')} onClick={() => removeRecord(entry.id)}><XCircle className="h-3.5 w-3.5" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default NetworkDiagnosticsPage

