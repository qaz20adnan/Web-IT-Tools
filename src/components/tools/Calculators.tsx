import { useMemo, useState } from 'react'
import { CalendarClock, Gauge, HardDrive, Network, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, CopyButton, Field, Input, Select, Stat } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import {
  assessRecovery,
  backupEstimate,
  certStatus,
  classifyIPv6,
  compressIPv6,
  expandIPv6,
  formatDuration,
  raidCapacity,
  subnetInfo,
  transferSeconds,
  type RaidLevel,
  type RecoveryRow,
} from '@/lib/calculators'
import { uid } from '@/lib/utils'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

const DATE_PLUS_90 = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)

export function SubnetTool() {
  const L = useLabels()
  const [address, setAddress] = useState('192.168.1.10')
  const [prefix, setPrefix] = useState(24)
  const result = useMemo(() => subnetInfo(address, prefix), [address, prefix])

  return (
    <Card>
      <CardHeader title={L('Subnet / CIDR Calculator', 'حاسبة Subnet / CIDR')} icon={<Network className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-3">
          <Field label={L('IPv4 address', 'عنوان IPv4')} htmlFor="subnet-ip">
            <Input id="subnet-ip" value={address} onChange={(event) => setAddress(event.target.value)} dir="ltr" placeholder="192.168.1.10" />
          </Field>
          <Field label={L('Prefix length', 'طول البادئة')} htmlFor="subnet-prefix">
            <Input id="subnet-prefix" type="number" min={0} max={32} value={prefix} onChange={(event) => setPrefix(Number(event.target.value))} dir="ltr" />
          </Field>
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted">
            {L(
              'Usable hosts exclude the network and broadcast addresses. /31 point-to-point links have two usable addresses; /32 is a single host.',
              'يستثني عدد المضيفين المتاحين عنوان الشبكة والبث. روابط /31 نقطة إلى نقطة لها عنوانان، و/32 مضيف واحد.',
            )}
          </div>
          {!result ? <Alert tone="danger">{L('Enter a valid IPv4 address and prefix (0–32).', 'أدخل عنوان IPv4 وبادئة صحيحة (0–32).')}</Alert> : null}
        </div>
        {result ? (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                [L('Network', 'الشبكة'), result.network],
                [L('Broadcast', 'البث'), result.broadcast],
                [L('First usable host', 'أول مضيف متاح'), result.firstHost],
                [L('Last usable host', 'آخر مضيف متاح'), result.lastHost],
                [L('Subnet mask', 'قناع الشبكة'), result.mask],
                [L('Wildcard mask', 'القناع العكسي'), result.wildcard],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-subtle">{label}</p>
                  <p className="font-mono text-sm" dir="ltr">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="primary">{result.totalAddresses.toLocaleString()} {L('addresses', 'عنوانًا')}</Badge>
              <Badge tone="success">{result.usableHosts.toLocaleString()} {L('usable hosts', 'مضيف متاح')}</Badge>
              <Badge>{L('Scope', 'النطاق')}: {result.scope}</Badge>
            </div>
            <div className="flex justify-end">
              <CopyButton value={`${result.network}/${result.prefix}`} label={L('Copy network', 'نسخ الشبكة')} />
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}

export function Ipv6Tool() {
  const L = useLabels()
  const [value, setValue] = useState('2001:db8::1')
  const expanded = expandIPv6(value)
  const compressed = expanded ? compressIPv6(expanded) : null
  const classification = expanded ? classifyIPv6(expanded) : null

  return (
    <Card>
      <CardHeader title={L('IPv6 Address Helper', 'مساعد عناوين IPv6')} />
      <div className="space-y-4 p-4">
        <Field label={L('IPv6 address', 'عنوان IPv6')} htmlFor="ipv6-input">
          <Input id="ipv6-input" value={value} onChange={(event) => setValue(event.target.value)} dir="ltr" placeholder="2001:db8::1" />
        </Field>
        {expanded ? (
          <>
            <div className="space-y-2">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] uppercase text-subtle">{L('Expanded', 'مُوسّع')}</p>
                <p className="break-all font-mono text-sm" dir="ltr">{expanded}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-[10px] uppercase text-subtle">{L('Compressed (RFC 5952)', 'مضغوط (RFC 5952)')}</p>
                <p className="break-all font-mono text-sm" dir="ltr">{compressed}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{L('Type', 'النوع')}: {classification}</Badge>
              <Badge>{L('Groups', 'المجموعات')}: 8</Badge>
              <CopyButton value={compressed ?? expanded} label={L('Copy', 'نسخ')} />
            </div>
          </>
        ) : (
          <Alert tone="danger">{L('Not a valid IPv6 address. Use up to one "::".', 'ليس عنوان IPv6 صالحًا. استخدم "::" مرة واحدة كحد أقصى.')}</Alert>
        )}
      </div>
    </Card>
  )
}

export function BandwidthTool() {
  const L = useLabels()
  const [size, setSize] = useState(100)
  const [speed, setSpeed] = useState(1000)
  const [overhead, setOverhead] = useState(2)
  const seconds = transferSeconds(size, speed, overhead)

  return (
    <Card>
      <CardHeader title={L('Bandwidth Calculator', 'حاسبة النطاق الترددي')} icon={<Gauge className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label={L('Data size (GB)', 'حجم البيانات (GB)')} htmlFor="bw-size">
          <Input id="bw-size" type="number" min={0} value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </Field>
        <Field label={L('Link speed (Mbps)', 'سرعة الرابط (Mbps)')} htmlFor="bw-speed">
          <Input id="bw-speed" type="number" min={0} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
        </Field>
        <Field label={L('Protocol overhead (%)', 'حمولة البروتوكول (%)')} htmlFor="bw-overhead">
          <Input id="bw-overhead" type="number" min={0} max={99} value={overhead} onChange={(event) => setOverhead(Number(event.target.value))} />
        </Field>
      </div>
      <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-3">
        <Stat label={L('Transfer time', 'زمن النقل')} value={seconds === null ? '—' : formatDuration(seconds)} tone="primary" />
        <Stat label={L('Effective throughput', 'الإنتاجية الفعلية')} value={`${(speed * (1 - overhead / 100)).toFixed(1)} Mbps`} />
        <Stat label={L('Total bits', 'إجمالي البتات')} value={`${(size * 1024 ** 3 * 8).toLocaleString(undefined, { maximumFractionDigits: 0 })} bits`} hint={L('before overhead', 'قبل الحمولة')} />
      </div>
      {seconds === null ? <div className="px-4 pb-4"><Alert tone="danger">{L('Values must be greater than zero, with overhead below 100%.', 'يجب أن تكون القيم أكبر من صفر والحمولة أقل من 100%.')}</Alert></div> : null}
    </Card>
  )
}

export function RaidTool() {
  const L = useLabels()
  const [level, setLevel] = useState<RaidLevel>('5')
  const [disks, setDisks] = useState(6)
  const [diskTB, setDiskTB] = useState(8)
  const result = raidCapacity(level, disks, diskTB)

  return (
    <Card>
      <CardHeader title={L('RAID Capacity Estimator', 'حاسبة سعة RAID')} icon={<HardDrive className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label={L('RAID level', 'مستوى RAID')} htmlFor="raid-level">
          <Select id="raid-level" value={level} onChange={(event) => setLevel(event.target.value as RaidLevel)}>
            {(['0', '1', '5', '6', '10'] as RaidLevel[]).map((value) => <option key={value} value={value}>RAID {value}</option>)}
          </Select>
        </Field>
        <Field label={L('Number of disks', 'عدد الأقراص')} htmlFor="raid-disks">
          <Input id="raid-disks" type="number" min={2} value={disks} onChange={(event) => setDisks(Number(event.target.value))} />
        </Field>
        <Field label={L('Disk size (TB)', 'حجم القرص (TB)')} htmlFor="raid-size">
          <Input id="raid-size" type="number" min={0.1} step={0.1} value={diskTB} onChange={(event) => setDiskTB(Number(event.target.value))} />
        </Field>
      </div>
      <div className="border-t border-line p-4">
        {result ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label={L('Usable capacity', 'السعة المتاحة')} value={`${result.usableTB.toFixed(2)} TB`} tone="primary" />
            <Stat label={L('Raw capacity', 'السعة الخام')} value={`${(disks * diskTB).toFixed(2)} TB`} hint={`${result.efficiency.toFixed(1)}% ${L('efficiency', 'كفاءة')}`} />
            <Stat label={L('Fault tolerance', 'تحمل الأعطال')} value={`${result.tolerance} ${L('disks', 'أقراص')}`} hint={result.description} />
          </div>
        ) : (
          <Alert tone="warning">
            {L('This RAID level needs more disks (RAID 5: 3, RAID 6: 4, RAID 10: 4 and even). RAID 1 requires exactly two.', 'يتطلب هذا المستوى أقراصًا أكثر (RAID 5: 3، RAID 6: 4، RAID 10: 4 وزوجي). RAID 1 يتطلب قرصين فقط.')}
          </Alert>
        )}
      </div>
    </Card>
  )
}

export function BackupTool() {
  const L = useLabels()
  const [full, setFull] = useState(500)
  const [change, setChange] = useState(5)
  const [retention, setRetention] = useState(30)
  const [growth, setGrowth] = useState(20)
  const result = backupEstimate(full, change, retention, growth)

  return (
    <Card>
      <CardHeader title={L('Backup Storage Estimator', 'حاسبة سعة النسخ الاحتياطي')} />
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={L('Full backup (GB)', 'نسخة كاملة (GB)')} htmlFor="bk-full">
          <Input id="bk-full" type="number" min={1} value={full} onChange={(event) => setFull(Number(event.target.value))} />
        </Field>
        <Field label={L('Daily change (%)', 'التغير اليومي (%)')} htmlFor="bk-change">
          <Input id="bk-change" type="number" min={0} max={100} value={change} onChange={(event) => setChange(Number(event.target.value))} />
        </Field>
        <Field label={L('Retention (days)', 'مدة الاحتفاظ (أيام)')} htmlFor="bk-retention">
          <Input id="bk-retention" type="number" min={1} value={retention} onChange={(event) => setRetention(Number(event.target.value))} />
        </Field>
        <Field label={L('Annual data growth (%)', 'النمو السنوي (%)')} htmlFor="bk-growth">
          <Input id="bk-growth" type="number" min={0} value={growth} onChange={(event) => setGrowth(Number(event.target.value))} />
        </Field>
      </div>
      <div className="border-t border-line p-4">
        {result ? (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label={L('Estimated repository', 'المستودع المقدّر')} value={`${result.peakGB.toFixed(0)} GB`} hint={L('including weekly fulls and growth', 'شامل النسخ الكاملة الأسبوعية والنمو')} tone="primary" />
              <Stat label={L('Weekly full copies', 'نسخ كاملة أسبوعية')} value={result.fullCopies} hint={`${(result.fullCopies * result.fullGB).toFixed(0)} GB`} />
              <Stat label={L('Incremental total', 'إجمالي التزايدية')} value={`${result.incrementGB.toFixed(0)} GB`} hint={`${result.dailyChangeGB.toFixed(1)} GB/day`} />
            </div>
            <Alert tone="info" className="mt-3">
              {L(
                'Model assumes one full per week plus daily incremental backups, with linear daily change. Add immutable/offsite copies separately; multiply by the number of copies you keep.',
                'يفترض النموذج نسخة كاملة أسبوعيًا مع نسخ تزايدية يومية وتغيرًا خطيًا. أضف النسخ غير القابلة للتغيير والخارجية بشكل منفصل واضربها بعدد النسخ المحفوظة.',
              )}
            </Alert>
          </>
        ) : (
          <Alert tone="danger">{L('Check the values. Change rate must be 0–100%, retention at least one day.', 'تحقق من القيم. يجب أن يكون التغير بين 0 و100% ومدة الاحتفاظ يومًا على الأقل.')}</Alert>
        )}
      </div>
    </Card>
  )
}

const DEFAULT_ROWS: RecoveryRow[] = [
  { id: 'tier0', system: 'Identity / DC', tier: '0', rpoHours: 0.25, rtoHours: 1 },
  { id: 'tier1', system: 'File & print', tier: '1', rpoHours: 4, rtoHours: 8 },
  { id: 'tier2', system: 'Internal wiki', tier: '2', rpoHours: 24, rtoHours: 72 },
]

export function RtoTool() {
  const L = useLabels()
  const [rows, setRows] = useState<RecoveryRow[]>(DEFAULT_ROWS)
  const assessment = assessRecovery(rows)
  const update = (id: string, patch: Partial<RecoveryRow>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  return (
    <Card>
      <CardHeader
        title={L('RPO / RTO Planner', 'مخطط RPO / RTO')}
        actions={<Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((current) => [...current, { id: uid('sys'), system: '', tier: '2', rpoHours: 24, rtoHours: 72 }])}>{L('Add system', 'إضافة نظام')}</Button>}
      />
      <div className="space-y-3 p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-start text-subtle">
                <th className="p-1.5 text-start">{L('System', 'النظام')}</th>
                <th className="p-1.5 text-start">{L('Tier', 'الفئة')}</th>
                <th className="p-1.5 text-start">{L('RPO (h)', 'RPO (ساعة)')}</th>
                <th className="p-1.5 text-start">{L('RTO (h)', 'RTO (ساعة)')}</th>
                <th className="p-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="p-1"><Input aria-label={L('System', 'النظام')} value={row.system} onChange={(event) => update(row.id, { system: event.target.value })} /></td>
                  <td className="p-1">
                    <Select aria-label="Tier" value={row.tier} onChange={(event) => update(row.id, { tier: event.target.value as RecoveryRow['tier'] })}>
                      <option value="0">Tier 0</option>
                      <option value="1">Tier 1</option>
                      <option value="2">Tier 2</option>
                    </Select>
                  </td>
                  <td className="p-1"><Input aria-label="RPO" type="number" min={0} step={0.25} value={row.rpoHours} onChange={(event) => update(row.id, { rpoHours: Number(event.target.value) })} /></td>
                  <td className="p-1"><Input aria-label="RTO" type="number" min={0} step={0.5} value={row.rtoHours} onChange={(event) => update(row.id, { rtoHours: Number(event.target.value) })} /></td>
                  <td className="p-1">
                    <Button size="icon" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} aria-label={L('Remove', 'إزالة')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label={L('Longest RPO', 'أطول RPO')} value={`${assessment.maxRpo} h`} tone="primary" />
          <Stat label={L('Longest RTO', 'أطول RTO')} value={`${assessment.maxRto} h`} />
          <Stat label={L('Tier 0 systems', 'أنظمة الفئة 0')} value={assessment.tier0Count} />
        </div>
        {assessment.warnings.length > 0 ? (
          <Alert tone="warning" title={L('Review these objectives', 'راجع هذه الأهداف')}>
            <ul className="list-inside list-disc">
              {assessment.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </Alert>
        ) : (
          <Alert tone="success">{L('No obvious inconsistencies in the entered objectives.', 'لا توجد تعارضات واضحة في الأهداف المدخلة.')}</Alert>
        )}
      </div>
    </Card>
  )
}

export function CertTool() {
  const L = useLabels()
  const [expiry, setExpiry] = useState(DATE_PLUS_90)
  const [warning, setWarning] = useState(30)
  const status = certStatus(expiry, warning)

  return (
    <Card>
      <CardHeader title={L('Certificate Expiry Calculator', 'حاسبة انتهاء الشهادة')} icon={<CalendarClock className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label={L('Expiry date', 'تاريخ الانتهاء')} htmlFor="cert-expiry">
          <Input id="cert-expiry" type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
        </Field>
        <Field label={L('Warning window (days)', 'نافذة التحذير (أيام)')} htmlFor="cert-warning">
          <Input id="cert-warning" type="number" min={1} value={warning} onChange={(event) => setWarning(Number(event.target.value))} />
        </Field>
      </div>
      {status ? (
        <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-3">
          <Stat
            label={L('Days remaining', 'الأيام المتبقية')}
            value={status.expired ? L('Expired', 'منتهية') : status.daysRemaining}
            tone={status.expired ? 'warning' : status.warning ? 'warning' : 'success'}
            icon={<ShieldCheck className="h-4 w-4" />}
          />
          <Stat label={L('Renew by', 'جدّد قبل')} value={status.renewBy} />
          <Stat
            label={L('Status', 'الحالة')}
            value={status.expired ? L('Expired', 'منتهية') : status.warning ? L('Renew soon', 'جدّد قريبًا') : L('Healthy', 'سليمة')}
          />
        </div>
      ) : (
        <div className="p-4"><Alert tone="danger">{L('Enter a valid expiry date.', 'أدخل تاريخ انتهاء صالحًا.')}</Alert></div>
      )}
      <p className="px-4 pb-4 text-[10px] text-subtle">
        {L('Certificate dates are evaluated in your local time zone. Renewal lead time should account for approval and deployment, not only signing.', 'تُقيَّم تواريخ الشهادات حسب منطقتك الزمنية. يجب أن تراعي مهلة التجديد الموافقات والنشر لا التوقيع فقط.')}
      </p>
    </Card>
  )
}
