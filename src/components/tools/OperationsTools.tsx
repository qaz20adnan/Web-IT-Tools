import { useMemo, useState } from 'react'
import { Activity, Archive, Download, HardDrive, Network, ShieldCheck } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, CopyButton, Field, Input, Select, Stat, Switch } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { downloadTextFile } from '@/lib/utils'
import {
  analyzeLatency,
  assessFirewallRule,
  backupReadiness,
  planDiskCapacity,
  searchPorts,
  type FirewallAction,
  type FirewallDirection,
  type FirewallProtocol,
  type LatencyGrade,
  type PortProtocol,
  type ReadinessCheck,
} from '@/lib/operations'
import type { RaidLevel } from '@/lib/calculators'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

function parseSamples(value: string): { samples: number[]; invalid: boolean } {
  const tokens = value.split(/[\s,;]+/).filter(Boolean)
  const samples = tokens.map(Number)
  return { samples: samples.filter((sample) => Number.isFinite(sample)), invalid: samples.some((sample) => !Number.isFinite(sample)) }
}

const GRADE_TONE: Record<LatencyGrade, 'success' | 'primary' | 'warning' | 'danger'> = {
  excellent: 'success',
  good: 'primary',
  fair: 'warning',
  poor: 'danger',
}

export function PortReferenceTool() {
  const L = useLabels()
  const [query, setQuery] = useState('')
  const [protocol, setProtocol] = useState<PortProtocol | 'all'>('all')
  const entries = useMemo(() => searchPorts(query, protocol), [query, protocol])

  return (
    <Card>
      <CardHeader title={L('TCP / UDP Port Reference', 'مرجع منافذ TCP / UDP')} icon={<Network className="h-4 w-4" />} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label={L('Search port or service', 'ابحث عن منفذ أو خدمة')} htmlFor="port-search">
            <Input id="port-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="443, rdp, smb…" dir="ltr" />
          </Field>
          <Field label={L('Protocol', 'البروتوكول')} htmlFor="port-protocol">
            <Select id="port-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as PortProtocol | 'all')}>
              <option value="all">{L('All', 'الكل')}</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </Select>
          </Field>
        </div>
        <div className="max-h-[26rem] overflow-auto rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-2 text-start">
              <tr>
                <th className="p-2 text-start font-semibold">{L('Port', 'المنفذ')}</th>
                <th className="p-2 text-start font-semibold">{L('Protocol', 'البروتوكول')}</th>
                <th className="p-2 text-start font-semibold">{L('Service', 'الخدمة')}</th>
                <th className="p-2 text-start font-semibold">{L('Typical use', 'الاستخدام النمطي')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={`${entry.port}-${entry.protocol}`} className="border-t border-line">
                  <td className="p-2 font-mono" dir="ltr">{entry.port}</td>
                  <td className="p-2 uppercase text-muted">{entry.protocol}</td>
                  <td className="p-2 font-mono" dir="ltr">
                    {entry.service}
                    {entry.secure ? <Badge tone="success" className="ms-1.5">{L('secure', 'آمن')}</Badge> : null}
                  </td>
                  <td className="p-2 text-muted">{entry.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length === 0 ? <Alert tone="warning">{L('No ports match this filter.', 'لا توجد منافذ مطابقة لهذا التصفية.')}</Alert> : null}
        <p className="text-[10px] text-subtle">
          {L(
            'Static reference list. Confirm the actual listener with netstat, ss or Get-NetTCPConnection on the host.',
            'قائمة مرجعية ثابتة. تحقق من المستمع الفعلي عبر netstat أو ss أو Get-NetTCPConnection على المضيف.',
          )}
        </p>
      </div>
    </Card>
  )
}

export function LatencyTool() {
  const L = useLabels()
  const [sent, setSent] = useState(20)
  const [samplesText, setSamplesText] = useState('18, 20, 19, 21, 18, 22, 20, 19')
  const parsed = useMemo(() => parseSamples(samplesText), [samplesText])
  const result = useMemo(() => analyzeLatency(sent, parsed.samples), [sent, parsed.samples])

  return (
    <Card>
      <CardHeader title={L('Latency & Packet Loss Analyzer', 'محلل زمن الاستجابة وفقدان الحزم')} icon={<Activity className="h-4 w-4" />} />
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Field label={L('Packets sent', 'الحزم المرسلة')} htmlFor="latency-sent">
            <Input id="latency-sent" type="number" min={1} value={sent} onChange={(event) => setSent(Number(event.target.value))} dir="ltr" />
          </Field>
          <Field label={L('Successful round-trip times (ms)', 'أزمنة الذهاب والعودة الناجحة (مللي ثانية)')} htmlFor="latency-samples">
            <Input id="latency-samples" value={samplesText} onChange={(event) => setSamplesText(event.target.value)} placeholder="18, 20, 19" dir="ltr" />
          </Field>
        </div>
        {parsed.invalid || !result ? (
          <Alert tone="danger">
            {L(
              'Enter a positive packet count and comma-separated non-negative RTT values. Successful samples cannot exceed packets sent.',
              'أدخل عدد حزم موجبًا وقيم RTT غير سالبة مفصولة بفواصل. لا يمكن أن يتجاوز عدد العينات الناجحة عدد الحزم المرسلة.',
            )}
          </Alert>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label={L('Packet loss', 'فقدان الحزم')} value={`${result.lossPercent}%`} hint={`${result.lost} / ${result.sent}`} />
              <Stat label={L('Average RTT', 'متوسط RTT')} value={`${result.avgMs} ms`} hint={`${result.minMs}–${result.maxMs} ms`} />
              <Stat label={L('Jitter', 'التذبذب')} value={`${result.jitterMs} ms`} hint={L('mean absolute difference', 'متوسط الفرق المطلق')} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={GRADE_TONE[result.grade]}>{result.grade.toUpperCase()}</Badge>
              <Badge>{L('Received', 'المستلمة')}: {result.received}</Badge>
              <Badge>{L('Lost', 'المفقودة')}: {result.lost}</Badge>
            </div>
            <p className="text-[10px] text-subtle">
              {L(
                'Jitter is estimated from consecutive RTT samples. ICMP may be filtered or deprioritised; corroborate with TCP probes and device counters.',
                'يُقدّر التذبذب من عينات RTT المتتالية. قد تُفلتر ICMP أو تُخفض أولويتها؛ تحقق بفحوص TCP وعدّادات الأجهزة.',
              )}
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

export function DiskCapacityTool() {
  const L = useLabels()
  const [disks, setDisks] = useState(8)
  const [diskSizeGiB, setDiskSizeGiB] = useState(1800)
  const [raid, setRaid] = useState<RaidLevel>('6')
  const [reservedPercent, setReservedPercent] = useState(5)
  const [filesystemPercent, setFilesystemPercent] = useState(2)
  const [growthReservePercent, setGrowthReservePercent] = useState(20)
  const result = useMemo(
    () => planDiskCapacity({ disks, diskSizeGiB, raid, reservedPercent, filesystemPercent, growthReservePercent }),
    [disks, diskSizeGiB, raid, reservedPercent, filesystemPercent, growthReservePercent],
  )

  return (
    <Card>
      <CardHeader title={L('Disk Capacity Planner', 'مخطط سعة الأقراص')} icon={<HardDrive className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={L('Disk count', 'عدد الأقراص')} htmlFor="disk-count">
              <Input id="disk-count" type="number" min={2} value={disks} onChange={(event) => setDisks(Number(event.target.value))} dir="ltr" />
            </Field>
            <Field label={L('Disk size (GiB)', 'حجم القرص (GiB)')} htmlFor="disk-size" hint={L('Binary units, as reported by the OS.', 'بوحدات ثنائية كما يعرضها النظام التشغيل.')}>
              <Input id="disk-size" type="number" min={1} value={diskSizeGiB} onChange={(event) => setDiskSizeGiB(Number(event.target.value))} dir="ltr" />
            </Field>
          </div>
          <Field label={L('RAID level', 'مستوى RAID')} htmlFor="disk-raid">
            <Select id="disk-raid" value={raid} onChange={(event) => setRaid(event.target.value as RaidLevel)}>
              {(['0', '1', '5', '6', '10'] as RaidLevel[]).map((level) => <option key={level} value={level}>RAID {level}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label={L('Reserved %', 'محجوز %')} htmlFor="disk-reserved">
              <Input id="disk-reserved" type="number" min={0} max={50} value={reservedPercent} onChange={(event) => setReservedPercent(Number(event.target.value))} dir="ltr" />
            </Field>
            <Field label={L('FS overhead %', 'كلفة نظام الملفات %')} htmlFor="disk-fs">
              <Input id="disk-fs" type="number" min={0} max={30} value={filesystemPercent} onChange={(event) => setFilesystemPercent(Number(event.target.value))} dir="ltr" />
            </Field>
            <Field label={L('Growth reserve %', 'احتياطي النمو %')} htmlFor="disk-growth">
              <Input id="disk-growth" type="number" min={0} max={90} value={growthReservePercent} onChange={(event) => setGrowthReservePercent(Number(event.target.value))} dir="ltr" />
            </Field>
          </div>
        </div>
        {result ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label={L('Raw capacity', 'السعة الخام')} value={`${(result.rawGiB / 1024).toFixed(2)} TiB`} />
              <Stat label={L('Usable after RAID', 'المتاحة بعد RAID')} value={`${(result.usableGiB / 1024).toFixed(2)} TiB`} hint={`${result.efficiency}% ${L('efficiency', 'كفاءة')}`} tone="primary" />
              <Stat label={L('Current data capacity', 'سعة البيانات الحالية')} value={`${(result.currentCapacityGiB / 1024).toFixed(2)} TiB`} tone="success" />
              <Stat label={L('Growth headroom', 'احتياطي النمو')} value={`${(result.growthHeadroomGiB / 1024).toFixed(2)} TiB`} tone="warning" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{L('Reserved', 'محجوز')}: {(result.reservedGiB / 1024).toFixed(2)} TiB</Badge>
              <Badge>{L('Filesystem', 'نظام الملفات')}: {(result.filesystemGiB / 1024).toFixed(2)} TiB</Badge>
              <Badge tone={result.tolerance > 0 ? 'success' : 'danger'}>{L('Fault tolerance', 'تحمل الأعطال')}: {result.tolerance}</Badge>
              {result.bestCaseTolerance > result.tolerance ? (
                <Badge>{L('Best case, failures in separate mirrors', 'أفضل حالة: أعطال في مرآتين مختلفتين')}: {result.bestCaseTolerance}</Badge>
              ) : null}
            </div>
            <Alert tone="info">
              {L(
                'Capacity is computed in binary units (GiB/TiB, 1024-based), which is smaller than the decimal GB/TB printed on the drive label. Enter the size the operating system reports. Confirm hot-spare policy and backup staging before purchase.',
                'تُحسب السعة بوحدات ثنائية (GiB/TiB أساسها 1024) وهي أقل من وحدات GB/TB العشرية المكتوبة على القرص. أدخل الحجم كما يعرضه نظام التشغيل. تحقق من سياسة الاحتياطي الساخن ومساحة النسخ الاحتياطي قبل الشراء.',
              )}
            </Alert>
          </div>
        ) : (
          <Alert tone="danger">
            {L(
              'Check the disk count, size and RAID minimums. RAID 10 needs an even count of at least 4; RAID 6 needs at least 4 disks.',
              'راجع عدد الأقراص والحجم والحد الأدنى لـ RAID. يحتاج RAID 10 عددًا زوجيًا لا يقل عن 4، ويحتاج RAID 6 إلى 4 أقراص على الأقل.',
            )}
          </Alert>
        )}
      </div>
    </Card>
  )
}

export function FirewallDocTool() {
  const L = useLabels()
  const [name, setName] = useState('Allow HTTPS from branch office')
  const [direction, setDirection] = useState<FirewallDirection>('inbound')
  const [action, setAction] = useState<FirewallAction>('allow')
  const [protocol, setProtocol] = useState<FirewallProtocol>('tcp')
  const [ports, setPorts] = useState('443')
  const [remoteScope, setRemoteScope] = useState('10.20.0.0/16')
  const [profile, setProfile] = useState('Domain')
  const [purpose, setPurpose] = useState('Branch users access the intranet portal')
  const [enabled, setEnabled] = useState(true)
  const result = assessFirewallRule({ name, direction, action, protocol, ports, remoteScope, profile, purpose, enabled }, L)

  return (
    <Card>
      <CardHeader title={L('Firewall Rule Documenter', 'موثّق قواعد جدار الحماية')} icon={<ShieldCheck className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-3">
          <Field label={L('Rule name', 'اسم القاعدة')} htmlFor="fw-name">
            <Input id="fw-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L('Direction', 'الاتجاه')} htmlFor="fw-direction">
              <Select id="fw-direction" value={direction} onChange={(event) => setDirection(event.target.value as FirewallDirection)}>
                <option value="inbound">{L('Inbound', 'وارد')}</option>
                <option value="outbound">{L('Outbound', 'صادر')}</option>
              </Select>
            </Field>
            <Field label={L('Action', 'الإجراء')} htmlFor="fw-action">
              <Select id="fw-action" value={action} onChange={(event) => setAction(event.target.value as FirewallAction)}>
                <option value="allow">{L('Allow', 'سماح')}</option>
                <option value="block">{L('Block', 'حجب')}</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L('Protocol', 'البروتوكول')} htmlFor="fw-protocol">
              <Select id="fw-protocol" value={protocol} onChange={(event) => setProtocol(event.target.value as FirewallProtocol)}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="any">{L('Any', 'الكل')}</option>
              </Select>
            </Field>
            <Field label={L('Local ports', 'المنافذ المحلية')} htmlFor="fw-ports">
              <Input id="fw-ports" value={ports} onChange={(event) => setPorts(event.target.value)} placeholder="443, 8000-8080" dir="ltr" disabled={protocol === 'icmp' || protocol === 'any'} />
            </Field>
          </div>
          <Field label={L('Remote scope', 'النطاق البعيد')} htmlFor="fw-scope">
            <Input id="fw-scope" value={remoteScope} onChange={(event) => setRemoteScope(event.target.value)} placeholder="10.20.0.0/16" dir="ltr" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L('Profile', 'الملف')} htmlFor="fw-profile">
              <Input id="fw-profile" value={profile} onChange={(event) => setProfile(event.target.value)} />
            </Field>
            <Field label={L('Purpose', 'الغرض')} htmlFor="fw-purpose">
              <Input id="fw-purpose" value={purpose} onChange={(event) => setPurpose(event.target.value)} />
            </Field>
          </div>
          <Switch checked={enabled} onChange={setEnabled} label={L('Documented as enabled', 'موثّقة كُممكّنة')} />
        </div>
        <div className="space-y-3">
          {result.errors.map((error) => <Alert key={error} tone="danger">{error}</Alert>)}
          {result.warnings.map((warning) => <Alert key={warning} tone="warning">{warning}</Alert>)}
          {result.valid && result.warnings.length === 0 ? <Alert tone="success">{L('No structural issues found. Compare with the approved network policy.', 'لا توجد مشكلات بنيوية. قارنها بسياسة الشبكة المعتمدة.')}</Alert> : null}
          <div className="max-h-80 overflow-auto rounded-lg border border-line bg-surface-2 p-3">
            <pre className="whitespace-pre-wrap font-mono text-[11px]" dir="ltr">{result.markdown}</pre>
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={result.markdown} label={L('Copy documentation', 'نسخ التوثيق')} />
            <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadTextFile('firewall-rule.md', result.markdown, 'text/markdown;charset=utf-8')}>
              {L('Export Markdown', 'تصدير Markdown')}
            </Button>
          </div>
          <p className="text-[10px] text-subtle">{L('Documentation only. Adnan Tech never deploys firewall rules.', 'توثيق فقط. لا تنشر منصة عدنان تك قواعد جدار الحماية إطلاقًا.')}</p>
        </div>
      </div>
    </Card>
  )
}

const CHECK_LABELS: Record<ReadinessCheck['id'], { en: string; ar: string }> = {
  rpo: { en: 'Backup frequency meets RPO', ar: 'تكرار النسخ يحقق RPO' },
  copies: { en: 'At least three copies', ar: 'ثلاث نسخ على الأقل' },
  offsite: { en: 'Off-site or isolated copy', ar: 'نسخة خارج الموقع أو معزولة' },
  immutable: { en: 'Immutable or offline protection', ar: 'حماية غير قابلة للتغيير أو دون اتصال' },
  encryption: { en: 'Encryption at rest', ar: 'تشفير البيانات المخزنة' },
  'restore-test': { en: 'Restore tested within 30 days', ar: 'اختبار الاسترداد خلال 30 يومًا' },
}

export function BackupReadinessTool() {
  const L = useLabels()
  const [rpoHours, setRpoHours] = useState(24)
  const [frequencyHours, setFrequencyHours] = useState(4)
  const [copies, setCopies] = useState(3)
  const [offsite, setOffsite] = useState(true)
  const [immutable, setImmutable] = useState(false)
  const [encrypted, setEncrypted] = useState(true)
  const [restoreTestDays, setRestoreTestDays] = useState(45)
  const result = useMemo(
    () => backupReadiness({ rpoHours, frequencyHours, copies, offsite, immutable, encrypted, restoreTestDays }),
    [rpoHours, frequencyHours, copies, offsite, immutable, encrypted, restoreTestDays],
  )

  const markdown = result
    ? [
        `# ${L('Backup readiness checklist', 'قائمة جاهزية النسخ الاحتياطي')}`,
        '',
        `${L('Score', 'الدرجة')}: ${result.score}/100 (${
          result.status === 'ready' ? L('Ready', 'جاهز') : result.status === 'needs-work' ? L('Needs work', 'يحتاج تحسينًا') : L('Critical gaps', 'ثغرات حرجة')
        })`,
        '',
        ...result.checks.map((check) => `- [${check.pass ? 'x' : ' '}] ${L(CHECK_LABELS[check.id].en, CHECK_LABELS[check.id].ar)}`),
        '',
        `> ${L('Generated locally by Adnan Tech. A score is not a guarantee; perform a real restore test.', 'أُنشئ محليًا في منصة عدنان تك. الدرجة ليست ضمانة؛ نفّذ اختبار استرداد فعليًا.')}`,
      ].join('\n')
    : ''

  return (
    <Card>
      <CardHeader
        title={L('Backup Readiness Checklist', 'قائمة جاهزية النسخ الاحتياطي')}
        icon={<Archive className="h-4 w-4" />}
        actions={result ? <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadTextFile('backup-readiness.md', markdown, 'text/markdown;charset=utf-8')}>{L('Export', 'تصدير')}</Button> : null}
      />
      <div className="grid gap-4 p-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={L('RPO (hours)', 'RPO (ساعات)')} htmlFor="backup-rpo">
              <Input id="backup-rpo" type="number" min={1} value={rpoHours} onChange={(event) => setRpoHours(Number(event.target.value))} dir="ltr" />
            </Field>
            <Field label={L('Backup every (hours)', 'النسخ كل (ساعات)')} htmlFor="backup-frequency">
              <Input id="backup-frequency" type="number" min={1} value={frequencyHours} onChange={(event) => setFrequencyHours(Number(event.target.value))} dir="ltr" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L('Independent copies', 'نسخ مستقلة')} htmlFor="backup-copies">
              <Input id="backup-copies" type="number" min={1} value={copies} onChange={(event) => setCopies(Number(event.target.value))} dir="ltr" />
            </Field>
            <Field label={L('Last restore test (days)', 'آخر اختبار استرداد (أيام)')} htmlFor="backup-test">
              <Input id="backup-test" type="number" min={0} value={restoreTestDays} onChange={(event) => setRestoreTestDays(Number(event.target.value))} dir="ltr" />
            </Field>
          </div>
          <Switch checked={offsite} onChange={setOffsite} label={L('Off-site or isolated copy', 'نسخة خارج الموقع أو معزولة')} />
          <Switch checked={immutable} onChange={setImmutable} label={L('Immutable or offline protection', 'حماية غير قابلة للتغيير أو دون اتصال')} />
          <Switch checked={encrypted} onChange={setEncrypted} label={L('Encryption at rest', 'تشفير البيانات المخزنة')} />
        </div>
        {result ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label={L('Readiness score', 'درجة الجاهزية')} value={`${result.score}/100`} tone={result.status === 'ready' ? 'success' : result.status === 'needs-work' ? 'warning' : undefined} />
              <Stat label={L('Status', 'الحالة')} value={result.status === 'ready' ? L('Ready', 'جاهز') : result.status === 'needs-work' ? L('Needs work', 'يحتاج تحسينًا') : L('Critical gaps', 'ثغرات حرجة')} />
            </div>
            <ul className="space-y-1.5">
              {result.checks.map((check) => (
                <li key={check.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
                  <span>{check.pass ? '✓' : '✗'} {L(CHECK_LABELS[check.id].en, CHECK_LABELS[check.id].ar)}</span>
                  <Badge tone={check.pass ? 'success' : 'danger'}>{check.pass ? L('Pass', 'ناجح') : L('Gap', 'ثغرة')}</Badge>
                </li>
              ))}
            </ul>
            <Alert tone="info">
              {L(
                'This checklist is guidance, not certification. Record restore evidence and confirm RPO/RTO with the system owner.',
                'هذه القائمة إرشادية وليست شهادة. سجّل دليل الاسترداد وأكّد RPO/RTO مع مالك النظام.',
              )}
            </Alert>
            <CopyButton value={markdown} label={L('Copy checklist', 'نسخ القائمة')} />
          </div>
        ) : (
          <Alert tone="danger">{L('RPO, backup frequency and restore-test age must be valid positive values.', 'يجب أن تكون RPO وتكرار النسخ وعمر اختبار الاسترداد قيمًا موجبة صحيحة.')}</Alert>
        )}
      </div>
    </Card>
  )
}
