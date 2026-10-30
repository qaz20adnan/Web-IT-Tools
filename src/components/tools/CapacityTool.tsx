import { useMemo, useState } from 'react'
import { Download, HardDrive, Ruler } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, CopyButton, Field, Input, Select, Stat } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import {
  BYTE_UNIT,
  CAPACITY_UNITS,
  capacityTable,
  divergence,
  formatCapacity,
  parseCapacity,
  toBytes,
  type CapacityRow,
  type CapacityUnit,
} from '@/lib/capacity'
import { downloadTextFile } from '@/lib/utils'
import { readJson, writeJson } from '@/lib/storage'

const STORAGE_KEY = 'nexora.capacity-input.v1'

const PRESETS = ['500 GB', '1 TB', '2 TB', '4 TB', '8 TB', '16 TB']

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

function num(value: number, max = 6): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', { maximumFractionDigits: max })
}

function exactBytes(bytes: number): string {
  return Number.isSafeInteger(Math.round(bytes)) ? Math.round(bytes).toLocaleString('en-US') : bytes.toExponential(6)
}

function unitName(unit: CapacityUnit, language: string): string {
  return language === 'ar' ? `${unit.symbol} — ${unit.name.ar}` : `${unit.symbol} — ${unit.name.en}`
}

export function CapacityTool() {
  const L = useLabels()
  const { settings } = useApp()
  const [input, setInput] = useState<{ size: string; unit: string }>(() => readJson(STORAGE_KEY, { size: '4 TB', unit: 'TB' }))

  const patch = (next: Partial<typeof input>) => {
    const merged = { ...input, ...next }
    setInput(merged)
    writeJson(STORAGE_KEY, merged)
  }

  const computed = useMemo(() => {
    const parsed = parseCapacity(input.size)
    const typedUnit = Boolean(parsed && parsed.unit.symbol !== 'B')
    const bytes = parsed === null ? null : typedUnit ? parsed.bytes : toBytes(parsed.value, input.unit)
    const rows = bytes === null ? [] : capacityTable(bytes)
    return {
      parsed,
      typedUnit,
      bytes,
      rows,
      activeSymbol: parsed && typedUnit ? parsed.unit.symbol : input.unit,
      binaryRows: rows.filter((row) => row.unit.system === 'binary'),
      decimalRows: rows.filter((row) => row.unit.system === 'decimal' && row.unit.exponent > 0),
      gap: bytes === null ? null : divergence(bytes),
    }
  }, [input.size, input.unit])

  const { parsed, typedUnit, bytes, binaryRows, decimalRows, activeSymbol, gap } = computed
  const tableRows: CapacityRow[] = bytes === null ? [] : [{ unit: BYTE_UNIT, value: bytes }, ...binaryRows, ...decimalRows]

  const report = useMemo(() => {
    if (bytes === null) return ''
    const lines = [
      L('Capacity conversion', 'تحويل السعة'),
      `${L('Input', 'المدخل')}: ${input.size.trim()}${typedUnit ? '' : ` ${input.unit}`}`,
      `${L('Exact bytes', 'البايتات الدقيقة')}: ${Math.round(bytes)}`,
      '',
      L('IEC binary — powers of 1024', 'IEC ثنائي — قوى 1024'),
      ...binaryRows.map((row) => `  ${num(row.value)} ${row.unit.symbol}`),
      '',
      L('JEDEC decimal — powers of 1000', 'JEDEC عشري — قوى 1000'),
      ...decimalRows.map((row) => `  ${num(row.value)} ${row.unit.symbol}`),
    ]
    if (gap) {
      lines.push(
        '',
        `${L('Divergence', 'الفرق')}: ${num(gap.decimalValue)} ${gap.decimalUnit.symbol} = ${num(gap.binaryValue)} ${gap.binaryUnit.symbol}`,
        `${L('Shortfall', 'النقص')}: ${gap.shortfallPercent.toFixed(2)} %`,
      )
    }
    return lines.join('\r\n')
  }, [bytes, input.size, input.unit, typedUnit, binaryRows, decimalRows, gap, L])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('Storage capacity unit converter', 'محوّل وحدات سعة التخزين')}
          subtitle={L('IEC binary (KiB, GiB, TiB) and JEDEC decimal (KB, GB, TB): the same bytes, two different numbers.', 'وحدات IEC الثنائية (KiB وGiB وTiB) ووحدات JEDEC العشرية (KB وGB وTB): البايتات نفسها ورقمان مختلفان.')}
          icon={<HardDrive className="h-4 w-4" />}
          actions={
            <div className="flex items-center gap-2">
              <CopyButton value={report} label={L('Copy', 'نسخ')} />
              {report ? (
                <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadTextFile('capacity-conversion.txt', report)}>
                  {L('Download', 'تنزيل')}
                </Button>
              ) : null}
            </div>
          }
        />
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <Field
              label={L('Size', 'الحجم')}
              htmlFor="cap-size"
              hint={L('A figure with a unit, or a bare number that uses the unit on the right. Examples: 1.5TiB, 4 TB, 32768.', 'رقم مع وحدة، أو رقم مجرد يتبع الوحدة في الحقل المجاور. أمثلة: 1.5TiB و4 TB و32768.')}
            >
              <Input id="cap-size" value={input.size} onChange={(event) => patch({ size: event.target.value })} dir="ltr" placeholder="1.5TiB" />
            </Field>
            <Field label={L('Unit for a bare number', 'وحدة الرقم المجرد')} htmlFor="cap-unit" hint={typedUnit ? L('The typed unit wins.', 'الوحدة المكتوبة هي المعتمدة.') : undefined}>
              <Select id="cap-unit" value={activeSymbol} onChange={(event) => patch({ unit: event.target.value })} disabled={typedUnit}>
                {CAPACITY_UNITS.filter((unit) => unit.exponent > 0).map((unit) => (
                  <option key={unit.symbol} value={unit.symbol}>
                    {unitName(unit, settings.language)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold text-muted">{L('Marketing sizes', 'أحجام المصنّعين')}</span>
            {PRESETS.map((preset) => (
              <Button
                key={preset}
                size="sm"
                variant={input.size.trim().toLowerCase() === preset.toLowerCase() ? 'primary' : 'secondary'}
                className="font-mono"
                onClick={() => patch({ size: preset, unit: preset.split(' ')[1] })}
              >
                {preset}
              </Button>
            ))}
          </div>

          {parsed === null && input.size.trim() !== '' ? (
            <Alert tone="danger">{L('That is not a readable size. Use a number with a unit such as 500 GB, 2TiB or 65536.', 'هذه ليست سعة مقروءة. استخدم رقمًا مع وحدة مثل 500 GB أو 2TiB أو 65536.')}</Alert>
          ) : null}

          {parsed?.ambiguous ? (
            <Alert tone="warning" title={L('Ambiguous unit', 'وحدة غامضة')}>
              <span dir="auto">
                {L(
                  `The single letter "${parsed.unit.symbol[0]}" does not state which system you mean, so it is read as ${parsed.unit.symbol} = ${num(parsed.unit.factor)} bytes. Write KiB or GiB when you mean the 1024-based unit.`,
                  `الحرف المفرد "${parsed.unit.symbol[0]}" لا يحدد النظام المقصود، لذا يُقرأ ${parsed.unit.symbol} أي ${num(parsed.unit.factor)} بايت. اكتب KiB أو GiB عندما تقصد الوحدة المعتمدة على 1024.`,
                )}
              </span>
            </Alert>
          ) : null}

          {bytes === null ? null : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label={L('Exact bytes', 'البايتات الدقيقة')} value={exactBytes(bytes)} hint={L('The only unambiguous number', 'الرقم الوحيد بلا غموض')} tone="primary" />
                <Stat label={L('IEC binary', 'ثنائي IEC')} value={formatCapacity(bytes, 'binary')} hint={L('What an OS reports', 'ما يعرضه نظام التشغيل')} />
                <Stat label={L('JEDEC decimal', 'عشري JEDEC')} value={formatCapacity(bytes, 'decimal')} hint={L('What the label advertises', 'ما يعلنه المصنّع على الملصق')} tone="accent" />
                <Stat
                  label={L('Binary vs decimal gap', 'الفارق بين الثنائي والعشري')}
                  value={gap ? `${gap.shortfallPercent.toFixed(2)} %` : '—'}
                  hint={gap ? L(`${num(gap.binaryValue, 3)} ${gap.binaryUnit.symbol} instead of ${num(gap.decimalValue, 3)} ${gap.decimalUnit.symbol}`, `${num(gap.binaryValue, 3)} ${gap.binaryUnit.symbol} بدل ${num(gap.decimalValue, 3)} ${gap.decimalUnit.symbol}`) : undefined}
                  tone={gap && gap.shortfallPercent >= 1 ? 'warning' : undefined}
                />
              </div>

              {gap ? (
                <Alert tone="info" title={L('Why the two numbers disagree', 'لماذا يختلف الرقمان')}>
                  <span dir="auto">
                    {L(
                      `A disk sold as ${num(gap.decimalValue, 3)} ${gap.decimalUnit.symbol} holds ${exactBytes(bytes)} bytes. Dividing that by 1024 repeatedly, an operating system shows ${num(gap.binaryValue, 3)} ${gap.binaryUnit.symbol}: the number is ${gap.shortfallPercent.toFixed(2)} % smaller, and asking for ${num(gap.decimalValue, 3)} ${gap.binaryUnit.symbol} would need ${num(gap.labelGapBytes / gap.decimalUnit.factor, 3)} ${gap.decimalUnit.symbol} more. Nothing disappeared — the two systems count differently.`,
                      `القرص المُسوّق بحجم ${num(gap.decimalValue, 3)} ${gap.decimalUnit.symbol} يحوي ${exactBytes(bytes)} بايت. وعند قسمته على 1024 تكرارًا يعرض نظام التشغيل ${num(gap.binaryValue, 3)} ${gap.binaryUnit.symbol}، أي أن الرقم أقل بنسبة ${gap.shortfallPercent.toFixed(2)} %، ولو طلبت ${num(gap.decimalValue, 3)} ${gap.binaryUnit.symbol} لاحتجت ${num(gap.labelGapBytes / gap.decimalUnit.factor, 3)} ${gap.decimalUnit.symbol} إضافية. لم يختفِ شيء؛ النظامان يعدّان بطريقتين.`,
                    )}
                  </span>
                </Alert>
              ) : (
                <Alert tone="info">{L('At this size the two systems differ only by a few bytes; the divergence matters from the kilo range upward.', 'عند هذا الحجم يقتصر الفرق على بضع بايتات؛ ويظهر الاختلاف من نطاق الكيلو فأكبر.')}</Alert>
              )}

              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wide text-subtle">
                      <th className="px-2 py-2 text-start font-medium">{L('Unit', 'الوحدة')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('System', 'النظام')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('Bytes per unit', 'بايت لكل وحدة')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('This size', 'هذا الحجم')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.unit.symbol} className={row.unit.symbol === activeSymbol ? 'border-b border-line/70 bg-surface-3' : 'border-b border-line/70'}>
                        <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">
                          {row.unit.symbol}
                          <span className="ms-2 font-sans text-[11px] text-subtle">{settings.language === 'ar' ? row.unit.name.ar : row.unit.name.en}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge tone={row.unit.exponent === 0 ? 'default' : row.unit.system === 'binary' ? 'primary' : 'accent'}>
                            {row.unit.exponent === 0
                              ? L('base', 'الأساس')
                              : row.unit.system === 'binary'
                                ? L('binary · ×1024', 'ثنائي ×1024')
                                : L('decimal · ×1000', 'عشري ×1000')}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">{row.unit.factor.toLocaleString('en-US')}</td>
                        <td className="px-2 py-1.5 font-mono text-xs" dir="ltr">{num(row.value, row.unit.exponent === 0 ? 0 : 6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs text-muted">
                <p className="flex items-center gap-1.5 font-semibold text-text">
                  <Ruler className="h-3.5 w-3.5 text-primary" />
                  {L('Reading the units', 'كيف تقرأ الوحدات')}
                </p>
                <ul className="mt-2 space-y-1.5">
                  <li dir="auto">
                    {L(
                      'KB/MB/GB/TB are powers of 1000 — the vendor and network-throughput convention: 1 TB = 1 000 000 000 000 bytes.',
                      'وحدات KB وMB وGB وTB قوى 1000، وهي عُرفة المصنّعين وقياس إنتاجية الشبكات: 1 TB = 1 000 000 000 000 بايت.',
                    )}
                  </li>
                  <li dir="auto">
                    {L(
                      'KiB/MiB/GiB/TiB are powers of 1024 — what operating systems report for RAM and filesystems: 1 TiB = 1 099 511 627 776 bytes.',
                      'وحدات KiB وMiB وGiB وTiB قوى 1024، وهي ما يعرضه نظام التشغيل للذاكرة وأنظمة الملفات: 1 TiB = 1 099 511 627 776 بايت.',
                    )}
                  </li>
                  <li dir="auto">
                    {L(
                      'The gap widens as sizes grow: about 7 % at the gigabyte range and over 20 % at petabytes, which is why RAID and backup figures quoted in GB rarely match what a server reports.',
                      'يتّسع الفارق مع كبر الحجم: نحو 7 % عند الجيجابايت وأكثر من 20 % عند البتابايت، ولذلك نادرًا ما تطابق أرقام RAID والنسخ الاحتياطي المذكورة بـ GB ما تُعلنه الخوادم.',
                    )}
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
