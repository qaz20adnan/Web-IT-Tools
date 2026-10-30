import { raidCapacity, type RaidLevel } from '@/lib/calculators'

export type PortProtocol = 'tcp' | 'udp' | 'both'

export interface PortEntry {
  port: number
  protocol: PortProtocol
  service: string
  description: string
  secure: boolean
}

export const PORT_ENTRIES: PortEntry[] = [
  { port: 20, protocol: 'tcp', service: 'ftp-data', description: 'FTP data transfer', secure: false },
  { port: 21, protocol: 'tcp', service: 'ftp', description: 'FTP control channel', secure: false },
  { port: 22, protocol: 'tcp', service: 'ssh', description: 'Secure Shell and SFTP', secure: true },
  { port: 23, protocol: 'tcp', service: 'telnet', description: 'Telnet (cleartext, avoid)', secure: false },
  { port: 25, protocol: 'tcp', service: 'smtp', description: 'SMTP mail relay', secure: false },
  { port: 53, protocol: 'both', service: 'dns', description: 'DNS name resolution', secure: false },
  { port: 67, protocol: 'udp', service: 'dhcp-server', description: 'DHCP server listening port', secure: false },
  { port: 68, protocol: 'udp', service: 'dhcp-client', description: 'DHCP client listening port', secure: false },
  { port: 69, protocol: 'udp', service: 'tftp', description: 'Trivial File Transfer Protocol', secure: false },
  { port: 80, protocol: 'tcp', service: 'http', description: 'HTTP web traffic', secure: false },
  { port: 88, protocol: 'both', service: 'kerberos', description: 'Kerberos authentication', secure: false },
  { port: 110, protocol: 'tcp', service: 'pop3', description: 'POP3 mail retrieval', secure: false },
  { port: 123, protocol: 'udp', service: 'ntp', description: 'Network Time Protocol', secure: false },
  { port: 135, protocol: 'tcp', service: 'msrpc', description: 'Microsoft RPC endpoint mapper', secure: false },
  { port: 137, protocol: 'udp', service: 'netbios-ns', description: 'NetBIOS name service', secure: false },
  { port: 138, protocol: 'udp', service: 'netbios-dgm', description: 'NetBIOS datagram service', secure: false },
  { port: 139, protocol: 'tcp', service: 'netbios-ssn', description: 'NetBIOS session service', secure: false },
  { port: 143, protocol: 'tcp', service: 'imap', description: 'IMAP mail retrieval', secure: false },
  { port: 161, protocol: 'udp', service: 'snmp', description: 'SNMP polling', secure: false },
  { port: 162, protocol: 'udp', service: 'snmptrap', description: 'SNMP trap receiver', secure: false },
  { port: 389, protocol: 'both', service: 'ldap', description: 'LDAP directory service', secure: false },
  { port: 443, protocol: 'tcp', service: 'https', description: 'HTTPS web traffic', secure: true },
  { port: 445, protocol: 'tcp', service: 'smb', description: 'SMB file sharing', secure: false },
  { port: 464, protocol: 'both', service: 'kpasswd', description: 'Kerberos password change', secure: false },
  { port: 465, protocol: 'tcp', service: 'smtps', description: 'SMTP over TLS', secure: true },
  { port: 500, protocol: 'udp', service: 'isakmp', description: 'IPsec key exchange', secure: true },
  { port: 514, protocol: 'udp', service: 'syslog', description: 'Syslog forwarding', secure: false },
  { port: 587, protocol: 'tcp', service: 'submission', description: 'Mail submission', secure: false },
  { port: 636, protocol: 'tcp', service: 'ldaps', description: 'LDAP over TLS', secure: true },
  { port: 993, protocol: 'tcp', service: 'imaps', description: 'IMAP over TLS', secure: true },
  { port: 995, protocol: 'tcp', service: 'pop3s', description: 'POP3 over TLS', secure: true },
  { port: 1194, protocol: 'both', service: 'openvpn', description: 'OpenVPN tunnel', secure: true },
  { port: 1433, protocol: 'tcp', service: 'mssql', description: 'Microsoft SQL Server', secure: false },
  { port: 1521, protocol: 'tcp', service: 'oracle', description: 'Oracle database listener', secure: false },
  { port: 1701, protocol: 'udp', service: 'l2tp', description: 'Layer 2 Tunneling Protocol', secure: true },
  { port: 1723, protocol: 'tcp', service: 'pptp', description: 'PPTP control channel (legacy)', secure: false },
  { port: 1812, protocol: 'udp', service: 'radius-auth', description: 'RADIUS authentication', secure: false },
  { port: 1813, protocol: 'udp', service: 'radius-acct', description: 'RADIUS accounting', secure: false },
  { port: 2049, protocol: 'both', service: 'nfs', description: 'Network File System', secure: false },
  { port: 3128, protocol: 'tcp', service: 'squid', description: 'HTTP proxy', secure: false },
  { port: 3268, protocol: 'tcp', service: 'global-catalog', description: 'AD global catalog', secure: false },
  { port: 3269, protocol: 'tcp', service: 'global-catalog-ssl', description: 'AD global catalog over TLS', secure: true },
  { port: 3306, protocol: 'tcp', service: 'mysql', description: 'MySQL or MariaDB', secure: false },
  { port: 3389, protocol: 'both', service: 'rdp', description: 'Remote Desktop Protocol', secure: false },
  { port: 4500, protocol: 'udp', service: 'ipsec-nat-t', description: 'IPsec NAT traversal', secure: true },
  { port: 5060, protocol: 'both', service: 'sip', description: 'SIP signalling', secure: false },
  { port: 5061, protocol: 'tcp', service: 'sips', description: 'SIP over TLS', secure: true },
  { port: 5432, protocol: 'tcp', service: 'postgresql', description: 'PostgreSQL database', secure: false },
  { port: 5672, protocol: 'tcp', service: 'amqp', description: 'AMQP message broker', secure: false },
  { port: 5900, protocol: 'tcp', service: 'vnc', description: 'VNC remote console', secure: false },
  { port: 6379, protocol: 'tcp', service: 'redis', description: 'Redis in-memory store', secure: false },
  { port: 8080, protocol: 'tcp', service: 'http-alt', description: 'Alternative HTTP listener', secure: false },
  { port: 8443, protocol: 'tcp', service: 'https-alt', description: 'Alternative HTTPS listener', secure: true },
  { port: 9092, protocol: 'tcp', service: 'kafka', description: 'Apache Kafka broker', secure: false },
  { port: 9200, protocol: 'tcp', service: 'elasticsearch', description: 'Elasticsearch or OpenSearch HTTP', secure: false },
  { port: 27017, protocol: 'tcp', service: 'mongodb', description: 'MongoDB database', secure: false },
]

export function searchPorts(query: string, protocol: PortProtocol | 'all' = 'all'): PortEntry[] {
  const term = query.trim().toLowerCase()
  return PORT_ENTRIES.filter((entry) => {
    if (protocol !== 'all' && entry.protocol !== protocol && entry.protocol !== 'both') return false
    if (!term) return true
    return (
      String(entry.port).includes(term) ||
      entry.service.toLowerCase().includes(term) ||
      entry.description.toLowerCase().includes(term)
    )
  })
}

export type LatencyGrade = 'excellent' | 'good' | 'fair' | 'poor'

export interface LatencyAnalysis {
  sent: number
  received: number
  lost: number
  lossPercent: number
  minMs: number
  maxMs: number
  avgMs: number
  jitterMs: number
  grade: LatencyGrade
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function analyzeLatency(sent: number, samples: number[]): LatencyAnalysis | null {
  if (!Number.isInteger(sent) || sent <= 0) return null
  if (samples.length > sent) return null
  if (!samples.every((sample) => Number.isFinite(sample) && sample >= 0)) return null

  const received = samples.length
  const lost = sent - received
  const lossPercent = (lost / sent) * 100
  const minMs = received ? Math.min(...samples) : 0
  const maxMs = received ? Math.max(...samples) : 0
  const avgMs = received ? samples.reduce((sum, sample) => sum + sample, 0) / received : 0
  const jitterMs = received > 1
    ? samples.slice(1).reduce((sum, sample, index) => sum + Math.abs(sample - samples[index]), 0) / (received - 1)
    : 0

  let grade: LatencyGrade
  if (lossPercent >= 5 || avgMs >= 200 || jitterMs >= 100) grade = 'poor'
  else if (lossPercent >= 1 || avgMs >= 100 || jitterMs >= 50) grade = 'fair'
  else if (lossPercent > 0 || avgMs >= 40 || jitterMs >= 30) grade = 'good'
  else grade = 'excellent'

  return {
    sent,
    received,
    lost,
    lossPercent: round1(lossPercent),
    minMs: round1(minMs),
    maxMs: round1(maxMs),
    avgMs: round1(avgMs),
    jitterMs: round1(jitterMs),
    grade,
  }
}

export interface DiskPlanInput {
  disks: number
  /** Binary GiB, matching what an operating system reports for a drive. */
  diskSizeGiB: number
  raid: RaidLevel
  reservedPercent: number
  filesystemPercent: number
  growthReservePercent: number
}

export interface DiskPlan {
  rawGiB: number
  usableGiB: number
  reservedGiB: number
  filesystemGiB: number
  currentCapacityGiB: number
  growthHeadroomGiB: number
  efficiency: number
  tolerance: number
  bestCaseTolerance: number
}

function percentValid(value: number, max: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= max
}

export function planDiskCapacity(input: DiskPlanInput): DiskPlan | null {
  const { disks, diskSizeGiB, raid, reservedPercent, filesystemPercent, growthReservePercent } = input
  if (!Number.isInteger(disks) || disks < 2 || !Number.isFinite(diskSizeGiB) || diskSizeGiB <= 0) return null
  if (!percentValid(reservedPercent, 50) || !percentValid(filesystemPercent, 30) || !percentValid(growthReservePercent, 90)) return null

  const array = raidCapacity(raid, disks, diskSizeGiB / 1024)
  if (!array) return null

  const rawGiB = disks * diskSizeGiB
  const usableGiB = array.usableTB * 1024
  const reservedGiB = usableGiB * (reservedPercent / 100)
  const afterReserve = usableGiB - reservedGiB
  const filesystemGiB = afterReserve * (filesystemPercent / 100)
  const currentCapacityGiB = afterReserve - filesystemGiB
  const growthHeadroomGiB = currentCapacityGiB * (growthReservePercent / 100)

  return {
    rawGiB: Math.round(rawGiB),
    usableGiB: Math.round(usableGiB),
    reservedGiB: Math.round(reservedGiB),
    filesystemGiB: Math.round(filesystemGiB),
    currentCapacityGiB: Math.round(currentCapacityGiB - growthHeadroomGiB),
    growthHeadroomGiB: Math.round(growthHeadroomGiB),
    efficiency: Math.round(array.efficiency),
    tolerance: array.tolerance,
    bestCaseTolerance: array.bestCaseTolerance,
  }
}

export type FirewallDirection = 'inbound' | 'outbound'
export type FirewallAction = 'allow' | 'block'
export type FirewallProtocol = 'tcp' | 'udp' | 'icmp' | 'any'

export interface FirewallRuleInput {
  name: string
  direction: FirewallDirection
  action: FirewallAction
  protocol: FirewallProtocol
  ports: string
  remoteScope: string
  profile: string
  purpose: string
  enabled: boolean
}

export interface FirewallAssessment {
  valid: boolean
  errors: string[]
  warnings: string[]
  markdown: string
}

function portsValid(value: string): boolean {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return false
  return parts.every((part) => {
    const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(part)
    if (!match) return false
    const start = Number(match[1])
    const end = match[2] ? Number(match[2]) : start
    return start >= 1 && end <= 65535 && start <= end
  })
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') || '—'
}

/** Bilingual helper used by the tool components; English is the fallback so exported text never breaks. */
export type Translator = (en: string, ar: string) => string

const english: Translator = (en) => en

export function assessFirewallRule(input: FirewallRuleInput, translate: Translator = english): FirewallAssessment {
  const t = translate
  const errors: string[] = []
  const warnings: string[] = []
  const name = input.name.trim()
  const remoteScope = input.remoteScope.trim()
  const purpose = input.purpose.trim()
  const ports = input.ports.trim()

  if (!name) errors.push(t('Rule name is required.', 'اسم القاعدة مطلوب.'))
  if (!remoteScope) errors.push(t('Remote scope is required; use "any" explicitly if that is intended.', 'النطاق البعيد مطلوب؛ استخدم "any" صراحةً إن كان ذلك مقصودًا.'))
  if (input.protocol === 'tcp' || input.protocol === 'udp') {
    if (!ports || ports.toLowerCase() === 'any') errors.push(t('TCP/UDP rules must list explicit ports.', 'يجب أن تسرد قواعد TCP/UDP المنافذ صراحةً.'))
    else if (!portsValid(ports)) errors.push(t('Ports must be numbers or ranges between 1 and 65535, separated by commas.', 'يجب أن تكون المنافذ أرقامًا أو نطاقات بين 1 و65535 مفصولة بفواصل.'))
  }

  const inboundAllow = input.direction === 'inbound' && input.action === 'allow'
  if (inboundAllow && (!ports || ports.toLowerCase() === 'any')) {
    warnings.push(t('Inbound allow with any port is broad. Restrict the port range if possible.', 'السماح الوارد لكل المنافذ واسع؛ حدّد نطاق المنافذ إن أمكن.'))
  }
  if (inboundAllow && (remoteScope === 'any' || remoteScope === '*')) {
    warnings.push(t('Inbound allow from any address exposes the rule to all networks.', 'السماح الوارد من أي عنوان يعرض القاعدة لكل الشبكات.'))
  }
  if (!purpose) warnings.push(t('Record a business or incident purpose so the rule can be reviewed later.', 'سجّل غرضًا تجاريًا أو مرتبطًا بحادثة حتى يمكن مراجعة القاعدة لاحقًا.'))
  if (!input.enabled) warnings.push(t('The rule is documented as disabled; confirm that is intended.', 'القاعدة موثّقة كمعطّلة؛ تأكد أن هذا مقصود.'))

  const rows = [
    [t('Name', 'الاسم'), name],
    [t('Direction', 'الاتجاه'), input.direction],
    [t('Action', 'الإجراء'), input.action],
    [t('Protocol', 'البروتوكول'), input.protocol],
    [t('Local ports', 'المنافذ المحلية'), input.protocol === 'tcp' || input.protocol === 'udp' ? ports : 'n/a'],
    [t('Remote scope', 'النطاق البعيد'), remoteScope],
    [t('Profile', 'الملف'), input.profile.trim()],
    [t('Enabled', 'مُفعّلة'), input.enabled ? t('Yes', 'نعم') : t('No', 'لا')],
    [t('Purpose', 'الغرض'), purpose],
  ]

  const markdown = [
    `# ${t('Firewall rule', 'قاعدة جدار الحماية')}: ${name || t('Untitled', 'بلا اسم')}`,
    '',
    '| ' + t('Field', 'الحقل') + ' | ' + t('Value', 'القيمة') + ' |',
    '| --- | --- |',
    ...rows.map(([label, value]) => `| ${escapeCell(label)} | ${escapeCell(value)} |`),
    '',
    `## ${t('Review notes', 'ملاحظات المراجعة')}`,
    '',
    ...(errors.length ? errors.map((error) => `- **${t('Error', 'خطأ')}:** ${error}`) : []),
    ...(warnings.length ? warnings.map((warning) => `- **${t('Warning', 'تحذير')}:** ${warning}`) : []),
    ...(errors.length === 0 && warnings.length === 0
      ? [`- ${t('No structural issues found. Confirm the rule against the approved network policy.', 'لا توجد مشكلات بنيوية. تحقق من القاعدة وفق سياسة الشبكة المعتمدة.')}`]
      : []),
    '',
    `> ${t('Generated for documentation only. Adnan Tech does not deploy firewall rules.', 'أُنشئ للتوثيق فقط. لا تنشر منصة عدنان تك قواعد جدار الحماية.')}`,
  ].join('\n')

  return { valid: errors.length === 0, errors, warnings, markdown }
}

export interface BackupReadinessInput {
  rpoHours: number
  frequencyHours: number
  copies: number
  offsite: boolean
  immutable: boolean
  encrypted: boolean
  restoreTestDays: number
}

export type ReadinessStatus = 'ready' | 'needs-work' | 'critical'

export interface ReadinessCheck {
  id: 'rpo' | 'copies' | 'offsite' | 'immutable' | 'encryption' | 'restore-test'
  pass: boolean
  weight: number
}

export interface BackupReadiness {
  score: number
  status: ReadinessStatus
  checks: ReadinessCheck[]
}

export function backupReadiness(input: BackupReadinessInput): BackupReadiness | null {
  const { rpoHours, frequencyHours, copies, restoreTestDays } = input
  if (!Number.isFinite(rpoHours) || rpoHours <= 0) return null
  if (!Number.isFinite(frequencyHours) || frequencyHours <= 0) return null
  if (!Number.isInteger(copies) || copies < 1) return null
  if (!Number.isFinite(restoreTestDays) || restoreTestDays < 0) return null

  const checks: ReadinessCheck[] = [
    { id: 'rpo', pass: frequencyHours <= rpoHours, weight: 25 },
    { id: 'copies', pass: copies >= 3, weight: 15 },
    { id: 'offsite', pass: input.offsite, weight: 15 },
    { id: 'immutable', pass: input.immutable, weight: 15 },
    { id: 'encryption', pass: input.encrypted, weight: 10 },
    { id: 'restore-test', pass: restoreTestDays <= 30, weight: 20 },
  ]

  const score = checks.reduce((sum, check) => sum + (check.pass ? check.weight : 0), 0)
  const status: ReadinessStatus = score >= 90 ? 'ready' : score >= 60 ? 'needs-work' : 'critical'
  return { score, status, checks }
}
