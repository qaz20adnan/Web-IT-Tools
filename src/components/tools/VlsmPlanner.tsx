import { useMemo, useState } from 'react'
import { Download, Network, Plus, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, CopyButton, Field, Input } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { ipv4ToNumber, numberToIPv4, parseIPv4, subnetInfo } from '@/lib/calculators'
import type { Translator } from '@/lib/operations'
import { downloadTextFile, uid } from '@/lib/utils'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

interface Row {
  id: string
  name: string
  hosts: string
}

type AllocationStatus = 'allocated' | 'unallocated' | 'too-big' | 'invalid'

interface PlannedRow {
  id: string
  name: string
  required: number | null
  status: AllocationStatus
  prefix: number | null
  network: string | null
  mask: string | null
  wildcard: string | null
  first: string | null
  last: string | null
  broadcast: string | null
  usable: number | null
  blockSize: number | null
}

interface Base {
  start: number
  prefix: number
  size: number
  network: string
}

interface Plan {
  base: Base | null
  rows: PlannedRow[]
  used: number
  remaining: number
  allocatedCount: number
  missingCount: number
}

function usableForPrefix(prefix: number): number {
  if (prefix === 32) return 1
  if (prefix === 31) return 2
  return 2 ** (32 - prefix) - 2
}

function prefixForRequired(required: number): number | null {
  if (!Number.isFinite(required) || required < 1) return null
  for (let prefix = 32; prefix >= 0; prefix -= 1) {
    if (usableForPrefix(prefix) >= required) return prefix
  }
  return null
}

function parseBase(value: string): Base | null {
  const parts = value.trim().split('/')
  if (parts.length !== 2) return null
  const bytes = parseIPv4(parts[0])
  if (!bytes) return null
  const prefix = Number(parts[1])
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const start = (ipv4ToNumber(bytes) & mask) >>> 0
  return { start, prefix, size: 2 ** (32 - prefix), network: numberToIPv4(start) }
}

function planVlsm(baseCidr: string, rows: Row[]): Plan {
  const base = parseBase(baseCidr)
  const prepared = rows.map((row, index) => {
    const parsed = row.hosts.trim() === '' ? Number.NaN : Number(row.hosts)
    const required = Number.isInteger(parsed) && parsed >= 1 ? parsed : null
    return { id: row.id, name: row.name, index, required }
  })

  const byId = new Map<string, PlannedRow>()
  for (const entry of prepared) {
    byId.set(entry.id, {
      id: entry.id,
      name: entry.name,
      required: entry.required,
      status: entry.required === null ? 'invalid' : 'unallocated',
      prefix: null,
      network: null,
      mask: null,
      wildcard: null,
      first: null,
      last: null,
      broadcast: null,
      usable: null,
      blockSize: null,
    })
  }

  if (!base) {
    return { base: null, rows: prepared.map((entry) => byId.get(entry.id) as PlannedRow), used: 0, remaining: 0, allocatedCount: 0, missingCount: 0 }
  }

  const order = prepared
    .filter((entry) => entry.required !== null)
    .sort((a, b) => (b.required as number) - (a.required as number) || a.index - b.index)

  const baseEnd = base.start + base.size
  let cursor = base.start

  for (const entry of order) {
    const target = byId.get(entry.id) as PlannedRow
    const required = entry.required as number
    const prefix = prefixForRequired(required)

    if (prefix === null) {
      target.status = 'too-big'
      continue
    }
    target.prefix = prefix

    if (prefix < base.prefix) {
      target.status = 'too-big'
      target.blockSize = 2 ** (32 - prefix)
      continue
    }

    // An allocated block must start on a boundary of its own size, so round the
    // cursor up to the next multiple of blockSize before placing it.
    const blockSize = 2 ** (32 - prefix)
    const remainder = cursor % blockSize
    const alignedStart = remainder === 0 ? cursor : cursor + (blockSize - remainder)

    if (alignedStart + blockSize > baseEnd) {
      target.status = 'unallocated'
      target.blockSize = blockSize
      continue
    }

    const info = subnetInfo(numberToIPv4(alignedStart), prefix)
    if (!info) {
      target.status = 'unallocated'
      target.blockSize = blockSize
      continue
    }

    cursor = alignedStart + blockSize
    target.status = 'allocated'
    target.network = info.network
    target.mask = info.mask
    target.wildcard = info.wildcard
    target.first = info.firstHost
    target.last = info.lastHost
    target.broadcast = info.broadcast
    target.usable = info.usableHosts
    target.blockSize = blockSize
  }

  let used = 0
  let allocatedCount = 0
  let missingCount = 0
  for (const target of byId.values()) {
    if (target.status === 'allocated') {
      used += target.blockSize as number
      allocatedCount += 1
    } else if (target.status === 'unallocated' || target.status === 'too-big') {
      missingCount += 1
    }
  }

  return {
    base,
    rows: prepared.map((entry) => byId.get(entry.id) as PlannedRow),
    used,
    remaining: base.size - used,
    allocatedCount,
    missingCount,
  }
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function buildCsv(baseCidr: string, plan: Plan, t: Translator, statusLabel: (status: AllocationStatus) => string): string {
  const header = [
    t('Name', 'الاسم'),
    t('Required hosts', 'المضيفون المطلوبون'),
    t('Status', 'الحالة'),
    t('CIDR', 'المسندة CIDR'),
    t('Network', 'الشبكة'),
    t('Mask', 'القناع'),
    t('Wildcard', 'القناع العكسي'),
    t('First usable', 'أول عنوان متاح'),
    t('Last usable', 'آخر عنوان متاح'),
    t('Broadcast', 'عنوان البث'),
    t('Usable', 'المتاح'),
  ]
  const lines: string[][] = [header]
  lines.push([`${t('Base', 'الأساس')}: ${baseCidr}`])
  for (const row of plan.rows) {
    const cidr = row.prefix === null ? '' : row.network ? `${row.network}/${row.prefix}` : `--/${row.prefix}`
    lines.push([
      row.name,
      row.required === null ? '' : String(row.required),
      statusLabel(row.status),
      cidr,
      row.network ?? '',
      row.mask ?? '',
      row.wildcard ?? '',
      row.first ?? '',
      row.last ?? '',
      row.broadcast ?? '',
      row.usable === null ? '' : String(row.usable),
    ])
  }
  return lines.map((cols) => cols.map(csvCell).join(',')).join('\r\n')
}

export function VlsmTool() {
  const L = useLabels()
  const [baseCidr, setBaseCidr] = useState('192.168.10.0/24')
  const [rows, setRows] = useState<Row[]>([
    { id: uid('vlsm'), name: 'Servers', hosts: '20' },
    { id: uid('vlsm'), name: 'Users', hosts: '100' },
    { id: uid('vlsm'), name: 'Management', hosts: '10' },
  ])

  const plan = useMemo(() => planVlsm(baseCidr, rows), [baseCidr, rows])

  const updateRow = (id: string, patch: Partial<Omit<Row, 'id'>>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }
  const addRow = () => setRows((current) => [...current, { id: uid('vlsm'), name: '', hosts: '' }])
  const removeRow = (id: string) => setRows((current) => current.filter((row) => row.id !== id))

  const statusLabel = (status: AllocationStatus): string => {
    if (status === 'allocated') return L('Allocated', 'مُخصَّصة')
    if (status === 'unallocated') return L('Unallocated', 'غير مُخصَّصة')
    if (status === 'too-big') return L('Too big for base', 'أكبر من الشبكة الأساسية')
    return L('Invalid input', 'قيمة غير صالحة')
  }

  const csv = buildCsv(baseCidr, plan, L, statusLabel)

  const statusTone = (status: AllocationStatus): 'success' | 'warning' | 'danger' | 'default' => {
    if (status === 'allocated') return 'success'
    if (status === 'unallocated') return 'warning'
    if (status === 'too-big') return 'danger'
    return 'default'
  }

  return (
    <Card>
      <CardHeader
        title={L('VLSM Subnet Planner', 'مُخطِّط الشبكات الفرعية VLSM')}
        subtitle={L('Allocate multiple networks from one base block, largest first.', 'تخصيص عدة شبكات من كتلة أساسية واحدة، الأكبر أولًا.')}
        icon={<Network className="h-4 w-4" />}
      />

      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[22rem_1fr]">
          <Field label={L('Base network (CIDR)', 'الشبكة الأساسية (CIDR)')} htmlFor="vlsm-base">
            <Input id="vlsm-base" value={baseCidr} onChange={(event) => setBaseCidr(event.target.value)} dir="ltr" placeholder="192.168.10.0/24" />
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Badge tone="primary">{L('Base addresses', 'عناوين الأساس')}: {plan.base ? plan.base.size.toLocaleString() : '—'}</Badge>
            <Badge tone="success">{L('Used', 'المُستخدمة')}: {plan.used.toLocaleString()}</Badge>
            <Badge tone={plan.missingCount > 0 ? 'warning' : 'default'}>{L('Remaining', 'المتبقي')}: {plan.remaining.toLocaleString()}</Badge>
            <Badge>{plan.allocatedCount}/{plan.rows.length} {L('networks allocated', 'شبكة مُخصَّصة')}</Badge>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted">
          {L(
            'Each network is placed on a boundary aligned to its own size so blocks never overlap. Usable-host math matches the CIDR calculator: /31 gives two hosts and /32 gives one.',
            'تُوضع كل شبكة على حدّ مُحاذاة لحجمها حتى لا تتداخل الكتل. حساب المضيفين المتاحين مطابق لحاسبة CIDR: يعطي /31 مضيفين و/32 مضيفًا واحدًا.',
          )}
        </div>

        {plan.base ? null : (
          <Alert tone="danger">{L('Enter a valid base network in CIDR form, for example 192.168.10.0/24.', 'أدخل شبكة أساسية صحيغة بصيغة CIDR، مثل 192.168.10.0/24.')}</Alert>
        )}
        {plan.base && plan.missingCount > 0 ? (
          <Alert tone="warning" title={L('Address space exhausted', 'نفاد مساحة العناوين')}>
            {L('Not enough contiguous aligned space remains to allocate every requested network.', 'لم تبقَ مساحة مُتصلة ومُحاذاة كافية لتخصيص كل الشبكات المطلوبة.')}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addRow}>
            {L('Add network', 'إضافة شبكة')}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton value={csv} label={L('Copy as CSV', 'نسخ بصيغة CSV')} />
            <Button
              size="sm"
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => downloadTextFile('vlsm-plan.csv', csv, 'text/csv;charset=utf-8')}
            >
              {L('Download CSV', 'تنزيل CSV')}
            </Button>
          </div>
        </div>

        {rows.length === 0 ? (
          <Alert tone="info">{L('No networks yet. Add a row to start planning.', 'لا توجد شبكات بعد. أضف صفًا لبدء التخطيط.')}</Alert>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[56rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-subtle">
                  <th className="px-2 py-2 text-start font-medium">{L('Name', 'الاسم')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Required hosts', 'المضيفون المطلوبون')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('CIDR', 'المسندة CIDR')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Network', 'الشبكة')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Mask', 'القناع')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Wildcard', 'القناع العكسي')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Usable range', 'نطاق العناوين المتاحة')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Usable', 'المتاح')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Status', 'الحالة')}</th>
                  <th className="px-2 py-2 text-end font-medium">{L('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row, index) => {
                  const source = rows[index]
                  return (
                    <tr key={row.id} className="border-b border-line/70 align-middle">
                      <td className="px-2 py-2">
                        <Input
                          value={source?.name ?? ''}
                          onChange={(event) => updateRow(row.id, { name: event.target.value })}
                          placeholder={L('Network name', 'اسم الشبكة')}
                          className="min-w-32"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          type="number"
                          min={1}
                          dir="ltr"
                          aria-label={L('Required hosts', 'المضيفون المطلوبون')}
                          value={source?.hosts ?? ''}
                          onChange={(event) => updateRow(row.id, { hosts: event.target.value })}
                          className="w-24"
                        />
                      </td>
                      <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                        {row.prefix === null ? '—' : row.network ? `${row.network}/${row.prefix}` : `--/${row.prefix}`}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs" dir="ltr">{row.network ?? '—'}</td>
                      <td className="px-2 py-2 font-mono text-xs" dir="ltr">{row.mask ?? '—'}</td>
                      <td className="px-2 py-2 font-mono text-xs" dir="ltr">{row.wildcard ?? '—'}</td>
                      <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                        {row.first && row.last ? `${row.first} – ${row.last}` : '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs" dir="ltr">{row.usable === null ? '—' : row.usable.toLocaleString()}</td>
                      <td className="px-2 py-2">
                        <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1.5">
                          {row.network ? <CopyButton size="sm" variant="ghost" value={`${row.network}/${row.prefix}`} /> : null}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={L('Remove network', 'إزالة الشبكة')}
                            onClick={() => removeRow(row.id)}
                            icon={<Trash2 className="h-4 w-4" />}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  )
}
