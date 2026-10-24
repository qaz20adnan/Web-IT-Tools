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

export interface PublicIpInfo {
  ipv4: string | null
  ipv6: string | null
  country: string | null
  colo: string | null
  source: string
}

export interface DdnsResult {
  host: string
  ipv4: string[]
  ipv6: string[]
  error: string | null
}

export type DdnsStatus = 'not_configured' | 'match' | 'partial' | 'mismatch' | 'unresolved'

export interface DdnsAnalysis {
  status: DdnsStatus
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
  publicIp: PublicIpInfo
  target: { host: string; address: string }
  ddns: DdnsResult | null
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

export function ddnsAnalysis(publicIp: PublicIpInfo, ddns: DdnsResult | null, lang: AnalysisLang): DdnsAnalysis {
  if (!ddns) {
    return {
      status: 'not_configured',
      title: t(lang, 'DDNS was not checked', 'لم يتم فحص DDNS'),
      detail: t(
        lang,
        'Add your DDNS hostname to compare its DNS records with the current public IP.',
        'أضف اسم مضيف DDNS لمقارنة سجلات DNS مع عنوان IP العام الحالي.',
      ),
      resolved: [],
    }
  }
  const resolved = [...ddns.ipv4, ...ddns.ipv6]
  if (ddns.error || resolved.length === 0) {
    return {
      status: 'unresolved',
      title: t(lang, 'DDNS hostname did not resolve', 'لم يتم تحليل اسم مضيف DDNS'),
      detail: ddns.error ?? t(lang, 'No A or AAAA records were returned.', 'لم تُرجع سجلات A أو AAAA أي نتيجة.'),
      resolved,
    }
  }
  const expected = [publicIp.ipv4, publicIp.ipv6].filter((entry): entry is string => Boolean(entry))
  if (expected.length === 0) {
    return {
      status: 'unresolved',
      title: t(lang, 'Public IP is unknown', 'عنوان IP العام غير معروف'),
      detail: t(lang, 'The DDNS record cannot be compared without a detected public IP.', 'لا يمكن مقارنة سجل DDNS دون كشف عنوان IP العام.'),
      resolved,
    }
  }
  const matches = expected.filter((entry) => resolved.includes(entry))
  if (matches.length === 0) {
    return {
      status: 'mismatch',
      title: t(lang, 'DDNS is stale or points elsewhere', 'DDNS قديم أو يشير إلى عنوان آخر'),
      detail: t(
        lang,
        `DDNS resolves to ${resolved.join(', ')}, but the current public address is ${expected.join(', ')}.`,
        `يشير DDNS إلى ${resolved.join(', ')} بينما العنوان العام الحالي هو ${expected.join(', ')}.`,
      ),
      resolved,
    }
  }
  if (matches.length < expected.length) {
    return {
      status: 'partial',
      title: t(lang, 'DDNS matches one address family only', 'DDNS يطابق عائلة عناوين واحدة فقط'),
      detail: t(
        lang,
        `Matched ${matches.join(', ')}. The other detected address (${expected.filter((entry) => !matches.includes(entry)).join(', ')}) is not published.`,
        `تمت مطابقة ${matches.join(', ')}. العنوان الآخر المكتشف (${expected.filter((entry) => !matches.includes(entry)).join(', ')}) غير منشور.`,
      ),
      resolved,
    }
  }
  return {
    status: 'match',
    title: t(lang, 'DDNS matches the current public IP', 'DDNS يطابق عنوان IP العام الحالي'),
    detail: t(
      lang,
      'The DDNS record is current at the time of this check. DNS caching can delay visibility for other clients.',
      'سجل DDNS محدّث وقت هذا الفحص. قد يؤخر تخزين DNS المؤقت ظهوره لدى العملاء الآخرين.',
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
  const { lang, publicIp, ddns, ports } = input
  const ddnsState = ddnsAnalysis(publicIp, ddns, lang)
  const causes: ReportCause[] = []

  if (isCgnat(publicIp.ipv4)) {
    causes.push({
      id: 'cgnat',
      likelihood: 'high',
      title: t(lang, 'Carrier-grade NAT (CGNAT) address', 'عنوان خلف NAT لمشغل الاتصالات (CGNAT)'),
      explanation: t(
        lang,
        'The detected IPv4 address is in the shared 100.64.0.0/10 range. The address may be shared and can change without your router rebooting, and inbound port forwarding will not work.',
        'عنوان IPv4 المكتشف يقع في النطاق المشترك 100.64.0.0/10. قد يكون العنوان مشتركاً ويتغير دون إعادة تشغيل الراوتر، ولن يعمل تحويل المنافذ الواردة.',
      ),
      evidence: [t(lang, `Detected IPv4: ${publicIp.ipv4}`, `IPv4 المكتشف: ${publicIp.ipv4}`)],
    })
  }

  if (ddnsState.status === 'mismatch') {
    causes.push({
      id: 'ddns-stale',
      likelihood: 'high',
      title: t(lang, 'DDNS updater did not publish the current address', 'محدّث DDNS لم ينشر العنوان الحالي'),
      explanation: t(
        lang,
        'A stale DDNS record is the strongest evidence that the WAN address changed after the last update, or that the updater is reading a LAN address instead of the WAN address.',
        'سجل DDNS القديم أقوى دليل على أن عنوان WAN تغيّر بعد آخر تحديث، أو أن المحدّث يقرأ عنوان LAN بدلاً من WAN.',
      ),
      evidence: [ddnsState.detail],
    })
  }

  causes.push({
    id: 'dynamic-lease',
    likelihood: 'medium',
    title: t(lang, 'Dynamic DHCP or PPPoE lease renewal', 'تجديد إيجار DHCP أو PPPoE الديناميكي'),
    explanation: t(
      lang,
      'Many FTTH connections receive a dynamic address from an ISP pool. A PPPoE re-dial, DHCP lease expiry or a change in the ISP access concentrator can return a different address.',
      'كثير من اتصالات FTTH تحصل على عنوان ديناميكي من مجموعة عناوين المشغل. إعادة اتصال PPPoE أو انتهاء إيجار DHCP أو تغيّر مجمّع وصول المشغل قد يعيد عنواناً مختلفاً.',
    ),
    evidence: [t(lang, 'No static-IP confirmation is available from this probe.', 'لا يتوفر تأكيد لعنوان IP ثابت من هذا الفحص.')],
  })

  causes.push({
    id: 'ont-reboot',
    likelihood: 'medium',
    title: t(lang, 'ONT reboot or optical link interruption', 'إعادة تشغيل ONT أو انقطاع الوصلة البصرية'),
    explanation: t(
      lang,
      'An FTTH ONT reboot, power loss, fiber bend, dirty connector or upstream optical alarm can drop the WAN session. When the session returns, the ISP may assign a different address.',
      'إعادة تشغيل ONT أو انقطاع الكهرباء أو انحناء الألياف أو اتساخ الموصل أو إنذار بصري من المشغل قد يُسقط جلسة WAN. وعند عودتها قد يخصص المشغل عنواناً مختلفاً.',
    ),
    evidence: [t(lang, 'Check ONT logs for LOS, LOF, dying-gasp or link-down events.', 'افحص سجلات ONT بحثاً عن أحداث LOS أو LOF أو dying-gasp أو link-down.')],
  })

  causes.push({
    id: 'router-reboot',
    likelihood: 'low',
    title: t(lang, 'Router reboot, firmware update or bridge-mode change', 'إعادة تشغيل الراوتر أو تحديث البرنامج أو تغيير وضع الجسر'),
    explanation: t(
      lang,
      'A router restart, firmware update, factory reset or change between routed and bridge mode tears down the WAN session and commonly triggers a new lease.',
      'إعادة تشغيل الراوتر أو تحديث البرنامج أو إعادة ضبط المصنع أو التبديل بين الوضع الموجّه ووضع الجسر يقطع جلسة WAN ويؤدي عادةً إلى إيجار جديد.',
    ),
    evidence: [t(lang, 'Compare the router uptime with the last known public-IP change.', 'قارن مدة تشغيل الراوتر بآخر تغيير معروف لعنوان IP العام.')],
  })

  causes.push({
    id: 'isp-maintenance',
    likelihood: 'low',
    title: t(lang, 'ISP pool reassignment or maintenance', 'إعادة توزيع عناوين المشغل أو صيانة'),
    explanation: t(
      lang,
      'ISPs may move subscribers between address pools during maintenance, capacity changes or BNG migration. This can change the address even when customer equipment did not reboot.',
      'قد ينقل المشغل المشتركين بين مجموعات العناوين أثناء الصيانة أو تغيير السعة أو ترحيل BNG. قد يتغير العنوان حتى دون إعادة تشغيل أجهزة العميل.',
    ),
    evidence: [t(lang, 'Ask the ISP whether the line uses a dynamic pool or CGNAT.', 'اسأل المشغل إن كان الخط يستخدم مجموعة ديناميكية أو CGNAT.')],
  })

  if (publicIp.ipv6) {
    causes.push({
      id: 'ipv6-prefix',
      likelihood: ddnsState.status === 'mismatch' ? 'high' : 'medium',
      title: t(lang, 'IPv6 prefix rotation', 'تغيّر بادئة IPv6'),
      explanation: t(
        lang,
        'IPv6 prefixes are commonly delegated dynamically. A prefix change can break AAAA records and inbound IPv6 rules even if the IPv4 address appears stable.',
        'غالباً ما تُفوّض بادئات IPv6 ديناميكياً. تغيّر البادئة قد يكسر سجلات AAAA وقواعد IPv6 الواردة حتى لو بدا عنوان IPv4 ثابتاً.',
      ),
      evidence: [t(lang, `Detected IPv6: ${publicIp.ipv6}`, `IPv6 المكتشف: ${publicIp.ipv6}`)],
    })
  }

  if (ports.some((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))) {
    causes.push({
      id: 'unexpected-exposure',
      likelihood: 'low',
      title: t(lang, 'Unexpected inbound exposure is present', 'يوجد تعرّض وارد غير متوقع'),
      explanation: t(
        lang,
        'One or more high-risk ports are reachable from the public internet. This is not an IP-change cause, but it is operationally urgent and may indicate UPnP, DMZ or an old port-forward rule.',
        'منفذ واحد أو أكثر عالي الخطورة يمكن الوصول إليه من الإنترنت العام. هذا ليس سبباً لتغير IP، لكنه عاجل تشغيلياً وقد يدل على UPnP أو DMZ أو قاعدة تحويل قديمة.',
      ),
      evidence: ports
        .filter((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))
        .map((entry) => t(lang, `Port ${entry.port} is open`, `المنفذ ${entry.port} مفتوح`)),
    })
  }

  return causes.sort((a, b) => causeRank(a.likelihood) - causeRank(b.likelihood))
}

export function buildRecommendations(input: AnalyzerReportInput): string[] {
  const { lang, publicIp, ddns, ports } = input
  const ddnsState = ddnsAnalysis(publicIp, ddns, lang)
  const recommendations: string[] = []
  const highRisk = ports.filter((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))

  if (ddnsState.status === 'mismatch' || ddnsState.status === 'partial') {
    recommendations.push(
      t(
        lang,
        'Update DDNS now, then verify the record from an external resolver. Configure the updater to read the WAN address, not the router LAN address.',
        'حدّث DDNS الآن ثم تحقق من السجل عبر خادم DNS خارجي. اضبط المحدّث ليقرأ عنوان WAN لا عنوان LAN في الراوتر.',
      ),
    )
    recommendations.push(
      t(
        lang,
        'Publish both A and AAAA records when dual-stack is enabled, and keep the DDNS update interval short (60–300 seconds).',
        'انشر سجلي A وAAAA عند تفعيل dual-stack، واجعل فترة تحديث DDNS قصيرة (60–300 ثانية).',
      ),
    )
  }

  if (isCgnat(publicIp.ipv4)) {
    recommendations.push(
      t(
        lang,
        'Request a dedicated public IPv4 address from the ISP, or use a VPN/tunnel. Port forwarding and classic DDNS cannot expose services behind CGNAT.',
        'اطلب عنوان IPv4 عاماً مخصصاً من المشغل أو استخدم VPN/نفقاً. تحويل المنافذ وDDNS التقليدي لا يستطيعان كشف الخدمات خلف CGNAT.',
      ),
    )
  }

  if (ports.every((entry) => entry.state !== 'open')) {
    recommendations.push(
      t(
        lang,
        'No tested port accepted a TCP connection. Check router NAT rules, host firewall rules, ISP blocking and CGNAT before changing the service.',
        'لم يقبل أي منفذ مفحوص اتصال TCP. افحص قواعد NAT في الراوتر وقواعد جدار الحماية في المضيف وحجب المشغل وCGNAT قبل تغيير الخدمة.',
      ),
    )
  }

  if (highRisk.length > 0) {
    recommendations.push(
      t(
        lang,
        `Close or restrict public access to: ${highRisk.map((entry) => entry.port).join(', ')}. Prefer a VPN and disable UPnP unless it is explicitly required.`,
        `أغلق أو قيّد الوصول العام إلى: ${highRisk.map((entry) => entry.port).join(', ')}. يُفضّل استخدام VPN وتعطيل UPnP ما لم يكن مطلوباً صراحةً.`,
      ),
    )
  }

  recommendations.push(
    t(
      lang,
      'Record the ONT optical status, router uptime, WAN lease time and public IP at each change. A short history is the fastest way to distinguish an ISP event from a local reboot.',
      'سجّل حالة ONT البصرية ومدة تشغيل الراوتر ومدة إيجار WAN وعنوان IP العام عند كل تغيير. السجل القصير أسرع وسيلة للتمييز بين حدث من المشغل وإعادة تشغيل محلية.',
    ),
  )
  recommendations.push(
    t(
      lang,
      'Use the local ownership commands in this report on the router or server to identify the exact process listening on a port. A remote probe cannot see local process ownership.',
      'استخدم أوامر ملكية المنافذ المحلية في هذا التقرير على الراوتر أو الخادم لتحديد العملية المستمعة بدقة. الفحص عن بُعد لا يرى ملكية العمليات المحلية.',
    ),
  )

  return recommendations
}

function buildMarkdown(
  input: AnalyzerReportInput,
  ddnsState: DdnsAnalysis,
  causes: ReportCause[],
  recommendations: string[],
  limitations: string[],
): string {
  const { lang, publicIp, target, ports, checkedAt } = input
  const lines: string[] = []
  lines.push(t(lang, '# NEXORA DDNS & Port Analysis', '# تحليل NEXORA لـ DDNS والمنافذ'))
  lines.push('')
  lines.push(`${t(lang, 'Generated', 'تم الإنشاء')}: ${checkedAt}`)
  lines.push('')
  lines.push(`## ${t(lang, 'Snapshot', 'اللقطة الحالية')}`)
  lines.push(`- ${t(lang, 'Public IPv4', 'IPv4 العام')}: ${publicIp.ipv4 ?? '—'}`)
  lines.push(`- ${t(lang, 'Public IPv6', 'IPv6 العام')}: ${publicIp.ipv6 ?? '—'}`)
  lines.push(`- ${t(lang, 'Country / edge', 'الدولة / الحافة')}: ${[publicIp.country, publicIp.colo].filter(Boolean).join(' / ') || '—'}`)
  lines.push(`- ${t(lang, 'Probe target', 'هدف الفحص')}: ${target.host} (${target.address})`)
  lines.push(`- ${t(lang, 'CGNAT', 'CGNAT')}: ${isCgnat(publicIp.ipv4) ? t(lang, 'yes', 'نعم') : t(lang, 'not detected', 'غير مكتشف')}`)
  lines.push('')
  lines.push(`## DDNS`)
  lines.push(`- ${t(lang, 'Status', 'الحالة')}: ${ddnsState.status}`)
  lines.push(`- ${t(lang, 'Detail', 'التفصيل')}: ${ddnsState.detail}`)
  if (ddnsState.resolved.length > 0) lines.push(`- ${t(lang, 'Resolved', 'المحلول')}: ${ddnsState.resolved.join(', ')}`)
  lines.push('')
  lines.push(`## ${t(lang, 'Ports', 'المنافذ')}`)
  lines.push(`| ${t(lang, 'Port', 'المنفذ')} | ${t(lang, 'State', 'الحالة')} | ${t(lang, 'Service', 'الخدمة')} | ${t(lang, 'Latency', 'الزمن')} | ${t(lang, 'Evidence', 'الدليل')} |`)
  lines.push('| --- | --- | --- | --- | --- |')
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
  const { lang, publicIp, ddns, ports } = input
  const ddnsState = ddnsAnalysis(publicIp, ddns, lang)
  const causes = buildCauses(input)
  const recommendations = buildRecommendations(input)
  const highRisk = ports.filter((entry) => entry.state === 'open' && HIGH_RISK_PORTS.has(entry.port))
  const openPorts = ports.filter((entry) => entry.state === 'open')
  const riskLevel: AnalyzerReport['riskLevel'] = highRisk.length > 0 ? 'high' : ddnsState.status === 'mismatch' || isCgnat(publicIp.ipv4) ? 'medium' : 'low'

  const headline = isCgnat(publicIp.ipv4)
    ? t(lang, 'Your line appears to be behind carrier-grade NAT', 'يبدو أن خطك خلف NAT لمشغل الاتصالات')
    : ddnsState.status === 'mismatch'
      ? t(lang, 'DDNS does not match the current public address', 'DDNS لا يطابق العنوان العام الحالي')
      : openPorts.length > 0
        ? t(lang, 'Public IP detected with reachable TCP ports', 'تم كشف IP العام مع منافذ TCP قابلة للوصول')
        : t(lang, 'Public IP detected; no tested ports are reachable', 'تم كشف IP العام؛ لا توجد منافذ مفحوصة قابلة للوصول')

  const summary = t(
    lang,
    `Public IPv4 ${publicIp.ipv4 ?? 'not detected'}${publicIp.ipv6 ? `, IPv6 ${publicIp.ipv6}` : ''}. ${openPorts.length} of ${ports.length} tested ports accepted a TCP connection. ${ddnsState.detail}`,
    `IPv4 العام ${publicIp.ipv4 ?? 'غير مكتشف'}${publicIp.ipv6 ? `، وIPv6 ${publicIp.ipv6}` : ''}. ${openPorts.length} من ${ports.length} منفذاً مفحوصاً قبلت اتصال TCP. ${ddnsState.detail}`,
  )

  const limitations = [
    t(lang, 'The TCP probe runs from the NEXORA deployment, not from your modem or LAN.', 'فحص TCP يعمل من نشر NEXORA وليس من موديمك أو شبكتك المحلية.'),
    t(lang, 'A closed or filtered port can mean no service, missing NAT, host firewall, ISP filtering or CGNAT. It does not prove the port is unused.', 'المنفذ المغلق أو المفلتر قد يعني عدم وجود خدمة أو غياب NAT أو جدار حماية أو حجب المشغل أو CGNAT. لا يثبت أن المنفذ غير مستخدم.'),
    t(lang, 'Remote probing cannot identify the local process that owns a port. Use the local commands in this report.', 'الفحص عن بُعد لا يحدد العملية المحلية المالكة للمنفذ. استخدم الأوامر المحلية في هذا التقرير.'),
    t(lang, 'A single snapshot cannot prove the exact cause of an IP change. The causes are ranked likelihoods based on the evidence collected.', 'لقطة واحدة لا تثبت السبب الدقيق لتغير IP. الأسباب مرتبة حسب الاحتمال بناءً على الأدلة المجمعة.'),
    t(lang, 'IPv6 reachability may be untested when the deployment has no IPv6 egress.', 'قد لا يُختبر وصول IPv6 عندما لا يملك النشر مسار خروج IPv6.'),
  ]

  const observations: ReportObservation[] = [
    {
      label: t(lang, 'Public IPv4', 'IPv4 العام'),
      value: publicIp.ipv4 ?? '—',
      tone: publicIp.ipv4 ? (isCgnat(publicIp.ipv4) ? 'warning' : 'success') : 'warning',
    },
    {
      label: t(lang, 'Public IPv6', 'IPv6 العام'),
      value: publicIp.ipv6 ?? '—',
      tone: publicIp.ipv6 ? 'success' : 'default',
    },
    {
      label: t(lang, 'DDNS', 'DDNS'),
      value: ddnsState.title,
      tone: ddnsState.status === 'match' ? 'success' : ddnsState.status === 'mismatch' || ddnsState.status === 'unresolved' ? 'warning' : 'default',
    },
    {
      label: t(lang, 'Open ports', 'المنافذ المفتوحة'),
      value: openPorts.length > 0 ? openPorts.map((entry) => entry.port).join(', ') : t(lang, 'none of the tested ports', 'لا شيء من المنافذ المفحوصة'),
      tone: highRisk.length > 0 ? 'danger' : openPorts.length > 0 ? 'success' : 'warning',
    },
  ]

  const markdown = buildMarkdown(input, ddnsState, causes, recommendations, limitations)

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
