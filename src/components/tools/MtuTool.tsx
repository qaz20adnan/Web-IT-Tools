import { useMemo, useState } from 'react'
import { Gauge, Ruler } from 'lucide-react'
import { Alert, Badge, Card, CardHeader, Checkbox, CopyButton, Field, Input, Select } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import {
  ENCAP_PROFILES,
  MIN_IPV4_MTU,
  MIN_IPV6_LINK_MTU,
  MIN_TCP_MSS,
  computeMtu,
  profileFor,
  type EncapId,
  type InnerFamily,
  type MtuFinding,
  type MtuResult,
  type Underlay,
} from '@/lib/mtu'
import { readJson, writeJson } from '@/lib/storage'

const STORAGE_KEY = 'nexora.mtu-config.v1'

function useLabels() {
  const { settings } = useApp()
  return (en: string, ar: string) => (settings.language === 'ar' ? ar : en)
}

type Labels = (en: string, ar: string) => string

function findingText(finding: MtuFinding, L: Labels): { tone: 'danger' | 'warning'; title: string; body: string } {
  const v = finding.values
  switch (finding.kind) {
    case 'encap-exceeds-link':
      return {
        tone: 'danger',
        title: L('Encapsulation is larger than the link', 'التغليف أكبر من الرابط'),
        body: L(
          `${v.overhead} bytes of overhead against a ${v.linkMtu} byte MTU leaves no payload space. Raise the underlay MTU or choose a cheaper encapsulation.`,
          `${v.overhead} بايت من الكلفة مقابل MTU طوله ${v.linkMtu} لا تترك أي حيز للبيانات. ارفع MTU الشبكة التحتية أو اختر تغليفًا أقل كلفة.`,
        ),
      }
    case 'below-ipv4-minimum':
      return {
        tone: 'danger',
        title: L('Below the IPv4 minimum of 68 bytes', 'أقل من الحد الأدنى IPv4 وهو 68 بايت'),
        body: L(
          `The tunnel would carry only ${v.payloadMtu} bytes. RFC 791 requires every IPv4 host to reassemble 68 bytes, so the figure is clamped to ${MIN_IPV4_MTU} and the path is unusable in practice.`,
          `لن يحمل النفق سوى ${v.payloadMtu} بايت. يُلزم RFC 791 كل مضيف IPv4 بإعادة تجميع 68 بايت، لذا تُثبَّت القيمة عند ${MIN_IPV4_MTU} والمسار غير عملي.`,
        ),
      }
    case 'below-ipv6-minimum':
      return {
        tone: 'warning',
        title: L('Under the IPv6 floor of 1280 bytes', 'أقل من حد IPv6 البالغ 1280 بايت'),
        body: L(
          `Only ${v.effectiveMtu} bytes remain. IPv6 requires 1280-byte link MTUs, so IPv6 over this tunnel needs fragment headers and many firewalls drop the result.`,
          `يتبقى ${v.effectiveMtu} بايت فقط. يشترط IPv6 روابط بطول 1280 بايت، لذا يحتاج IPv6 هنا ترويسات تجزئة وغالبًا تحجبها الجدران النارية.`,
        ),
      }
    case 'configured-above-available':
      return {
        tone: 'danger',
        title: L('Configured MTU exceeds the path', 'MTU المضبوط أكبر مما يحمله المسار'),
        body: L(
          `The interface is set to ${v.configured} but only ${v.available} bytes survive the encapsulation. Larger packets fragment when DF is clear; when DF is set they are dropped, and if ICMP "need-to-know" is blocked the connection black-holes — big TLS handshakes, SSH logins and file uploads stall while small traffic looks healthy.`,
          `الواجهة مضبوطة على ${v.configured} لكن ${v.available} بايت فقط تنجو من التغليف. الحزم الأكبر تتجزأ إذا رُفع علم DF، وتُسقَط إذا ضُبِط، وإذا حُجبت رسائل ICMP "need-to-know" عن المسار تُصبح الاتصالات صامتة: مصافحات TLS الكبيرة وتسجيل الدخول عبر SSH ورفع الملفات تتوقف بينما يبدو المرور الصغير سليمًا.`,
        ),
      }
    case 'mss-below-536':
      return {
        tone: 'warning',
        title: L('MSS below 536 bytes', 'قيمة MSS أقل من 536 بايت'),
        body: L(
          `The computed MSS is ${v.mss}. RFC 1122 obliges hosts to accept at least ${MIN_TCP_MSS}, so smaller segments work but header cost dominates and throughput collapses.`,
          `قيمة MSS المحسوبة ${v.mss} بايت. يُلزم RFC 1122 المضيفين بقبول ${MIN_TCP_MSS} بايتًا على الأقل، لذا تعمل المقاطع الأصغر لكن كلفة الترويسات تسيطر فينخفض الإنتاج.`,
        ),
      }
    case 'link-below-ipv6-minimum':
      return {
        tone: 'warning',
        title: L('IPv6 configured below 1280', 'إعداد IPv6 أقل من 1280'),
        body: L(
          `A tunnel MTU of ${v.configured} is below the ${MIN_IPV6_LINK_MTU}-byte IPv6 minimum; use the IPv6 fragmentation header or raise it.`,
          `MTU النفق ${v.configured} أقل من حد IPv6 البالغ ${MIN_IPV6_LINK_MTU} بايت؛ استخدم ترويسة التجزئة أو ارفع القيمة.`,
        ),
      }
    default:
      return { tone: 'warning', title: finding.kind, body: '' }
  }
}

function summarize(result: MtuResult, L: Labels): string {
  const profile = profileFor(result.encap)
  const lines = [
    `${L('Base MTU', 'MTU الأساسي')}: ${result.linkMtu}`,
    `${L('Encapsulation', 'التغليف')}: ${profile.name.en} / ${profile.name.ar}`,
    `${L('Overhead', 'كلفة التغليف')}: ${result.overhead} bytes`,
    `${L('Payload MTU', 'MTU الحمولة')}: ${result.payloadMtu}`,
    `${L('Effective MTU', 'MTU الفعلي')}: ${result.effectiveMtu}`,
    `MSS (${result.innerFamily.toUpperCase()}/TCP): ${result.mss}`,
    '',
    L('Breakdown', 'التفصيل'),
    ...result.parts.map((part) => `  ${part.bytes} B  ${part.name.en}`),
  ]
  return lines.join('\r\n')
}

export function MtuTool() {
  const L = useLabels()
  const [config, setConfig] = useState(() =>
    readJson<{ linkMtu: number; encap: EncapId; underlay: Underlay; innerFamily: InnerFamily; configuredMtu: string; jumbo: string; mssClamp: boolean }>(STORAGE_KEY, {
      linkMtu: 1500,
      encap: 'vxlan' as EncapId,
      underlay: 'ipv4' as Underlay,
      innerFamily: 'ipv4' as InnerFamily,
      configuredMtu: '1500',
      jumbo: '9000',
      mssClamp: false,
    }),
  )

  const patch = (next: Partial<typeof config>) => {
    const merged = { ...config, ...next }
    setConfig(merged)
    writeJson(STORAGE_KEY, merged)
  }

  const configured = config.configuredMtu.trim() === '' ? null : Number(config.configuredMtu)
  const jumbo = config.jumbo.trim() === '' ? null : Number(config.jumbo)

  const result = useMemo(
    () =>
      computeMtu({
        linkMtu: Number.isFinite(config.linkMtu) ? config.linkMtu : 1500,
        encap: config.encap,
        underlay: config.underlay,
        innerFamily: config.innerFamily,
        configuredMtu: configured,
        mssClamp: config.mssClamp,
      }),
    [config.linkMtu, config.encap, config.underlay, config.innerFamily, configured, config.mssClamp],
  )

  const jumboResult = useMemo(() => {
    if (!jumbo || !Number.isFinite(jumbo) || jumbo <= 0 || jumbo === config.linkMtu) return null
    return computeMtu({ linkMtu: jumbo, encap: config.encap, underlay: config.underlay, innerFamily: config.innerFamily })
  }, [jumbo, config.encap, config.underlay, config.innerFamily, config.linkMtu])

  const profile = profileFor(result.encap)
  const summary = summarize(result, L)

  const cell = 'px-2 py-1.5 font-mono text-xs'

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={L('MTU & tunnel overhead calculator', 'حاسبة MTU وكلفة الأنفاق')}
          subtitle={L('Payload MTU, TCP MSS and the header cost of each encapsulation.', 'حساب MTU الحمولة وMSS لكلفة الترويسات لكل نوع تغليف.')}
          icon={<Gauge className="h-4 w-4" />}
          actions={<CopyButton value={summary} label={L('Copy summary', 'نسخ الملخص')} />}
        />
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={L('Base interface MTU', 'MTU الواجهة الأساسية')} htmlFor="mtu-base" hint={L('Usually 1500, or 9000 on a jumbo-enabled link.', 'غالبًا 1500، أو 9000 على رابط بإطارات ضخمة.')}>
              <Input
                id="mtu-base"
                type="number"
                min={0}
                dir="ltr"
                inputMode="numeric"
                value={config.linkMtu}
                onChange={(event) => patch({ linkMtu: Number(event.target.value) })}
              />
            </Field>
            <Field label={L('Encapsulation', 'نوع التغليف')} htmlFor="mtu-encap">
              <Select id="mtu-encap" value={config.encap} onChange={(event) => patch({ encap: event.target.value as EncapId })}>
                {ENCAP_PROFILES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name.en} — {entry.name.ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={L('Underlay header family', 'ترويسة الشبكة التحتية (underlay)')} htmlFor="mtu-underlay" hint={profile.underlayFixed ? L('Fixed by the encapsulation.', 'ثابتة بحسب نوع التغليف.') : L('The IP header that delivers the tunnel.', 'ترويسة IP التي تنقل حزمة النفق.')}>
              <Select
                id="mtu-underlay"
                value={profile.underlayFixed ?? config.underlay}
                disabled={Boolean(profile.underlayFixed)}
                onChange={(event) => patch({ underlay: event.target.value as Underlay })}
              >
                <option value="ipv4">IPv4 (20 B)</option>
                <option value="ipv6">IPv6 (40 B)</option>
              </Select>
            </Field>
            <Field label={L('Payload protocol', 'بروتوكول الحمولة')} htmlFor="mtu-inner">
              <Select id="mtu-inner" value={config.innerFamily} onChange={(event) => patch({ innerFamily: event.target.value as InnerFamily })}>
                <option value="ipv4">TCP / IPv4 (−40 B)</option>
                <option value="ipv6">TCP / IPv6 (−60 B)</option>
              </Select>
            </Field>
            <Field label={L('Configured tunnel MTU (optional)', 'MTU النفق المضبوط (اختياري)')} htmlFor="mtu-configured" hint={L('Compare what the interface actually advertises.', 'للمقارنة مع ما تعلنه الواجهة فعليًا.')}>
              <Input id="mtu-configured" value={config.configuredMtu} onChange={(event) => patch({ configuredMtu: event.target.value })} dir="ltr" inputMode="numeric" placeholder="1500" />
            </Field>
            <Field label={L('Jumbo MTU to compare (optional)', 'MTU الضخم للمقارنة (اختياري)')} htmlFor="mtu-jumbo" hint={L('Shown side by side, never applied automatically.', 'يُعرض للمقارنة فقط ولا يُطبَّق تلقائيًا.')}>
              <Input id="mtu-jumbo" value={config.jumbo} onChange={(event) => patch({ jumbo: event.target.value })} dir="ltr" inputMode="numeric" placeholder="9000" />
            </Field>
          </div>

          <div className="flex items-center">
            <Checkbox
              checked={config.mssClamp}
              onChange={(event) => patch({ mssClamp: event.target.checked })}
              label={L('MSS clamping is available on this path', 'خاصية MSS clamping متاحة على هذا المسار')}
              description={L('SYN segments get their MSS rewritten to the path MTU instead of the interface MTU.', 'تُعاد صياغة MSS في مقاطع SYN ليكون مساويًا لـ MTU المسار بدل MTU الواجهة.')}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card card-pad">
              <p className="text-xs font-medium text-muted">{L('Encapsulation overhead', 'كلفة التغليف')}</p>
              <p className="stat-value mt-1.5" dir="ltr">{result.overhead} B</p>
            </div>
            <div className="card card-pad">
              <p className="text-xs font-medium text-muted">{L('Payload MTU', 'MTU الحمولة')}</p>
              <p className="stat-value mt-1.5" dir="ltr">{result.payloadMtu} B</p>
            </div>
            <div className="card card-pad">
              <p className="text-xs font-medium text-muted">{L('TCP MSS', 'قيمة MSS')}</p>
              <p className="stat-value mt-1.5" dir="ltr">{result.mss} B</p>
              <p className="mt-0.5 text-xs text-subtle" dir="ltr">−{result.tcpOverhead} B ({result.innerFamily.toUpperCase()})</p>
            </div>
            <div className="card card-pad">
              <p className="text-xs font-medium text-muted">{L('Effective MTU', 'MTU الفعلي')}</p>
              <p className="stat-value mt-1.5" dir="ltr">{result.effectiveMtu} B</p>
              <p className="mt-0.5 text-xs text-subtle" dir="auto">
                {result.floorApplied ? L(`Clamped to the ${MIN_IPV4_MTU}-byte IPv4 minimum`, `مثبَّت عند حد IPv4 الأدنى ${MIN_IPV4_MTU} بايت`) : L('No floor applied', 'بلا تثبيت عند الحد')}
              </p>
            </div>
          </div>

          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-subtle">
                  <th className="px-2 py-2 text-start font-medium">{L('Header component', 'مكوّن الترويسة')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Bytes', 'البايتات')}</th>
                  <th className="px-2 py-2 text-start font-medium">{L('Cumulative', 'التراكمي')}</th>
                </tr>
              </thead>
              <tbody>
                {result.parts.map((part, index) => {
                  const running = result.parts.slice(0, index + 1).reduce((total, entry) => total + entry.bytes, 0)
                  return (
                    <tr key={part.name.en} className="border-b border-line/70">
                      <td className="px-2 py-1.5 text-xs" dir="auto">{part.name.en} — {part.name.ar}</td>
                      <td className={cell} dir="ltr">{part.bytes}</td>
                      <td className={cell} dir="ltr">{running}</td>
                    </tr>
                  )
                })}
                <tr>
                  <td className="px-2 py-1.5 text-xs font-semibold">{L('Total added by the tunnel', 'الإجمالي المضاف بالنفق')}</td>
                  <td className={cell} dir="ltr">{result.overhead}</td>
                  <td className={cell} dir="ltr">{result.linkMtu} − {result.overhead} = {result.payloadMtu}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {jumboResult ? (
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-xs font-semibold" dir="auto">{L('Jumbo comparison', 'مقارنة مع الإطارات الضخمة')}</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[28rem] border-collapse text-xs">
                  <thead>
                    <tr className="text-subtle">
                      <th className="px-2 py-1 text-start font-medium">{L('Base MTU', 'MTU الأساسي')}</th>
                      <th className="px-2 py-1 text-start font-medium">{L('Payload MTU', 'حمولة MTU')}</th>
                      <th className="px-2 py-1 text-start font-medium">{L('TCP MSS', 'MSS')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[result, jumboResult].map((entry) => (
                      <tr key={entry.linkMtu} className="border-t border-line/70">
                        <td className={cell} dir="ltr">{entry.linkMtu}</td>
                        <td className={cell} dir="ltr">{entry.payloadMtu}</td>
                        <td className={cell} dir="ltr">{entry.mss}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted" dir="auto">
                {L(
                  'Jumbo frames only pay off if every switch, NIC and router in the underlay is set to the same size; a single 1500-byte hop puts them back at the standard figure.',
                  'الإطارات الضخمة مفيدة فقط إذا ضُبطت كل المبادلات وبطاقات الشبكة والموجّهات في الشبكة التحتية على الحجم نفسه؛ قفزة واحدة بطول 1500 تعيدك إلى القيمة الاعتيادية.',
                )}
              </p>
            </div>
          ) : null}

          {result.findings.map((finding) => {
            const text = findingText(finding, L)
            return (
              <Alert key={finding.kind} tone={text.tone} title={text.title}>
                <span dir="auto">{text.body}</span>
              </Alert>
            )
          })}

          <div className="rounded-lg border border-line p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <Ruler className="h-3.5 w-3.5 text-primary" />
              {L('Assumptions behind these numbers', 'الفرضيات خلف هذه الأرقام')}
            </p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted">
              {profile.assumptions.map((assumption) => (
                <li key={assumption.en} dir="auto">• {assumption.en} — {assumption.ar}</li>
              ))}
              <li dir="auto">
                •{' '}
                {L(
                  'The payload MTU is the largest IP packet the tunnel carries; Ethernet preamble, start-of-frame and the 4-byte FCS are outside the 1500-byte figure.',
                  'MTU الحمولة هو أكبر حزمة IP ينقلها النفق؛ مقدمات Ethernet وبداية الإطار وFCS بطول 4 بايت خارج حساب 1500 بايت.',
                )}
              </li>
              <li dir="auto">
                •{' '}
                {L(
                  'IP options, TCP timestamps and any headers beyond those listed are not modelled — a real path is usually a few bytes tighter.',
                  'خيارات IP وطوابع TCP وأي ترويسات غير المدرجة هنا غير محسوبة؛ المسار الفعلي أضيق بضع بايتات غالبًا.',
                )}
              </li>
            </ul>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted">{L('Apply it', 'التطبيق')}</p>
            {result.commands.map((command) => (
              <div key={command} className="flex items-center gap-2">
                <code className="min-w-0 flex-1 overflow-x-auto rounded border border-line bg-[var(--code-bg)] px-2 py-1 font-mono text-[11px]" dir="ltr">
                  {command}
                </code>
                <CopyButton size="sm" variant="ghost" value={command} />
              </div>
            ))}
            <p className="text-[11px] text-subtle" dir="auto">
              {L('Replace <iface> with your real interface name and confirm the value on every hop before you push it.', 'استبدل <iface> باسم الواجهة الحقيقي وتحقق من القيمة على كل قفزة قبل التطبيق.')}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="primary" className="font-mono">{L('IPv4 min', 'حد IPv4')} {MIN_IPV4_MTU}</Badge>
            <Badge tone="primary" className="font-mono">{L('IPv6 min', 'حد IPv6')} {MIN_IPV6_LINK_MTU}</Badge>
            <Badge tone="primary" className="font-mono">{L('TCP min MSS', 'أقل MSS')} {MIN_TCP_MSS}</Badge>
          </div>
        </div>
      </Card>
    </div>
  )
}
