import type { ToolMeta } from '@/types'

export const TOOLS: ToolMeta[] = [
  {
    id: 'subnet',
    name: { en: 'Subnet / CIDR Calculator', ar: 'حاسبة Subnet / CIDR' },
    description: {
      en: 'Network, broadcast, host range and usable hosts for an IPv4 address and prefix.',
      ar: 'الشبكة والبث ونطاق المضيفين وعدد المضيفين المتاحين لعنوان IPv4 وبادئة.',
    },
    category: 'network',
    icon: 'Network',
    keywords: ['subnet', 'cidr', 'mask', 'ipv4', 'vlsm', 'تقسيم', 'شبكة'],
  },
  {
    id: 'ipv6',
    name: { en: 'IPv6 Address Helper', ar: 'مساعد عناوين IPv6' },
    description: {
      en: 'Expand, compress and classify IPv6 addresses.',
      ar: 'توسيع واختصار وتصنيف عناوين IPv6.',
    },
    category: 'network',
    icon: 'Globe2',
    keywords: ['ipv6', 'expand', 'compress', 'link-local', 'unique-local'],
  },
  {
    id: 'dns',
    name: { en: 'DNS Lookup', ar: 'استعلام DNS' },
    description: {
      en: 'A, AAAA, MX, TXT, NS and CNAME queries through DNS-over-HTTPS.',
      ar: 'استعلامات A وAAAA وMX وTXT وNS وCNAME عبر DNS-over-HTTPS.',
    },
    category: 'network',
    icon: 'Search',
    keywords: ['dns', 'lookup', 'mx', 'txt', 'cname', 'nslookup'],
  },
  {
    id: 'bandwidth',
    name: { en: 'Bandwidth Calculator', ar: 'حاسبة النطاق الترددي' },
    description: {
      en: 'Transfer time from data size, link speed and protocol overhead.',
      ar: 'زمن النقل من حجم البيانات وسرعة الرابط ونسق البروتوكول.',
    },
    category: 'network',
    icon: 'Gauge',
    keywords: ['bandwidth', 'transfer', 'throughput', 'time', 'mbit'],
  },
  {
    id: 'tls',
    name: { en: 'TLS Certificate Inspector', ar: 'فاحص شهادات TLS' },
    description: {
      en: 'Best-effort certificate metadata for a public host via the server proxy.',
      ar: 'بيانات الشهادة لمضيف عام عبر وسيط الخادم بأفضل جهد.',
    },
    category: 'network',
    icon: 'Lock',
    keywords: ['tls', 'ssl', 'certificate', 'expiry', 'https'],
  },
  {
    id: 'speed',
    name: { en: 'Internet Speed Test', ar: 'فحص سرعة الإنترنت' },
    description: {
      en: 'Download, upload, ping and jitter measured in the browser against the Cloudflare speed endpoint.',
      ar: 'التنزيل والرفع والبنغ والتذبذب تُقاس في المتصفح عبر نقطة قياس السرعة لدى كلاودفلير.',
    },
    category: 'network',
    icon: 'Gauge',
    keywords: ['speed', 'speedtest', 'bandwidth', 'ping', 'jitter', 'latency', 'سرعة'],
  },
  {
    id: 'portcheck',
    name: { en: 'Public Port & DDNS Checker', ar: 'فحص المنافذ العامة وDDNS' },
    description: {
      en: 'TCP port probes from the server plus A-record resolution to verify a DDNS hostname is reachable.',
      ar: 'فحص منافذ TCP من الخادم مع حل سجل A للتأكد من إمكانية الوصول إلى اسم DDNS.',
    },
    category: 'network',
    icon: 'RadioTower',
    keywords: ['port', 'ports', 'ddns', 'reachability', 'firewall', 'open', 'منافذ'],
  },
  {
    id: 'raid',
    name: { en: 'RAID Capacity Estimator', ar: 'مقدّر سعة RAID' },
    description: {
      en: 'Usable capacity and fault tolerance for RAID 0/1/5/6/10.',
      ar: 'السعة القابلة للاستخدام وتحمّل الأعطال لـ RAID 0/1/5/6/10.',
    },
    category: 'server',
    icon: 'HardDrive',
    keywords: ['raid', 'storage', 'capacity', 'parity', 'disk'],
  },
  {
    id: 'backup',
    name: { en: 'Backup Storage Estimator', ar: 'مقدّر مساحة النسخ الاحتياطي' },
    description: {
      en: 'Repository sizing with full/incremental schedules, retention and growth.',
      ar: 'تقدير المستودع بجداول كاملة وتزايدية والاحتفاظ والنمو.',
    },
    category: 'server',
    icon: 'Archive',
    keywords: ['backup', 'storage', 'retention', 'repository', '3-2-1'],
  },
  {
    id: 'rto',
    name: { en: 'RPO / RTO Planner', ar: 'مخطط RPO / RTO' },
    description: {
      en: 'Classify systems and summarize recovery objectives and test cadence.',
      ar: 'تصنيف الأنظمة وتلخيص أهداف التعافي ووتيرة الاختبار.',
    },
    category: 'server',
    icon: 'Timer',
    keywords: ['rpo', 'rto', 'disaster', 'recovery', 'tier'],
  },
  {
    id: 'cert',
    name: { en: 'Certificate Expiry Calculator', ar: 'حاسبة انتهاء الشهادات' },
    description: {
      en: 'Days until expiry plus a renewal window based on certificate lifetime.',
      ar: 'الأيام حتى الانتهاء ونافذة تجديد وفق عمر الشهادة.',
    },
    category: 'server',
    icon: 'CalendarClock',
    keywords: ['certificate', 'expiry', 'renewal', 'tls'],
  },
  {
    id: 'commandbuilder',
    name: { en: 'Windows Command Builder', ar: 'منشئ أوامر Windows' },
    description: {
      en: 'Reviewable SFC/DISM, update and printer diagnostic command sets with risk labels.',
      ar: 'مجموعات أوامر SFC/DISM والتحديث والطباعة قابلة للمراجعة مع تصنيف المخاطر.',
    },
    category: 'windows',
    icon: 'TerminalSquare',
    keywords: ['sfc', 'dism', 'windows update', 'powershell', 'commands'],
  },
  {
    id: 'log',
    name: { en: 'Event Log Analyzer', ar: 'محلل سجلات الأحداث' },
    description: {
      en: 'Group pasted Windows or text event logs by ID, level and provider.',
      ar: 'تجميع سجلات Windows أو النصوص حسب المعرّف والمستوى والمصدر.',
    },
    category: 'windows',
    icon: 'ScrollText',
    keywords: ['event', 'log', 'analyzer', 'eventid', 'windows'],
  },
  {
    id: 'cvss',
    name: { en: 'CVSS v3.1 Calculator', ar: 'حاسبة CVSS v3.1' },
    description: {
      en: 'Official base-score formula with vector string output.',
      ar: 'معادلة الدرجة الأساسية الرسمية مع توليد متجه.',
    },
    category: 'security',
    icon: 'ShieldAlert',
    keywords: ['cvss', 'vulnerability', 'severity', 'score'],
  },
  {
    id: 'headers',
    name: { en: 'Security Headers Reference', ar: 'مرجع رؤوس الأمان' },
    description: {
      en: 'Recommended HTTP security headers with rationale and examples.',
      ar: 'رؤوس HTTP الأمنية الموصى بها مع السبب والأمثلة.',
    },
    category: 'security',
    icon: 'FileCheck2',
    keywords: ['headers', 'csp', 'hsts', 'security', 'http'],
  },
  {
    id: 'checklist',
    name: { en: 'Operational Checklists', ar: 'قوائم التحقق التشغيلية' },
    description: {
      en: 'Server health, hardening, incident response and backup checklists you can save.',
      ar: 'قوائم صحة السيرفر والتحصين والاستجابة للحوادث والنسخ الاحتياطي قابلة للحفظ.',
    },
    category: 'security',
    icon: 'ListChecks',
    keywords: ['checklist', 'hardening', 'server', 'incident', 'backup'],
  },
  {
    id: 'ioc',
    name: { en: 'IOC Investigation Notes', ar: 'ملاحظات تحليل IOC' },
    description: {
      en: 'Track indicators, verdicts and evidence locally; export as Markdown.',
      ar: 'تتبع المؤشرات والأحكام والأدلة محليًا وتصديرها كـ Markdown.',
    },
    category: 'security',
    icon: 'ScanSearch',
    keywords: ['ioc', 'indicator', 'malware', 'investigation'],
  },
  {
    id: 'vuln',
    name: { en: 'Vulnerability Remediation Tracker', ar: 'متتبع معالجة الثغرات' },
    description: {
      en: 'Track CVEs, affected assets, owners, due dates and status locally.',
      ar: 'تتبع CVEs والأصول المتأثرة والمالكين والتواريخ والحالة محليًا.',
    },
    category: 'security',
    icon: 'Bug',
    keywords: ['cve', 'vulnerability', 'remediation', 'tracker'],
  },
  {
    id: 'audit',
    name: { en: 'Security Audit Report Builder', ar: 'منشئ تقرير التدقيق الأمني' },
    description: {
      en: 'Assemble findings with severity and evidence into an exportable report.',
      ar: 'تجميع النتائج مع الخطورة والأدلة في تقرير قابل للتصدير.',
    },
    category: 'security',
    icon: 'FileText',
    keywords: ['audit', 'report', 'security', 'findings'],
  },
  {
    id: 'hash',
    name: { en: 'Hash Calculator', ar: 'حاسبة التجزئة' },
    description: {
      en: 'SHA-1, SHA-256 and SHA-512 digests using Web Crypto.',
      ar: 'بصمات SHA-1 وSHA-256 وSHA-512 باستخدام Web Crypto.',
    },
    category: 'developer',
    icon: 'Fingerprint',
    keywords: ['hash', 'sha256', 'checksum', 'integrity'],
  },
  {
    id: 'base64',
    name: { en: 'Base64 Encode / Decode', ar: 'ترميز وفك Base64' },
    description: {
      en: 'UTF-8 safe Base64 conversion, including URL-safe output.',
      ar: 'تحويل Base64 آمن لـ UTF-8 بما يشمل الصيغة الآمنة للروابط.',
    },
    category: 'developer',
    icon: 'Binary',
    keywords: ['base64', 'encode', 'decode', 'utf8'],
  },
  {
    id: 'url',
    name: { en: 'URL Encode / Decode', ar: 'ترميز وفك URL' },
    description: {
      en: 'Percent-encode and decode URL components or full URLs.',
      ar: 'ترميز وفك مكونات الروابط أو الروابط الكاملة بنسبة مئوية.',
    },
    category: 'developer',
    icon: 'Link',
    keywords: ['url', 'encode', 'decode', 'percent'],
  },
  {
    id: 'json',
    name: { en: 'JSON Formatter & Validator', ar: 'تنسيق وفحص JSON' },
    description: {
      en: 'Format, minify and locate JSON syntax errors.',
      ar: 'تنسيق وتصغير وتحديد موضع خطأ صياغة JSON.',
    },
    category: 'developer',
    icon: 'Braces',
    keywords: ['json', 'format', 'validate', 'minify'],
  },
  {
    id: 'regex',
    name: { en: 'Regex Tester', ar: 'اختبار Regex' },
    description: {
      en: 'Test a JavaScript regular expression with match positions and groups.',
      ar: 'اختبار تعبير نمطي في JavaScript مع المواضع والمجموعات.',
    },
    category: 'developer',
    icon: 'Regex',
    keywords: ['regex', 'pattern', 'match', 'test'],
  },
  {
    id: 'timestamp',
    name: { en: 'Timestamp Converter', ar: 'محول الطوابع الزمنية' },
    description: {
      en: 'Convert Unix seconds, milliseconds and ISO 8601 in local time.',
      ar: 'تحويل Unix بالثواني والمللي ثانية وISO 8601 بالتوقيت المحلي.',
    },
    category: 'developer',
    icon: 'Clock',
    keywords: ['timestamp', 'unix', 'epoch', 'iso8601', 'time'],
  },
  {
    id: 'cron',
    name: { en: 'Cron Expression Helper', ar: 'مساعد تعبير Cron' },
    description: {
      en: 'Validate a five-field cron expression and preview the next run times.',
      ar: 'التحقق من تعبير cron بخمسة حقول ومعاينة مواعيد التشغيل التالية.',
    },
    category: 'developer',
    icon: 'CalendarClock',
    keywords: ['cron', 'schedule', 'jobs', 'crontab'],
  },
  {
    id: 'yaml',
    name: { en: 'YAML Validator', ar: 'مدقق YAML' },
    description: {
      en: 'Parse YAML and report syntax errors with line information.',
      ar: 'تحليل YAML وإظهار أخطاء الصياغة مع معلومات السطر.',
    },
    category: 'developer',
    icon: 'FileJson',
    keywords: ['yaml', 'validate', 'kubernetes', 'config'],
  },
  {
    id: 'markdown',
    name: { en: 'Markdown Editor', ar: 'محرر Markdown' },
    description: {
      en: 'Write Markdown with a sanitized live preview and export.',
      ar: 'كتابة Markdown مع معاينة مباشرة آمنة وتصدير.',
    },
    category: 'developer',
    icon: 'PenLine',
    keywords: ['markdown', 'editor', 'preview', 'docs'],
  },
  {
    id: 'api',
    name: { en: 'API Request Builder', ar: 'منشئ طلبات API' },
    description: {
      en: 'Send an HTTP request and inspect status, headers and body. CORS applies.',
      ar: 'إرسال طلب HTTP وفحص الحالة والرؤوس والجسم، مع مراعاة CORS.',
    },
    category: 'developer',
    icon: 'Send',
    keywords: ['api', 'http', 'rest', 'request', 'curl'],
  },
  {
    id: 'logformat',
    name: { en: 'Log Formatter', ar: 'منسّق السجلات' },
    description: {
      en: 'Pretty-print JSON lines or normalize plain-text logs.',
      ar: 'تنسيق أسطر JSON أو توحيد السجلات النصية.',
    },
    category: 'data',
    icon: 'AlignLeft',
    keywords: ['log', 'jsonl', 'format', 'parse'],
  },
  {
    id: 'ports',
    name: { en: 'TCP / UDP Port Reference', ar: 'مرجع منافذ TCP / UDP' },
    description: {
      en: 'Searchable reference for common service ports, protocols and secure alternatives.',
      ar: 'مرجع قابل للبحث لمنافذ الخدمات الشائعة والبروتوكولات والبدائل الآمنة.',
    },
    category: 'network',
    icon: 'Network',
    keywords: ['port', 'tcp', 'udp', 'service', 'netstat', 'firewall'],
  },
  {
    id: 'latency',
    name: { en: 'Latency & Packet Loss Analyzer', ar: 'محلل زمن الاستجابة وفقدان الحزم' },
    description: {
      en: 'Compute packet loss, min/avg/max RTT and jitter from ping samples.',
      ar: 'احسب فقدان الحزم وأقل/متوسط/أعلى زمن استجابة والتذبذب من عينات ping.',
    },
    category: 'network',
    icon: 'Activity',
    keywords: ['latency', 'ping', 'packet loss', 'jitter', 'rtt'],
  },
  {
    id: 'diskcapacity',
    name: { en: 'Disk Capacity Planner', ar: 'مخطط سعة الأقراص' },
    description: {
      en: 'Plan usable capacity with RAID overhead, reserved space, filesystem cost and growth headroom.',
      ar: 'خطط السعة المتاحة مع كلفة RAID والمساحة المحجوزة ونظام الملفات واحتياطي النمو.',
    },
    category: 'server',
    icon: 'HardDrive',
    keywords: ['disk', 'capacity', 'raid', 'storage', 'planning'],
  },
  {
    id: 'firewalldoc',
    name: { en: 'Firewall Rule Documenter', ar: 'موثّق قواعد جدار الحماية' },
    description: {
      en: 'Validate a firewall rule and export reviewable Markdown documentation.',
      ar: 'تحقق من قاعدة جدار حماية وصدّر توثيق Markdown قابلًا للمراجعة.',
    },
    category: 'security',
    icon: 'ShieldCheck',
    keywords: ['firewall', 'rule', 'documentation', 'policy', 'segmentation'],
  },
  {
    id: 'backupcheck',
    name: { en: 'Backup Readiness Checklist', ar: 'قائمة جاهزية النسخ الاحتياطي' },
    description: {
      en: 'Score backup coverage against RPO, copies, isolation, immutability and restore testing.',
      ar: 'قيّم تغطية النسخ الاحتياطي مقابل RPO والنسخ والعزل وعدم القابلية للتغيير واختبار الاسترداد.',
    },
    category: 'server',
    icon: 'Archive',
    keywords: ['backup', 'checklist', 'rpo', 'immutable', 'restore'],
  },
  {
    id: 'vlsm',
    name: { en: 'VLSM Subnet Planner', ar: 'مخطّط شبكات VLSM' },
    description: {
      en: 'Allocate aligned subnets for several networks from one base prefix, largest requirement first, with CSV export.',
      ar: 'توزيع شبكات متوافقة الحدود على عدة متطلبات من بادئة واحدة، الأكبر أولًا، مع تصدير CSV.',
    },
    category: 'network',
    icon: 'Network',
    keywords: ['vlsm', 'subnet', 'cidr', 'addressing plan', 'allocation', 'خطة عنونة', 'تقسيم'],
  },
  {
    id: 'permissions',
    name: { en: 'Linux Permission & umask Calculator', ar: 'حاسبة صلاحيات Linux وumask' },
    description: {
      en: 'Convert between octal and symbolic modes, review special bits, and see what a umask grants to new files and directories.',
      ar: 'التحويل بين الوضع العشاري والرمزي ومراجعة البتات الخاصة ومعرفة ما يمنحه umask للملفات والمجلدات الجديدة.',
    },
    category: 'server',
    icon: 'Lock',
    keywords: ['chmod', 'umask', 'permission', 'octal', 'symbolic', 'setuid', 'setgid', 'sticky', 'صلاحيات', 'تراخيص'],
  },
  {
    id: 'cidroverlap',
    name: { en: 'CIDR Overlap / Conflict Detector', ar: 'فاحص تداخل وتعارض CIDR' },
    description: {
      en: 'Check a list of IPv4 networks for overlapping subnets, host-bit mistakes and gateway or DNS address collisions.',
      ar: 'فحص قائمة شبكات IPv4 بحثًا عن الشبكات الفرعية المتداخلة وأخطاء بتات المضيف وتصادم عناوين البوابة وDNS.',
    },
    category: 'network',
    icon: 'Network',
    keywords: ['cidr', 'overlap', 'conflict', 'addressing plan', 'gateway', 'broadcast', 'تداخل', 'خطة عنونة', 'تعارض'],
  },
  {
    id: 'mtu',
    name: { en: 'MTU & Tunnel Overhead Calculator', ar: 'حاسبة MTU وكلفة الأنفاق' },
    description: {
      en: 'Payload MTU and TCP MSS for VXLAN, GRE, IPsec ESP, PPPoE, 6in4 and WireGuard, with the header breakdown and PMTU symptoms.',
      ar: 'حساب MTU الحمولة وقيمة MSS لأنفاق VXLAN وGRE وIPsec ESP وPPPoE و6in4 وWireGuard، مع تفصيل أحجام الترويسات وأعراض تجاوز MTU المسار.',
    },
    category: 'network',
    icon: 'Gauge',
    keywords: ['mtu', 'mss', 'fragmentation', 'vxlan', 'gre', 'ipsec', 'esp', 'pppoe', 'wireguard', 'jumbo', 'تجزئة', 'نفق'],
  },
  {
    id: 'capacity',
    name: { en: 'Storage Capacity Unit Converter', ar: 'محوّل وحدات سعة التخزين' },
    description: {
      en: 'Convert between IEC binary (KiB, GiB, TiB) and JEDEC decimal (KB, GB, TB) units and show the marketing-versus-usable gap.',
      ar: 'التحويل بين وحدات IEC الثنائية (KiB وGiB وTiB) ووحدات JEDEC العشرية (KB وGB وTB) وإظهار الفارق بين الحجم التسويقي والمتاح.',
    },
    category: 'server',
    icon: 'HardDrive',
    keywords: ['capacity', 'kib', 'mib', 'gib', 'tib', 'kb', 'mb', 'gb', 'tb', 'jedec', 'iec', 'سعة', 'تخزين', 'بايت'],
  },
  {
    id: 'certdecode',
    name: { en: 'X.509 Certificate & CSR Decoder', ar: 'فك تشفير الشهادات وطلبات التوقيع' },
    description: {
      en: 'Decode PEM certificates and CSRs from their DER bytes locally: validity, issuer and subject, key algorithm, SAN and extensions, plus chain matching inside the bundle.',
      ar: 'فك تشفير شهادات وطلبات توقيع certificates بصيغة PEM محليًا من ترميز DER: فترة الصلاحية والمُصدِر وصاحب الشهادة وخوارزمية المفتاح والامتدادات، مع مطابقة سلسلة الشهادات داخل الملف.',
    },
    category: 'security',
    icon: 'FileKey',
    keywords: ['x509', 'pem', 'csr', 'der', 'asn.1', 'san', 'certificate', 'chain', 'شهادة', 'سلسلة'],
  },
  {
    id: 'textdiff',
    name: { en: 'Text & Config Diff', ar: 'مقارنة النصوص وملفات الإعدادات' },
    description: {
      en: 'Line-by-line comparison of two configs or outputs with unified and side-by-side views, added/removed counts and ignore-case options.',
      ar: 'مقارنة سطرية بين ملفي إعدادات أو مخرجين مع عرض موحّد وآخر متقابل، وأعداد الأسطر المضافة والحذف وخيارات تجاهل حالة الأحرف.',
    },
    category: 'developer',
    icon: 'GitCompare',
    keywords: ['diff', 'compare', 'config', 'unified', 'مقارنة', 'فارق', 'إعدادات'],
  },
  {
    id: 'csvjson',
    name: { en: 'CSV ⇄ JSON Converter', ar: 'محوّل CSV إلى JSON والعكس' },
    description: {
      en: 'RFC 4180 parsing with quoted fields and embedded newlines, delimiter choice, ragged-row reporting and optional type coercion for ticket and inventory exports.',
      ar: 'تحليل متوافق مع RFC 4180 يدعم الحقول بين علامتي اقتباس وأسطر النص داخل الحقل واختيار الفاصل والإبلاغ عن الصفوف غير المتطابقة وتحويل الأنواع اختياريًا، لتصدير التذاكر والجرد.',
    },
    category: 'developer',
    icon: 'Table',
    keywords: ['csv', 'json', 'rfc 4180', 'delimiter', 'export', 'separator', 'فاصل', 'تصدير'],
  },
]

export const TOOL_CATEGORIES = ['network', 'server', 'windows', 'security', 'developer', 'data'] as const

export function getTool(id: string): ToolMeta | undefined {
  return TOOLS.find((tool) => tool.id === id)
}

export function toolsForCategories(categories: string[]): ToolMeta[] {
  if (categories.length === 0) return TOOLS
  return TOOLS.filter((tool) => categories.includes(tool.category))
}
