import type { LocalizedText, RiskLevel } from '@/types'

export interface ScanFinding {
  ruleId: string
  severity: 'medium' | 'high' | 'critical'
  line: number
  excerpt: string
  title: LocalizedText
  recommendation: LocalizedText
}

interface Rule {
  id: string
  severity: 'medium' | 'high' | 'critical'
  pattern: RegExp
  title: LocalizedText
  recommendation: LocalizedText
}

const RULES: Rule[] = [
  {
    id: 'rm-root',
    severity: 'critical',
    pattern: /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+(\/|\/\*|~\/?\*?)(\s|$)/,
    title: { en: 'Recursive delete of a root or home path', ar: 'حذف متكرر لمسار جذر أو مجلد المستخدم' },
    recommendation: {
      en: 'Never delete root or home paths from a script. Resolve and validate an explicit target path first.',
      ar: 'لا تحذف مسارات الجذر أو مجلد المستخدم من سكربت. حدد المسار الهدف وتحقق منه أولًا.',
    },
  },
  {
    id: 'remove-item',
    severity: 'high',
    pattern: /\b(Remove-Item|rmdir|rd)\b[^\n]*(-Recurse|-r\b)[^\n]*(-Force|-f\b)?/i,
    title: { en: 'Recursive deletion', ar: 'حذف متكرر' },
    recommendation: {
      en: 'Gate deletion behind a confirmation, a variable-validated path, and a backup or recycle-bin option.',
      ar: 'اشترط التأكيد والتحقق من المتغير والنسخ الاحتياطي أو سلة المحذوفات قبل الحذف.',
    },
  },
  {
    id: 'format-disk',
    severity: 'critical',
    pattern: /\b(Format-Volume|Clear-Disk|Initialize-Disk|diskpart\s+\/s|format\s+[a-z]:)/i,
    title: { en: 'Destructive disk operation', ar: 'عملية قرص مدمّرة' },
    recommendation: {
      en: 'Require an approved change record, a verified backup, and an explicit disk identifier. Never use wildcards.',
      ar: 'اطلب سجل تغيير معتمدًا ونسخة احتياطية موثقة ومعرّف قرص صريحًا. لا تستخدم أحرف البدل.',
    },
  },
  {
    id: 'sql-drop',
    severity: 'critical',
    pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i,
    title: { en: 'Irreversible SQL DROP', ar: 'أمر DROP SQL غير قابل للتراجع' },
    recommendation: {
      en: 'Take a verified backup or snapshot first and use a transaction where the engine supports it.',
      ar: 'خذ نسخة احتياطية أو لقطة موثقة أولًا واستخدم معاملة إن كان المحرك يدعمها.',
    },
  },
  {
    id: 'invoke-expression',
    severity: 'high',
    pattern: /\b(Invoke-Expression|iex)\b/i,
    title: { en: 'Dynamic code execution', ar: 'تنفيذ كود ديناميكي' },
    recommendation: {
      en: 'Avoid evaluating strings as code. Use explicit parameters and validate allowed values.',
      ar: 'تجنّب تقييم النصوص ككود. استخدم معاملات صريحة وتحقق من القيم المسموح بها.',
    },
  },
  {
    id: 'execution-policy',
    severity: 'high',
    pattern: /Set-ExecutionPolicy\s+(Bypass|Unrestricted)/i,
    title: { en: 'Execution policy bypass', ar: 'تجاوز سياسة التنفيذ' },
    recommendation: {
      en: 'Sign the script instead. A temporary Process-scope change is safer than a persistent machine-wide bypass.',
      ar: 'وقّع السكربت بدلًا من ذلك. تغيير مؤقت في نطاق Process أكثر أمانًا من تجاوز دائم على مستوى الجهاز.',
    },
  },
  {
    id: 'chmod-777',
    severity: 'high',
    pattern: /\bchmod\s+(-R\s+)?777\b/,
    title: { en: 'World-writable permissions', ar: 'أذونات كتابة للجميع' },
    recommendation: {
      en: 'Grant the minimum required mode to a specific owner or group, never 777 on sensitive paths.',
      ar: 'امنح الحد الأدنى من الأذونات لمالك أو مجموعة محددة، ولا تستخدم 777 على مسارات حساسة.',
    },
  },
  {
    id: 'pipe-to-shell',
    severity: 'critical',
    pattern: /(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba|z|k)?sh\b/i,
    title: { en: 'Downloaded content piped to a shell', ar: 'محتوى مُنزّل يُمرر إلى صدفة' },
    recommendation: {
      en: 'Download, verify a checksum or signature, then execute the reviewed file.',
      ar: 'نزّل الملف وتحقق من البصمة أو التوقيع ثم نفّذ الملف المراجَع.',
    },
  },
  {
    id: 'firewall-off',
    severity: 'high',
    pattern: /(Disable-NetFirewallRule|netsh\s+advfirewall\s+set\s+\w+\s+state\s+off)/i,
    title: { en: 'Firewall disabled', ar: 'تعطيل جدار الحماية' },
    recommendation: {
      en: 'Create a scoped allow rule for the required port and source instead of disabling the firewall.',
      ar: 'أنشئ قاعدة سماح محددة للمنفذ والمصدر المطلوبين بدلًا من تعطيل جدار الحماية.',
    },
  },
  {
    id: 'remote-shell',
    severity: 'medium',
    pattern: /\b(Invoke-Command|Enter-PSSession|ssh\s+\S+@\S+|scp\s+)/i,
    title: { en: 'Remote execution or transfer', ar: 'تنفيذ أو نقل عن بُعد' },
    recommendation: {
      en: 'Confirm the target host, credentials scope, and that the remote change is intended.',
      ar: 'تأكد من المضيف الهدف ونطاق بيانات الاعتماد وأن التغيير البعيد مقصود.',
    },
  },
  {
    id: 'reboot',
    severity: 'medium',
    pattern: /\b(Restart-Computer|Stop-Computer|shutdown\s+\/[rf]|reboot)\b/i,
    title: { en: 'Unexpected reboot or shutdown', ar: 'إعادة تشغيل أو إيقاف غير متوقع' },
    recommendation: {
      en: 'Require a maintenance window, warn interactive users, and check for unsaved work and cluster roles.',
      ar: 'اشترط نافذة صيانة ونبّه المستخدمين وتحقق من الأعمال غير المحفوظة وأدوار العنقود.',
    },
  },
  {
    id: 'hard-reset',
    severity: 'medium',
    pattern: /\bgit\s+reset\s+--hard\b/i,
    title: { en: 'Discards uncommitted work', ar: 'يتجاهل العمل غير الملتزم' },
    recommendation: {
      en: 'Stash or commit local changes first; confirm the current branch before resetting.',
      ar: 'خزّن التغييرات المحلية أو التزم بها أولًا وتأكد من الفرع الحالي قبل إعادة الضبط.',
    },
  },
  {
    id: 'ad-removal',
    severity: 'high',
    pattern: /\b(Remove-ADUser|Remove-ADGroupMember|Remove-ADComputer)\b/i,
    title: { en: 'Identity object removal', ar: 'حذف كائن هوية' },
    recommendation: {
      en: 'Disable and retain the object first. Verify group membership impact and approval.',
      ar: 'عطّل الكائن واحتفظ به أولًا وتحقق من أثر العضوية والموافقة.',
    },
  },
  {
    id: 'dd-device',
    severity: 'critical',
    pattern: /\bdd\s+if=\S+\s+of=\/dev\//,
    title: { en: 'Raw device write', ar: 'كتابة مباشرة على جهاز' },
    recommendation: {
      en: 'A wrong target destroys data. Confirm the device path twice and use a snapshot.',
      ar: 'الهدف الخاطئ يتلف البيانات. تحقق من مسار الجهاز مرتين واستخدم لقطة.',
    },
  },
]

export const SEVERITY_ORDER: Record<ScanFinding['severity'], number> = { critical: 3, high: 2, medium: 1 }

export function scanScript(code: string): ScanFinding[] {
  const findings: ScanFinding[] = []
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        line: index + 1,
        excerpt: line.trim().slice(0, 200),
        title: rule.title,
        recommendation: rule.recommendation,
      })
    }
  })
  return findings.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] || a.line - b.line)
}

export function highestRisk(findings: ScanFinding[]): RiskLevel {
  if (findings.some((finding) => finding.severity === 'critical')) return 'critical'
  if (findings.some((finding) => finding.severity === 'high')) return 'high'
  if (findings.some((finding) => finding.severity === 'medium')) return 'medium'
  return 'low'
}
