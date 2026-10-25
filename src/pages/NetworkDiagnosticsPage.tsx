import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Clock3,
  Globe2,
  History,
  Network,
  Radar,
  Route,
  Server,
  ShieldAlert,
  ShieldCheck,
  Trash2,
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
  ApiError,
  checkHttpEndpoint,
  checkPublicPorts,
  runPing,
  runTraceroute,
  type HttpCheckResponse,
  type PingResponse,
  type PortCheckResponse,
  type TracerouteResponse,
} from '@/services/api'
import { cn } from '@/lib/utils'

type DiagnosticTab = 'overview' | 'ping' | 'traceroute' | 'dns' | 'ports' | 'http' | 'ssl' | 'history'

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

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail ? `${error.message} ${error.detail}` : error.message
  return error instanceof Error ? error.message : 'The request failed.'
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
  const [tab, setTab] = useState<DiagnosticTab>('overview')
  const analytics = useMemo(() => buildDiagnosticAnalytics(records), [records])

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
            <Button icon={<Wifi className="h-4 w-4" />} onClick={() => setTab('ping')}>
              {L('Start with ping', 'ابدأ بالبنغ')}
            </Button>
            <Button variant="secondary" icon={<Route className="h-4 w-4" />} onClick={() => setTab('traceroute')}>
              {L('Trace a route', 'تتبع المسار')}
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
        <Tab id="ping" icon={<Wifi className="h-3.5 w-3.5" />}>Ping</Tab>
        <Tab id="traceroute" icon={<Route className="h-3.5 w-3.5" />}>Traceroute</Tab>
        <Tab id="dns" icon={<Globe2 className="h-3.5 w-3.5" />}>DNS</Tab>
        <Tab id="ports" icon={<Server className="h-3.5 w-3.5" />}>{L('Ports', 'المنافذ')}</Tab>
        <Tab id="http" icon={<Network className="h-3.5 w-3.5" />}>HTTP</Tab>
        <Tab id="ssl" icon={<ShieldCheck className="h-3.5 w-3.5" />}>SSL</Tab>
        <Tab id="history" icon={<History className="h-3.5 w-3.5" />}>{L('History', 'السجل')}</Tab>
      </Tabs>

      {tab === 'overview' ? <OverviewPanel /> : null}
      {tab === 'ping' ? <PingPanel /> : null}
      {tab === 'traceroute' ? <TraceroutePanel /> : null}
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
            label={L('Average ping', 'متوسط البنغ')}
            value={analytics.avgPingMs === null ? '—' : `${analytics.avgPingMs} ms`}
            hint={L('Successful ping replies only', 'ردود البنغ الناجحة فقط')}
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
                description={L('Run a ping or an HTTP check to build real history.', 'نفّذ بنغ أو فحص HTTP لبناء سجل حقيقي.')}
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
              <p className="flex gap-2"><Server className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{L('Ping, traceroute, ports, HTTP, SSL, and URL checks are executed by the serverless runtime, not the browser.', 'تُنفّذ فحوص البنغ والتتبع والمنافذ وHTTP وSSL والروابط من بيئة الخادم، وليس من المتصفح.')}</p>
              <p className="flex gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{L('A blocked ICMP reply does not prove the service is down. A TCP timeout does not prove the host is offline.', 'حجب ICMP لا يثبت تعطل الخدمة، ومهلة TCP لا تثبت أن المضيف متوقف.')}</p>
              <p className="flex gap-2"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />{L('No external reputation provider is configured, so URL analysis never claims a link is safe.', 'لا يوجد مزوّد سمعة خارجي مُهيّأ، لذلك لا يدّعي تحليل الروابط أن الرابط آمن.')}</p>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

function PingPanel() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [target, setTarget] = useState('')
  const [count, setCount] = useState(4)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PingResponse | null>(null)
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
      const response = await runPing(target.trim(), count, 1500)
      setResult(response)
      const received = response.summary.received
      addRecord({
        tool: 'ping',
        target: response.target,
        status: !response.available ? 'blocked' : received === 0 ? 'failure' : response.summary.lossPercent > 0 ? 'partial' : 'success',
        summary: response.available
          ? `${received}/${response.summary.sent} replies · ${response.summary.lossPercent}% loss${response.summary.avgMs === null ? '' : ` · avg ${response.summary.avgMs} ms`}`
          : response.note,
        latencyMs: response.summary.avgMs ?? undefined,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      addRecord({ tool: 'ping', target: target.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Wifi className="h-4 w-4 text-primary" />{L('Ping', 'البنغ')}</h2>
        <p className="mt-1 text-xs text-muted">{L('ICMP echo from the server runtime to a public target.', 'صدى ICMP من بيئة الخادم إلى هدف عام.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('Hostname or IP', 'اسم المضيف أو IP')} htmlFor="ping-target">
            <Input id="ping-target" dir="ltr" className="force-ltr" placeholder="example.com" value={target} onChange={(event) => setTarget(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run() }} />
          </Field>
          <Field label={L('Echo requests', 'عدد الطلبات')} htmlFor="ping-count">
            <Select id="ping-count" value={count} onChange={(event) => setCount(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Runner>
            <Button loading={busy} icon={<Wifi className="h-4 w-4" />} onClick={() => void run()}>{L('Run ping', 'تشغيل البنغ')}</Button>
            {result ? <Button variant="ghost" onClick={() => { setResult(null); setError(null) }}>{L('Clear', 'مسح')}</Button> : null}
          </Runner>
        </div>
        <p className="mt-3 text-[10px] text-subtle">{L('The server runtime may block ICMP. In that case the tool reports unsupported instead of inventing a latency.', 'قد تحجب بيئة الخادم ICMP. حينها تُبلغ الأداة بعدم الدعم بدلًا من اختراع زمن استجابة.')}</p>
      </section>

      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-48 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('Ping failed', 'فشل البنغ')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Wifi className="h-6 w-6" />} title={L('Ready when you are', 'جاهز عندما تبدأ')} description={L('Results will show measured latency, loss, and replies.', 'ستعرض النتائج زمن الاستجابة المقس وفقد الحزم والردود.')} /> : null}
        {!busy && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={!result.available ? 'warning' : result.summary.received === 0 ? 'danger' : result.summary.lossPercent > 0 ? 'warning' : 'success'}>
                {!result.available ? L('Unavailable', 'غير متاح') : result.summary.received === 0 ? L('No replies', 'لا ردود') : L('Completed', 'اكتمل')}
              </Badge>
              <span className="text-xs text-muted">{result.target} → {result.address}</span>
              <Badge tone="default">{L('Server probe', 'فحص من الخادم')}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label={L('Received', 'المستلم')} value={`${result.summary.received}/${result.summary.sent}`} />
              <Metric label={L('Loss', 'الفقد')} value={`${result.summary.lossPercent}%`} />
              <Metric label={L('Average', 'المتوسط')} value={result.summary.avgMs === null ? '—' : `${result.summary.avgMs} ms`} />
              <Metric label={L('Range', 'المدى')} value={result.summary.minMs === null ? '—' : `${result.summary.minMs}–${result.summary.maxMs} ms`} />
            </div>
            {result.replies.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-start text-[10px] uppercase tracking-wider text-subtle">
                    <tr><th className="px-3 py-2 text-start">#</th><th className="px-3 py-2 text-start">{L('Status', 'الحالة')}</th><th className="px-3 py-2 text-start">{L('Latency', 'الزمن')}</th><th className="px-3 py-2 text-start">TTL</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {result.replies.map((reply) => (
                      <tr key={reply.sequence}>
                        <td className="px-3 py-1.5 text-subtle">{reply.sequence}</td>
                        <td className="px-3 py-1.5">{reply.status === 'success' ? <span className="text-success">{L('Reply', 'رد')}</span> : <span className="text-warning">{reply.status}</span>}</td>
                        <td className="px-3 py-1.5 tabular-nums">{reply.latencyMs === null ? '—' : `${reply.latencyMs} ms`}</td>
                        <td className="px-3 py-1.5 tabular-nums">{reply.ttl ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <Alert tone="info">{result.note}</Alert>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function TraceroutePanel() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [target, setTarget] = useState('')
  const [maxHops, setMaxHops] = useState(15)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<TracerouteResponse | null>(null)
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
      const response = await runTraceroute(target.trim(), maxHops, 1500)
      setResult(response)
      addRecord({
        tool: 'traceroute',
        target: response.target,
        status: !response.available ? 'blocked' : response.hops.length === 0 ? 'failure' : response.reached ? 'success' : 'partial',
        summary: response.available ? `${response.totalHops} hops${response.reached ? ' · destination reached' : ' · destination not confirmed'}` : response.note,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      addRecord({ tool: 'traceroute', target: target.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Route className="h-4 w-4 text-primary" />Traceroute</h2>
        <p className="mt-1 text-xs text-muted">{L('ICMP/UDP path discovery from the server runtime.', 'اكتشاف المسار عبر ICMP/UDP من بيئة الخادم.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('Hostname or IP', 'اسم المضيف أو IP')} htmlFor="trace-target">
            <Input id="trace-target" dir="ltr" className="force-ltr" placeholder="example.com" value={target} onChange={(event) => setTarget(event.target.value)} />
          </Field>
          <Field label={L('Maximum hops', 'أقصى عدد قفزات')} htmlFor="trace-hops">
            <Select id="trace-hops" value={maxHops} onChange={(event) => setMaxHops(Number(event.target.value))}>
              {[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Runner><Button loading={busy} icon={<Route className="h-4 w-4" />} onClick={() => void run()}>{L('Trace route', 'تتبع المسار')}</Button></Runner>
        </div>
      </section>
      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-48 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('Traceroute failed', 'فشل التتبع')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Route className="h-6 w-6" />} title={L('Discover the path', 'اكتشف المسار')} description={L('Hop latency and gaps appear here, with honest timeouts.', 'يظهر زمن القفزات والفواصل هنا مع مهلات صريحة.')} /> : null}
        {!busy && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={!result.available ? 'warning' : result.reached ? 'success' : 'warning'}>{result.available ? (result.reached ? L('Destination reached', 'وصل إلى الهدف') : L('Destination not confirmed', 'لم يتأكد الوصول')) : L('Unavailable', 'غير متاح')}</Badge>
              <span className="text-xs text-muted">{result.target} → {result.address}</span>
            </div>
            <ol className="nx-hop-list space-y-1">
              {result.hops.map((hop) => (
                <li key={hop.hop} className={cn('nx-hop', hop.address === result.address && 'nx-hop-end')}>
                  <span className="nx-hop-index">{hop.hop}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">{hop.address ?? (hop.timedOut ? '* * *' : '—')}</span>
                  <span className="text-[10px] tabular-nums text-subtle" dir="ltr">{hop.probes.map((value) => (value === null ? '*' : `${value}ms`)).join(' / ')}</span>
                </li>
              ))}
            </ol>
            <Alert tone="info">{result.note}</Alert>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function PortsPanel() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [target, setTarget] = useState('')
  const [selected, setSelected] = useState<number[]>([443])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PortCheckResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggle = (port: number) => {
    setSelected((current) => current.includes(port) ? current.filter((entry) => entry !== port) : current.length >= 4 ? current : [...current, port])
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
      const response = await checkPublicPorts(target.trim(), selected)
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
      const message = errorMessage(caught)
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
        <p className="mt-1 text-xs text-muted">{L('Allowlisted ports only, maximum four per run.', 'منافذ مسموحة فقط، أربعة كحد أقصى لكل تشغيل.')}</p>
        <div className="mt-4 space-y-3">
          <Field label={L('Hostname or IP', 'اسم المضيف أو IP')} htmlFor="port-target">
            <Input id="port-target" dir="ltr" className="force-ltr" placeholder="example.com" value={target} onChange={(event) => setTarget(event.target.value)} />
          </Field>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">{L('Ports', 'المنافذ')} <span className="text-subtle">({selected.length}/4)</span></p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PORT_OPTIONS.map((option) => {
                const checked = selected.includes(option.port)
                return (
                  <label key={option.port} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] transition-colors', checked ? 'border-primary/60 bg-primary/10 text-text' : 'border-line text-muted hover:border-line-strong')}>
                    <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={checked} disabled={!checked && selected.length >= 4} onChange={() => toggle(option.port)} />
                    <span className="tabular-nums">{option.port}</span>
                    <span className="truncate text-subtle">{option.service}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <Runner><Button loading={busy} icon={<Server className="h-4 w-4" />} onClick={() => void run()}>{L('Check ports', 'فحص المنافذ')}</Button></Runner>
        </div>
        <p className="mt-3 text-[10px] text-subtle">{L('RDP scanning can be intrusive. Use it only on systems you are authorized to test.', 'فحص RDP قد يكون تدخليًا. استخدمه فقط على أنظمة مصرّح لك بفحصها.')}</p>
      </section>
      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-40 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('Port check failed', 'فشل فحص المنافذ')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Server className="h-6 w-6" />} title={L('No port results yet', 'لا نتائج منافذ بعد')} description={L('Each port reports open, closed, filtered, or timeout.', 'كل منفذ يعرض مفتوحًا أو مغلقًا أو مفلترًا أو مهلة.')} /> : null}
        {!busy && result ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">{result.target} → {result.address}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {result.ports.map((port) => (
                <div key={port.port} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-bold" dir="ltr">{port.port}</span>
                    <Badge tone={port.state === 'open' ? 'success' : port.state === 'closed' ? 'default' : 'warning'}>{port.state}</Badge>
                  </div>
                  <p className="mt-1 text-[10px] text-subtle">{port.service ?? '—'} · {port.latencyMs === null ? '—' : `${port.latencyMs} ms`}</p>
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

function HttpPanel() {
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState<'HEAD' | 'GET'>('HEAD')
  const [follow, setFollow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<HttpCheckResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (!url.trim()) {
      setError(L('Enter a public http:// or https:// URL.', 'أدخل رابطًا عامًا يبدأ بـ http:// أو https://.'))
      return
    }
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const response = await checkHttpEndpoint(url.trim(), { method, followRedirects: follow, timeoutMs: 8000 })
      setResult(response)
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
      const message = errorMessage(caught)
      setError(message)
      addRecord({ tool: 'http', target: url.trim(), status: 'error', summary: message, durationMs: Math.round(performance.now() - started), location: 'server' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
      <section className="nx-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Network className="h-4 w-4 text-primary" />{L('HTTP check', 'فحص HTTP')}</h2>
        <p className="mt-1 text-xs text-muted">{L('Headers, redirect chain, and TLS summary. Page content is not downloaded.', 'الترويسات وسلسلة التحويل وملخص TLS. لا يُنزّل محتوى الصفحة.')}</p>
        <div className="mt-4 space-y-3">
          <Field label="URL" htmlFor="http-url">
            <Input id="http-url" dir="ltr" className="force-ltr" placeholder="https://example.com" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void run() }} />
          </Field>
          <Field label={L('Method', 'الطريقة')} htmlFor="http-method">
            <Select id="http-method" value={method} onChange={(event) => setMethod(event.target.value as 'HEAD' | 'GET')}>
              <option value="HEAD">HEAD</option>
              <option value="GET">GET</option>
            </Select>
          </Field>
          <Checkbox label={L('Follow redirects (max 3)', 'اتبع التحويلات (3 كحد أقصى)')} checked={follow} onChange={(event) => setFollow(event.target.checked)} />
          <Runner><Button loading={busy} icon={<Network className="h-4 w-4" />} onClick={() => void run()}>{L('Run HTTP check', 'تشغيل فحص HTTP')}</Button></Runner>
        </div>
      </section>
      <section className="nx-panel p-4">
        {busy ? <Skeleton className="h-48 w-full" /> : null}
        {!busy && error ? <Alert tone="danger" title={L('HTTP check failed', 'فشل فحص HTTP')}>{error}</Alert> : null}
        {!busy && !error && !result ? <EmptyState icon={<Network className="h-6 w-6" />} title={L('Inspect a response', 'افحص استجابة')} description={L('Status, latency, redirects, and security headers appear here.', 'تظهر الحالة والزمن والتحويلات وترويسات الأمان هنا.')} /> : null}
        {!busy && result ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={result.status >= 200 && result.status < 400 ? 'success' : result.status >= 400 ? 'danger' : 'warning'}>{result.status} {result.statusText}</Badge>
              <span className="text-xs text-muted">{result.latencyMs} ms · {result.method} · {L('measured by server', 'قياس من الخادم')}</span>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
              <p className="break-all font-mono" dir="ltr">{result.finalUrl}</p>
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
            {['ping', 'traceroute', 'port', 'http', 'url', 'file', 'log'].map((entry) => <option key={entry} value={entry}>{diagnosticToolLabel(entry as never)}</option>)}
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

