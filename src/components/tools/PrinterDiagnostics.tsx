import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookMarked,
  CheckCircle2,
  Copy,
  Download,
  Info,
  Printer,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  XCircle,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  CodeBlock,
  Field,
  Input,
  Spinner,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { ApiError, probeNetworkPrinter, type PrinterProbeResponse } from '@/services/api'
import { describeError } from '@/services/apiError'
import { buildPrinterAgentScript } from '@/lib/printer-agent'
import { downloadTextFile } from '@/lib/utils'
import { formatDateTime } from '@/i18n'

export function PrinterDiagnostics() {
  const { settings } = useApp()
  const { notify } = useToast()
  const navigate = useNavigate()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
  const stateLabel = (state: string) => {
    const labels: Record<string, [string, string]> = {
      open: ['open', 'مفتوح'],
      closed: ['closed', 'مغلق'],
      filtered: ['filtered', 'مفلتر'],
      timeout: ['timeout', 'مهلة'],
      error: ['error', 'خطأ'],
      idle: ['idle', 'خاملة'],
      processing: ['processing', 'قيد المعالجة'],
      stopped: ['stopped', 'متوقفة'],
    }
    const label = labels[state]
    return label ? L(label[0], label[1]) : state
  }

  const [host, setHost] = useState('')
  const [result, setResult] = useState<PrinterProbeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const [queueName, setQueueName] = useState('')
  const [restartSpooler, setRestartSpooler] = useState(false)
  const [cancelJobs, setCancelJobs] = useState(false)

  const script = useMemo(
    () => buildPrinterAgentScript({ queueName, restartSpooler, cancelJobs }),
    [queueName, restartSpooler, cancelJobs],
  )

  const run = async () => {
    const target = host.trim()
    if (!target) {
      setError(L('Enter the printer hostname or IP address.', 'أدخل اسم مضيف الطابعة أو عنوان IP.'))
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await probeNetworkPrinter(target, settings.language))
    } catch (caught) {
      // blocked_host keeps its own wording: it covers both "this target is on a
      // LAN" and "probing is switched off here", and only the UI can say which
      // of those the person in front of it can do something about.
      setError(
        caught instanceof ApiError && caught.code === 'blocked_host'
          ? L(
              'This deployment cannot reach private printers. Run Adnan Tech locally, or enable PRINTER_ALLOW_PRIVATE on a trusted self-hosted server.',
              'هذا النشر لا يستطيع الوصول إلى الطابعات الخاصة. شغّل منصة عدنان تك محلياً أو فعّل PRINTER_ALLOW_PRIVATE على خادم مستضاف موثوق.',
            )
          : describeError(caught, settings.language, L('The printer probe failed.', 'فشل فحص الطابعة.')),
      )
    } finally {
      setLoading(false)
    }
  }

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script)
      notify('success', L('PowerShell script copied.', 'تم نسخ سكربت PowerShell.'))
    } catch {
      notify('error', L('Could not copy the script.', 'تعذر نسخ السكربت.'))
    }
  }

  const downloadScript = () => {
    downloadTextFile('adnan-tech-printer-diagnostics.ps1', script, 'text/plain;charset=utf-8')
  }

  const saveToKnowledgeBase = () => {
    if (!result) return
    const problem = [
      `Printer ${result.target.host} (${result.target.address}) reachable: ${result.reachable}`,
      `Likely protocol: ${result.likelyProtocol}`,
      result.queue?.name ? `Queue: ${result.queue.name}` : '',
      result.queue?.queuedJobs !== null && result.queue?.queuedJobs !== undefined ? `Queued jobs: ${result.queue.queuedJobs}` : '',
      result.ipp?.stateReasons.length ? `State reasons: ${result.ipp.stateReasons.join(', ')}` : '',
      `Notes:\n- ${result.notes.join('\n- ')}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    navigate('/kb', {
      state: {
        draft: {
          title: `Printer diagnostics — ${result.target.host}`,
          problem,
          solution: result.reachable
            ? 'Confirm the queue state in the local PowerShell agent, cancel stuck jobs if needed, then restart the Print Spooler.'
            : 'Verify the printer is powered on and connected, confirm the IP address, then check TCP 631/9100/515 from the same network.',
          category: 'printing',
          tags: ['printer', 'queue', 'network'],
          source: 'tool',
        },
      },
    })
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('Network printer diagnostics', 'تشخيص طابعة الشبكة')}
          icon={<Server className="h-4 w-4" />}
          subtitle={L(
            'Probe IPP (631), raw printing (9100) and LPD (515) from the deployment, then read queue state when IPP is available.',
            'افحص IPP (631) والطباعة الخام (9100) وLPD (515) من النشر، ثم اقرأ حالة قائمة الانتظار عند توفر IPP.',
          )}
        />
        <div className="space-y-3 p-4">
          <Field
            label={L('Printer hostname or IP', 'اسم مضيف الطابعة أو IP')}
            htmlFor="printer-host"
            hint={L(
              'Network printers reachable from the public internet are probed directly. USB and LAN printers need the local agent below.',
              'تُفحص مباشرةً الطابعات الشبكية المتاحة من الإنترنت العام. طابعات USB والمحلية تحتاج الوكيل المحلي أدناه.',
            )}
          >
            <Input
              id="printer-host"
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder="printer.example.com"
              dir="ltr"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void run()} loading={loading} icon={<Printer className="h-4 w-4" />}>
              {L('Probe printer', 'فحص الطابعة')}
            </Button>
            <Button
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              onClick={() => {
                setHost('')
                setResult(null)
                setError(null)
              }}
            >
              {L('Reset', 'إعادة ضبط')}
            </Button>
          </div>
          <Alert tone="info">
            {L(
              'Private LAN printers are blocked on the public cloud deployment by design. Run the app locally for LAN discovery, or use the local PowerShell agent for queues and USB devices.',
              'طابعات الشبكة المحلية محظورة على النشر السحابي العام بحكم التصميم. شغّل التطبيق محلياً لاكتشاف الشبكة المحلية، أو استخدم وكيل PowerShell المحلي لقوائم الانتظار وأجهزة USB.',
            )}
          </Alert>
          {loading ? <Spinner label={L('Probing printer ports…', 'جارٍ فحص منافذ الطابعة…')} /> : null}
          {error ? <Alert tone="danger" title={L('Probe failed', 'فشل الفحص')}>{error}</Alert> : null}
        </div>
      </Card>

      {result ? (
        <Card>
          <CardHeader
            title={L('Network probe result', 'نتيجة فحص الشبكة')}
            icon={result.reachable ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            subtitle={`${formatDateTime(result.checkedAt, settings.language)} · ${result.target.host} (${result.target.address})`}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={result.reachable ? 'success' : 'danger'}>
                  {result.reachable ? L('Reachable', 'قابل للوصول') : L('Unreachable', 'غير قابل للوصول')}
                </Badge>
                <Button size="sm" variant="ghost" icon={<BookMarked className="h-3.5 w-3.5" />} onClick={saveToKnowledgeBase}>
                  {L('Save to KB', 'حفظ في المعرفة')}
                </Button>
              </div>
            }
          />
          <div className="space-y-3 p-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Likely protocol', 'البروتوكول المرجح')}</p>
                <p className="mt-1 text-sm font-semibold">{result.likelyProtocol}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Printer', 'الطابعة')}</p>
                <p className="mt-1 break-all text-sm font-semibold">{result.queue?.name ?? result.ipp?.name ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] uppercase tracking-wide text-subtle">{L('Queued jobs', 'المهام في الانتظار')}</p>
                <p className="mt-1 text-sm font-semibold">{result.queue?.queuedJobs ?? '—'}</p>
              </div>
            </div>

            {result.ipp ? (
              <div className="rounded-lg border border-line p-3 text-xs">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={result.ipp.ok ? 'success' : 'warning'}>IPP</Badge>
                  <span className="text-muted">{result.ipp.statusName ?? result.ipp.statusCode ?? '—'}</span>
                  {result.ipp.state ? <Badge>{stateLabel(result.ipp.state)}</Badge> : null}
                  {result.ipp.acceptingJobs === false ? <Badge tone="warning">{L('Not accepting jobs', 'لا يستقبل مهام')}</Badge> : null}
                </p>
                {result.ipp.model ? <p className="mt-2 text-muted" dir="ltr">{result.ipp.model}</p> : null}
                {result.ipp.stateReasons.length > 0 ? (
                  <p className="mt-1 text-subtle">{result.ipp.stateReasons.join(' · ')}</p>
                ) : null}
              </div>
            ) : null}

            <div className="overflow-auto rounded-lg border border-line">
              <table className="w-full text-xs">
                <thead className="bg-surface-2 text-subtle">
                  <tr>
                    <th className="p-2 text-start">{L('Port', 'المنفذ')}</th>
                    <th className="p-2 text-start">{L('State', 'الحالة')}</th>
                    <th className="p-2 text-start">{L('Service', 'الخدمة')}</th>
                    <th className="p-2 text-start">{L('Latency', 'الزمن')}</th>
                    <th className="p-2 text-start">{L('Detail', 'التفصيل')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ports.map((entry) => (
                    <tr key={entry.port} className="border-t border-line">
                      <td className="p-2 font-mono" dir="ltr">{entry.port}</td>
                      <td className="p-2">
                        <Badge tone={entry.state === 'open' ? 'success' : entry.state === 'closed' ? 'default' : 'warning'}>
                          {stateLabel(entry.state)}
                        </Badge>
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

            <div className="space-y-1.5">
              {result.notes.map((note) => (
                <p key={note} className="flex gap-2 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {note}</p>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={L('Local queue agent (USB & network)', 'وكيل قائمة الانتظار المحلي (USB والشبكة)')}
          icon={<Terminal className="h-4 w-4" />}
          subtitle={L(
            'Generate a read-only PowerShell inventory by default, or explicitly opt in to canceling jobs and restarting the spooler.',
            'أنشئ جرد PowerShell للقراءة فقط افتراضياً، أو وافق صراحةً على إلغاء المهام وإعادة تشغيل Spooler.',
          )}
        />
        <div className="space-y-3 p-4">
          <Alert tone="warning" title={L('Adnan Tech does not run this script', 'منصة عدنان تك لا تشغّل هذا السكربت')}>
            {L(
              'Download it, inspect it, then run it in an elevated PowerShell window on the Windows device that owns the printer. The browser and cloud functions cannot access the Windows spooler.',
              'نزّله وافحصه ثم شغّله في نافذة PowerShell بصلاحيات مسؤول على جهاز Windows المالك للطابعة. المتصفح ودوال السحابة لا تستطيع الوصول إلى Spooler.',
            )}
          </Alert>
          <Field
            label={L('Queue name (optional)', 'اسم قائمة الانتظار (اختياري)')}
            htmlFor="printer-queue"
            hint={L('Leave empty to inventory all printers. Use the exact name from Get-Printer.', 'اتركه فارغاً لجرد كل الطابعات. استخدم الاسم الدقيق من Get-Printer.')}
          >
            <Input
              id="printer-queue"
              value={queueName}
              onChange={(event) => setQueueName(event.target.value)}
              placeholder={L('e.g. HP LaserJet M404', 'مثال: HP LaserJet M404')}
            />
          </Field>
          <div className="space-y-2">
            <Checkbox
              label={L('Cancel all jobs in the selected queue(s)', 'إلغاء كل المهام في قائمة الانتظار المحددة')}
              description={L('Adds Remove-PrintJob commands. Requires administrator rights.', 'يضيف أوامر Remove-PrintJob. يتطلب صلاحيات مسؤول.')}
              checked={cancelJobs}
              onChange={(event) => setCancelJobs(event.target.checked)}
            />
            <Checkbox
              label={L('Restart the Print Spooler service', 'إعادة تشغيل خدمة Print Spooler')}
              description={L('Adds Restart-Service Spooler -Force. Requires administrator rights.', 'يضيف Restart-Service Spooler -Force. يتطلب صلاحيات مسؤول.')}
              checked={restartSpooler}
              onChange={(event) => setRestartSpooler(event.target.checked)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<Download className="h-4 w-4" />} onClick={downloadScript}>
              {L('Download .ps1', 'تنزيل .ps1')}
            </Button>
            <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copyScript()}>
              {L('Copy script', 'نسخ السكربت')}
            </Button>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            {L(
              'Only run scripts you generated yourself. Review every command before executing, especially cancel and restart actions.',
              'شغّل فقط السكربتات التي أنشأتها بنفسك. راجع كل أمر قبل التنفيذ، خاصة أوامر الإلغاء وإعادة التشغيل.',
            )}
          </div>
          <CodeBlock code={script} language="powershell" title="adnan-tech-printer-diagnostics.ps1" maxHeight="24rem" />
        </div>
      </Card>
    </div>
  )
}
