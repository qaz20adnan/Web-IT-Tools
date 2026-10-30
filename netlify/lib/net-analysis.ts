export type AnalysisLang = 'en' | 'ar'

export type PortState = 'open' | 'closed' | 'filtered' | 'timeout' | 'error'

export interface PortProbeResult {
  port: number
  state: PortState
  latencyMs: number | null
  service: string | null
  banner: string | null
  errorCode: string | null
}

/**
 * Where the probe was launched from. A serverless deployment can only ever
 * report its own egress address, so this is never presented as the visitor's IP.
 */
export interface ProbeSourceInfo {
  ipv4: string | null
  ipv6: string | null
  country: string | null
  colo: string | null
  source: string
}

export interface NameResolution {
  host: string
  ipv4: string[]
  ipv6: string[]
  /** Seconds; the shortest TTL seen, so the user knows how long to wait before re-checking. */
  lowestTtl: number | null
  error: string | null
}

export type NameStatus = 'not_provided' | 'resolved' | 'match' | 'partial' | 'mismatch' | 'unresolved'

export interface NameAnalysis {
  status: NameStatus
  title: string
  detail: string
  resolved: string[]
}

export interface ReportObservation {
  label: string
  value: string
  tone: 'default' | 'success' | 'warning' | 'danger'
}

export interface ReportCause {
  id: string
  likelihood: 'high' | 'medium' | 'low'
  title: string
  explanation: string
  evidence: string[]
}

export interface AnalyzerReport {
  headline: string
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  observations: ReportObservation[]
  causes: ReportCause[]
  recommendations: string[]
  limitations: string[]
  markdown: string
}

export interface AnalyzerReportInput {
  lang: AnalysisLang
  checkedAt: string
  probeSource: ProbeSourceInfo
  /** The public name the user asked about — usually their own DDNS hostname. */
  name: NameResolution | null
  /** The address the user expects that name to hold, if they supplied one. */
  expectedIp: string | null
  target: { host: string; address: string }
  ports: PortProbeResult[]
}

const PORT_SERVICES: Record<number, string> = {
  20: 'FTP data',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  465: 'SMTPS',
  587: 'SMTP submission',
  631: 'IPP printing',
  636: 'LDAPS',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'Microsoft SQL Server',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  5900: 'VNC',
  6379: 'Redis',
  8080: 'HTTP alternate',
  8443: 'HTTPS alternate',
  9100: 'Raw printing',
}

const HIGH_RISK_PORTS = new Set([21, 23, 445, 1433, 3306, 3389, 5432, 5900, 6379])

export const DEFAULT_ANALYZER_PORTS = [80, 443, 22, 3389, 8080, 8443]

const t = (lang: AnalysisLang, en: string, ar: string): string => (lang === 'ar' ? ar : en)

export function isCgnat(address: string | null): boolean {
  if (!address) return false
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

export function portService(port: number): string | null {
  return PORT_SERVICES[port] ?? null
}

export function detectService(port: number, banner: string | null): string | null {
  const text = (banner ?? '').toLowerCase()
  if (text.startsWith('ssh-')) return 'SSH'
  if (/^220[ -].*(ftp|vsftpd|proftpd|filezilla)/.test(text)) return 'FTP'
  if (/^220[ -].*(smtp|mail|postfix|exchange)/.test(text)) return 'SMTP'
  if (/^\+ok/.test(text)) return 'POP3'
  if (/^\* ok/.test(text)) return 'IMAP'
  if (text.includes('redis')) return 'Redis'
  if (text.includes('mysql')) return 'MySQL'
  if (text.includes('postgres')) return 'PostgreSQL'
  const server = text.match(/server:\s*([^\r\n]+)/)?.[1]?.trim()
  if (server) {
    const base = server.split('/')[0].slice(0, 40)
    return `HTTP (${base})`
  }
  if (text.startsWith('http/')) return 'HTTP'
  if (port === 443 || port === 8443) return 'HTTPS'
  return portService(port)
}

export function nameAnalysis(name: NameResolution | null, expectedIp: string | null, lang: AnalysisLang): NameAnalysis {
  if (!name) {
    return {
      status: 'not_provided',
      title: t(lang, 'No hostname checked', 'لم يُفحص أي اسم مضيف'),
      detail: t(
        lang,
        'Enter the DDNS or server hostname you want to verify and the report will compare it with the address you expect.',
        'أدخل اسم مضيف DDNS أو الخادم الذي تريد التحقق منه لمقارنته بالعنوان الذي تتوقعه.',
      ),
      resolved: [],
    }
  }
  const resolved = [...name.ipv4, ...name.ipv6]
  if (name.error || resolved.length === 0) {
    return {
      status: 'unresolved',
      title: t(lang, 'The hostname did not resolve', 'لم يتم تحليل اسم المضيف'),
      detail: name.error ?? t(lang, 'No A or AAAA record was returned for this name.', 'لم تُرجع سجلات A أو AAAA أي نتيجة لهذا الاسم.'),
      resolved,
    }
  }
  if (!expectedIp) {
    return {
      status: 'resolved',
      title: t(lang, 'Name points to a public address', 'الاسم يشير إلى عنوان عام'),
      detail: t(
        lang,
        `${name.host} resolves to ${resolved.join(', ')}${name.lowestTtl === null ? '' : `, cached for at most ${name.lowestTtl}s`}. Give the address you expect to check it for drift.`,
        `يشير ${name.host} إلى ${resolved.join(', ')}${name.lowestTtl === null ? '' : `، بذاكرة تخزين مؤقت لا تتجاوز ${name.lowestTtl} ثانية`}. أدخل العنوان الذي تتوقعه للتحقق من الانحراف.`,
      ),
      resolved,
    }
  }
  if (!resolved.includes(expectedIp)) {
    return {
      status: 'mismatch',
      title: t(lang, 'The record points elsewhere', 'السجل يشير إلى عنوان آخر'),
      detail: t(
        lang,
        `${name.host} resolves to ${resolved.join(', ')}, but you expected ${expectedIp}. Until the updater publishes the new address, clients keep reaching the old one.`,
        `يشير ${name.host} إلى ${resolved.join(', ')} بينما تتوقع أنت ${expectedIp}. إلى أن ينشر المحدّث العنوان الجديد سيظل العملاء يصلون إلى القديم.`,
      ),
      resolved,
    }
  }
  const otherFamilies = resolved.filter((entry) => entry !== expectedIp)
  if (otherFamilies.length > 0) {
    return {
      status: 'partial',
      title: t(lang, 'The expected address is published, alongside others', 'العنوان المتوقع منشور مع عناوين أخرى'),
      detail: t(
        lang,
        `${expectedIp} is present, and so is ${otherFamilies.join(', ')}. Round-robin DNS means some clients will get the other address.`,
        `يوجد ${expectedIp} ويوجد معه ${otherFamilies.join(', ')}. وجود أكثر من سجل يعني أن بعض العملاء سيحصلون على العنوان الآخر.`,
      ),
      resolved,
    }
  }
  return {
    status: 'match',
    title: t(lang, 'The record matches the expected address', 'السجل يطابق العنوان المتوقع'),
    detail: t(
      lang,
      'The name is current at the time of this check. Caching resolvers can keep serving the previous address for one more TTL.',
      'الاسم محدّث وقت هذا الفحص. قد يستمر تخزين DNS المؤقت في تقديم العنوان السابق لمدة TTL إضافية.',
    ),
    resolved,
  }
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 180)
}

function causeRank(likelihood: ReportCause['likelihood']): number {
  return likelihood === 'high' ? 0 : likelihood === 'medium' ? 1 : 2
}

export function buildCauses(input: AnalyzerReportInput): ReportCause[] {
  const { lang, name, expectedIp, ports } = input
  const state = nameAnalysis(name, expectedIp, lang)
  const targetAddress = input.target.address
  const causes: ReportCause[] = []

  if (isCgnat(targetAddress)) {
    causes.push({
      id: 'cgnat',
      likelihood: 'high',
      title: t(lang, 'The address is inside carrier-grade NAT (CGNAT)', 'العنوان يقع داخل NAT لمشغل الاتصالات (CGNAT)'),
      explanation: t(
        lang,
        `${targetAddress} belongs to the shared 100.64.0.0/10 range. That block is not routable on the public internet, so inbound port forwarding and classic DDNS exposure cannot work on it.`,
        `${targetAddress} يقع ضمن النطاق المشترك 100.64.0.0/10. هذه الكتلة غير قابلة للتوجيه على الإنترنت العام، لذلك لا يعمل تحويل المنافذ الواردة ولا كشف DDNS التقليدي عليها.`,
      ),
      evidence: [t(lang, `The name resolves to ${targetAddress}`, `يشير اسم المضيف إلى ${targetAddress}`)],
    })
  }

  if (state.status === 'mismatch') {
    causes.push({
      id: 'ddns-stale',
      likelihood: 'high',
      title: t(lang, 'The updater has not published the address you expect', 'لم ينشر المحدّث العنوان الذي تتوقعه'),
      explanation: t(
        lang,
        'The strongest reading of a mismatch is that the WAN address changed after the last update, or that the updater submits a LAN address instead of the real WAN address.',
        'أقوى قراءة لعدم التطابق أن عنوان WAN تغيّر بعد آخر تحديث، أو أن المحدّث يرسل عنوان LAN بدلاً من عنوان WAN الحقيقي.',
      ),
      evidence: [state.detail],
    })
    causes.push({
      id: 'dynamic-lease',
      likelihood: 'medium',
      title: t(lang, 'Dynamic DHCP or PPPoE lease renewal', 'تجديد إيجار DHCP أو PPPoE الديناميكي'),
      explanation: t(
        lang,
        'Most consumer lines receive a dynamic address from an ISP pool. A PPPoE re-dial, lease expiry or a change of access concentrator returns a different address.',
        'معظم الخطوط المنزلية تحصل على عنوان ديناميكي من مجموعة عناوين المشغل. إعادة اتصال PPPoE أو انتهاء الإيجار أو تغيّر مجمّع الوصول يعيد عنواناً مختلفاً.',
      ),
      evidence: [t(lang, 'A mismatch between the published and expected address is present.', 'يوجد عدم تطابق بين العنوان المنشور والعنوان المتوقع.')],
    })
    causes.push({
      id: 'device-reboot',
      likelihood: 'low',
      title: t(lang, 'ONT or router restart', 'إعادة تشغيل ONT أو الراوتر'),
      explanation: t(
        lang,
        'A power loss, fiber alarm, firmware update or WAN session drop tears the session down and commonly triggers a fresh lease from the ISP pool.',
        'انقطاع الكهرباء أو إنذار بصري أو تحديث برنامج أو سقوط جلسة WAN يقطع الاتصال ويؤدي غالباً إلى إيجار جديد من مجموعة المشغل.',
      ),
      evidence: [t(lang, 'Compare the device uptime with the moment the record last changed.', 'قارن مدة تشغيل الجهاز باللحظة التي تغير فيها السجل آخر مرة.')],
    })
  }

  if (state.status === 'partial') {
    causes.push({
      id: 'multi-record',
      likelihood: 'medium',
      title: t(lang, 'Several addresses are published for the same name', 'تُنشر عدة عناوين للاسم نفسه'),
      explanation: t(
        lang,
        'Round-robin records make resolvers hand out different addresses to different clients, so one client keeps reaching a host that no longer answers.',
        'السجلات الدائرية تجعل المحلّلات توزع عناوين مختلفة على العملاء، فيظل أحد العملاء يصل إلى مضيف لم يعد يستجيب.',
      ),
      evidence: [state.detail],
    })
  }

  if (state.status === 'unresolved') {
    causes.push({
      id: 'name-missing',
      likelihood: 'high',
      title: t(lang, 'The hostname has no address record', 'لا يوجد سجل عنوان لاسم المضيف'),
      explanation: t(
        lang,
        'Either the record was deleted, the domain expired, or the updater has never authenticated successfully. Nothing downstream of this name can be reached.',
        'إما أن السجل حُذف أو أن النطاق انتهت صلاحيته أو أن المحدّث لم ينجح في المصادقة قط. ولا شيء خلف هذا الاسم قابل للوصول.',
      ),
      evidence: [state.detail],
    })
  }

  if (ports.length > 0 && ports.every((entry) => entry.state !== 'open')) {
    const filtered = ports.filter((entry) => entry.state === 'filtered' || entry.state === 'timeout')
    causes.push({
      id: 'no-inbound',
      likelihood: filtered.length > 0 ? 'high' : 'medium',
      title:
        filtered.length > 0
          ? t(lang, 'Traffic is being dropped before it reaches the service', 'تُسقط الحركة قبل وصولها إلى الخدمة')
          : t(lang, 'Nothing answered on the tested ports', 'لم يستجب شيء على المنافذ المفحوصة'),
      explanation:
        filtered.length > 0
          ? t(
              lang,
              'A timeout or filtered state means packets were silently dropped — a router without a matching port forward, a host firewall, or ISP filtering. A refused connection would instead have meant nothing was listening.',
              'المهلة أو الحالة المفلترة تعني إسقاط الحزم بصمت — راوتر بلا تحويل مطابق، أو جدار حماية في المضيف، أو حجب من المشغل. أما الرفض فكان يعني أن لا شيء يستمع.',
            )
          : t(
              lang,
              'Every tested port refused the connection, which points at a service that is stopped or bound to another interface rather than a network block.',
              'رفضت كل المنافذ المفحوصة الاتصال، وهو ما يشير إلى خدمة متوقفة أو مرتبطة بواجهة أخرى بدلاً من حظر شبكي.',
            ),
      evidence: ports.map((entry) => t(lang, `Port ${entry.port}: ${entry.state}`, `المنفذ ${entry.port}: ${entry.state}`)),
    })
  }

  if (ports.some((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))) {
    causes.push({
      id: 'unexpected-exposure',
      likelihood: 'high',
      title: t(lang, 'A high-risk service is exposed to the internet', 'توجد خدمة عالية الخطورة مكشوفة على الإنترنت'),
      explanation: t(
        lang,
        'This is not a name or address problem, but it is operationally urgent: it usually comes from UPnP, a DMZ rule, or a port forward left behind.',
        'هذه ليست مشكلة اسم أو عنوان، لكنها عاجلة تشغيلياً: عادةً ما يكون مصدرها UPnP أو قاعدة DMZ أو تحويل منافذ مُنسيّ.',
      ),
      evidence: ports
        .filter((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))
        .map((entry) => t(lang, `Port ${entry.port} accepted a connection`, `قبل المنفذ ${entry.port} الاتصال`)),
    })
  }

  return causes.sort((a, b) => causeRank(a.likelihood) - causeRank(b.likelihood))
}

export function buildRecommendations(input: AnalyzerReportInput): string[] {
  const { lang, name, expectedIp, ports } = input
  const state = nameAnalysis(name, expectedIp, lang)
  const targetAddress = input.target.address
  const highRisk = ports.filter((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))
  const recommendations: string[] = []

  if (state.status === 'mismatch' || state.status === 'partial') {
    recommendations.push(
      t(
        lang,
        'Force a DDNS update now, then verify the record through a public resolver. Point the updater at the WAN interface address, never at the LAN address.',
        'أجبر تحديث DDNS الآن ثم تحقق من السجل عبر خادم DNS عام. وجّه المحدّث إلى عنوان واجهة WAN لا إلى عنوان LAN.',
      ),
    )
  }

  if (state.status === 'unresolved') {
    recommendations.push(
      t(
        lang,
        'Recreate the A record and confirm the updater credentials and the zone itself; an expired domain and a failed update look identical from outside.',
        'أعد إنشاء سجل A وتحقق من بيانات اعتماد المحدّث ومن النطاق نفسه؛ فالنطاق المنتهي والفشل في التحديث يظهران بالشكل نفسه من الخارج.',
      ),
    )
  }

  if (name?.lowestTtl !== null && name?.lowestTtl !== undefined) {
    recommendations.push(
      t(
        lang,
        `The shortest TTL on this record is ${name.lowestTtl}s. After a change, wait at least that long before concluding the update failed, and re-query from a resolver that did not cache the old answer.`,
        `أقل TTL على هذا السجل هو ${name.lowestTtl} ثانية. بعد أي تغيير انتظر هذه المدة على الأقل قبل الحكم بفشل التحديث، وأعد الاستعلام من محلّل لم يخزّن الجواب السابق.`,
      ),
    )
  }

  if (isCgnat(targetAddress)) {
    recommendations.push(
      t(
        lang,
        'Ask the ISP for a dedicated public IPv4 address, or publish the service through a tunnel or VPN. Port forwarding cannot work on a CGNAT address.',
        'اطلب من المشغل عنوان IPv4 عاماً مخصصاً أو انشر الخدمة عبر نفق أو VPN. تحويل المنافذ لا يعمل على عنوان CGNAT.',
      ),
    )
  }

  if (ports.length > 0 && ports.every((entry) => entry.state !== 'open')) {
    recommendations.push(
      t(
        lang,
        'Check the port-forward rule, the host firewall and the service binding order: a service listening on 127.0.0.1 looks identical to a blocked port from outside.',
        'رتّب الفحص على قاعدة تحويل المنفذ ثم جدار حماية المضيف ثم ربط الخدمة: الخدمة المستمعة على 127.0.0.1 تبدو من الخارج مثل المنفذ المحجوب.',
      ),
    )
  }

  if (highRisk.length > 0) {
    recommendations.push(
      t(
        lang,
        `Close or restrict public access to: ${highRisk.map((entry) => entry.port).join(', ')}. Prefer a VPN for administration and disable UPnP unless it is explicitly required.`,
        `أغلق أو قيّد الوصول العام إلى: ${highRisk.map((entry) => entry.port).join(', ')}. الأفضل استخدام VPN للإدارة وتعطيل UPnP ما لم يكن مطلوباً صراحةً.`,
      ),
    )
  }

  recommendations.push(
    t(
      lang,
      'Keep a dated note of the published address, the WAN address seen on the router, and the ONT status. A short history separates an ISP event from a local reboot faster than any single snapshot.',
      'احتفظ بملحوظة مؤرخة للعنوان المنشور وعنوان WAN كما يظهر في الراوتر وحالة ONT. السجل القصير يفرّق حدث المشغل عن إعادة التشغيل المحلية أسرع من أي لقطة واحدة.',
    ),
  )
  recommendations.push(
    t(
      lang,
      'Run the local port-ownership commands in this report on the router or server. A remote probe can never see which process holds a port.',
      'نفّذ أوامر ملكية المنافذ المحلية في هذا التقرير على الراوتر أو الخادم. الفحص عن بُعد لا يرى أبداً أي عملية تحتكر المنفذ.',
    ),
  )

  return recommendations
}

function buildMarkdown(
  input: AnalyzerReportInput,
  state: NameAnalysis,
  causes: ReportCause[],
  recommendations: string[],
  limitations: string[],
): string {
  const { lang, checkedAt, probeSource, name, expectedIp, target, ports } = input
  const originLine = [probeSource.ipv4, probeSource.ipv6].filter(Boolean).join(' + ') || '—'
  const lines: string[] = []
  lines.push(t(lang, '# Adnan Tech DDNS & Port Analysis', '# تحليل منصة عدنان تك لـ DDNS والمنافذ'))
  lines.push('')
  lines.push(`${t(lang, 'Generated', 'تم الإنشاء')}: ${checkedAt}`)
  lines.push('')
  lines.push(`## ${t(lang, 'Snapshot', 'اللقطة الحالية')}`)
  lines.push(`- ${t(lang, 'Hostname checked', 'اسم المضيف المفحوص')}: ${name?.host ?? '—'}`)
  lines.push(`- ${t(lang, 'Expected address', 'العنوان المتوقع')}: ${expectedIp ?? '—'}`)
  lines.push(`- ${t(lang, 'Name status', 'حالة الاسم')}: ${state.status}`)
  lines.push(`- ${t(lang, 'Resolved addresses', 'العناوين المحلولة')}: ${state.resolved.join(', ') || '—'}`)
  lines.push(`- ${t(lang, 'Shortest TTL', 'أقل TTL')}: ${name?.lowestTtl === null || name?.lowestTtl === undefined ? '—' : `${name.lowestTtl}s`}`)
  lines.push(`- ${t(lang, 'Port probe target', 'هدف فحص المنافذ')}: ${target.host} (${target.address || '—'})`)
  lines.push(
    `- ${t(lang, 'CGNAT on the probe target', 'CGNAT على هدف الفحص')}: ${isCgnat(target.address) ? t(lang, 'yes', 'نعم') : t(lang, 'not detected', 'غير مكتشف')}`,
  )
  lines.push(`- ${t(lang, 'Probe origin (this platform, not the visitor)', 'مصدر الفحص (هذه المنصة، وليس الزائر)')}: ${originLine}`)
  lines.push(
    `- ${t(lang, 'Origin country / POP', 'دولة المصدر / نقطة الحضور')}: ${[probeSource.country, probeSource.colo].filter(Boolean).join(' / ') || '—'}`,
  )
  lines.push('')
  lines.push(`## ${t(lang, 'Name resolution', 'تحليل الاسم')}`)
  lines.push(`- ${state.title}`)
  lines.push(`- ${state.detail}`)
  if (name?.error) lines.push(`- ${t(lang, 'Resolver error', 'خطأ في المحلّل')}: ${escapeCell(name.error)}`)
  lines.push('')
  lines.push(`## ${t(lang, 'Ports', 'المنافذ')}`)
  lines.push(`| ${t(lang, 'Port', 'المنفذ')} | ${t(lang, 'State', 'الحالة')} | ${t(lang, 'Service', 'الخدمة')} | ${t(lang, 'Latency', 'الزمن')} | ${t(lang, 'Evidence', 'الدليل')} |`)
  lines.push('| --- | --- | --- | --- | --- |')
  if (ports.length === 0) {
    lines.push(
      t(
        lang,
        'No TCP port was probed: the name resolved to no public address, so there was nothing to connect to.',
        'لم يُفحص أي منفذ TCP: لم يُحل الاسم إلى عنوان عام، فلم يكن هناك ما يُتصل به.',
      ),
    )
  }
  for (const entry of ports) {
    lines.push(
      `| ${entry.port} | ${entry.state} | ${escapeCell(entry.service ?? '—')} | ${entry.latencyMs === null ? '—' : `${entry.latencyMs} ms`} | ${escapeCell(entry.banner ?? entry.errorCode ?? '—')} |`,
    )
  }
  lines.push('')
  lines.push(`## ${t(lang, 'Why the IP may have changed', 'أسباب محتملة لتغير عنوان IP')}`)
  for (const cause of causes) {
    lines.push(`### ${cause.title} (${cause.likelihood})`)
    lines.push(cause.explanation)
    for (const evidence of cause.evidence) lines.push(`- ${evidence}`)
    lines.push('')
  }
  lines.push(`## ${t(lang, 'Recommendations', 'التوصيات')}`)
  for (const recommendation of recommendations) lines.push(`- ${recommendation}`)
  lines.push('')
  lines.push(`## ${t(lang, 'Local port ownership', 'ملكية المنافذ محلياً')}`)
  lines.push(t(lang, 'Run these on the router or server, not in the browser:', 'نفّذ هذه الأوامر على الراوتر أو الخادم وليس في المتصفح:'))
  lines.push('')
  lines.push('```powershell')
  lines.push('$listeners = Get-NetTCPConnection -State Listen')
  lines.push('$listeners | Sort-Object LocalPort | Select-Object LocalAddress, LocalPort, OwningProcess,')
  lines.push("  @{n='Process';e={(Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName}}")
  lines.push('$listeners | Group-Object LocalPort | ForEach-Object {')
  lines.push('  $owners = @($_.Group.OwningProcess | Sort-Object -Unique)')
  lines.push('  if ($owners.Count -gt 1) { Write-Host "CONFLICT: port $($_.Name) owners $($owners -join \', \')" }')
  lines.push('}')
  lines.push('```')
  lines.push('')
  lines.push('```cmd')
  lines.push('netstat -ano | findstr :PORT')
  lines.push('```')
  lines.push('')
  lines.push(`## ${t(lang, 'Limitations', 'القيود')}`)
  for (const limitation of limitations) lines.push(`- ${limitation}`)
  lines.push('')
  return lines.join('\n')
}

export function buildAnalyzerReport(input: AnalyzerReportInput): AnalyzerReport {
  const { lang, probeSource, name, expectedIp, target, ports } = input
  const state = nameAnalysis(name, expectedIp, lang)
  const causes = buildCauses(input)
  const recommendations = buildRecommendations(input)
  const highRisk = ports.filter((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))
  const openPorts = ports.filter((entry) => entry.state === 'open')
  const targetIsCgnat = isCgnat(target.address)
  const originLine = [probeSource.ipv4, probeSource.ipv6].filter(Boolean).join(' + ') || '—'
  const riskLevel: AnalyzerReport['riskLevel'] =
    highRisk.length > 0 ? 'high' : state.status === 'mismatch' || state.status === 'unresolved' || targetIsCgnat ? 'medium' : 'low'

  const headline =
    state.status === 'unresolved'
      ? t(lang, 'The hostname publishes no address', 'لا ينشر اسم المضيف أي عنوان')
      : state.status === 'mismatch'
        ? t(lang, 'The published address is not the one you expect', 'العنوان المنشور ليس الذي تتوقعه')
        : targetIsCgnat
          ? t(lang, 'The probe target sits inside carrier-grade NAT', 'هدف الفحص يقع داخل NAT لمشغل الاتصالات')
          : state.status === 'partial'
            ? t(lang, 'The name is published, but with more than one address', 'الاسم منشور بأكثر من عنوان واحد')
            : state.status === 'not_provided'
              ? openPorts.length > 0
                ? t(lang, 'The target answers on exposed TCP ports', 'الهدف يستجيب على منافذ TCP مكشوفة')
                : t(lang, 'No tested TCP port answered', 'لم يستجب أي منفذ TCP مفحوص')
              : openPorts.length > 0
                ? t(lang, 'The record is current and the target answers', 'السجل محدّث والهدف يستجيب')
                : t(lang, 'The record is current; no tested port answered', 'السجل محدّث؛ لم يستجب أي منفذ مفحوص')

  const summary = target.address
    ? t(
        lang,
        `${target.host} was probed at ${target.address}. ${openPorts.length} of ${ports.length} tested ports accepted a TCP connection. ${state.detail}`,
        `فُحص ${target.host} على العنوان ${target.address}. قبل ${openPorts.length} من ${ports.length} منفذاً مفحوصاً اتصال TCP. ${state.detail}`,
      )
    : t(
        lang,
        `${target.host} resolved to no public address, so no TCP port was probed. ${state.detail}`,
        `لم يُحل ${target.host} إلى أي عنوان عام، لذلك لم يُفحص أي منفذ TCP. ${state.detail}`,
      )

  const limitations = [
    t(
      lang,
      `The TCP probe is launched by this platform from its own egress address (${originLine}${
        probeSource.colo ? `, POP ${probeSource.colo}` : ''
      }). It is the platform's address, not yours: no tool here measures the visitor's public IP or scans your LAN.`,
      `يُطلق فحص TCP من هذه المنصة عبر عنوان خروجها الخاص (${originLine}${probeSource.colo ? `، نقطة الحضور ${probeSource.colo}` : ''}). إنه عنوان المنصة لا عنوانك: لا تقيس أي أداة هنا IP الزائر ولا تفحص شبكتك المحلية.`,
    ),
    t(
      lang,
      'A closed or filtered port can mean no service, a missing NAT rule, a host firewall, ISP filtering or CGNAT. It does not prove the port is unused.',
      'المنفذ المغلق أو المفلتر قد يعني لا خدمة، أو قاعدة NAT ناقصة، أو جدار حماية في المضيف، أو حجباً من المشغل، أو CGNAT. وهو لا يثبت أن المنفذ غير مستخدم.',
    ),
    t(
      lang,
      'Remote probing cannot identify the local process that owns a port. Use the local commands in this report.',
      'الفحص عن بُعد لا يحدد العملية المحلية المالكة للمنفذ. استخدم الأوامر المحلية في هذا التقرير.',
    ),
    t(
      lang,
      'A single snapshot cannot prove the exact cause of an address change. The causes are ranked likelihoods based on the evidence collected.',
      'لقطة واحدة لا تثبت السبب الدقيق لتغير العنوان. الأسباب مراتب احتمالية مبنية على الأدلة المجمعة.',
    ),
    t(
      lang,
      'Names are resolved through public DNS-over-HTTPS resolvers, so a resolver cache can still serve a previous address for one TTL after a change.',
      'تُحلّل الأسماء عبر محلّلات DNS-over-HTTPS عامة، لذا قد يستمر تخزين المحلّل المؤقت في تقديم العنوان السابق لمدة TTL بعد أي تغيير.',
    ),
    t(lang, 'IPv6 reachability may be untested when the deployment has no IPv6 egress.', 'قد لا يُختبر وصول IPv6 عندما لا يملك النشر مسار خروج IPv6.'),
  ]

  const observations: ReportObservation[] = [
    {
      label: t(lang, 'Probe target', 'هدف الفحص'),
      value: target.address ? `${target.host} → ${target.address}` : `${target.host} → —`,
      tone: state.status === 'unresolved' ? 'warning' : targetIsCgnat ? 'warning' : 'default',
    },
    {
      label: t(lang, 'Name resolution', 'تحليل الاسم'),
      value: state.title,
      tone:
        state.status === 'match' || state.status === 'resolved'
          ? 'success'
          : state.status === 'mismatch' || state.status === 'unresolved' || state.status === 'partial'
            ? 'warning'
            : 'default',
    },
    {
      label: t(lang, 'Open ports', 'المنافذ المفتوحة'),
      value:
        ports.length === 0
          ? t(lang, 'nothing was probed', 'لم يُفحص أي منفذ')
          : openPorts.length > 0
            ? openPorts.map((entry) => entry.port).join(', ')
            : t(lang, 'none of the tested ports', 'لا شيء من المنافذ المفحوصة'),
      tone: ports.length === 0 ? 'default' : highRisk.length > 0 ? 'danger' : openPorts.length > 0 ? 'success' : 'warning',
    },
    {
      label: t(lang, 'Probe origin (platform)', 'مصدر الفحص (المنصة)'),
      value: `${originLine}${[probeSource.country, probeSource.colo].filter(Boolean).length > 0 ? ` · ${[probeSource.country, probeSource.colo].filter(Boolean).join(' / ')}` : ''} · ${probeSource.source}`,
      tone: 'default',
    },
  ]

  const markdown = buildMarkdown(input, state, causes, recommendations, limitations)

  return {
    headline,
    riskLevel,
    summary,
    observations,
    causes,
    recommendations,
    limitations,
    markdown,
  }
}
