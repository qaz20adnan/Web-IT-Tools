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
  hasAmbiguousOctet,
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
  const [prefixText, setPrefixText] = useState('24')
  const prefix = prefixText.trim() === '' ? Number.NaN : Number(prefixText)
  const result = useMemo(() => subnetInfo(address, prefix), [address, prefix])

  const error = !result
    ? hasAmbiguousOctet(address)
      ? L(
          'A leading zero in an IPv4 octet is ambiguous (010 can be read as octal). Enter plain decimal octets.',
          'الصفر السابق في جزء من عنوان IPv4 غامض (قد تُقرأ 010 كثماني). أدخل الأجزاء عشرية عادية.',
        )
      : Number.isNaN(prefix)
        ? L('Prefix length is required, from 0 to 32.', 'طول البادئة مطلوب، من 0 إلى 32.')
        : L('Enter a valid IPv4 address and prefix (0–32).', 'أدخل عنوان IPv4 وبادئة صحيحة (0–32).')
    : null

  return (
    <Card>
      <CardHeader title={L('Subnet / CIDR Calculator', 'حاسبة Subnet / CIDR')} icon={<Network className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-3">
          <Field label={L('IPv4 address', 'عنوان IPv4')} htmlFor="subnet-ip">
            <Input id="subnet-ip" value={address} onChange={(event) => setAddress(event.target.value)} dir="ltr" placeholder="192.168.1.10" />
          </Field>
          <Field label={L('Prefix length', 'طول البادئة')} htmlFor="subnet-prefix">
            <Input
              id="subnet-prefix"
              type="number"
              min={0}
              max={32}
              value={prefixText}
              onChange={(event) => setPrefixText(event.target.value)}
              dir="ltr"
              aria-invalid={Number.isNaN(prefix)}
            />
          </Field>
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted">
            {L(
              'Usable hosts exclude the network and broadcast addresses. /31 point-to-point links have two usable addresses; /32 is a single host.',
              'يستثني عدد المضيفين المتاحين عنوان الشبكة والبث. روابط /31 نقطة إلى نقطة لها عنوانان، و/32 مضيف واحد.',
            )}
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
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
  const overheadUsable = Number.isFinite(overhead) && overhead >= 0 && overhead < 100
  const throughput = Number.isFinite(speed) && speed >= 0 && overheadUsable ? speed * (1 - overhead / 100) : null
  const totalBits = Number.isFinite(size) && size >= 0 ? size * 1024 ** 3 * 8 : null

  return (
    <Card>
      <CardHeader title={L('Bandwidth Calculator', 'حاسبة النطاق الترددي')} icon={<Gauge className="h-4 w-4" />} />
      <div className="grid gap-4 p-4 sm:grid-cols-3">
        <Field label={L('Data size (GiB)', 'حجم البيانات (GiB)')} htmlFor="bw-size" hint={L('Binary 1024³ bytes.', 'بايت ثنائي بأساس 1024³.')}>
          <Input id="bw-size" type="number" min={0} value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </Field>
        <Field label={L('Link speed (Mbps)', 'سرعة الرابط (Mbps)')} htmlFor="bw-speed" hint={L('Decimal megabits per second.', 'ميغابت عشري في الثانية.')}>
          <Input id="bw-speed" type="number" min={0} value={speed} onChange={(event) => setSpeed(Number(event.target.value))} />
        </Field>
        <Field label={L('Protocol overhead (%)', 'حمولة البروتوكول (%)')} htmlFor="bw-overhead" hint={L('Below 100%.', 'أقل من 100%.')}>
          <Input id="bw-overhead" type="number" min={0} max={99} value={overhead} onChange={(event) => setOverhead(Number(event.target.value))} />
        </Field>
      </div>
      <div className="grid gap-2 border-t border-line p-4 sm:grid-cols-3">
        <Stat label={L('Transfer time', 'زمن النقل')} value={seconds === null ? '—' : formatDuration(seconds)} tone="primary" />
        <Stat label={L('Effective throughput', 'الإنتاجية الفعلية')} value={throughput === null ? '—' : `${throughput.toFixed(1)} Mbps`} />
        <Stat
          label={L('Total bits', 'إجمالي البتات')}
          value={totalBits === null ? '—' : `${totalBits.toLocaleString(undefined, { maximumFractionDigits: 0 })} bits`}
          hint={L('GiB payload, before overhead', 'حمولة بوحدة GiB قبل الحمولة الإضافية')}
        />
      </div>
      {seconds === null ? (
        <div className="px-4 pb-4">
          <Alert tone="danger">
            {L('GiB size and Mbps must be greater than zero, and overhead must be between 0 and 99%.', 'يجب أن يكون الحجم بوحدة GiB والسرعة بـ Mbps أكبر من صفر، والحمولة بين 0 و99%.')}
          </Alert>
        </div>
      ) : null}
    </Card>
  )
}

const RAID_COPY: Record<RaidLevel, [string, string]> = {
  '0': ['Striping, no redundancy', 'تشريط دون تكرار'],
  '1': ['Mirroring', 'نسخ مرآتي'],
  '5': ['Single parity', 'تكافؤ فردي'],
  '6': ['Double parity', 'تكافؤ مزدوج'],
  '10': ['Mirrored stripes', 'شرائح منسوخة مرآتيًا'],
}

export function RaidTool() {
  const L = useLabels()
  const [level, setLevel] = useState<RaidLevel>('5')
  const [disks, setDisks] = useState(6)
  const [diskTB, setDiskTB] = useState(8)
  const result = raidCapacity(level, disks, diskTB)
  const bestCaseNote =
    result && result.bestCaseTolerance > result.tolerance
      ? L(
          `Best case ${result.bestCaseTolerance}, only when failures land in separate mirrors`,
          `أفضل حالة ${result.bestCaseTolerance} قرصًا، فقط عندما تقع الأعطال في مرآتيتين مختلفتين`,
        )
      : L('Disks that survive any single failure', 'عدد الأقراص التي تنجو من أي عطل منفرد')

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
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Stat label={L('Usable capacity', 'السعة المتاحة')} value={`${result.usableTB.toFixed(2)} TB`} tone="primary" />
              <Stat label={L('Raw capacity', 'السعة الخام')} value={`${(disks * diskTB).toFixed(2)} TB`} hint={`${result.efficiency.toFixed(1)}% ${L('efficiency', 'كفاءة')}`} />
              <Stat
                label={L('Guaranteed fault tolerance', 'تحمل الأعطال المضمون')}
                value={`${result.tolerance} ${L('disks', 'أقراص')}`}
                hint={`${L(RAID_COPY[level][0], RAID_COPY[level][1])} · ${bestCaseNote}`}
              />
            </div>
            {result.tolerance === 0 ? (
              <Alert tone="danger" className="mt-3">
                {L('This layout has no redundancy: one disk failure loses the array.', 'هذا التكوين بلا تكرار: عطب قرص واحد يُفقد المصفوفة كلها.')}
              </Alert>
            ) : null}
          </>
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
              <Stat label={L('Estimated repository', 'المستودع المقدّر')} value={`${result.peakGB.toFixed(0)} GB`} hint={L('weekly fulls and increments, grown once', 'النسخ الكاملة الأسبوعية والتزايدية، مع تطبيق النمو مرة واحدة')} tone="primary" />
              <Stat label={L('Weekly full copies', 'نسخ كاملة أسبوعية')} value={result.fullCopies} hint={`${(result.fullCopies * result.fullGB).toFixed(0)} GB`} />
              <Stat label={L('Incremental total', 'إجمالي التزايدية')} value={`${result.incrementGB.toFixed(0)} GB`} hint={`${result.dailyChangeGB.toFixed(1)} GB/${L('day', 'يوم')}`} />
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

interface RecoveryDraft {
  id: string
  system: string
  tier: RecoveryRow['tier']
  rpo: string
  rto: string
}

const DEFAULT_DRAFTS: RecoveryDraft[] = DEFAULT_ROWS.map((row) => ({
  id: row.id,
  system: row.system,
  tier: row.tier,
  rpo: String(row.rpoHours),
  rto: String(row.rtoHours),
}))

function parseHours(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function RtoTool() {
  const L = useLabels()
  const [rows, setRows] = useState<RecoveryDraft[]>(DEFAULT_DRAFTS)
  const update = (id: string, patch: Partial<RecoveryDraft>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  const parsedRows = rows.map((row) => ({ row, rpo: parseHours(row.rpo), rto: parseHours(row.rto) }))
  const validRows: RecoveryRow[] = parsedRows.flatMap((entry) =>
    entry.rpo !== null && entry.rto !== null
      ? [{ id: entry.row.id, system: entry.row.system, tier: entry.row.tier, rpoHours: entry.rpo, rtoHours: entry.rto }]
      : [],
  )
  const invalidCount = rows.length - validRows.length
  const assessment = assessRecovery(validRows)

  return (
    <Card>
      <CardHeader
        title={L('RPO / RTO Planner', 'مخطط RPO / RTO')}
        actions={<Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRows((current) => [...current, { id: uid('sys'), system: '', tier: '2', rpo: '24', rto: '72' }])}>{L('Add system', 'إضافة نظام')}</Button>}
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
              {parsedRows.map(({ row, rpo, rto }) => (
                <tr key={row.id}>
                  <td className="p-1"><Input aria-label={L('System', 'النظام')} value={row.system} onChange={(event) => update(row.id, { system: event.target.value })} /></td>
                  <td className="p-1">
                    <Select aria-label={L('Tier', 'الفئة')} value={row.tier} onChange={(event) => update(row.id, { tier: event.target.value as RecoveryRow['tier'] })}>
                      <option value="0">Tier 0</option>
                      <option value="1">Tier 1</option>
                      <option value="2">Tier 2</option>
                    </Select>
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={L('RPO in hours', 'RPO بالساعات')}
                      type="number"
                      min={0}
                      step={0.25}
                      value={row.rpo}
                      onChange={(event) => update(row.id, { rpo: event.target.value })}
                      aria-invalid={rpo === null}
                      className={rpo === null ? 'border-danger' : undefined}
                      dir="ltr"
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label={L('RTO in hours', 'RTO بالساعات')}
                      type="number"
                      min={0}
                      step={0.5}
                      value={row.rto}
                      onChange={(event) => update(row.id, { rto: event.target.value })}
                      aria-invalid={rto === null}
                      className={rto === null ? 'border-danger' : undefined}
                      dir="ltr"
                    />
                  </td>
                  <td className="p-1">
                    <Button size="icon" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))} aria-label={L('Remove', 'إزالة')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invalidCount > 0 ? (
          <Alert tone="danger" title={L('Invalid hours', 'قيم ساعات غير صالحة')}>
            {L(
              `${invalidCount} row(s) have an empty or non-numeric RPO/RTO value. Those rows are left out of the totals until you enter a number of 0 or more.`,
              `${invalidCount} صفًا يحتوي RPO أو RTO فارغًا أو غير رقمي. تُستبعد هذه الصفوف من الإجماليات حتى تُدخل رقمًا صفرًا أو أكبر.`,
            )}
          </Alert>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label={L('Longest RPO', 'أطول RPO')} value={`${assessment.maxRpo} h`} tone="primary" />
          <Stat label={L('Longest RTO', 'أطول RTO')} value={`${assessment.maxRto} h`} />
          <Stat label={L('Tier 0 systems', 'أنظمة الفئة 0')} value={assessment.tier0Count} />
        </div>
        {assessment.warnings.length > 0 ? (
          <Alert tone="warning" title={L('Review these objectives', 'راجع هذه الأهداف')}>
            <ul className="list-inside list-disc">
              {assessment.warnings.map((warning) => <li key={warning} dir="auto">{warning}</li>)}
            </ul>
          </Alert>
        ) : invalidCount === 0 ? (
          <Alert tone="success">{L('No obvious inconsistencies in the entered objectives.', 'لا توجد تعارضات واضحة في الأهداف المدخلة.')}</Alert>
        ) : null}
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
          <Stat label={L('Renew by', 'جدّد قبل')} value={<span dir="ltr">{status.renewBy}</span>} />
          <Stat
            label={L('Status', 'الحالة')}
            value={status.expired ? L('Expired', 'منتهية') : status.warning ? L('Renew soon', 'جدّد قريبًا') : L('Healthy', 'سليمة')}
          />
        </div>
      ) : (
        <div className="p-4"><Alert tone="danger">{L('Enter a valid expiry date.', 'أدخل تاريخ انتهاء صالحًا.')}</Alert></div>
      )}
      <p className="px-4 pb-4 text-[10px] text-subtle" dir="auto">
        {L(
          'A date-only expiry is treated as valid through 23:59 of that day in your local time zone, so a certificate expiring today is not yet expired. Renewal lead time should account for approval and deployment, not only signing.',
          'يُعامل تاريخ الانتهاء بدون وقت على أنه صالح حتى 23:59 من ذلك اليوم حسب منطقتك الزمنية، لذلك الشهادة التي تنتهي اليوم لا تُعد منتهية بعد. يجب أن تراعي مهلة التجديد الموافقات والنشر لا التوقيع فقط.',
        )}
      </p>
    </Card>
  )
}
