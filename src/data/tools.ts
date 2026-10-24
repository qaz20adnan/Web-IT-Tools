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
]

export const TOOL_CATEGORIES = ['network', 'server', 'windows', 'security', 'developer', 'data'] as const

export function getTool(id: string): ToolMeta | undefined {
  return TOOLS.find((tool) => tool.id === id)
}

export function toolsForCategories(categories: string[]): ToolMeta[] {
  if (categories.length === 0) return TOOLS
  return TOOLS.filter((tool) => categories.includes(tool.category))
}
