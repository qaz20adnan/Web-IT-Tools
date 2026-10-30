import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Network, Plus, Trash2 } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CopyButton,
  EmptyState,
  Field,
  Input,
  Stat,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { analyzeCidrText, type CidrAnalysis, type CidrFindingKind, type CidrNetwork } from '@/lib/cidrGroups'
import { numberToIPv4 } from '@/lib/calculators'
import { downloadTextFile } from '@/lib/utils'
import { readJson, writeJson } from '@/lib/storage'

const STORAGE_KEY = 'nexora.cidr-plan.v1'

const SAMPLE = [
  '10.0.0.0/24, Servers, 10.0.0.1, 10.0.0.53',
  '10.0.0.128/25, Backup, 10.0.0.129',
  '10.0.1.0/24, Users, 10.0.1.1',
  '10.0.2.0/24, Wi-Fi, 10.0.3.1, 8.8.8.8',
  '10.0.1.64/26, Printers, 10.0.1.64',
].join('\n')

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

function useKindLabels() {
  const L = useLabels()
  return (kind: CidrFindingKind): { label: string; hint: string } => {
    switch (kind) {
      case 'invalid':
        return { label: L('Invalid entry', 'إدخال غير صالح'), hint: L('The line is not a readable IPv4 CIDR.', 'السطر ليس CIDR بصيغة IPv4 مقروءة.') }
      case 'misaligned':
        return { label: L('Misaligned network', 'شبكة غير مُحاذاة'), hint: L('Host bits are set; the block was probably mistyped.', 'بتات المضيف مضبوطة؛ كُتبت البادئة خطأ على الأرجح.') }
      case 'identical':
        return { label: L('Duplicate network', 'شبكة مكرَّرة'), hint: L('Two entries describe the very same block.', 'صفان يصفان الكتلة نفسها.') }
      case 'containment':
        return { label: L('Contained networks', 'تضمين كامل'), hint: L('One block sits entirely inside the other.', 'كتلة داخل الكتلة الأخرى بالكامل.') }
      case 'partial':
        return { label: L('Partial overlap', 'تداخل جزئي'), hint: L('The ranges intersect without containing each other.', 'يتقاطع النطاقان دون تضمين أحدهما للآخر.') }
      case 'address-outside':
        return { label: L('Address outside subnet', 'عنوان خارج الشبكة'), hint: L('A gateway or DNS address is not in its own network.', 'عنوان البوابة أو DNS لا يقع داخل الشبكة المنسوبة إليه.') }
      case 'address-reserved':
        return { label: L('Reserved address in use', 'عنوان محجوز مُستخدم'), hint: L('Assigned on the network or broadcast address.', 'مُخصَّص على عنوان الشبكة أو البث.') }
      case 'duplicate-address':
        return { label: L('Duplicate address', 'عنوان مكرر'), hint: L('The same address is assigned in more than one place.', 'العنوان نفسه مُخصَّص في أكثر من موضع.') }
      case 'foreign-address':
        return { label: L('Address in another subnet', 'عنوان في شبكة أخرى'), hint: L('Reachable, but it belongs to a different block.', 'قابل للوصول لكنه يخص كتلة أخرى.') }
      case 'default-route':
        return { label: L('Default route present', 'المسار الافتراضي'), hint: L('0.0.0.0/0 contains every other block by design.', 'عنوان 0.0.0.0/0 يحوي كل الشبكات الأخرى بحكم تعريفه، فلا يُعدّ ذلك تداخلًا معها.') }
      default:
        return { label: kind, hint: '' }
    }
  }
}

function statusOf(analysis: CidrAnalysis, network: CidrNetwork, L: (en: string, ar: string) => string): { label: string; tone: 'success' | 'danger' | 'warning' } {
  const mine = analysis.findings.filter((finding) => finding.networkIds.includes(network.id))
  if (mine.some((finding) => finding.severity === 'error')) return { label: L('Conflict', 'تعارض'), tone: 'danger' }
  if (mine.length > 0) return { label: L('Note', 'ملاحظة'), tone: 'warning' }
  return { label: L('Clean', 'سليمة'), tone: 'success' }
}

function hostRange(network: CidrNetwork): string {
  if (network.prefix >= 31) return `${network.network} – ${network.broadcast}`
  return `${numberToIPv4(network.start + 1)} – ${numberToIPv4(network.end - 1)}`
}

function buildReport(analysis: CidrAnalysis, baseText: string, L: (en: string, ar: string) => string): string {
  const label = kindReportLabel(L)
  const lines: string[] = []
  lines.push(L('# CIDR overlap report', '# تقرير تداخل CIDR'))
  lines.push('')
  lines.push(analysis.passed ? L('Result: PASS - no conflicts found.', 'النتيجة: ناجح - لا توجد تعارضات.') : L(`Result: FAIL - ${analysis.errorCount} conflict(s).`, `النتيجة: غير ناجح - ${analysis.errorCount} تعارضًا.`))
  lines.push(L(`Networks checked: ${analysis.networks.length}`, `الشبكات المفحوصة: ${analysis.networks.length}`))
  lines.push(L(`Errors: ${analysis.errorCount} / Warnings: ${analysis.warningCount}`, `الأخطاء: ${analysis.errorCount} / التحذيرات: ${analysis.warningCount}`))
  lines.push('')
  lines.push(L('## Networks', '## الشبكات'))
  for (const network of analysis.networks) {
    const parts = [network.cidr, L('mask', 'القناع') + ` ${network.mask}`, L('usable', 'المتاح') + ` ${hostRange(network)}`, L('broadcast', 'البث') + ` ${network.broadcast}`]
    if (network.gateway) parts.push(`GW ${network.gateway}`)
    if (network.dns.length) parts.push(`DNS ${network.dns.join(' ')}`)
    lines.push(`- ${parts.join(' | ')}`)
  }
  lines.push('')
  lines.push(L('## Findings', '## النتائج'))
  if (analysis.findings.length === 0) lines.push(L('- none', '- لا شيء'))
  for (const finding of analysis.findings) {
    lines.push(`- [${finding.severity === 'error' ? 'ERROR' : 'WARN'}] ${label(finding.kind)}: ${finding.detail}`)
  }
  lines.push('')
  lines.push(L('## Input', '## المدخل'))
  for (const line of baseText.split(/\r?\n/)) if (line.trim()) lines.push(`  ${line}`)
  return lines.join('\r\n')
}

function kindReportLabel(L: (en: string, ar: string) => string) {
  return (kind: CidrFindingKind): string => {
    if (kind === 'misaligned') return L('misaligned', 'غير مُحاذاة')
    if (kind === 'identical') return L('duplicate network', 'شبكة مكرَّرة')
    if (kind === 'containment') return L('containment', 'تضمين')
    if (kind === 'partial') return L('partial overlap', 'تداخل جزئي')
    if (kind === 'address-outside') return L('address outside subnet', 'عنوان خارج الشبكة')
    if (kind === 'address-reserved') return L('reserved address', 'عنوان محجوز')
    if (kind === 'duplicate-address') return L('duplicate address', 'عنوان مكرر')
    if (kind === 'foreign-address') return L('address in another subnet', 'عنوان في شبكة أخرى')
    if (kind === 'default-route') return L('default route', 'مسار افتراضي')
    return L('invalid entry', 'إدخال غير صالح')
  }
}

export function CidrOverlapTool() {
  const L = useLabels()
  const kindLabel = useKindLabels()
  const [text, setText] = useState<string>(() => readJson<string>(STORAGE_KEY, SAMPLE))
  const [draft, setDraft] = useState({ cidr: '', name: '', gateway: '' })

  const analysis = useMemo(() => analyzeCidrText(text), [text])
  const report = useMemo(() => buildReport(analysis, text, L), [analysis, text, L])

  const update = (next: string) => {
    setText(next)
    writeJson(STORAGE_KEY, next)
  }

  const addDraft = () => {
    const parts = [draft.cidr.trim(), draft.name.trim(), draft.gateway.trim()].filter((part, index) => Boolean(part) || index === 0)
    if (!draft.cidr.trim()) return
    const line = parts.join(', ')
    update(`${text.trimEnd()}${text.trim() ? '\n' : ''}${line}`)
    setDraft({ cidr: '', name: '', gateway: '' })
  }

  const removeLine = (index: number) => {
    const lines = text.split(/\r?\n/)
    update(lines.filter((_, position) => position !== index).join('\n'))
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('CIDR overlap / conflict detector', 'فاحص تداخل وتعارض CIDR')}
          subtitle={L('Check an addressing plan for overlapping networks, host-bit mistakes and address collisions.', 'فحص خطة عنونة الشبكات بحثًا عن التداخلات وأخطاء بتات المضيف وتصادم العناوين.')}
          icon={<Network className="h-4 w-4" />}
          actions={
            <div className="flex items-center gap-2">
              <CopyButton value={report} label={L('Copy report', 'نسخ التقرير')} />
              <Button size="sm" variant="secondary" icon={<Download className="h-3.5 w-3.5" />} onClick={() => downloadTextFile('cidr-overlap-report.txt', report)}>
                {L('Download', 'تنزيل')}
              </Button>
            </div>
          }
        />
        <div className="space-y-4 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Field label={L('Networks (one per line)', 'الشبكات (سطر لكل شبكة)')} htmlFor="cidr-list" hint={L('Format: CIDR, name, gateway, dns1 dns2 — commas, semicolons, pipes or tabs all work. A bare address is read as /32.', 'الصيغة: CIDR ثم الاسم ثم البوابة ثم عناوين DNS. تُقبل الفاصلة أو الفاصلة المنقوطة أو الخط العمودي أو Tab للفصل بين الحقول، والعنوان بلا بادئة يُعامل كـ /32.')}>
              <Textarea
                id="cidr-list"
                value={text}
                onChange={(event) => update(event.target.value)}
                dir="ltr"
                spellCheck={false}
                className="min-h-40 font-mono text-xs"
                placeholder="10.0.0.0/24, Servers, 10.0.0.1"
              />
            </Field>
            <div className="space-y-3">
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs font-semibold text-muted">{L('Result', 'النتيجة')}</p>
                <p className="mt-1 text-sm font-semibold" dir="auto">
                  {analysis.passed ? L('Pass — no conflicts', 'ناجح — لا تعارضات') : L(`Fail — ${analysis.errorCount} conflict(s)`, `غير ناجح — ${analysis.errorCount} تعارضًا`)}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="primary">{analysis.networks.length} {L('networks', 'شبكة')}</Badge>
                  <Badge tone={analysis.errorCount ? 'danger' : 'default'}>{analysis.errorCount} {L('errors', 'خطأ')}</Badge>
                  <Badge tone={analysis.warningCount ? 'warning' : 'default'}>{analysis.warningCount} {L('warnings', 'تحذير')}</Badge>
                </div>
              </div>
              <Field label={L('Add one network', 'إضافة شبكة واحدة')} htmlFor="cidr-add">
                <Input id="cidr-add" value={draft.cidr} onChange={(event) => setDraft({ ...draft, cidr: event.target.value })} placeholder="10.0.5.0/24" dir="ltr" />
              </Field>
              <Field label={L('Name', 'الاسم')} htmlFor="cidr-add-name">
                <Input id="cidr-add-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={L('Storage VLAN', 'شبكة التخزين')} />
              </Field>
              <Field label={L('Gateway', 'البوابة')} htmlFor="cidr-add-gw">
                <Input id="cidr-add-gw" value={draft.gateway} onChange={(event) => setDraft({ ...draft, gateway: event.target.value })} placeholder="10.0.5.1" dir="ltr" />
              </Field>
              <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={addDraft} disabled={!draft.cidr.trim()}>
                {L('Append to list', 'إضافة إلى القائمة')}
              </Button>
            </div>
          </div>

          {analysis.networks.length === 0 ? (
            <EmptyState title={L('Nothing to check yet', 'لا شيء للفحص بعد')} description={L('Paste a CIDR list or add a network above.', 'الصق قائمة شبكات CIDR أو أضف شبكة أعلاه.')} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label={L('Networks', 'الشبكات')} value={analysis.networks.length} />
                <Stat label={L('Overlapping pairs', 'أزواج متداخلة')} value={analysis.overlaps.length} tone={analysis.overlaps.length ? 'warning' : 'success'} />
                <Stat label={L('Conflict clusters', 'مجموعات التعارض')} value={analysis.clusters.length} tone={analysis.clusters.length ? 'warning' : undefined} />
                <Stat label={L('Invalid lines', 'أسطر غير صالحة')} value={analysis.invalid.length} tone={analysis.invalid.length ? 'warning' : undefined} />
              </div>

              {analysis.passed ? (
                <Alert tone="success" title={L('Clean addressing plan', 'خطة عنونة سليمة')}>
                  {L('No overlapping networks, no host-bit mistakes and no address collisions were found.', 'لم يُعثر على شبكات متداخلة ولا أخطاء بتات المضيف ولا تصادم عناوين.')}
                </Alert>
              ) : (
                <Alert tone="danger" title={L('Conflicts found', 'وُجدت تعارضات')}>
                  {L('Routing between these networks is ambiguous or an address is assigned twice. Fix the errors before pushing this plan to devices.', 'التوجيه بين هذه الشبكات غير واضح أو عنوان مُخصَّص مرتين. أصلح الأخطاء قبل تطبيق الخطة على الأجهزة.')}
                </Alert>
              )}

              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[58rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-[11px] uppercase tracking-wide text-subtle">
                      <th className="px-2 py-2 text-start font-medium">{L('Network', 'الشبكة')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('Name', 'الاسم')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('Mask', 'القناع')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('Usable range', 'النطاق المتاح')}</th>
                      <th className="px-2 py-2 text-start font-medium">{L('Gateway', 'البوابة')}</th>
                      <th className="px-2 py-2 text-start font-medium">DNS</th>
                      <th className="px-2 py-2 text-start font-medium">{L('Status', 'الحالة')}</th>
                      <th className="px-2 py-2 text-end font-medium">{L('Actions', 'إجراءات')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.networks.map((network) => {
                      const status = statusOf(analysis, network, L)
                      return (
                        <tr key={network.id} className="border-b border-line/70">
                          <td className="px-2 py-2 font-mono text-xs" dir="ltr">
                            {network.rawCidr === network.cidr ? network.cidr : `${network.rawCidr} → ${network.cidr}`}
                          </td>
                          <td className="px-2 py-2 text-xs">{network.name}</td>
                          <td className="px-2 py-2 font-mono text-xs" dir="ltr">{network.mask}</td>
                          <td className="px-2 py-2 font-mono text-xs" dir="ltr">{hostRange(network)}</td>
                          <td className="px-2 py-2 font-mono text-xs" dir="ltr">{network.gateway ?? '—'}</td>
                          <td className="px-2 py-2 font-mono text-xs" dir="ltr">{network.dns.length ? network.dns.join(', ') : '—'}</td>
                          <td className="px-2 py-2">
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex justify-end">
                              <Button
                                size="icon"
                                variant="ghost"
                                aria-label={L('Remove line', 'حذف السطر')}
                                icon={<Trash2 className="h-4 w-4" />}
                                onClick={() => removeLine(network.line - 1)}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                {analysis.findings.length === 0 ? (
                  <p className="flex items-center gap-2 text-xs text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    {L('No findings.', 'لا توجد نتائج.')}
                  </p>
                ) : (
                  analysis.findings.map((finding) => {
                    const labels = kindLabel(finding.kind)
                    return (
                      <div key={finding.id} className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 p-3 text-xs">
                        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${finding.severity === 'error' ? 'text-danger' : 'text-warning'}`} />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold" dir="auto">
                            {labels.label} <span className="font-normal text-subtle">— {labels.hint}</span>
                          </p>
                          <p className="mt-1 font-mono text-[11px] text-muted" dir="ltr">{finding.detail}</p>
                        </div>
                        <Badge tone={finding.severity === 'error' ? 'danger' : 'warning'}>{finding.severity === 'error' ? L('Error', 'خطأ') : L('Warning', 'تحذير')}</Badge>
                      </div>
                    )
                  })
                )}
              </div>

              <p className="text-[11px] text-subtle" dir="auto">
                {L(
                  `Overlap is decided on the canonical block, so a /8 covering a /24 is reported as containment and neighbours such as 10.0.1.0/24 and 10.0.2.0/24 are never flagged. A /31 link keeps both addresses and a /32 keeps its single address, so neither is treated as reserved.`,
                  'يُقاس التداخل على الكتلة القانونية (canonical) للعنوان، فيُسجَّل /8 يحوي /24 كتضمين، ولا تُعلَّم الشبكات المتجاورة مثل 10.0.1.0/24 و10.0.2.0/24 مطلقًا. رابط /31 يحتفظ بعنوانيه و/32 بعنوانه الوحيد، فلا يُعدّ أيٌّ منهما محجوزًا.',
                )}
              </p>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}
