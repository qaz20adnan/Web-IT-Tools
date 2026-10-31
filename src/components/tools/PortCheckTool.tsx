import { useMemo, useState } from 'react'
import { Globe2, RadioTower, ShieldQuestion } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, Field, Input, Select, Spinner } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useDiagnostics } from '@/context/DiagnosticsContext'
import { checkPublicPorts, lookupDns, type PortCheckResponse, type PortProbeState } from '@/services/api'
import { describeError } from '@/services/apiError'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

/** Server-side limits in netlify/lib/schema.ts: at most 8 ports per request. */
const MAX_PORTS = 8

interface ServicePort {
  port: number
  label: string
}

const COMMON_PORTS: ServicePort[] = [
  { port: 21, label: 'FTP' },
  { port: 22, label: 'SSH' },
  { port: 25, label: 'SMTP' },
  { port: 53, label: 'DNS' },
  { port: 80, label: 'HTTP' },
  { port: 110, label: 'POP3' },
  { port: 143, label: 'IMAP' },
  { port: 443, label: 'HTTPS' },
  { port: 445, label: 'SMB' },
  { port: 993, label: 'IMAPS' },
  { port: 1433, label: 'MSSQL' },
  { port: 1723, label: 'PPTP' },
  { port: 3306, label: 'MySQL' },
  { port: 3389, label: 'RDP' },
  { port: 5000, label: 'UPnP' },
  { port: 5432, label: 'PostgreSQL' },
  { port: 5900, label: 'VNC' },
  { port: 6553, label: 'DDNS' },
  { port: 8080, label: 'HTTP-alt' },
  { port: 8443, label: 'HTTPS-alt' },
  { port: 25565, label: 'Minecraft' },
]

const STATE_TONES: Record<PortProbeState, 'success' | 'warning' | 'danger' | 'default'> = {
  open: 'success',
  filtered: 'warning',
  closed: 'default',
  timeout: 'warning',
  error: 'danger',
}

export function parsePortList(raw: string): number[] {
  return raw
    .split(/[\s,;]+/)
    .map((entry) => Number(entry))
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535)
}

export function PortCheckTool() {
  const L = useLabels()
  const { settings } = useApp()
  const { addRecord } = useDiagnostics()
  const [host, setHost] = useState('')
  const [selected, setSelected] = useState<number[]>([80, 443, 3389])
  const [custom, setCustom] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(2400)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PortCheckResponse | null>(null)
  const [resolved, setResolved] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const customPorts = useMemo(() => parsePortList(custom), [custom])
  const targets = useMemo(() => [...new Set([...selected, ...customPorts])].slice(0, MAX_PORTS), [selected, customPorts])
  const overflow = selected.length + customPorts.length > MAX_PORTS

  const toggle = (port: number) => {
    setSelected((current) => (current.includes(port) ? current.filter((entry) => entry !== port) : [...current, port]))
  }

  const run = async () => {
    const target = host.trim().replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    if (!target || targets.length === 0) {
      setError(L('Enter a hostname or IP and choose at least one port.', 'أدخل اسم مضيف أو IP واختر منفذًا واحدًا على الأقل.'))
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    setResolved(null)
    const started = performance.now()
    try {
      const [check, dns] = await Promise.all([
        checkPublicPorts(target, targets, { timeoutMs }),
        lookupDns(target, 'A')
          .then((answer) => answer.answers.map((entry) => entry.data))
          .catch(() => null),
      ])
      setResult(check)
      setResolved(dns && dns.length > 0 ? dns : null)
      const open = check.ports.filter((entry) => entry.state === 'open').length
      addRecord({
        tool: 'port',
        target: `${check.target}:${check.ports.map((entry) => entry.port).join(',')}`,
        status: open > 0 ? 'success' : check.ports.some((entry) => entry.state === 'error') ? 'error' : 'partial',
        summary: `${open}/${check.ports.length} ${L('open', 'مفتوح')} · ${check.address}`,
        durationMs: Math.round(performance.now() - started),
        location: 'server',
      })
    } catch (caught) {
      setError(describeError(caught, settings.language, L('Port check failed.', 'فشل فحص المنافذ.')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={L('Public Port & DDNS Reachability', 'فحص المنافذ وإمكانية الوصول عبر DDNS')}
        icon={<RadioTower className="h-4 w-4" />}
        subtitle={L(
          'Probes TCP ports from the server runtime and resolves the hostname, so you can confirm a DDNS name points at your link and which services are exposed.',
          'يفحص منافذ TCP من بيئة الخادم ويحل اسم المضيف، للتأكد من أن اسم DDNS يشير إلى ربطك وللتعرف على الخدمات المكشوفة.',
        )}
      />
      <div className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]">
          <Field label={L('DDNS hostname or IP', 'اسم DDNS أو IP')} htmlFor="port-host">
            <Input
              id="port-host"
              dir="ltr"
              placeholder="home.example-ddns.com"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void run()
              }}
            />
          </Field>
          <Field label={L('Timeout', 'المهلة')} htmlFor="port-timeout">
            <Select id="port-timeout" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))}>
              {[1000, 2400, 5000].map((value) => <option key={value} value={value}>{`${value / 1000} s`}</option>)}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button loading={busy} disabled={!host.trim() || targets.length === 0} icon={<RadioTower className="h-4 w-4" />} onClick={() => void run()}>
              {L('Check ports', 'فحص المنافذ')}
            </Button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
            {L('Common services', 'الخدمات الشائعة')} · {targets.length}/{MAX_PORTS}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {COMMON_PORTS.map((entry) => {
              const active = selected.includes(entry.port)
              const blocked = !active && targets.length >= MAX_PORTS
              return (
                <button
                  key={entry.port}
                  type="button"
                  disabled={blocked}
                  onClick={() => toggle(entry.port)}
                  aria-pressed={active}
                  className={`lift rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                    active ? 'border-primary/60 bg-primary/10 text-text' : 'border-line text-muted hover:border-primary/40'
                  } ${blocked ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <span dir="ltr">{entry.port}</span> <span className="text-subtle">{entry.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <Field label={L('Additional ports', 'منافذ إضافية')} htmlFor="port-custom">
          <Input
            id="port-custom"
            dir="ltr"
            placeholder="8081, 27017"
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void run()
            }}
          />
        </Field>
        {overflow ? (
          <p className="text-[10px] text-warning">{L(`Only the first ${MAX_PORTS} ports are probed per request.`, `يُفحص أول ${MAX_PORTS} منافذ فقط في كل طلب.`)}</p>
        ) : null}

        {busy ? <Spinner label={L('Probing from the server runtime…', 'جارٍ الفحص من بيئة الخادم…')} /> : null}
        {error ? <Alert tone="danger" title={L('Check failed', 'فشل الفحص')}>{error}</Alert> : null}

        {result ? (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="primary"><span dir="ltr">{result.address}</span></Badge>
              <span className="text-[10px] text-subtle">
                {L('Resolved from', 'تم حلّه من')} <span dir="ltr">{result.target}</span> · {result.scope} · {result.timeoutMs} ms
              </span>
            </div>
            {resolved && !resolved.includes(result.address) ? (
              <Alert tone="warning" title={L('DDNS may be stale', 'قد يكون سجل DDNS قديمًا')}>
                {L(
                  `The name resolves to ${resolved.join(', ')} while the probe used ${result.address}. Update the DDNS client or wait for the record TTL to expire.`,
                  `يُحل الاسم إلى ${resolved.join(', ')} بينما استخدم الفحص ${result.address}. حدّث عميل DDNS أو انتظر انتهاء صلاحية السجل.`,
                )}
              </Alert>
            ) : null}
            <ul className="stagger divide-y divide-line rounded-lg border border-line">
              {result.ports.map((entry) => (
                <li key={entry.port} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                  <span className="w-14 font-mono font-semibold" dir="ltr">{entry.port}</span>
                  <Badge tone={STATE_TONES[entry.state]}>{entry.state}</Badge>
                  <span className="text-[10px] text-subtle">{entry.service ?? '—'}</span>
                  <span className="ms-auto font-mono text-[10px] text-subtle" dir="ltr">
                    {entry.latencyMs === null ? '—' : `${entry.latencyMs} ms`}
                  </span>
                  {entry.errorCode ? <span className="text-[10px] text-danger" dir="ltr">{entry.errorCode}</span> : null}
                </li>
              ))}
            </ul>
            {result.ports.some((entry) => entry.state === 'open') ? (
              <Alert tone="warning" title={L('Exposed services', 'خدمات مكشوفة')}>
                {L(
                  'Every open port reachable from the internet is an entry point. Confirm each one is intended, patched and protected by credentials or a firewall.',
                  'كل منفذ مفتوح يمكن الوصول إليه من الإنترنت يمثل نقطة دخول. تأكد من أن كل واحد مقصود ومُرقّع ومحمي ببيانات اعتماد أو جدار حماية.',
                )}
              </Alert>
            ) : null}
            <p className="flex items-start gap-1.5 text-[10px] text-subtle">
              <ShieldQuestion className="mt-0.5 h-3 w-3 shrink-0" />
              {result.note}
            </p>
            <p className="flex items-start gap-1.5 text-[10px] text-subtle">
              <Globe2 className="mt-0.5 h-3 w-3 shrink-0" />
              {L(
                'A closed port can also mean a host firewall dropped the probe. Test from an external network, not from inside your LAN.',
                'قد يعني المنفذ المغلق أيضًا أن جدار حماية أسقط الطلب. اختبر من شبكة خارجية وليس من داخل شبكتك.',
              )}
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export default PortCheckTool
