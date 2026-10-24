import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  Copy,
  Download,
  Globe2,
  History,
  Network,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CodeBlock,
  Field,
  Input,
  Spinner,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { analyzeNetwork, ApiError, type NetworkAnalyzerResponse, type PortProbeInfo } from '@/services/api'
import { downloadTextFile } from '@/lib/utils'
import { readJson, STORAGE_KEYS, writeJson } from '@/lib/storage'
import { formatDateTime } from '@/i18n'

const DEFAULT_PORTS = [80, 443, 22, 3389, 8080, 8443]
const HIGH_RISK_PORTS = new Set([21, 23, 445, 1433, 3306, 3389, 5432, 5900, 6379])
const MAX_HISTORY = 20

interface IpSnapshot {
  checkedAt: string
  ipv4: string | null
  ipv6: string | null
}

const LOCAL_OWNERSHIP = `$listeners = Get-NetTCPConnection -State Listen
$listeners |
  Sort-Object LocalPort |
  Select-Object LocalAddress, LocalPort, OwningProcess,
    @{n='Process';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}

# Detect duplicate port ownership (possible conflict)
$listeners | Group-Object LocalPort | ForEach-Object {
  $owners = @($_.Group.OwningProcess | Sort-Object -Unique)
  if ($owners.Count -gt 1) {
    Write-Host "CONFLICT: port $($_.Name) is bound by processes $($owners -join ', ')"
  }
}

# Identify a single port (replace 8080)
netstat -ano | findstr :8080
Get-Process -Id (Get-NetTCPConnection -LocalPort 8080 -State Listen).OwningProcess`

function parsePorts(value: string): number[] {
  const entries = value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
  const ports = [...new Set(entries.map(Number))]
  if (ports.length === 0 || ports.length > 12) throw new Error('ports-count')
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('ports-invalid')
  return ports
}

function toneForPort(entry: PortProbeInfo): 'success' | 'danger' | 'warning' | 'default' {
  if (entry.state === 'open') return HIGH_RISK_PORTS.has(entry.port) ? 'danger' : 'success'
  if (entry.state === 'timeout' || entry.state === 'filtered') return 'warning'
  return 'default'
}

function riskTone(level: 'low' | 'medium' | 'high'): 'success' | 'warning' | 'danger' {
  return level === 'high' ? 'danger' : level === 'medium' ? 'warning' : 'success'
}

export function DdnsPortAnalyzer() {
  const { settings } = useApp()
  const { notify } = useToast()
  const navigate = useNavigate()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const riskLabel = (level: 'low' | 'medium' | 'high') =>
    level === 'high' ? L('high', 'مرتفع') : level === 'medium' ? L('medium', 'متوسط') : L('low', 'منخفض')
  const likelihoodLabel = (level: 'low' | 'medium' | 'high') =>
    level === 'high' ? L('high', 'مرتفع') : level === 'medium' ? L('medium', 'متوسط') : L('low', 'منخفض')
  const stateLabel = (state: PortProbeInfo['state']) => {
    const labels: Record<PortProbeInfo['state'], [string, string]> = {
      open: ['open', 'مفتوح'],
      closed: ['closed', 'مغلق'],
      filtered: ['filtered', 'مفلتر'],
      timeout: ['timeout', 'مهلة'],
      error: ['error', 'خطأ'],
    }
    return L(labels[state][0], labels[state][1])
  }
  const [ddns, setDdns] = useState('')
  const [target, setTarget] = useState('')
  const [portsText, setPortsText] = useState(DEFAULT_PORTS.join(', '))
  const [result, setResult] = useState<NetworkAnalyzerResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<IpSnapshot[]>(() => {
    const saved = readJson<unknown>(STORAGE_KEYS.netIpHistory, [])
    return Array.isArray(saved) ? saved.filter((item): item is IpSnapshot => Boolean(item && typeof item === 'object' && typeof (item as IpSnapshot).checkedAt === 'string')).slice(0, MAX_HISTORY) : []
  })
  const [previous, setPrevious] = useState<IpSnapshot | null>(null)
  const formatSnapshot = (snapshot: IpSnapshot) => [snapshot.ipv4, snapshot.ipv6].filter(Boolean).join(' / ') || '—'
  const ipChanged = Boolean(
    previous &&
      result &&
      (previous.ipv4 !== result.publicIp.ipv4 || previous.ipv6 !== result.publicIp.ipv6),
  )

  const run = async () => {
    let ports: number[]
    try {
      ports = parsePorts(portsText)
    } catch (caught) {
      setError(
        (caught as Error).message === 'ports-count'
          ? L('Enter between 1 and 12 ports.', 'أدخل من 1 إلى 12 منفذاً.')
          : L('Ports must be whole numbers from 1 to 65535.', 'يجب أن تكون المنافذ أرقاماً صحيحة من 1 إلى 65535.'),
      )
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const response = await analyzeNetwork({
        ...(target.trim() ? { host: target.trim() } : {}),
        ...(ddns.trim() ? { ddns: ddns.trim() } : {}),
        ports,
        lang: settings.language,
      })
      setResult(response)
      const snapshot: IpSnapshot = {
        checkedAt: response.checkedAt,
        ipv4: response.publicIp.ipv4,
        ipv6: response.publicIp.ipv6,
      }
      setPrevious(history[0] ?? null)
      const nextHistory = [snapshot, ...history].slice(0, MAX_HISTORY)
      setHistory(nextHistory)
      writeJson(STORAGE_KEYS.netIpHistory, nextHistory)
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(
          caught.code === 'blocked_host'
            ? L(
                'Only your current public IP can be analyzed. Use the detected IP or a DDNS hostname that resolves to it.',
                'يمكن تحليل عنوان IP العام الحالي فقط. استخدم العنوان المكتشف أو اسم DDNS يشير إليه.',
              )
            : caught.message,
        )
      } else {
        setError(L('The network analysis failed.', 'فشل تحليل الشبكة.'))
      }
    } finally {
      setLoading(false)
    }
  }

  const copyReport = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.report.markdown)
      notify('success', L('Report copied.', 'تم نسخ التقرير.'))
    } catch {
      notify('error', L('Could not copy the report.', 'تعذر نسخ التقرير.'))
    }
  }

  const downloadReport = () => {
    if (!result) return
    const stamp = result.checkedAt.replace(/[:.]/g, '-').slice(0, 19)
    downloadTextFile(`nexora-ddns-port-report-${stamp}.md`, result.report.markdown, 'text/markdown;charset=utf-8')
  }

  const saveToKnowledgeBase = () => {
    if (!result) return
    const problem = [
      result.report.summary,
      previous ? `Previous public IP: ${formatSnapshot(previous)} (${previous.checkedAt})` : '',
      `Public IP: ${result.publicIp.ipv4 ?? result.publicIp.ipv6 ?? 'unknown'}`,
      result.ddns ? `DDNS ${result.ddns.host}: ${[...result.ddns.ipv4, ...result.ddns.ipv6].join(', ') || result.ddns.error || 'no records'}` : '',
      `Open ports: ${result.ports.filter((entry) => entry.state === 'open').map((entry) => entry.port).join(', ') || 'none'}`,
      `Causes:\n- ${result.report.causes.map((cause) => `${cause.title}: ${cause.explanation}`).join('\n- ')}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    navigate('/kb', {
      state: {
        draft: {
          title: `DDNS & port analysis — ${result.target.host}`,
          problem,
          solution: result.report.recommendations.map((item) => `- ${item}`).join('\n'),
          category: 'networking',
          tags: ['ddns', 'ports', 'public-ip'],
          source: 'tool',
        },
      },
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('DDNS & Port Analyzer', 'محلل DDNS والمنافذ')}
          icon={<Globe2 className="h-4 w-4" />}
          subtitle={L(
            'Detect the public IP, compare DDNS records, probe selected TCP ports and generate an evidence-based report.',
            'اكشف عنوان IP العام، وقارن سجلات DDNS، وافحص منافذ TCP المحددة، وأنشئ تقريراً مبنياً على الأدلة.',
          )}
        />
        <div className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L('DDNS hostname (optional)', 'اسم مضيف DDNS (اختياري)')} htmlFor="ddns-host" hint={L('Example: home.example.com', 'مثال: home.example.com')}>
              <Input
                id="ddns-host"
                value={ddns}
                onChange={(event) => setDdns(event.target.value)}
                placeholder="home.example.com"
                dir="ltr"
              />
            </Field>
            <Field
              label={L('Target (optional)', 'الهدف (اختياري)')}
              htmlFor="ddns-target"
              hint={L('Leave empty to use the detected public IP. Custom targets must resolve to it.', 'اتركه فارغاً لاستخدام IP العام المكتشف. يجب أن يشير الهدف المخصص إليه.')}
            >
              <Input
                id="ddns-target"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={L('auto-detect', 'كشف تلقائي')}
                dir="ltr"
              />
            </Field>
          </div>
          <Field
            label={L('TCP ports', 'منافذ TCP')}
            htmlFor="ddns-ports"
            hint={L('Comma or space separated, maximum 12. Default: 80, 443, 22, 3389, 8080, 8443.', 'مفصولة بفواصل أو مسافات، بحد أقصى 12. الافتراضي: 80، 443، 22، 3389، 8080، 8443.')}
          >
            <Input id="ddns-ports" value={portsText} onChange={(event) => setPortsText(event.target.value)} dir="ltr" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void run()} loading={loading} icon={<ScanSearch className="h-4 w-4" />}>
              {L('Analyze network', 'تحليل الشبكة')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDdns('')
                setTarget('')
                setPortsText(DEFAULT_PORTS.join(', '))
                setResult(null)
                setError(null)
              }}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              {L('Reset', 'إعادة ضبط')}
            </Button>
          </div>
          <Alert tone="info">
            {L(
              'The probe runs from the NEXORA deployment, not from your modem. It can confirm whether a port is reachable from the public internet, but it cannot see the local process that owns a port.',
              'يعمل الفحص من نشر NEXORA وليس من موديمك. يمكنه تأكيد وصول المنفذ من الإنترنت العام، لكنه لا يرى العملية المحلية المالكة للمنفذ.',
            )}
          </Alert>
          {loading ? <Spinner label={L('Detecting public IP and probing ports…', 'جارٍ كشف IP العام وفحص المنافذ…')} /> : null}
          {error ? <Alert tone="danger" title={L('Analysis failed', 'فشل التحليل')}>{error}</Alert> : null}
        </div>
      </Card>

      {result ? (
        <>
          <Card>
            <CardHeader
              title={L('Current snapshot', 'اللقطة الحالية')}
              icon={<Network className="h-4 w-4" />}
              subtitle={`${formatDateTime(result.checkedAt, settings.language)} · ${result.publicIp.source}`}
              actions={
                <Badge tone={riskTone(result.report.riskLevel)}>
                  {L('Risk', 'الخطورة')}: {riskLabel(result.report.riskLevel)}
                </Badge>
              }
            />
            <div className="space-y-3 p-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {result.report.observations.map((observation) => (
                  <div key={observation.label} className="rounded-lg border border-line bg-surface-2 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-subtle">{observation.label}</p>
                    <p className="mt-1 break-all text-sm font-semibold" dir="ltr">{observation.value}</p>
                  </div>
                ))}
              </div>
              {previous ? (
                <Alert
                  tone={ipChanged ? 'warning' : 'success'}
                  title={ipChanged ? L('Public IP changed since the last check', 'تغيّر عنوان IP العام منذ آخر فحص') : L('No public IP change since the last check', 'لا تغيير في عنوان IP العام منذ آخر فحص')}
                >
                  {ipChanged
                    ? `${formatSnapshot(previous)} → ${formatSnapshot({ checkedAt: result.checkedAt, ipv4: result.publicIp.ipv4, ipv6: result.publicIp.ipv6 })} (${formatDateTime(previous.checkedAt, settings.language)})`
                    : L(
                        `Previous check: ${formatDateTime(previous.checkedAt, settings.language)}.`,
                        `الفحص السابق: ${formatDateTime(previous.checkedAt, settings.language)}.`,
                      )}
                </Alert>
              ) : (
                <Alert tone="info">
                  {L(
                    'This is the first saved check on this browser. The next analysis will compare against it.',
                    'هذا أول فحص محفوظ في هذا المتصفح. سيقارن التحليل التالي به.',
                  )}
                </Alert>
              )}
              <div className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={riskTone(result.report.riskLevel)}>
                    {result.report.headline}
                  </Badge>
                  {result.ddns ? <Badge>{result.ddns.host}</Badge> : null}
                  <Badge>{result.target.address}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted">{result.report.summary}</p>
              </div>
              <div className="overflow-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="bg-surface-2 text-subtle">
                    <tr>
                      <th className="p-2 text-start">{L('Port', 'المنفذ')}</th>
                      <th className="p-2 text-start">{L('State', 'الحالة')}</th>
                      <th className="p-2 text-start">{L('Service', 'الخدمة')}</th>
                      <th className="p-2 text-start">{L('Latency', 'الزمن')}</th>
                      <th className="p-2 text-start">{L('Evidence', 'الدليل')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.ports.map((entry) => (
                      <tr key={entry.port} className="border-t border-line">
                        <td className="p-2 font-mono" dir="ltr">{entry.port}</td>
                        <td className="p-2">
                          <Badge tone={toneForPort(entry)}>{stateLabel(entry.state)}</Badge>
                        </td>
                        <td className="p-2">{entry.service ?? '—'}</td>
                        <td className="p-2 font-mono">{entry.latencyMs === null ? '—' : `${entry.latencyMs} ms`}</td>
                        <td className="max-w-[18rem] break-all p-2 font-mono text-[10px] text-subtle" dir="ltr">
                          {entry.banner ?? entry.errorCode ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={L('Public IP history', 'سجل عنوان IP العام')}
              icon={<History className="h-4 w-4" />}
              subtitle={L('Stored locally in this browser, newest first.', 'محفوظ محلياً في هذا المتصفح، الأحدث أولاً.')}
              actions={<Badge>{history.length}</Badge>}
            />
            <div className="max-h-52 overflow-auto p-4">
              <div className="space-y-1.5">
                {history.map((snapshot, index) => (
                  <div key={`${snapshot.checkedAt}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-xs">
                    <span className="text-subtle">{formatDateTime(snapshot.checkedAt, settings.language)}</span>
                    <span className="font-mono" dir="ltr">{formatSnapshot(snapshot)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={L('Why the IP may have changed', 'أسباب محتملة لتغير عنوان IP')}
              icon={<AlertTriangle className="h-4 w-4" />}
              subtitle={L('Ranked hypotheses from the collected evidence. A single snapshot cannot prove the exact cause.', 'فرضيات مرتبة حسب الأدلة المجمعة. لقطة واحدة لا تثبت السبب الدقيق.')}
              actions={
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={downloadReport}>
                    {L('Markdown', 'Markdown')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copyReport()}>
                    {L('Copy', 'نسخ')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<BookMarked className="h-3.5 w-3.5" />} onClick={saveToKnowledgeBase}>
                    {L('Save to KB', 'حفظ في المعرفة')}
                  </Button>
                </div>
              }
            />
            <div className="space-y-3 p-4">
              {result.report.causes.map((cause) => (
                <div key={cause.id} className="rounded-lg border border-line bg-surface-2 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={cause.likelihood === 'high' ? 'danger' : cause.likelihood === 'medium' ? 'warning' : 'default'}>
                      {likelihoodLabel(cause.likelihood)}
                    </Badge>
                    <p className="text-sm font-semibold">{cause.title}</p>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">{cause.explanation}</p>
                  {cause.evidence.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-[11px] text-subtle">
                      {cause.evidence.map((evidence) => <li key={evidence}>• {evidence}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-success/30 bg-success/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-success" /> {L('Recommendations', 'التوصيات')}</p>
                  <ul className="mt-2 space-y-1.5 text-xs text-muted">
                    {result.report.recommendations.map((recommendation) => <li key={recommendation}>• {recommendation}</li>)}
                  </ul>
                </div>
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-warning" /> {L('Limitations', 'القيود')}</p>
                  <ul className="mt-2 space-y-1.5 text-xs text-muted">
                    {result.report.limitations.map((limitation) => <li key={limitation}>• {limitation}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title={L('Local port ownership', 'ملكية المنافذ محلياً')}
              icon={<ShieldAlert className="h-4 w-4" />}
              subtitle={L('Run on the router or server to identify the process behind a conflict. A remote probe cannot do this.', 'نفّذ على الراوتر أو الخادم لتحديد العملية وراء التعارض. الفحص عن بُعد لا يستطيع ذلك.')}
            />
            <div className="p-4">
              <CodeBlock code={LOCAL_OWNERSHIP} language="powershell" title={L('Windows / PowerShell', 'Windows / PowerShell')} />
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}
