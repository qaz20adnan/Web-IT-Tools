export type Underlay = 'ipv4' | 'ipv6'
export type InnerFamily = 'ipv4' | 'ipv6'

export type EncapId =
  | 'none'
  | 'pppoe'
  | 'gre'
  | 'gre-key'
  | 'vxlan'
  | 'wireguard'
  | 'ipsec-transport'
  | 'ipsec-tunnel'
  | 'ipsec-tunnel-natt'
  | '6in4'

export interface LocalizedText {
  en: string
  ar: string
}

export interface HeaderPart {
  name: LocalizedText
  bytes: number
}

export interface EncapProfile {
  id: EncapId
  name: LocalizedText
  underlayFixed?: Underlay
  parts: (underlay: Underlay) => HeaderPart[]
  assumptions: LocalizedText[]
}

export const MIN_IPV4_MTU = 68
export const MIN_IPV6_LINK_MTU = 1280
export const MIN_TCP_MSS = 536

export const ENCAP_PROFILES: EncapProfile[] = [
  {
    id: 'none',
    name: { en: 'None (plain Ethernet)', ar: 'بدون تغليف (Ethernet اعتيادي)' },
    parts: () => [],
    assumptions: [{ en: 'No tunnel or extra layer-2 header is added.', ar: 'لا تُضاف أي ترويسة نفق أو طبقة ثانية إضافية.' }],
  },
  {
    id: 'pppoe',
    name: { en: 'PPPoE', ar: 'PPPoE' },
    parts: () => [
      { name: { en: 'PPPoE session header', ar: 'ترويسة جلسة PPPoE' }, bytes: 6 },
      { name: { en: 'PPP protocol field', ar: 'حقل بروتوكول PPP' }, bytes: 2 },
    ],
    assumptions: [
      {
        en: 'Assumes ACCM negotiation compressed the PPP control field (the usual default), giving the familiar 1492 payload MTU on a 1500 link. Without protocol-field compression add 2 more bytes.',
        ar: 'نفترض أن حقل تحكم PPP مضغوط وفق ACCM (الافتراض الشائع) فينتج MTU حمولة 1492 على رابط 1500. وبدون ضغط حقل البروتوكول تُضاف بايتان.',
      },
    ],
  },
  {
    id: 'gre',
    name: { en: 'GRE', ar: 'GRE' },
    parts: (underlay) => [
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'GRE header (no options)', ar: 'ترويسة GRE بلا خيارات' }, bytes: 4 },
    ],
    assumptions: [{ en: 'No checksum, no key, no routing fields; the delivery header has no IP options.', ar: 'لا فحص ولا مفتاح ولا حقول توجيه؛ ترويسة التوصيل بلا خيارات IP.' }],
  },
  {
    id: 'gre-key',
    name: { en: 'GRE + Key', ar: 'GRE + Key' },
    parts: (underlay) => [
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'GRE header with Key present', ar: 'ترويسة GRE مع حقل Key' }, bytes: 8 },
    ],
    assumptions: [{ en: 'Key bit set (4 extra bytes), checksum bit clear. GRE with checksum would add 4 more.', ar: 'بت Key مضبوط (4 بايت إضافية) وبت الفحص غير مضبوط. إضافة الفحص تزيد 4 بايت.' }],
  },
  {
    id: 'vxlan',
    name: { en: 'VXLAN', ar: 'VXLAN' },
    parts: (underlay) => [
      { name: { en: 'Outer Ethernet header', ar: 'ترويسة Ethernet خارجية' }, bytes: 14 },
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'UDP header', ar: 'ترويسة UDP' }, bytes: 8 },
      { name: { en: 'VXLAN header (flags + VNI)', ar: 'ترويسة VXLAN (أعلام + VNI)' }, bytes: 8 },
    ],
    assumptions: [
      {
        en: 'Uses the vendor convention of 50 bytes, which counts the underlay Ethernet header (14) plus IP 20 + UDP 8 + VXLAN 8, giving the familiar 1450 tunnel MTU on a 1500 link. GRE and PPPoE figures here are quoted without an L2 header, so do not mix the two conventions in one plan.',
        ar: 'يعتمد العُرف الشائع لدى المورّدين وهو 50 بايت، وتشمل ترويسة Ethernet للشبكة التحتية (14) مع IP‏ 20 وUDP 8 وVXLAN 8، فينتج MTU نفق 1450 على رابط 1500. أما أرقام GRE وPPPoE هنا فمذكورة بلا ترويسة طبقة ثانية، فلا تخلُط العُرفين في الخطة نفسها.',
      },
    ],
  },
  {
    id: 'wireguard',
    name: { en: 'WireGuard', ar: 'WireGuard' },
    parts: (underlay) => [
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'UDP header', ar: 'ترويسة UDP' }, bytes: 8 },
      { name: { en: 'WG data header (type + receiver)', ar: 'ترويسة بيانات WG (النوع + المستلم)' }, bytes: 8 },
      { name: { en: 'WG message counter', ar: 'عدّاد رسالة WG' }, bytes: 8 },
      { name: { en: 'AEAD authentication tag', ar: 'وسم التحقق AEAD' }, bytes: 16 },
    ],
    assumptions: [
      {
        en: 'Data-channel packet: 8-byte type/receiver header, 8-byte counter, 16-byte ChaCha20-Poly1305 tag. The 1–16 byte random padding is deliberately not counted, so 60 bytes is the minimum overhead; wg-quick probes the real value.',
        ar: 'حزمة قناة البيانات: ترويسة نوع/مستلم 8 بايت، عدّاد 8 بايت، وسم ChaCha20-Poly1305 بطول 16 بايت. الحشو العشوائي من 1 إلى 16 بايت غير محسوب عمدًا، لذا 60 بايت هي أقل كلفة؛ أمر wg-quick يقيس القيمة الفعلية.',
      },
      {
        en: 'The underlay Ethernet header is not counted here, so this 60-byte figure is not comparable with the 50-byte VXLAN figure above.',
        ar: 'ترويسة Ethernet للشبكة التحتية غير محسوبة هنا، لذلك رقم 60 بايت هذا لا يقارن برقم VXLAN البالغ 50 بايت أعلاه.',
      },
    ],
  },
  {
    id: 'ipsec-transport',
    name: { en: 'IPsec ESP, transport mode', ar: 'IPsec ESP، وضع النقل' },
    parts: (underlay) => [
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'ESP header (SPI + sequence)', ar: 'ترويسة ESP (SPI + التسلسل)' }, bytes: 8 },
      { name: { en: 'ESP explicit IV (AES-GCM)', ar: 'متجه IV الصريح لـ ESP (AES-GCM)' }, bytes: 12 },
      { name: { en: 'ESP trailer (pad length + next header)', ar: 'تذييل ESP (طول الحشو + الترويسة التالية)' }, bytes: 2 },
      { name: { en: 'ESP integrity check value', ar: 'قيمة سلامة ESP (ICV)' }, bytes: 12 },
    ],
    assumptions: [
      {
        en: 'ESP sizing assumes AES-128-GCM with a 12-byte explicit IV and a 96-bit tag, giving 34 ESP bytes. AES-CBC instead adds a 16-byte IV plus 1–16 padding bytes, and SHA-256/384 HMAC tags add 16 or 24.',
        ar: 'أحجام ESP تفترض AES-128-GCM بمتجه IV صريح 12 بايت ووسم 96 بت، أي 34 بايت لـ ESP. أما AES-CBC فيضيف IV بطول 16 بايت مع حشو من 1 إلى 16 بايت، ووسوم HMAC بـ SHA-256 أو SHA-384 تضيف 16 أو 24 بايت.',
      },
    ],
  },
  {
    id: 'ipsec-tunnel',
    name: { en: 'IPsec ESP, tunnel mode', ar: 'IPsec ESP، وضع النفق' },
    parts: (underlay) => [
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'Inner (original) IPv4 header', ar: 'ترويسة IPv4 الداخلية (الأصلية)' }, bytes: 20 },
      { name: { en: 'ESP header (SPI + sequence)', ar: 'ترويسة ESP (SPI + التسلسل)' }, bytes: 8 },
      { name: { en: 'ESP explicit IV (AES-GCM)', ar: 'متجه IV الصريح لـ ESP (AES-GCM)' }, bytes: 12 },
      { name: { en: 'ESP trailer (pad length + next header)', ar: 'تذييل ESP (طول الحشو + الترويسة التالية)' }, bytes: 2 },
      { name: { en: 'ESP integrity check value', ar: 'قيمة سلامة ESP (ICV)' }, bytes: 12 },
    ],
    assumptions: [
      {
        en: 'Same AES-128-GCM ESP assumption as transport mode, plus an inner IPv4 header. An inner IPv6 packet adds 40 bytes of its own header instead of 20.',
        ar: 'نفس افتراض AES-128-GCM في وضع النقل مع ترويسة IPv4 داخلية. الحزمة الداخلية IPv6 تضيف 40 بايت من ترويساتها بدل 20.',
      },
    ],
  },
  {
    id: 'ipsec-tunnel-natt',
    name: { en: 'IPsec ESP tunnel + NAT-T (UDP 4500)', ar: 'IPsec ESP نفق + NAT-T (UDP 4500)' },
    parts: (underlay) => [
      {
        name: underlay === 'ipv4' ? { en: 'Outer IPv4 header', ar: 'ترويسة IPv4 خارجية' } : { en: 'Outer IPv6 header', ar: 'ترويسة IPv6 خارجية' },
        bytes: underlay === 'ipv4' ? 20 : 40,
      },
      { name: { en: 'UDP header (port 4500)', ar: 'ترويسة UDP (المنفذ 4500)' }, bytes: 8 },
      { name: { en: 'Non-ESP marker', ar: 'علامة غير ESP' }, bytes: 4 },
      { name: { en: 'Inner (original) IPv4 header', ar: 'ترويسة IPv4 الداخلية (الأصلية)' }, bytes: 20 },
      { name: { en: 'ESP header (SPI + sequence)', ar: 'ترويسة ESP (SPI + التسلسل)' }, bytes: 8 },
      { name: { en: 'ESP explicit IV (AES-GCM)', ar: 'متجه IV الصريح لـ ESP (AES-GCM)' }, bytes: 12 },
      { name: { en: 'ESP trailer (pad length + next header)', ar: 'تذييل ESP (طول الحشو + الترويسة التالية)' }, bytes: 2 },
      { name: { en: 'ESP integrity check value', ar: 'قيمة سلامة ESP (ICV)' }, bytes: 12 },
    ],
    assumptions: [
      {
        en: 'NAT-T wraps ESP in UDP on port 4500 with a 4-byte non-ESP marker when no port rewrite is needed. AES-128-GCM ESP assumption as above.',
        ar: 'يغلف NAT-T بروتوكول ESP داخل UDP على المنفذ 4500 مع علامة non-ESP بطول 4 بايت. افتراض ESP هو AES-128-GCM كما فوق.',
      },
    ],
  },
  {
    id: '6in4',
    name: { en: 'IPv6 in IPv4 (6in4)', ar: 'IPv6 داخل IPv4 (6in4)' },
    underlayFixed: 'ipv4',
    parts: () => [{ name: { en: 'Encapsulating IPv4 header', ar: 'ترويسة IPv4 الغلّافة' }, bytes: 20 }],
    assumptions: [
      {
        en: '6in4 adds only the outer IPv4 header; the inner IPv6 header is part of the carried packet, which is why the IPv6/TCP MSS subtracts 60 from the payload MTU. GRE would add 4 more bytes (6in4 over GRE).',
        ar: 'يضيف 6in4 ترويسة IPv4 خارجية فقط، لأن ترويسة IPv6 الداخلية جزء من الحزمة المنقولة، ولهذا يطرح MSS لـ IPv6/TCP مقدار 60 من MTU الحمولة. النقل عبر GRE يضيف 4 بايت إضافية.',
      },
    ],
  },
]

export function profileFor(id: EncapId): EncapProfile {
  const profile = ENCAP_PROFILES.find((entry) => entry.id === id)
  return profile ?? ENCAP_PROFILES[0]
}

export interface MtuInput {
  linkMtu: number
  encap: EncapId
  underlay?: Underlay
  innerFamily?: InnerFamily
  configuredMtu?: number | null
  mssClamp?: boolean
}

export type MtuFindingKind =
  | 'encap-exceeds-link'
  | 'below-ipv4-minimum'
  | 'below-ipv6-minimum'
  | 'configured-above-available'
  | 'mss-below-536'
  | 'link-below-ipv6-minimum'

export interface MtuFinding {
  kind: MtuFindingKind
  severity: 'error' | 'warning'
  values: Record<string, number>
}

export interface MtuResult {
  linkMtu: number
  encap: EncapId
  underlay: Underlay
  innerFamily: InnerFamily
  parts: HeaderPart[]
  overhead: number
  payloadMtu: number
  effectiveMtu: number
  tcpOverhead: number
  mss: number
  floorApplied: boolean
  findings: MtuFinding[]
  commands: string[]
}

export function computeMtu(input: MtuInput): MtuResult {
  const profile = profileFor(input.encap)
  const underlay: Underlay = profile.underlayFixed ?? input.underlay ?? 'ipv4'
  const innerFamily: InnerFamily = input.innerFamily ?? 'ipv4'
  const linkMtu = Math.trunc(input.linkMtu)
  const parts = profile.parts(underlay)
  const overhead = parts.reduce((total, part) => total + part.bytes, 0)
  const tcpOverhead = innerFamily === 'ipv4' ? 40 : 60

  const payloadMtu = linkMtu - overhead
  const floorApplied = payloadMtu < MIN_IPV4_MTU
  const effectiveMtu = floorApplied ? MIN_IPV4_MTU : payloadMtu
  const mss = Math.max(0, effectiveMtu - tcpOverhead)

  const findings: MtuFinding[] = []
  if (overhead >= linkMtu) {
    findings.push({ kind: 'encap-exceeds-link', severity: 'error', values: { linkMtu, overhead } })
  } else if (floorApplied) {
    findings.push({ kind: 'below-ipv4-minimum', severity: 'error', values: { linkMtu, overhead, payloadMtu, minimum: MIN_IPV4_MTU } })
  }

  if (innerFamily === 'ipv6' && effectiveMtu < MIN_IPV6_LINK_MTU) {
    findings.push({ kind: 'below-ipv6-minimum', severity: 'warning', values: { effectiveMtu, minimum: MIN_IPV6_LINK_MTU } })
  }
  if (mss > 0 && mss < MIN_TCP_MSS) {
    findings.push({ kind: 'mss-below-536', severity: 'warning', values: { mss, minimum: MIN_TCP_MSS } })
  }

  const configured = input.configuredMtu === null || input.configuredMtu === undefined ? null : Math.trunc(input.configuredMtu)
  if (configured !== null && configured > payloadMtu) {
    findings.push({ kind: 'configured-above-available', severity: 'error', values: { configured, available: payloadMtu } })
  }
  if (innerFamily === 'ipv6' && configured !== null && configured < MIN_IPV6_LINK_MTU) {
    findings.push({ kind: 'link-below-ipv6-minimum', severity: 'warning', values: { configured, minimum: MIN_IPV6_LINK_MTU } })
  }

  const commands = buildCommands({ effectiveMtu, mss, innerFamily, clamped: Boolean(input.mssClamp) })

  return {
    linkMtu,
    encap: profile.id,
    underlay,
    innerFamily,
    parts,
    overhead,
    payloadMtu,
    effectiveMtu,
    tcpOverhead,
    mss,
    floorApplied,
    findings,
    commands,
  }
}

function buildCommands(options: { effectiveMtu: number; mss: number; innerFamily: InnerFamily; clamped: boolean }): string[] {
  const commands = [
    `ip link set dev <iface> mtu ${options.effectiveMtu}`,
    `netsh interface ipv4 set subinterface "<iface>" mtu=${options.effectiveMtu} store=persistent`,
    `ip tcp adjust-mss ${options.mss}`,
  ]
  if (options.clamped) {
    commands.push('iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu')
  } else {
    commands.push(`iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss ${options.mss}`)
  }
  commands.push('sysctl -w net.ipv4.tcp_mtu_probing=1')
  return commands
}
