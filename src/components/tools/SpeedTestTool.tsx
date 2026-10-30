import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, Gauge, ShieldAlert, Square, Upload, Wifi, Download } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Field, Select, Spinner } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useDiagnostics } from '@/context/DiagnosticsContext'
import {
  formatBytesShort,
  formatMbps,
  formatMs,
  runSpeedTest,
  SPEED_HOST,
  type SpeedPhase,
  type SpeedProgressEvent,
  type SpeedTestResult,
} from '@/lib/speedtest'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

const PHASE_ORDER: SpeedPhase[] = ['meta', 'latency', 'download', 'upload']

interface LiveState {
  phase: SpeedPhase
  mbps: number
  bytes: number
  ms: number
  attempt: number
  streaming: boolean
  sampleCount: number
}

export function SpeedTestTool() {
  const L = useLabels()
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const [samples, setSamples] = useState(5)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<SpeedTestResult | null>(null)
  const [live, setLive] = useState<LiveState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const start = async () => {
    if (running) return
    const abort = new AbortController()
    controller.current = abort
    setRunning(true)
    setError(null)
    setResult(null)
    setLive({ phase: 'meta', mbps: 0, bytes: 0, ms: 0, attempt: 0, streaming: false, sampleCount: 0 })
    const started = performance.now()
    try {
      const outcome = await runSpeedTest({
        signal: abort.signal,
        latencySamples: samples,
        onProgress: (event: SpeedProgressEvent) => {
          setLive({
            phase: event.phase,
            mbps: event.mbps,
            bytes: event.bytes,
            ms: event.ms,
            attempt: event.attempt,
            streaming: event.streaming,
            sampleCount: event.sampleCount ?? 0,
          })
        },
      })
      setResult(outcome)
      addRecord({
        tool: 'speed',
        target: outcome.host,
        status: outcome.aborted ? 'blocked' : outcome.ok ? (outcome.failures.length > 0 ? 'partial' : 'success') : 'error',
        summary: outcome.ok
          ? `${L('down', 'تنزيل')} ${formatMbps(outcome.download.mbps)} · ${L('up', 'رفع')} ${formatMbps(outcome.upload.mbps)} · ${L('ping', 'بنغ')} ${formatMs(outcome.latency.avg)}`
          : outcome.failures[0]?.message ?? L('No phase produced a reliable measurement.', 'لم ينتج أي طور قياسًا موثوقًا.'),
        latencyMs: outcome.latency.samples.length > 0 ? Math.round(outcome.latency.avg) : undefined,
        durationMs: Math.round(performance.now() - started),
        location: 'browser',
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : L('The speed test failed.', 'فشل فحص السرعة.'))
    } finally {
      setRunning(false)
      setLive(null)
      controller.current = null
    }
  }

  const stop = () => controller.current?.abort()

  const phaseLabel = (phase: SpeedPhase) =>
    phase === 'meta'
      ? L('Detecting exit', 'جارٍ اكتشاف العنوان')
      : phase === 'latency'
        ? L('Latency', 'زمن الاستجابة')
        : phase === 'download'
          ? L('Download', 'تنزيل')
          : L('Upload', 'رفع')

  const peakMbps = result
    ? Math.max(result.download.mbps, result.upload.mbps, 1)
    : Math.max(live?.mbps ?? 0, 1)

  return (
    <Card>
      <CardHeader
        title={L('Internet Speed Test', 'فحص سرعة الإنترنت')}
        icon={<Gauge className="h-4 w-4" />}
        subtitle={L(
          'Measured in your browser against the Cloudflare speed endpoint, the same approach as speedtest.net. Nothing is uploaded except test payload.',
          'يُقاس في متصفحك عبر نقطة قياس السرعة لدى كلاودفلير بنفس نهج speedtest.net. لا يُرفع سوى حمولة الاختبار.',
        )}
      />
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-40">
            <Field label={L('Latency probes', 'عينات الاستجابة')} htmlFor="speed-samples">
              <Select id="speed-samples" value={samples} onChange={(event) => setSamples(Number(event.target.value))} disabled={running}>
                {[3, 5, 10].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
          </div>
          {running ? (
            <Button variant="secondary" icon={<Square className="h-3.5 w-3.5" />} onClick={stop}>{L('Stop', 'إيقاف')}</Button>
          ) : (
            <Button icon={<Activity className="h-4 w-4" />} onClick={() => void start()}>{L('Run test', 'تشغيل الفحص')}</Button>
          )}
          {result && !running ? (
            <Button variant="ghost" onClick={() => setResult(null)}>{L('Clear', 'مسح')}</Button>
          ) : null}
        </div>

        {running || result ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {PHASE_ORDER.map((phase, index) => {
                const stage = running ? PHASE_ORDER.indexOf(live?.phase ?? 'meta') : PHASE_ORDER.length
                const state = index < stage ? 'done' : index === stage && running ? 'active' : 'idle'
                return (
                  <span
                    key={phase}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                      state === 'active'
                        ? 'border-primary/50 bg-primary/10 text-text'
                        : state === 'done'
                          ? 'border-success/40 bg-success/5 text-muted'
                          : 'border-line text-subtle'
                    }`}
                  >
                    {phaseLabel(phase)}
                  </span>
                )
              })}
            </div>
            {running ? (
              <div className="space-y-1.5">
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                    style={{ width: `${Math.min(100, ((live?.mbps ?? 0) / peakMbps) * 100)}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Spinner label={phaseLabel(live?.phase ?? 'meta')} />
                  <span className="font-mono text-sm font-semibold" dir="ltr">{formatMbps(live?.mbps ?? 0)}</span>
                  <span className="text-[10px] text-subtle" dir="ltr">{formatBytesShort(live?.bytes ?? 0)} · {formatMs(live?.ms ?? 0)}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? <Alert tone="danger" title={L('Test failed', 'فشل الفحص')}>{error}</Alert> : null}

        {result ? (
          <div className="space-y-3">
            {result.aborted ? <Alert tone="warning" title={L('Stopped early', 'توقف مبكر')}>{L('The test was aborted, so the figures below cover only the bytes moved before stopping.', 'أُوقف الفحص مبكرًا، لذا تعكس الأرقام أدناه الكمية المنقولة قبل الإيقاف فقط.')}</Alert> : null}
            <div className="stagger grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Metric
                label={L('Download', 'التنزيل')}
                value={formatMbps(result.download.mbps)}
                icon={<Download className="h-3.5 w-3.5" />}
                reliable={result.download.reliable}
                sub={`${formatBytesShort(result.download.bytes)} · ${formatMs(result.download.ms)}`}
                L={L}
              />
              <Metric
                label={L('Upload', 'الرفع')}
                value={formatMbps(result.upload.mbps)}
                icon={<Upload className="h-3.5 w-3.5" />}
                reliable={result.upload.reliable}
                sub={`${formatBytesShort(result.upload.bytes)} · ${formatMs(result.upload.ms)}`}
                L={L}
              />
              <Metric
                label={L('Ping', 'البنغ')}
                value={result.latency.samples.length > 0 ? formatMs(result.latency.avg) : '—'}
                icon={<Wifi className="h-3.5 w-3.5" />}
                reliable={result.latency.reliable}
                sub={`${result.latency.samples.length}/${result.latency.requested} ${L('replies', 'رد')}`}
                L={L}
              />
              <Metric
                label={L('Jitter', 'التذبذب')}
                value={result.latency.jitterReliable ? formatMs(result.latency.jitter) : '—'}
                icon={<Activity className="h-3.5 w-3.5" />}
                reliable={result.latency.jitterReliable}
                sub={`${L('min', 'أدنى')} ${formatMs(result.latency.min)}`}
                L={L}
              />
            </div>

            {result.client ? (
              <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                {[
                  [L('Your public IP', 'عنوانك العام'), result.client.ip],
                  [L('Provider', 'مزود الخدمة'), result.client.organization],
                  [L('ASN', 'رقم النظام المستقل'), result.client.asn],
                  [L('City', 'المدينة'), result.client.city],
                  [L('Country', 'الدولة'), result.client.country],
                  [L('Edge data centre', 'مركز البيانات'), result.client.colo],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <dt className="text-[10px] uppercase text-subtle">{label}</dt>
                    <dd className="mt-0.5 break-all font-mono" dir="ltr">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            {result.failures.length > 0 ? (
              <Alert tone="warning" title={L('Some phases failed', 'بعض الأطوار فشلت')}>
                <ul className="list-disc space-y-0.5 ps-4">
                  {result.failures.map((failure) => (
                    <li key={`${failure.phase}-${failure.message}`}>
                      <span className="font-medium">{phaseLabel(failure.phase)}</span> — {failure.message}
                    </li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <p className="flex items-start gap-1.5 text-[10px] text-subtle">
              <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {settings.language === 'ar'
                ? `تُقاس النتائج عبر ${SPEED_HOST} من جهازك، وتتأثر بالراوتر والكابل والضغط على الشبكة. القياسات القصيرة غير موثوقة.`
                : `Results are measured from your device against ${SPEED_HOST} and are affected by the local link, routing and contention. Short runs are marked unreliable.`}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

function Metric({
  label,
  value,
  sub,
  icon,
  reliable,
  L,
}: {
  label: string
  value: string
  sub: string
  icon: ReactNode
  reliable: boolean
  L: (en: string, ar: string) => string
}) {
  return (
    <div className="lift rounded-xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-1 font-mono text-xl font-semibold" dir="ltr">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <Badge tone={reliable ? 'success' : 'warning'}>{reliable ? L('reliable', 'موثوق') : L('low sample', 'عينة صغيرة')}</Badge>
        <span className="text-[10px] text-subtle" dir="ltr">{sub}</span>
      </div>
    </div>
  )
}

export default SpeedTestTool
