import type { AnalysisResult, Language, ProblemInput } from '@/types'

const bi = (lang: Language, en: string, ar: string) => (lang === 'ar' ? ar : en)

interface Rule {
  id: string
  test: RegExp
  build: (input: ProblemInput, lang: Language) => Pick<
    AnalysisResult,
    'summary' | 'symptoms' | 'causes' | 'evidence' | 'diagnosticSteps' | 'solutions' | 'prerequisites' | 'risks' | 'rollback' | 'missingInformation' | 'sources'
  >
}

const RULES: Rule[] = [
  {
    id: 'dns',
    test: /dns|resolve|nxdomain|name resolution|srv record|تحليل|استعلام/i,
    build: (_input, lang) => ({
      summary: bi(lang, 'Symptoms indicate a name-resolution problem. The local resolver, the DNS server configuration, or an upstream forwarder may be at fault.', 'تشير الأعراض إلى مشكلة في تحليل الأسماء. قد يكون السبب محلل العميل أو إعداد خادم DNS أو المُحوّل الأعلى.'),
      symptoms: [
        bi(lang, 'Names fail while direct IP connectivity may still work', 'فشل الأسماء مع احتمال بقاء الاتصال المباشر بعناوين IP'),
        bi(lang, 'Intermittent resolution from one subnet or VPN client', 'تحليل متقطع من شبكة فرعية أو عميل VPN'),
      ],
      causes: [
        { cause: bi(lang, 'Client points to the wrong or stale DNS servers', 'العميل يشير إلى خوادم DNS خاطئة أو قديمة'), likelihood: 'high', evidence: [bi(lang, 'DNS failure is a common result of stale DHCP or VPN adapter settings', 'فشل DNS شائع بسبب إعدادات DHCP أو محول VPN قديمة')] },
        { cause: bi(lang, 'Missing or incorrect forward/reverse record', 'سجل أمامي أو عكسي مفقود أو خاطئ'), likelihood: 'medium', evidence: [bi(lang, 'Requires a query against the authoritative server to confirm', 'يتطلب استعلامًا على الخادم المرجعي للتأكيد')] },
        { cause: bi(lang, 'Upstream recursion or conditional forwarder failure', 'فشل التكرار الأعلى أو المُحوّل الشرطي'), likelihood: 'medium', evidence: [bi(lang, 'Only confirmed by testing from the DNS server itself', 'لا يُؤكد إلا بالاختبار من خادم DNS نفسه')] },
      ],
      evidence: [
        { statement: bi(lang, 'Category and description mention DNS/name resolution.', 'الفئة والوصف يذكران DNS أو تحليل الأسماء.'), type: 'inference' },
        { statement: bi(lang, 'No command output was supplied with this offline triage.', 'لم تُرفق مخرجات أوامر مع هذا التحليل المحلي.'), type: 'unverified' },
      ],
      diagnosticSteps: [
        { order: 1, title: bi(lang, 'Capture configured DNS servers', 'سجّل خوادم DNS المُهيّأة'), detail: bi(lang, 'Compare the adapter configuration with the intended DHCP scope or VPN profile.', 'قارن إعداد المحول بنطاق DHCP أو ملف VPN المقصود.'), command: 'Get-DnsClientServerAddress -AddressFamily IPv4', kind: 'diagnostic', risk: 'none' },
        { order: 2, title: bi(lang, 'Query the name against the expected server', 'استعلم عن الاسم من الخادم المتوقع'), detail: bi(lang, 'Bypass the client resolver cache and compare with a known-good server.', 'تجاوز ذاكرة العميل المؤقتة وقارن بخادم سليم.'), command: 'Resolve-DnsName server01.contoso.com -Type A -Server 10.0.0.10', kind: 'diagnostic', risk: 'none' },
        { order: 3, title: bi(lang, 'Test recursion from the DNS server', 'اختبر التكرار من خادم DNS'), detail: bi(lang, 'If the client succeeds against one server and fails against another, the servers disagree.', 'إذا نجح العميل مع خادم وفشل مع آخر فلديك اختلاف بين الخادمين.'), command: 'nslookup contoso.com 10.0.0.10', kind: 'diagnostic', risk: 'none' },
      ],
      solutions: [
        { order: 1, title: bi(lang, 'Correct the client resolver configuration', 'صحّح إعداد محلل العميل'), detail: bi(lang, 'Fix DHCP scope options or the VPN DNS profile. Renew the lease or reconnect the VPN afterwards.', 'أصلح خيارات نطاق DHCP أو ملف DNS للـ VPN ثم جدّد العنوان أو أعد الاتصال.'), kind: 'change', risk: 'low', rollback: bi(lang, 'Restore the previous DNS server list and reconnect.', 'أعد قائمة خوادم DNS السابقة وأعد الاتصال.') },
        { order: 2, title: bi(lang, 'Correct the DNS record', 'صحّح سجل DNS'), detail: bi(lang, 'Update the record on the authoritative server and wait for TTL expiry or clear the cache deliberately.', 'حدّث السجل على الخادم المرجعي وانتظر انتهاء TTL أو امسح الذاكرة المؤقتة عمدًا.'), kind: 'change', risk: 'medium', rollback: bi(lang, 'Restore the previous record value.', 'أعد قيمة السجل السابقة.') },
      ],
      prerequisites: [bi(lang, 'Read access to the client and DNS server', 'وصول قراءة إلى العميل وخادم DNS'), bi(lang, 'Change approval for DNS record edits', 'موافقة تغيير لتعديل سجلات DNS')],
      risks: [bi(lang, 'Clearing caches during an incident hides evidence.', 'مسح الذاكرة المؤقتة أثناء الحادث يخفي الأدلة.'), bi(lang, 'Editing the wrong record can break other services.', 'تعديل سجل خاطئ قد يعطل خدمات أخرى.')],
      rollback: bi(lang, 'Reapply previous resolver settings and record values. Keep a screenshot of the original configuration.', 'أعد إعدادات المحلل وقيم السجلات السابقة، واحتفظ بلقطة للإعداد الأصلي.'),
      missingInformation: [
        bi(lang, 'Exact queried name and record type', 'الاسم ونوع السجل المطلوب بدقة'),
        bi(lang, 'Output of Resolve-DnsName with and without -Server', 'مخرجات Resolve-DnsName مع وبدون -Server'),
        bi(lang, 'Whether the failure affects one client, subnet, or all clients', 'هل يؤثر الفشل على عميل أو شبكة فرعية أو الجميع'),
      ],
      sources: [{ title: 'Microsoft Learn — DNS client troubleshooting', url: 'https://learn.microsoft.com/en-us/windows-server/networking/dns/troubleshoot/troubleshoot-dns-client' }],
    }),
  },
  {
    id: 'bsod',
    test: /bsod|blue screen|stop code|bugcheck|شاشة زرقاء|رمز توقف/i,
    build: (_input, lang) => ({
      summary: bi(lang, 'A bugcheck occurred. The stop code and faulting module are the primary evidence; without a dump analysis, causes remain hypotheses.', 'حدث توقف للنظام. رمز التوقف والوحدة المتسببة هما الدليل الأساسي، وبدون تحليل التفريغ تبقى الأسباب فرضيات.'),
      symptoms: [bi(lang, 'Unexpected restart or blue screen', 'إعادة تشغيل غير متوقعة أو شاشة زرقاء'), bi(lang, 'Event ID 41/1001 around the failure time', 'الحدث 41/1001 قرب وقت العطل')],
      causes: [
        { cause: bi(lang, 'Third-party driver fault', 'عطل تعريف طرف ثالث'), likelihood: 'high', evidence: [bi(lang, 'Common, but must be confirmed in the dump stack', 'شائع لكن يجب تأكيده من مسار التفريغ')] },
        { cause: bi(lang, 'Memory or storage hardware error', 'خطأ في الذاكرة أو التخزين'), likelihood: 'medium', evidence: [bi(lang, 'WHEA or storage-related bugchecks suggest hardware', 'رموز WHEA أو المتعلقة بالتخزين ترجّح العتاد')] },
        { cause: bi(lang, 'System file or firmware issue', 'مشكلة ملفات نظام أو برامج ثابتة'), likelihood: 'low', evidence: [bi(lang, 'Needs SFC/DISM and firmware checks', 'يحتاج فحوص SFC/DISM والبرامج الثابتة')] },
      ],
      evidence: [
        { statement: bi(lang, 'Description mentions a blue screen or stop code.', 'الوصف يذكر شاشة زرقاء أو رمز توقف.'), type: 'inference' },
        { statement: bi(lang, 'No memory dump has been analyzed.', 'لم يُحلل ملف تفريغ الذاكرة بعد.'), type: 'untested' },
      ],
      diagnosticSteps: [
        { order: 1, title: bi(lang, 'Locate dumps and bugcheck events', 'حدّد ملفات التفريغ وأحداث التوقف'), detail: bi(lang, 'Copy dumps to a protected location; they may contain sensitive data.', 'انسخ التفريغ إلى موقع محمي، فقد يحتوي بيانات حساسة.'), command: 'Get-ChildItem C:\\Windows\\Minidump, C:\\Windows\\MEMORY.DMP -ErrorAction SilentlyContinue', kind: 'diagnostic', risk: 'none' },
        { order: 2, title: bi(lang, 'Analyze the dump in WinDbg', 'حلل التفريغ في WinDbg'), detail: bi(lang, 'Run !analyze -v with current symbols and record the faulting module.', 'نفّذ !analyze -v برموز حديثة وسجّل الوحدة المتسببة.'), command: '!analyze -v', kind: 'diagnostic', risk: 'none' },
        { order: 3, title: bi(lang, 'Validate storage and memory', 'تحقق من التخزين والذاكرة'), detail: bi(lang, 'Check disk health and run a multi-pass memory test according to vendor guidance.', 'افحص صحة القرص ونفّذ اختبار ذاكرة متعدد الدورات وفق إرشاد المصنّع.'), command: 'Get-PhysicalDisk | Select-Object FriendlyName, HealthStatus, OperationalStatus', kind: 'diagnostic', risk: 'none' },
      ],
      solutions: [
        { order: 1, title: bi(lang, 'Update or roll back the implicated driver', 'حدّث أو أعد إصدار التعريف المتسبب'), detail: bi(lang, 'Use the hardware vendor package and keep the previous version for rollback.', 'استخدم حزمة مصنّع العتاد واحتفظ بالإصدار السابق للتراجع.'), kind: 'change', risk: 'medium', rollback: bi(lang, 'Reinstall the previous driver package.', 'أعد تثبيت حزمة التعريف السابقة.') },
        { order: 2, title: bi(lang, 'Repair system files if corruption is found', 'أصلح ملفات النظام عند اكتشاف تلف'), detail: bi(lang, 'Run DISM RestoreHealth then SFC, and verify the result.', 'نفّذ DISM RestoreHealth ثم SFC وتحقق من النتيجة.'), kind: 'change', risk: 'low', rollback: bi(lang, 'No per-file rollback; use a restore point or snapshot.', 'لا تراجع لكل ملف؛ استخدم نقطة استعادة أو لقطة.') },
      ],
      prerequisites: [bi(lang, 'Administrator access', 'وصول مسؤول'), bi(lang, 'Debugging Tools for Windows for dump analysis', 'أدوات التصحيح لتحليل التفريغ')],
      risks: [bi(lang, 'Driver Verifier can force a bugcheck; use only where recovery is possible.', 'Driver Verifier قد يفرض توقفًا؛ استخدمه حيث يمكن الاستعادة فقط.'), bi(lang, 'Dumps may contain credentials or personal data.', 'قد تحتوي ملفات التفريغ بيانات اعتماد أو بيانات شخصية.')],
      rollback: bi(lang, 'Keep the previous driver package and a restore point. Hardware changes require vendor service procedures.', 'احتفظ بحزمة التعريف السابقة ونقطة استعادة. وتغييرات العتاد تتطلب إجراءات خدمة المصنّع.'),
      missingInformation: [bi(lang, 'Exact stop code', 'رمز التوقف بدقة'), bi(lang, 'Faulting module from WinDbg', 'الوحدة المتسببة من WinDbg'), bi(lang, 'Recent hardware or driver changes', 'تغييرات العتاد أو التعريفات الحديثة')],
      sources: [{ title: 'Microsoft Learn — Troubleshoot stop errors', url: 'https://learn.microsoft.com/en-us/windows/client-management/troubleshoot-stop-errors' }],
    }),
  },
  {
    id: 'ad-replication',
    test: /repadmin|dcpromo|replication|domain controller|active directory|group policy|\bgpo\b|dfsr|1311|تكرار|وحدة تحكم|المجلد/i,
    build: (_input, lang) => ({
      summary: bi(lang, 'The symptoms involve Active Directory or a dependent service. DNS, time, and network connectivity must be verified before replication is forced.', 'تتعلق الأعراض بـ Active Directory أو خدمة تابعة. يجب التحقق من DNS والوقت والاتصال قبل فرض التكرار.'),
      symptoms: [bi(lang, 'Replication errors or stale directory data', 'أخطاء تكرار أو بيانات دليل قديمة'), bi(lang, 'Authentication or Group Policy failures', 'فشل المصادقة أو Group Policy')],
      causes: [
        { cause: bi(lang, 'DNS registration or forwarder problem', 'مشكلة تسجيل DNS أو المُحوّل'), likelihood: 'high', evidence: [bi(lang, 'AD relies on SRV records and correct name resolution', 'يعتمد AD على سجلات SRV والتحليل الصحيح')] },
        { cause: bi(lang, 'Time skew beyond Kerberos tolerance', 'انحراف وقت يتجاوز حد Kerberos'), likelihood: 'medium', evidence: [bi(lang, 'Kerberos rejects authentication beyond the configured tolerance', 'يرفض Kerberos المصادقة بعد تجاوز الحد')] },
        { cause: bi(lang, 'Blocked RPC ports or site link issue', 'حجب منافذ RPC أو مشكلة ربط مواقع'), likelihood: 'medium', evidence: [bi(lang, 'Requires port and topology verification', 'يتطلب التحقق من المنافذ والطوبولوجيا')] },
        { cause: bi(lang, 'Dirty shutdown / USN journal issue (DFSR)', 'إطفاء غير سليم أو مشكلة USN (DFSR)'), likelihood: 'low', evidence: [bi(lang, 'Specific DFSR event IDs are required to confirm', 'يلزم معرفة أحداث DFSR المحددة للتأكيد')] },
      ],
      evidence: [
        { statement: bi(lang, 'The description mentions AD, replication, DFSR, or Group Policy.', 'الوصف يذكر AD أو التكرار أو DFSR أو Group Policy.'), type: 'inference' },
        { statement: bi(lang, 'No repadmin/dcdiag output was provided.', 'لم تُقدم مخرجات repadmin/dcdiag.'), type: 'unverified' },
      ],
      diagnosticSteps: [
        { order: 1, title: bi(lang, 'Summarize replication health', 'لخّص صحة التكرار'), detail: bi(lang, 'Read-only. Identify the largest delta and the failing naming context.', 'للقراءة فقط. حدّد أكبر فرق وسياق التسمية الفاشل.'), command: 'repadmin /replsummary', kind: 'diagnostic', risk: 'none' },
        { order: 2, title: bi(lang, 'Run dcdiag with DNS tests', 'شغّل dcdiag مع فحوص DNS'), detail: bi(lang, 'Collect the failing test and exact error code.', 'اجمع الاختبار الفاشل ورمز الخطأ الدقيق.'), command: 'dcdiag /v /c /d /e /test:dns', kind: 'diagnostic', risk: 'none' },
        { order: 3, title: bi(lang, 'Check time synchronization', 'تحقق من مزامنة الوقت'), detail: bi(lang, 'Compare domain controllers before changing any source.', 'قارن وحدات التحكم قبل تغيير أي مصدر.'), command: 'w32tm /monitor', kind: 'diagnostic', risk: 'none' },
        { order: 4, title: bi(lang, 'Check directory service events', 'افحص أحداث خدمة الدليل'), detail: bi(lang, 'Look for 1311, 1864, 2042, and 2089 with timestamps.', 'ابحث عن 1311 و1864 و2042 و2089 مع الأوقات.'), command: 'Get-WinEvent -LogName "Directory Service" -MaxEvents 100', kind: 'diagnostic', risk: 'none' },
      ],
      solutions: [
        { order: 1, title: bi(lang, 'Fix DNS registration first', 'أصلح تسجيل DNS أولًا'), detail: bi(lang, 'Correct missing SRV/A records and re-test. Do not force replication until name resolution is stable.', 'صحّح سجلات SRV/A المفقودة وأعد الاختبار. لا تفرض التكرار قبل استقرار تحليل الأسماء.'), kind: 'change', risk: 'medium', rollback: bi(lang, 'Restore previous DNS records and settings.', 'أعد سجلات وإعدادات DNS السابقة.') },
        { order: 2, title: bi(lang, 'Escalate before metadata cleanup', 'صعّد قبل تنظيف البيانات الوصفية'), detail: bi(lang, 'Removing a DC or seizing roles is high impact and requires a backup and approval.', 'إزالة وحدة تحكم أو الاستيلاء على الأدوار عالي التأثير ويتطلب نسخة احتياطية وموافقة.'), kind: 'change', risk: 'high', rollback: bi(lang, 'Authoritative restore or vendor-supported recovery.', 'استعادة مرجعية أو تعافٍ مدعوم من المصنّع.') },
      ],
      prerequisites: [bi(lang, 'Domain credentials with read access', 'بيانات اعتماد نطاق بصلاحية قراءة'), bi(lang, 'RSAT AD tools', 'أدوات RSAT للدليل'), bi(lang, 'Change approval and system-state backup before changes', 'موافقة تغيير ونسخة حالة نظام قبل التغييرات')],
      risks: [bi(lang, 'Forced replication can spread corruption.', 'فرض التكرار قد ينشر التلف.'), bi(lang, 'Metadata cleanup is destructive.', 'تنظيف البيانات الوصفية مدمّر.'), bi(lang, 'Changing time sources can break Kerberos.', 'تغيير مصادر الوقت قد يعطل Kerberos.')],
      rollback: bi(lang, 'DNS and time changes can be reverted. Directory metadata cleanup cannot be undone without an authoritative restore.', 'يمكن التراجع عن تغييرات DNS والوقت. أما تنظيف بيانات الدليل فلا يمكن التراجع عنه دون استعادة مرجعية.'),
      missingInformation: [bi(lang, 'repadmin /replsummary and /showrepl output', 'مخرجات repadmin /replsummary و/showrepl'), bi(lang, 'Exact event IDs and error codes', 'معرفات الأحداث ورموز الأخطاء الدقيقة'), bi(lang, 'Whether DNS tests pass from every DC', 'هل تنجح فحوص DNS من كل وحدة تحكم')],
      sources: [{ title: 'Microsoft Learn — AD replication troubleshooting', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/active-directory/troubleshoot-ad-replication' }],
    }),
  },
  {
    id: 'spooler',
    test: /print|spooler|printer|طابعة|طباعة/i,
    build: (_input, lang) => ({
      summary: bi(lang, 'The failure is in the printing path. Separate a single queue problem from a spooler-wide failure before deleting jobs.', 'العطل في مسار الطباعة. افصل مشكلة طابور واحد عن عطل Spooler الكامل قبل حذف المهام.'),
      symptoms: [bi(lang, 'Jobs stuck in the queue', 'مهام عالقة في الطابور'), bi(lang, 'Print spooler service stopped or restarting', 'توقف خدمة Print Spooler أو إعادة تشغيلها')],
      causes: [
        { cause: bi(lang, 'Corrupt spool file or incompatible driver', 'ملف spool تالف أو تعريف غير متوافق'), likelihood: 'high', evidence: [bi(lang, 'Common with vendor-specific drivers', 'شائع مع تعريفات المصنّع')] },
        { cause: bi(lang, 'Network printer unreachable', 'تعذر الوصول إلى الطابعة الشبكية'), likelihood: 'medium', evidence: [bi(lang, 'Requires port and device reachability test', 'يتطلب فحص المنفذ والجهاز')] },
        { cause: bi(lang, 'Print server resource pressure', 'ضغط موارد على خادم الطباعة'), likelihood: 'low', evidence: [bi(lang, 'Check disk space and service crash events', 'افحص مساحة القرص وأحداث تعطل الخدمة')] },
      ],
      evidence: [{ statement: bi(lang, 'Printing is the stated domain.', 'الطباعة هي المجال المذكور.'), type: 'inference' }, { statement: bi(lang, 'Queue contents were not provided.', 'لم تُقدم محتويات الطابور.'), type: 'unverified' }],
      diagnosticSteps: [
        { order: 1, title: bi(lang, 'Inspect service and queue state', 'افحص حالة الخدمة والطابور'), detail: bi(lang, 'Read-only. Record the document names before clearing anything.', 'للقراءة فقط. سجّل أسماء المستندات قبل أي تفريغ.'), command: 'Get-Service Spooler; Get-PrintJob -PrinterName "PRINTER"', kind: 'diagnostic', risk: 'none' },
        { order: 2, title: bi(lang, 'Review print service events', 'راجع أحداث خدمة الطباعة'), detail: bi(lang, 'Look for driver faults and service crashes.', 'ابحث عن أعطال التعريفات وتعطل الخدمة.'), command: 'Get-WinEvent -LogName "Microsoft-Windows-PrintService/Admin" -MaxEvents 30', kind: 'diagnostic', risk: 'none' },
      ],
      solutions: [
        { order: 1, title: bi(lang, 'Remove a single stuck job', 'أزل مهمة عالقة واحدة'), detail: bi(lang, 'Confirm with the user first; job contents may be business records.', 'تأكد من المستخدم أولًا، فقد تكون المهمة سجلًا مهمًا.'), command: 'Remove-PrintJob -PrinterName "PRINTER" -ID <id>', kind: 'change', risk: 'low', rollback: bi(lang, 'Resubmit the document from the source application.', 'أعد إرسال المستند من التطبيق الأصلي.') },
        { order: 2, title: bi(lang, 'Restart the spooler and isolate the driver', 'أعد تشغيل Spooler واعزل التعريف'), detail: bi(lang, 'Archive spool files before clearing. Roll back a recently updated driver.', 'أرشف ملفات spool قبل التفريغ، وأعد إصدار تعريف محدث مؤخرًا.'), kind: 'change', risk: 'medium', rollback: bi(lang, 'Restore archived spool files and the previous driver.', 'أعد ملفات spool المؤرشفة والتعريف السابق.') },
      ],
      prerequisites: [bi(lang, 'Print server administrator access', 'وصول مسؤول خادم الطباعة')],
      risks: [bi(lang, 'Clearing the queue deletes pending jobs.', 'تفريغ الطابور يحذف المهام المعلقة.'), bi(lang, 'Deleting spool files destroys evidence.', 'حذف ملفات spool يتلف الأدلة.')],
      rollback: bi(lang, 'Restore archived spool files while the service is stopped; reinstall the previous driver.', 'أعد ملفات spool المؤرشفة والخدمة متوقفة، وأعد تثبيت التعريف السابق.'),
      missingInformation: [bi(lang, 'Printer name and connection type (local/TCP/IP/shared)', 'اسم الطابعة ونوع الاتصال (محلي/TCP/IP/مشترك)'), bi(lang, 'Whether one printer or all printers are affected', 'هل تتأثر طابعة واحدة أم كل الطابعات'), bi(lang, 'Recent driver or Windows updates', 'تحديثات التعريف أو Windows الحديثة')],
      sources: [{ title: 'Microsoft Learn — Print services', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/printing/printing-overview' }],
    }),
  },
  {
    id: 'disk',
    test: /disk full|no space|space exhausted|inode|امتلاء|مساحة|قرص ممتلئ/i,
    build: (_input, lang) => ({
      summary: bi(lang, 'Storage exhaustion is likely. Determine whether the cause is visible files, deleted-but-open files, inodes, or snapshots before deleting anything.', 'يُرجّح نفاد التخزين. حدّد إن كان السبب ملفات ظاهرة أو محذوفة مفتوحة أو inode أو لقطات قبل حذف أي شيء.'),
      symptoms: [bi(lang, 'Writes failing or services unable to start', 'فشل الكتابة أو تعذر بدء الخدمات'), bi(lang, 'Low free space or high inode usage', 'مساحة حرة منخفضة أو استخدام inode مرتفع')],
      causes: [
        { cause: bi(lang, 'Log or data growth beyond retention', 'نمو السجلات أو البيانات بما يتجاوز الاحتفاظ'), likelihood: 'high', evidence: [bi(lang, 'Most common cause on long-running servers', 'السبب الأكثر شيوعًا في السيرفرات طويلة التشغيل')] },
        { cause: bi(lang, 'Deleted files still held open', 'ملفات محذوفة ما زالت مفتوحة'), likelihood: 'medium', evidence: [bi(lang, 'Confirmed when df and du disagree', 'يُؤكد عند اختلاف df وdu')] },
        { cause: bi(lang, 'Inode exhaustion from many small files', 'نفاد inode بسبب ملفات صغيرة كثيرة'), likelihood: 'medium', evidence: [bi(lang, 'Confirmed with df -i', 'يُؤكد بـ df -i')] },
      ],
      evidence: [{ statement: bi(lang, 'The problem mentions disk space or storage.', 'المشكلة تذكر مساحة القرص أو التخزين.'), type: 'inference' }, { statement: bi(lang, 'No filesystem output was supplied.', 'لم تُقدم مخرجات نظام الملفات.'), type: 'unverified' }],
      diagnosticSteps: [
        { order: 1, title: bi(lang, 'Measure usage and inodes', 'قِس الاستخدام وinode'), detail: bi(lang, 'Compare df with du and check inode usage.', 'قارن df بـ du وافحص استخدام inode.'), command: 'df -hT; df -i; du -xhd1 / | sort -h', kind: 'diagnostic', risk: 'none' },
        { order: 2, title: bi(lang, 'Find deleted-but-open files', 'ابحث عن ملفات محذوفة مفتوحة'), detail: bi(lang, 'Space returns only when the last process closes the file.', 'لا تعود المساحة إلا عند إغلاق آخر عملية للملف.'), command: 'lsof +L1', kind: 'diagnostic', risk: 'none' },
        { order: 3, title: bi(lang, 'Identify the largest consumers', 'حدّد أكبر المستهلكين'), detail: bi(lang, 'Scope to the affected filesystem, not the whole host.', 'اقصر البحث على نظام الملفات المتأثر لا كل المضيف.'), command: 'du -xhd1 /var | sort -h', kind: 'diagnostic', risk: 'none' },
      ],
      solutions: [
        { order: 1, title: bi(lang, 'Apply the existing retention policy', 'طبّق سياسة الاحتفاظ القائمة'), detail: bi(lang, 'Use logrotate or the application’s supported cleanup. Do not rm -rf system directories.', 'استخدم logrotate أو تنظيف التطبيق المدعوم، ولا تنفّذ rm -rf على مجلدات النظام.'), kind: 'change', risk: 'medium', rollback: bi(lang, 'Restore from backup if data was removed incorrectly.', 'استعد من النسخة الاحتياطية إذا حُذفت بيانات بالخطأ.') },
        { order: 2, title: bi(lang, 'Restart the process holding deleted files', 'أعد تشغيل العملية التي تحتفظ بملفات محذوفة'), detail: bi(lang, 'Follow the service runbook; never kill a database process arbitrarily.', 'اتبع دليل الخدمة، ولا تقتل عملية قاعدة بيانات عشوائيًا.'), kind: 'change', risk: 'high', rollback: bi(lang, 'Use the service’s documented restart/rollback procedure.', 'استخدم إجراء إعادة التشغيل أو التراجع الموثق للخدمة.') },
      ],
      prerequisites: [bi(lang, 'Read access to filesystem metadata', 'وصول قراءة لبيانات نظام الملفات'), bi(lang, 'Approval before deleting any data', 'موافقة قبل حذف أي بيانات')],
      risks: [bi(lang, 'Deletion is irreversible.', 'الحذف غير قابل للتراجع.'), bi(lang, 'Aggressive cleanup can break running services.', 'التنظيف المتهور قد يعطل خدمات قائمة.')],
      rollback: bi(lang, 'There is no rollback for deletion. Prefer quarantine moves or volume expansion and verify backups first.', 'لا تراجع عن الحذف. فضّل النقل إلى حجر أو توسيع الحجم وتحقق من النسخ أولًا.'),
      missingInformation: [bi(lang, 'Most constrained mount point', 'نقطة التحميل الأكثر امتلاءً'), bi(lang, 'Output of df -h and df -i', 'مخرجات df -h وdf -i'), bi(lang, 'Whether snapshots or container layers consume space', 'هل تستهلك اللقطات أو طبقات الحاويات مساحة')],
      sources: [{ title: 'Red Hat — Managing storage', url: 'https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_storage_devices/index' }],
    }),
  },
  {
    id: 'update',
    test: /update|patch|kb\d|0x800f|windows update|تحديث|ترقيع/i,
    build: (_input, lang) => ({
      summary: bi(lang, 'The failure involves update installation. The exact error code and the last successful patch level determine the repair path.', 'يتعلق العطل بتثبيت التحديث. رمز الخطأ الدقيق وآخر مستوى تصحيح ناجح يحددان مسار الإصلاح.'),
      symptoms: [bi(lang, 'Update fails repeatedly or rolls back', 'فشل التحديث المتكرر أو التراجع عنه'), bi(lang, 'Servicing or component store errors', 'أخطاء الصيانة أو مخزن المكونات')],
      causes: [
        { cause: bi(lang, 'Component store corruption', 'تلف مخزن المكونات'), likelihood: 'high', evidence: [bi(lang, 'CheckHealth/ScanHealth output is required', 'يلزم مخرجات CheckHealth/ScanHealth')] },
        { cause: bi(lang, 'Insufficient disk space', 'مساحة قرص غير كافية'), likelihood: 'high', evidence: [bi(lang, 'Easy to verify and often overlooked', 'سهل التحقق وغالبًا يُغفل')] },
        { cause: bi(lang, 'Proxy, WSUS, or network blocking', 'حجب وكيل أو WSUS أو شبكة'), likelihood: 'medium', evidence: [bi(lang, 'Check policy and connectivity to the update source', 'افحص السياسة والاتصال بمصدر التحديث')] },
        { cause: bi(lang, 'Incompatible driver or blocking policy', 'تعريف غير متوافق أو سياسة حجب'), likelihood: 'low', evidence: [bi(lang, 'Vendor and policy review needed', 'يلزم مراجعة المصنّع والسياسات')] },
      ],
      evidence: [{ statement: bi(lang, 'The problem mentions updates or KBs.', 'المشكلة تذكر التحديثات أو KBs.'), type: 'inference' }, { statement: bi(lang, 'No CBS or WindowsUpdate log excerpt was provided.', 'لم يُقدم مقتطف من سجل CBS أو WindowsUpdate.'), type: 'unverified' }],
      diagnosticSteps: [
        { order: 1, title: bi(lang, 'Record build, free space, and services', 'سجّل البنية والمساحة والخدمات'), detail: bi(lang, 'Baseline before any repair action.', 'خط أساس قبل أي إصلاح.'), command: 'Get-ComputerInfo | Select-Object OsBuildNumber; Get-PSDrive C; Get-Service wuauserv,bits,cryptsvc', kind: 'diagnostic', risk: 'none' },
        { order: 2, title: bi(lang, 'Scan component store health', 'افحص صحة مخزن المكونات'), detail: bi(lang, 'Read-only scan; may take 10-30 minutes.', 'فحص للقراءة فقط قد يستغرق 10-30 دقيقة.'), command: 'DISM /Online /Cleanup-Image /ScanHealth', kind: 'diagnostic', risk: 'none' },
        { order: 3, title: bi(lang, 'Review update errors', 'راجع أخطاء التحديث'), detail: bi(lang, 'Capture the exact HRESULT and failing phase.', 'سجّل HRESULT الدقيق والمرحلة الفاشلة.'), command: 'Get-WinEvent -LogName System -MaxEvents 300 | Where-Object { $_.ProviderName -match "WindowsUpdate|Servicing" }', kind: 'diagnostic', risk: 'none' },
      ],
      solutions: [
        { order: 1, title: bi(lang, 'Repair the component store', 'أصلح مخزن المكونات'), detail: bi(lang, 'RestoreHealth then SFC. Use matching media if Windows Update is restricted.', 'RestoreHealth ثم SFC، واستخدم وسائط مطابقة إذا كان Windows Update مقيّدًا.'), command: 'DISM /Online /Cleanup-Image /RestoreHealth', kind: 'change', risk: 'medium', rollback: bi(lang, 'Use a restore point or snapshot; there is no per-file rollback.', 'استخدم نقطة استعادة أو لقطة؛ لا يوجد تراجع لكل ملف.') },
        { order: 2, title: bi(lang, 'Reinstall the specific KB', 'أعد تثبيت تحديث KB المحدد'), detail: bi(lang, 'Download from the Microsoft Update Catalog and verify the hash/signature.', 'نزّل من Microsoft Update Catalog وتحقق من البصمة والتوقيع.'), kind: 'change', risk: 'medium', rollback: bi(lang, 'Uninstall the KB or restore a snapshot.', 'أزل تحديث KB أو استعد لقطة.') },
      ],
      prerequisites: [bi(lang, 'Administrator access', 'وصول مسؤول'), bi(lang, 'Several GB free space', 'عدة جيجابايت مساحة حرة'), bi(lang, 'Matching installation media for offline repair', 'وسائط تثبيت مطابقة للإصلاح دون اتصال')],
      risks: [bi(lang, 'Resetting update components removes history; document the error first.', 'إعادة ضبط مكونات التحديث تمحو السجل؛ وثّق الخطأ أولًا.'), bi(lang, 'Mismatched repair media can worsen corruption.', 'وسائط إصلاح غير مطابقة قد تفاقم التلف.')],
      rollback: bi(lang, 'Renamed update folders can be restored. Uninstall the specific KB if the system boots. Keep snapshots for server changes.', 'يمكن استعادة مجلدات التحديث المعاد تسميتها، وأزل تحديث KB المحدد إذا أقلع النظام، واحتفظ بلقطات لتغييرات السيرفر.'),
      missingInformation: [bi(lang, 'Exact KB and error code', 'تحديث KB ورمز الخطأ بدقة'), 'CBS.log / WindowsUpdate.log excerpt', bi(lang, 'Whether the device is WSUS-managed', 'هل الجهاز مُدار بـ WSUS')],
      sources: [{ title: 'Microsoft Learn — Windows Update troubleshooting', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-client/installing-updates-features-roles/windows-update-troubleshooting' }],
    }),
  },
]

function generic(input: ProblemInput, lang: Language): AnalysisResult {
  return {
    summary: bi(
      lang,
      `Offline triage for "${input.title || input.category}". The description was matched to the ${input.category} domain, but no specific rule had enough evidence.`,
      `تحليل محلي لـ «${input.title || input.category}». صُنّف الوصف ضمن مجال ${input.category}، لكن لم توجد قاعدة محددة بأدلة كافية.`,
    ),
    category: input.category,
    symptoms: input.description
      ? [input.description.slice(0, 400)]
      : [bi(lang, 'No description supplied.', 'لم يُقدّم وصف.')],
    causes: [
      {
        cause: bi(lang, 'Insufficient evidence for a specific hypothesis', 'الأدلة غير كافية لفرضية محددة'),
        likelihood: 'low',
        evidence: [bi(lang, 'This is an offline rule-based result, not an AI diagnosis.', 'هذه نتيجة محلية بالقواعد وليست تشخيصًا بالذكاء الاصطناعي.')],
      },
    ],
    evidence: [
      { statement: bi(lang, 'Category was selected or inferred from the form.', 'تم اختيار الفئة أو استنتاجها من النموذج.'), type: 'fact' },
      { statement: bi(lang, 'No logs, error codes, or command output were analyzed.', 'لم تُحلّل سجلات أو رموز أخطاء أو مخرجات أوامر.'), type: 'unverified' },
    ],
    diagnosticSteps: [
      {
        order: 1,
        title: bi(lang, 'Capture the exact symptom and timeline', 'سجّل العَرَض والجدول الزمني بدقة'),
        detail: bi(lang, 'Record start time, scope, recent changes, and the exact error text.', 'سجّل وقت البدء والنطاق والتغييرات الحديثة ونص الخطأ الدقيق.'),
        kind: 'diagnostic',
        risk: 'none',
      },
      {
        order: 2,
        title: bi(lang, 'Collect logs before restarting services', 'اجمع السجلات قبل إعادة تشغيل الخدمات'),
        detail: bi(lang, 'Use the platform’s Script Lab templates for a read-only collector.', 'استخدم قوالب مختبر السكربتات لجمع للقراءة فقط.'),
        kind: 'diagnostic',
        risk: 'none',
      },
      {
        order: 3,
        title: bi(lang, 'Add the error text or log excerpt', 'أضف نص الخطأ أو مقتطف السجل'),
        detail: bi(lang, 'A specific error code is required for a meaningful analysis.', 'يلزم رمز خطأ محدد لتحليل ذي معنى.'),
        kind: 'diagnostic',
        risk: 'none',
      },
    ],
    solutions: [],
    prerequisites: [bi(lang, 'Read access to the affected system', 'وصول قراءة إلى النظام المتأثر')],
    risks: [bi(lang, 'Do not change production settings without evidence and a rollback plan.', 'لا تغيّر إعدادات الإنتاج دون دليل وخطة تراجع.')],
    rollback: bi(lang, 'No change was proposed by this offline result.', 'لم يقترح هذا التحليل المحلي أي تغيير.'),
    missingInformation: [
      bi(lang, 'Exact error message or event ID', 'رسالة الخطأ أو معرف الحدث بدقة'),
      bi(lang, 'When the problem started and what changed', 'متى بدأت المشكلة وما الذي تغيّر'),
      bi(lang, 'Scope: one user, one host, or many', 'النطاق: مستخدم واحد أو جهاز واحد أو عدة'),
    ],
    sources: [],
    confidence: { level: 'low', reason: bi(lang, 'No specific rule or source evidence matched.', 'لم تتطابق قاعدة محددة أو دليل من مصدر.') },
    generatedAt: new Date().toISOString(),
    provider: 'Local rules',
    model: 'deterministic-triage-v1',
    offline: true,
    limitations: bi(lang, 'Rule-based triage only. It cannot read images, verify commands, or replace a professional investigation.', 'تحليل بالقواعد فقط. لا يقرأ الصور ولا يتحقق من الأوامر ولا يغني عن التحقيق المهني.'),
  }
}

export function runLocalTriage(input: ProblemInput, lang: Language): AnalysisResult {
  const haystack = `${input.title} ${input.description} ${input.errorText} ${input.logs} ${input.os} ${input.recentChange}`.toLowerCase()
  const rule = RULES.find((candidate) => candidate.test.test(haystack))
  if (!rule) return generic(input, lang)
  const partial = rule.build(input, lang)
  return {
    ...partial,
    category: input.category,
    confidence: {
      level: 'low',
      reason: bi(
        lang,
        'Matched a known symptom pattern, but no logs were parsed and no AI model reasoned over the evidence. Verify every step.',
        'تطابق نمط عَرَض معروف، لكن لم تُحلّل سجلات ولم يستنتج نموذج ذكاء اصطناعي من الأدلة. تحقق من كل خطوة.',
      ),
    },
    generatedAt: new Date().toISOString(),
    provider: 'Local rules',
    model: `deterministic-triage-v1:${rule.id}`,
    offline: true,
    limitations: bi(
      lang,
      'Offline triage is deterministic and narrow. It does not inspect your environment, read images, or confirm that a fix works.',
      'التحليل المحلي حتمي ومحدود. لا يفحص بيئتك ولا يقرأ الصور ولا يؤكد نجاح أي إصلاح.',
    ),
  }
}
