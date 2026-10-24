import type { LocalizedText } from '@/types'

export interface ChecklistDefinition {
  id: string
  title: LocalizedText
  description: LocalizedText
  items: Array<{ id: string; text: LocalizedText; critical?: boolean }>
}

export const CHECKLISTS: ChecklistDefinition[] = [
  {
    id: 'server-health',
    title: { en: 'Windows Server health checklist', ar: 'قائمة صحة Windows Server' },
    description: {
      en: 'Read-only verification pass for a production Windows Server. Collect evidence before changing anything.',
      ar: 'جولة تحقق للقراءة فقط على Windows Server إنتاجي. اجمع الأدلة قبل أي تغيير.',
    },
    items: [
      { id: 'srv-uptime', text: { en: 'Record uptime, last boot and pending reboot state', ar: 'سجّل مدة التشغيل وآخر إقلاع وحالة إعادة التشغيل المعلقة' }, critical: true },
      { id: 'srv-disk', text: { en: 'Confirm free space on OS, data and log volumes (≥15% or documented threshold)', ar: 'تأكد من المساحة الحرة في وحدات نظام التشغيل والبيانات والسجلات (≥15% أو حد موثق)' }, critical: true },
      { id: 'srv-disk-health', text: { en: 'Check physical disk and storage pool health, not just free space', ar: 'افحص صحة الأقراص ومجمعات التخزين لا المساحة فقط' }, critical: true },
      { id: 'srv-services', text: { en: 'Verify critical services and their startup type', ar: 'تحقق من الخدمات الحرجة ونوع بدء تشغيلها' } },
      { id: 'srv-events', text: { en: 'Review System and Application error events for the last 24 hours', ar: 'راجع أحداث الخطأ في System وApplication لآخر 24 ساعة' } },
      { id: 'srv-backup', text: { en: 'Confirm the last successful backup and the last tested restore date', ar: 'تأكد من آخر نسخة ناجحة وتاريخ آخر استعادة مُختبرة' }, critical: true },
      { id: 'srv-patch', text: { en: 'Check installed updates and the patch compliance window', ar: 'افحص التحديثات المثبتة ونافذة الالتزام بالتصحيح' } },
      { id: 'srv-time', text: { en: 'Verify time synchronization source and offset', ar: 'تحقق من مصدر مزامنة الوقت والفرق' } },
      { id: 'srv-sec', text: { en: 'Review Defender/EDR status and audit policy changes', ar: 'راجع حالة Defender/EDR وتغييرات سياسة التدقيق' }, critical: true },
      { id: 'srv-certs', text: { en: 'Check certificate expiry within the next 90 days', ar: 'افحص الشهادات المنتهية خلال 90 يومًا' } },
      { id: 'srv-capacity', text: { en: 'Compare CPU, memory and IOPS trends with capacity plan', ar: 'قارن اتجاهات المعالج والذاكرة وIOPS بخطة السعة' } },
      { id: 'srv-doc', text: { en: 'Update the runbook with anything that changed', ar: 'حدّث دليل التشغيل بأي تغيير حدث' } },
    ],
  },
  {
    id: 'hardening',
    title: { en: 'Security hardening baseline', ar: 'أساسيات التحصين الأمني' },
    description: {
      en: 'A prioritised baseline for Windows and identity infrastructure. Test in a pilot group; do not apply all controls at once.',
      ar: 'أساسيات مرتبة الأولوية لـ Windows وبنية الهوية. اختبر في مجموعة تجريبية ولا تطبق كل الضوابط دفعة واحدة.',
    },
    items: [
      { id: 'sec-tier', text: { en: 'Separate privileged accounts by tier; no admin account for email or browsing', ar: 'افصل الحسابات المميزة حسب الطبقة، ولا حساب إداري للبريد أو التصفح' }, critical: true },
      { id: 'sec-mfa', text: { en: 'MFA enforced for all administrators and remote access', ar: 'فرض MFA لكل المسؤولين والوصول البعيد' }, critical: true },
      { id: 'sec-laps', text: { en: 'Unique local administrator passwords managed centrally', ar: 'كلمات مرور مدير محلي فريدة ومدارة مركزيًا' }, critical: true },
      { id: 'sec-smbv1', text: { en: 'SMBv1 disabled where no dependency exists', ar: 'تعطيل SMBv1 حيث لا توجد اعتمادية' } },
      { id: 'sec-ldap', text: { en: 'LDAP signing and channel binding enforced or progressed', ar: 'فرض توقيع LDAP وربط القناة أو التقدم فيه' } },
      { id: 'sec-ntlm', text: { en: 'NTLM usage inventoried and reduced', ar: 'حصر استخدام NTLM وتقليله' } },
      { id: 'sec-patch', text: { en: 'Tier-0 assets patched on an accelerated schedule', ar: 'تصحيح أصول Tier-0 وفق جدول معجّل' }, critical: true },
      { id: 'sec-backup', text: { en: 'At least one immutable/offline backup copy verified', ar: 'التحقق من نسخة احتياطية غير قابلة للتغيير أو غير متصلة على الأقل' }, critical: true },
      { id: 'sec-logs', text: { en: 'Authentication and privilege-change logging forwarded to SIEM', ar: 'إرسال سجلات المصادقة وتغيير الصلاحيات إلى SIEM' } },
      { id: 'sec-edr', text: { en: 'EDR healthy and tamper protection enabled', ar: 'صحة EDR وتفعيل حماية العبث' } },
      { id: 'sec-reviews', text: { en: 'Quarterly access review for privileged groups', ar: 'مراجعة ربع سنوية لوصول المجموعات المميزة' } },
      { id: 'sec-ir', text: { en: 'Incident response contacts and playbooks tested', ar: 'اختبار جهات الاتصال وأدلة الاستجابة للحوادث' } },
    ],
  },
  {
    id: 'incident-response',
    title: { en: 'Incident response first-hour checklist', ar: 'قائمة الساعة الأولى للاستجابة للحوادث' },
    description: {
      en: 'Operational checklist for containment. Follow your organisation’s legal and communications plan.',
      ar: 'قائمة تشغيلية للاحتواء. اتبع خطة مؤسستك القانونية وخطة التواصل.',
    },
    items: [
      { id: 'ir-declare', text: { en: 'Incident commander and scribe assigned; decision log started', ar: 'تعيين قائد الحادث والكاتب وبدء سجل القرارات' }, critical: true },
      { id: 'ir-scope', text: { en: 'Initial scope: identities, hosts, data and business services', ar: 'النطاق الأولي: الهويات والأجهزة والبيانات وخدمات الأعمال' }, critical: true },
      { id: 'ir-evidence', text: { en: 'Volatile evidence and relevant logs preserved before changes', ar: 'حفظ الأدلة المتطايرة والسجلات قبل التغيير' }, critical: true },
      { id: 'ir-contain', text: { en: 'Containment selected with reversibility considered', ar: 'اختيار الاحتواء مع مراعاة قابلية التراجع' } },
      { id: 'ir-sessions', text: { en: 'Compromised account sessions and tokens revoked', ar: 'إبطال جلسات الحساب المخترق ورموزه' }, critical: true },
      { id: 'ir-c2', text: { en: 'Known command-and-control infrastructure blocked at egress', ar: 'حجب بنية C2 المعروفة عند نقطة الخروج' } },
      { id: 'ir-backups', text: { en: 'Backup immutability verified before recovery planning', ar: 'التحقق من عدم قابلية النسخ للتغيير قبل تخطيط الاستعادة' }, critical: true },
      { id: 'ir-legal', text: { en: 'Legal, privacy and insurer contacts engaged', ar: 'إشراك القانوني والخصوصية والتأمين' } },
      { id: 'ir-comms', text: { en: 'Approved communication channel and holding statement', ar: 'قناة تواصل معتمدة وبيان أولي' } },
      { id: 'ir-timeline', text: { en: 'Timeline maintained with UTC timestamps and evidence hashes', ar: 'صيانة الجدول الزمني بتوقيت UTC وبصمات الأدلة' } },
      { id: 'ir-eradicate', text: { en: 'Eradication plan does not destroy evidence needed for scope', ar: 'خطة الاستئصال لا تتلف أدلة لازمة لتحديد النطاق' } },
      { id: 'ir-review', text: { en: 'Post-incident review scheduled with owners and dates', ar: 'جدولة مراجعة ما بعد الحادث بمالكين وتواريخ' } },
    ],
  },
  {
    id: 'backup-321',
    title: { en: 'Backup and restore validation', ar: 'التحقق من النسخ الاحتياطي والاستعادة' },
    description: {
      en: 'Prove recoverability instead of trusting job status. Adjust cadence to system tier.',
      ar: 'أثبت قابلية الاستعادة بدل الثقة بحالة المهمة، وعدّل الوتيرة حسب فئة النظام.',
    },
    items: [
      { id: 'bk-inventory', text: { en: 'Every critical system is in scope with an owner', ar: 'كل نظام حرج داخل النطاق وله مالك' }, critical: true },
      { id: 'bk-321', text: { en: 'Three copies, two media types, one offsite', ar: 'ثلاث نسخ ووسيطان ون副本 خارج الموقع' } },
      { id: 'bk-immutable', text: { en: 'Immutable/offline copy cannot be deleted by production credentials', ar: 'النسخة غير القابلة للتغيير أو غير المتصلة لا يحذفها حساب الإنتاج' }, critical: true },
      { id: 'bk-rpo', text: { en: 'RPO documented and met by backup frequency', ar: 'توثيق RPO وتحقيقه بتكرار النسخ' }, critical: true },
      { id: 'bk-rto', text: { en: 'RTO measured from an actual restore, not estimated', ar: 'قياس RTO من استعادة فعلية لا تقدير' }, critical: true },
      { id: 'bk-appconsistent', text: { en: 'Application-consistent backups enabled for databases and VMs', ar: 'تفعيل نسخ متسق مع التطبيق لقواعد البيانات والأجهزة الافتراضية' } },
      { id: 'bk-encrypt', text: { en: 'Backups encrypted in transit and at rest; keys managed separately', ar: 'تشفير النسخ أثناء النقل والتخزين وإدارة المفاتيح منفصلة' } },
      { id: 'bk-restore', text: { en: 'Restore tested to an isolated environment this quarter', ar: 'اختبار الاستعادة إلى بيئة معزولة هذا الربع' }, critical: true },
      { id: 'bk-integrity', text: { en: 'Restored data validated with application checks', ar: 'التحقق من البيانات المستعادة بفحوص التطبيق' } },
      { id: 'bk-docs', text: { en: 'Restore runbook current with credentials location (not the secret itself)', ar: 'تحديث دليل الاستعادة مع مكان بيانات الاعتماد لا السر نفسه' } },
      { id: 'bk-alerts', text: { en: 'Backup failure alerts reach an accountable on-call owner', ar: 'وصول تنبيهات فشل النسخ إلى مسؤول مناوب' } },
    ],
  },
]

