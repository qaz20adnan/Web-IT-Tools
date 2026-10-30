import type { ScriptTemplate } from '@/types'

const CREATED = '2026-10-26'

/**
 * Read-only diagnostic templates. `testStatus` is deliberately honest: these
 * templates have not been executed against a live system in this repository.
 * They are marked `not-executed` until a maintainer records a lab run.
 * High-risk actions are intentionally excluded; use the recovery templates in
 * scripts.ts when an approved change is required.
 */
export const EXPANSION_SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'script-dns-diagnostics',
    title: { en: 'DNS resolution diagnostics', ar: 'تشخيص حل أسماء DNS' },
    description: {
      en: 'Read-only collector for client DNS servers, resolver cache, SRV records, port 53 reachability and DNS client events.',
      ar: 'جامع للقراءة فقط لخوادم DNS للعميل وذاكرة المُحلّل وسجلات SRV وإمكانية الوصول للمنفذ 53 وأحداث عميل DNS.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'networking',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only DNS diagnostics collector.
.DESCRIPTION
  Writes text reports to a timestamped folder. It does not change DNS settings.
  Review the output before sharing: it can contain internal hostnames and addresses.
#>
[CmdletBinding()]
param(
  [string]$Domain = $env:USERDNSDOMAIN,
  [string]$DnsServer,
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-DNS-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Get-DnsClientServerAddress -AddressFamily IPv4,IPv6 |
  Select-Object InterfaceAlias, InterfaceIndex, AddressFamily, ServerAddresses |
  Format-Table -AutoSize | Out-File (Join-Path $out 'dns-servers.txt') -Encoding utf8

Get-DnsClientCache |
  Select-Object Entry, Name, Type, Status, Section, TimeToLive |
  Format-Table -AutoSize | Out-File (Join-Path $out 'resolver-cache.txt') -Encoding utf8

if ($Domain) {
  Resolve-DnsName "_ldap._tcp.dc._msdcs.$Domain" -Type SRV -ErrorAction SilentlyContinue |
    Format-List | Out-File (Join-Path $out 'dc-srv-records.txt') -Encoding utf8
  Resolve-DnsName $Domain -Type A,AAAA -ErrorAction SilentlyContinue |
    Format-List | Out-File (Join-Path $out 'domain-a-aaaa.txt') -Encoding utf8
}

if ($DnsServer) {
  Test-NetConnection -ComputerName $DnsServer -Port 53 -WarningAction SilentlyContinue |
    Format-List | Out-File (Join-Path $out 'dns-port-53.txt') -Encoding utf8
  Resolve-DnsName 'www.microsoft.com' -Server $DnsServer -ErrorAction SilentlyContinue |
    Format-List | Out-File (Join-Path $out 'external-resolution.txt') -Encoding utf8
}

Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-DNS-Client'; StartTime = (Get-Date).AddDays(-2) } -MaxEvents 200 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated, Id, LevelDisplayName, Message |
  Format-List | Out-File (Join-Path $out 'dns-client-events.txt') -Encoding utf8

Write-Host "DNS evidence written to: $out" -ForegroundColor Green
Write-Warning 'The reports may contain internal names and addresses. Review before sharing.'`,
    requires: ['PowerShell 5.1+', 'DNS Client service running', 'Read access to System event log'],
    rollback: 'No system changes are made. Delete the generated report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10', 'Windows 11', 'Windows Server 2016+'],
    permissions: ['Standard user for client data', 'Event Log Readers for complete System log access'],
    dependencies: ['DnsClient PowerShell module (included in Windows)'],
    expectedOutput: {
      en: 'A timestamped folder with DNS server configuration, resolver cache, SRV records, port 53 test and recent DNS client events.',
      ar: 'مجلد بطابع زمني يحتوي إعداد خوادم DNS وذاكرة المُحلّل وسجلات SRV واختبار المنفذ 53 وأحداث عميل DNS الأخيرة.',
    },
    usage: {
      en: 'Run in a normal PowerShell window on the affected client. Optionally pass -DnsServer to test a specific server.',
      ar: 'شغّله في نافذة PowerShell عادية على العميل المتأثر. مرّر -DnsServer اختيارياً لاختبار خادم محدد.',
    },
    validation: {
      en: 'Confirm the folder contains all expected files and that the port test reaches the intended resolver. Compare internal and external resolution results.',
      ar: 'تأكد من وجود كل الملفات المتوقعة ومن وصول اختبار المنفذ إلى المُحلّل المقصود. قارن نتائج الحل الداخلي والخارجي.',
    },
    sources: [
      { title: 'Microsoft Learn - Resolve-DnsName', url: 'https://learn.microsoft.com/en-us/powershell/module/dnsclient/resolve-dnsname' },
      { title: 'Microsoft Learn - DNS troubleshooting', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/dns-client-resolution-troubleshooting' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. No lab execution has been recorded for this template.',
      ar: 'مراجعة ثابتة فقط. لم يُسجّل تنفيذ مختبري لهذا القالب.',
    },
  },
  {
    id: 'script-dhcp-scope-report',
    title: { en: 'DHCP scope utilisation report', ar: 'تقرير استخدام نطاقات DHCP' },
    description: {
      en: 'Read-only report of scopes, address usage, reservations, leases and failover state from a Windows DHCP server.',
      ar: 'تقرير للقراءة فقط عن النطاقات واستخدام العناوين والحجوزات والإيجارات وحالة تجاوز الفشل من خادم DHCP في Windows.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'networking',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only Windows DHCP server utilisation report.
.NOTES
  Requires the DHCP Server RSAT module and DHCP read permissions.
  No scope, lease or failover configuration is modified.
#>
[CmdletBinding()]
param(
  [string]$ComputerName = $env:COMPUTERNAME,
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

Import-Module DhcpServer -ErrorAction Stop

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-DHCP-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

$scopes = Get-DhcpServerv4Scope -ComputerName $ComputerName

foreach ($scope in $scopes) {
  Get-DhcpServerv4ScopeStatistics -ComputerName $ComputerName -ScopeId $scope.ScopeId |
    Select-Object ScopeId, SubnetMask, StartRange, EndRange, Free, InUse, PendingOffer, PercentageInUse |
    Export-Csv -Path (Join-Path $out ("scope-{0}.csv" -f $scope.ScopeId)) -NoTypeInformation -Encoding UTF8
}

Get-DhcpServerv4Scope -ComputerName $ComputerName |
  Select-Object ScopeId, Name, SubnetMask, StartRange, EndRange, State, LeaseDuration |
  Export-Csv -Path (Join-Path $out 'scopes.csv') -NoTypeInformation -Encoding UTF8

Get-DhcpServerv4Scope -ComputerName $ComputerName |
  ForEach-Object { Get-DhcpServerv4Lease -ComputerName $ComputerName -ScopeId $_.ScopeId } |
  Select-Object IPAddress, ClientId, HostName, AddressState, LeaseExpiryTime |
  Export-Csv -Path (Join-Path $out 'leases.csv') -NoTypeInformation -Encoding UTF8

Get-DhcpServerv4Reservation -ComputerName $ComputerName -ErrorAction SilentlyContinue |
  Select-Object IPAddress, ClientId, Name, Description |
  Export-Csv -Path (Join-Path $out 'reservations.csv') -NoTypeInformation -Encoding UTF8

Get-DhcpServerv4Failover -ComputerName $ComputerName -ErrorAction SilentlyContinue |
  Format-List | Out-File (Join-Path $out 'failover.txt') -Encoding utf8

Get-DhcpServerv4Scope -ComputerName $ComputerName |
  Where-Object State -ne 'Active' |
  Select-Object ScopeId, Name, State |
  Out-File (Join-Path $out 'inactive-scopes.txt') -Encoding utf8

Write-Host "DHCP report written to: $out" -ForegroundColor Green
Write-Warning 'Lease data can contain device names and MAC addresses. Handle it as internal inventory data.'`,
    requires: ['DHCP Server RSAT PowerShell module', 'DHCP read permissions', 'Network access to the DHCP server'],
    rollback: 'No changes are made. Delete the generated CSV/txt folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows Server 2016+', 'Windows 10/11 with RSAT (remote management)'],
    permissions: ['DHCP Users or DHCP Administrators (read)', 'Local administrator on the DHCP server for complete data'],
    dependencies: ['DhcpServer PowerShell module'],
    expectedOutput: {
      en: 'CSV files for scopes, per-scope usage, leases and reservations, plus failover and inactive-scope text reports.',
      ar: 'ملفات CSV للنطاقات والاستخدام لكل نطاق والإيجارات والحجوزات، إضافة إلى تقارير نصية لتجاوز الفشل والنطاقات غير النشطة.',
    },
    usage: {
      en: 'Run on the DHCP server or a management host with RSAT. Use -ComputerName to target a remote server.',
      ar: 'شغّله على خادم DHCP أو مضيف إدارة مع RSAT. استخدم -ComputerName لاستهداف خادم بعيد.',
    },
    validation: {
      en: 'Confirm each scope has a statistics file, that free/in-use counts add up plausibly, and that failover state is expected.',
      ar: 'تأكد من وجود ملف إحصاءات لكل نطاق، ومن منطقية مجموع المتاح/المستخدم، ومن تطابق حالة تجاوز الفشل مع المتوقع.',
    },
    sources: [
      { title: 'Microsoft Learn - Get-DhcpServerv4ScopeStatistics', url: 'https://learn.microsoft.com/en-us/powershell/module/dhcpserver/get-dhcpserverv4scopestatistics' },
      { title: 'Microsoft Learn - DHCP failover', url: 'https://learn.microsoft.com/en-us/windows-server/networking/technologies/dhcp/dhcp-failover' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Verify cmdlet availability in your installed RSAT version before relying on the output.',
      ar: 'مراجعة ثابتة فقط. تحقق من توفر الأوامر في إصدار RSAT المثبت قبل الاعتماد على المخرجات.',
    },
  },
  {
    id: 'script-rdp-diagnostics',
    title: { en: 'RDP and RDS session diagnostics', ar: 'تشخيص جلسات RDP وRDS' },
    description: {
      en: 'Read-only collector for RDP listener, services, certificate, firewall, sessions and Terminal Services event logs.',
      ar: 'جامع للقراءة فقط لمستمع RDP والخدمات والشهادة والجدار والجلسات وسجلات خدمات الطرفية.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'windows-server',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only RDP/RDS session diagnostics.
.DESCRIPTION
  Does not reset sessions or restart services. It records the current listener,
  service, certificate, firewall and session state for review.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-RDP-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Get-Service TermService, UmRdpService, SessionHost, RDMS, RDPRDPSink -ErrorAction SilentlyContinue |
  Select-Object Name, DisplayName, Status, StartType |
  Format-Table -AutoSize | Out-File (Join-Path $out 'services.txt') -Encoding utf8

Get-NetTCPConnection -LocalPort 3389 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, State, OwningProcess |
  Format-Table -AutoSize | Out-File (Join-Path $out 'listener-3389.txt') -Encoding utf8

Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections -ErrorAction SilentlyContinue |
  Format-List | Out-File (Join-Path $out 'rdp-enabled.txt') -Encoding utf8

Get-ChildItem Cert:\\LocalMachine\\RemoteDesktop\\My -ErrorAction SilentlyContinue |
  Select-Object Subject, Issuer, NotBefore, NotAfter, Thumbprint, HasPrivateKey |
  Format-List | Out-File (Join-Path $out 'rdp-certificates.txt') -Encoding utf8

Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue |
  Select-Object DisplayName, Enabled, Direction, Action, Profile |
  Format-Table -AutoSize | Out-File (Join-Path $out 'firewall-rules.txt') -Encoding utf8

qwinsta 2>&1 | Out-File (Join-Path $out 'sessions.txt') -Encoding utf8

foreach ($log in @(
  'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational',
  'Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational',
  'Microsoft-Windows-TerminalServices-RDPClient/Operational'
)) {
  $name = ($log -replace '[\\\\/]', '-')
  Get-WinEvent -LogName $log -MaxEvents 100 -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, LevelDisplayName, Message |
    Format-List | Out-File (Join-Path $out ("$name.txt")) -Encoding utf8
}

Write-Host "RDP evidence written to: $out" -ForegroundColor Green
Write-Warning 'Session data can contain usernames and client addresses. Review before sharing.'`,
    requires: ['PowerShell 5.1+', 'Local administrator for complete certificate and event data'],
    rollback: 'No changes are made. Delete the generated report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10/11', 'Windows Server 2016+'],
    permissions: ['Local administrator for certificate and full event access'],
    dependencies: ['Windows built-in cmdlets', 'qwinsta'],
    expectedOutput: {
      en: 'Reports for services, listener, RDP enablement, certificates, firewall, sessions and three Terminal Services logs.',
      ar: 'تقارير للخدمات والمستمع وتمكين RDP والشهادات والجدار والجلسات وثلاثة سجلات لخدمات الطرفية.',
    },
    usage: {
      en: 'Run on the session host while the failure is present. Do not log off sessions based on this output alone.',
      ar: 'شغّله على مضيف الجلسة أثناء وجود الفشل. لا تسجّل خروج الجلسات بناءً على هذه المخرجات وحدها.',
    },
    validation: {
      en: 'Confirm the listener is present, the certificate dates are valid, and the failure timestamp appears in the Terminal Services logs.',
      ar: 'تأكد من وجود المستمع وصلاحية تواريخ الشهادة وظهور وقت الفشل في سجلات خدمات الطرفية.',
    },
    sources: [
      { title: 'Microsoft Learn - RDS troubleshooting', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/remote/remote-desktop-services-troubleshooting' },
      { title: 'Microsoft Learn - Enable Remote Desktop', url: 'https://learn.microsoft.com/en-us/windows-server/remote/remote-desktop-services/clients/remote-desktop-allow-access' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Verify the RDP certificate store name on your Windows version.',
      ar: 'مراجعة ثابتة فقط. تحقق من اسم مخزن شهادة RDP في إصدار Windows لديك.',
    },
  },
  {
    id: 'script-windows-update-diagnostics',
    title: { en: 'Windows Update diagnostics', ar: 'تشخيص Windows Update' },
    description: {
      en: 'Read-only collector for update services, recent hotfixes, pending reboot state, component health and update client events.',
      ar: 'جامع للقراءة فقط لخدمات التحديث وآخر التحديثات وحالة إعادة التشغيل المعلقة وصحة المكونات وأحداث عميل التحديث.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'windows-client',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only Windows Update diagnostics.
.NOTES
  The script does not reset the update cache or stop services. Use the recovery
  template only after reviewing the evidence and obtaining approval.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-WU-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Get-Service wuauserv, bits, cryptsvc, msiserver, TrustedInstaller, UsoSvc -ErrorAction SilentlyContinue |
  Select-Object Name, DisplayName, Status, StartType |
  Format-Table -AutoSize | Out-File (Join-Path $out 'services.txt') -Encoding utf8

Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 30 |
  Format-Table -AutoSize | Out-File (Join-Path $out 'hotfixes.txt') -Encoding utf8

$pending = [ordered]@{
  CBS_RebootPending = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending'
  WU_RebootRequired = Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired'
  PendingFileRename = Test-Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\PendingFileRenameOperations'
}
$pending.GetEnumerator() | Format-Table -AutoSize | Out-File (Join-Path $out 'pending-reboot.txt') -Encoding utf8

DISM /Online /Cleanup-Image /CheckHealth 2>&1 |
  Out-File (Join-Path $out 'component-store.txt') -Encoding utf8

Get-WinEvent -FilterHashtable @{
  LogName = 'System'
  ProviderName = 'Microsoft-Windows-WindowsUpdateClient'
  StartTime = (Get-Date).AddDays(-7)
} -MaxEvents 200 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated, Id, LevelDisplayName, Message |
  Format-List | Out-File (Join-Path $out 'windows-update-events.txt') -Encoding utf8

Get-ChildItem 'C:\\Windows\\Logs\\CBS' -Filter 'CBS.log' -ErrorAction SilentlyContinue |
  Select-Object FullName, Length, LastWriteTime |
  Format-List | Out-File (Join-Path $out 'cbs-log-info.txt') -Encoding utf8

Write-Host "Windows Update evidence written to: $out" -ForegroundColor Green
Write-Warning 'CBS and event logs may contain sensitive environment data. Review before sharing.'`,
    requires: ['PowerShell 5.1+', 'Local administrator for DISM and complete event access'],
    rollback: 'No changes are made. Delete the generated report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10 21H2+', 'Windows 11', 'Windows Server 2016+'],
    permissions: ['Local administrator recommended for DISM /CheckHealth'],
    dependencies: ['DISM', 'Windows Update Client event channel'],
    expectedOutput: {
      en: 'Service state, hotfix history, pending reboot flags, component store health and recent update client events.',
      ar: 'حالة الخدمات وسجل التحديثات وعلامات إعادة التشغيل المعلقة وصحة مخزن المكونات وأحداث عميل التحديث الأخيرة.',
    },
    usage: {
      en: 'Run on the affected device before resetting update components. Keep the folder with the incident record.',
      ar: 'شغّله على الجهاز المتأثر قبل إعادة تعيين مكونات التحديث. احفظ المجلد مع سجل الحادث.',
    },
    validation: {
      en: 'Confirm the failure time and error code appear in the update events and that the pending reboot state matches the symptom.',
      ar: 'تأكد من ظهور وقت الفشل ورمز الخطأ في أحداث التحديث ومن تطابق حالة إعادة التشغيل المعلقة مع العَرَض.',
    },
    sources: [
      { title: 'Microsoft Learn - Windows Update troubleshooting', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-client/installing-updates-features-roles/windows-update-troubleshooting' },
      { title: 'Microsoft Learn - DISM CheckHealth', url: 'https://learn.microsoft.com/en-us/windows-hardware/manufacture/desktop/dism-image-management-command-line-options-s14' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. The registry paths are Windows-version dependent and should be confirmed in a lab.',
      ar: 'مراجعة ثابتة فقط. تعتمد مسارات التسجيل على إصدار Windows ويجب تأكيدها مختبرياً.',
    },
  },
  {
    id: 'script-event-log-bundle',
    title: { en: 'Curated event log evidence bundle', ar: 'حزمة أدلة من سجلات الأحداث المختارة' },
    description: {
      en: 'Exports System, Application and selected operational logs to EVTX files with a hash for integrity, without clearing logs.',
      ar: 'يصدّر سجلات النظام والتطبيقات وسجلات تشغيل مختارة إلى ملفات EVTX مع تجزئة للسلامة، دون مسح السجلات.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'general',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Export selected event logs without clearing them.
.DESCRIPTION
  Creates EVTX copies and a SHA-256 manifest. Security log export requires
  administrator rights and can contain sensitive data. Handle the bundle as
  confidential evidence.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop'),
  [switch]$IncludeSecurity
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-Logs-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

$logs = @(
  'System',
  'Application',
  'Microsoft-Windows-Kernel-PnP/Configuration',
  'Microsoft-Windows-WindowsUpdateClient/Operational',
  'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational',
  'Microsoft-Windows-SmbClient/Operational'
)
if ($IncludeSecurity) { $logs += 'Security' }

foreach ($log in $logs) {
  try {
    $safe = ($log -replace '[\\\\/]', '-')
    $path = Join-Path $out ("$safe.evtx")
    wevtutil epl $log $path
    Get-FileHash -Path $path -Algorithm SHA256 |
      Select-Object Path, Hash |
      Export-Csv -Path (Join-Path $out 'sha256-manifest.csv') -NoTypeInformation -Append -Encoding UTF8
  } catch {
    "Export failed for '$log': $($_.Exception.Message)" |
      Out-File (Join-Path $out 'export-errors.txt') -Append -Encoding utf8
  }
}

Get-ComputerInfo | Select-Object WindowsProductName, OsVersion, OsBuildNumber, CsName, OsLastBootUpTime |
  Format-List | Out-File (Join-Path $out 'system-info.txt') -Encoding utf8

Write-Host "Evidence bundle written to: $out" -ForegroundColor Green
Write-Warning 'Event logs may contain usernames, addresses and sensitive operational data. Store securely.'`,
    requires: ['PowerShell 5.1+', 'Local administrator for Security log export', 'Write access to the output folder'],
    rollback: 'No logs are cleared or modified. Delete the exported folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10 21H2+', 'Windows 11', 'Windows Server 2016+'],
    permissions: ['Local administrator', 'Security log access only if -IncludeSecurity is used'],
    dependencies: ['wevtutil'],
    expectedOutput: {
      en: 'EVTX copies, a SHA-256 manifest, system information and an error list for logs that could not be exported.',
      ar: 'نسخ EVTX وقائمة تجزئة SHA-256 ومعلومات النظام وقائمة أخطاء للسجلات التي تعذر تصديرها.',
    },
    usage: {
      en: 'Run as administrator. Use -IncludeSecurity only when authorized and when the Security log is required.',
      ar: 'شغّله كمسؤول. استخدم -IncludeSecurity فقط عند التصريح وعند الحاجة لسجل الأمان.',
    },
    validation: {
      en: 'Confirm the manifest hashes match the files and that export-errors.txt is empty or explained.',
      ar: 'تأكد من تطابق تجزئات القائمة مع الملفات وأن ملف أخطاء التصدير فارغ أو مفسر.',
    },
    sources: [
      { title: 'Microsoft Learn - wevtutil', url: 'https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/wevtutil' },
      { title: 'Microsoft Learn - Get-FileHash', url: 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/get-filehash' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Confirm the operational log names exist on your Windows build.',
      ar: 'مراجعة ثابتة فقط. تحقق من وجود أسماء السجلات التشغيلية في بناء Windows لديك.',
    },
  },
  {
    id: 'script-linux-service-diagnostics',
    title: { en: 'Linux systemd service diagnostics', ar: 'تشخيص خدمة systemd في Linux' },
    description: {
      en: 'Read-only systemctl and journalctl evidence for a single failing unit, including sockets, dependencies and resource limits.',
      ar: 'أدلة للقراءة فقط من systemctl وjournalctl لوحدة فاشلة، تشمل المقابس والاعتمادات وحدود الموارد.',
    },
    language: 'bash',
    risk: 'low',
    category: 'linux',
    code: `#!/usr/bin/env bash
# Read-only systemd service diagnostics.
# Usage: ./adnan-tech-service-diagnostics.sh <unit-name> [output-dir]
set -euo pipefail

UNIT="\${1:?usage: $0 <unit-name> [output-dir]}"
OUT="\${2:-/tmp/adnan-tech-service-$UNIT-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

run() {
  local name="$1"; shift
  "$@" >"$OUT/$name.txt" 2>&1 || echo "command failed: $*" >>"$OUT/$name.txt"
}

run status systemctl status "$UNIT" --no-pager -l
run unit-file systemctl cat "$UNIT"
run properties systemctl show "$UNIT" -p ActiveState,SubState,LoadState,UnitFileState,ExecMainPID,NRestarts,Result,FragmentPath
run journal journalctl -u "$UNIT" -n 400 --no-pager
run errors journalctl -u "$UNIT" -p warning -n 200 --no-pager
run dependencies systemctl list-dependencies "$UNIT" --no-pager
run sockets ss -lntup
run os cat /etc/os-release
run uname uname -a
run uptime uptime

echo "Service evidence written to: $OUT"
echo "Review before sharing: journals and socket lists can contain hostnames, users and addresses."`,
    requires: ['Linux with systemd', 'bash 4+', 'Read access to journal and unit state', 'Root for complete socket and unit details'],
    rollback: 'No changes are made. Delete the output directory to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Ubuntu 22.04+', 'Debian 12+', 'RHEL 8+', 'Rocky Linux 8+'],
    permissions: ['Standard user for unit status', 'Root or systemd-journal group for full journal access'],
    dependencies: ['systemd', 'journalctl', 'iproute2 (ss)'],
    expectedOutput: {
      en: 'Status, unit file, properties, journal excerpts, dependency tree and listening sockets for the unit.',
      ar: 'الحالة وملف الوحدة والخصائص ومقتطفات السجل وشجرة الاعتمادات والمقابس المستمعة للوحدة.',
    },
    usage: {
      en: 'Run with the unit name, for example ./adnan-tech-service-diagnostics.sh nginx. The script never restarts the service.',
      ar: 'شغّله باسم الوحدة، مثل ./adnan-tech-service-diagnostics.sh nginx. لا يعيد السكربت تشغيل الخدمة أبداً.',
    },
    validation: {
      en: 'Confirm the unit name is correct, the journal shows the failure window, and the exit reason matches the service properties.',
      ar: 'تأكد من صحة اسم الوحدة وظهور نافذة الفشل في السجل وتطابق سبب الخروج مع خصائص الخدمة.',
    },
    sources: [
      { title: 'systemd - systemctl manual', url: 'https://www.freedesktop.org/software/systemd/man/latest/systemctl.html' },
      { title: 'systemd - journalctl manual', url: 'https://www.freedesktop.org/software/systemd/man/latest/journalctl.html' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Shellcheck and a lab run are recommended before distribution.',
      ar: 'مراجعة ثابتة فقط. يُنصح بتشغيل shellcheck واختبار مختبري قبل التوزيع.',
    },
  },
  {
    id: 'script-backup-verification-evidence',
    title: { en: 'Backup verification evidence collector', ar: 'جامع أدلة التحقق من النسخ الاحتياطي' },
    description: {
      en: 'Read-only checks of local VSS shadow copies, backup event logs and repository free space; it does not start or delete backups.',
      ar: 'فحوص للقراءة فقط لنسخ VSS المحلية وسجلات أحداث النسخ ومساحة المستودع؛ لا يبدأ أو يحذف نسخاً.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'backup-dr',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only backup verification evidence for Windows hosts.
.NOTES
  This is not a restore test. A successful job or an existing shadow copy does
  not prove that the application can be recovered. Record a real restore test.
#>
[CmdletBinding()]
param(
  [string[]]$RepositoryPaths = @(),
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-Backup-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Get-CimInstance Win32_ShadowCopy -ErrorAction SilentlyContinue |
  Select-Object ID, VolumeName, InstallDate, State, DeviceObject |
  Format-Table -AutoSize | Out-File (Join-Path $out 'shadow-copies.txt') -Encoding utf8

Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = (Get-Date).AddDays(-14) } -MaxEvents 400 -ErrorAction SilentlyContinue |
  Where-Object { $_.ProviderName -match 'Backup|VSS|Volume Shadow' } |
  Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message |
  Format-List | Out-File (Join-Path $out 'backup-events.txt') -Encoding utf8

Get-Volume |
  Select-Object DriveLetter, FileSystemLabel, FileSystem, HealthStatus,
    @{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}},
    @{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB,2)}} |
  Format-Table -AutoSize | Out-File (Join-Path $out 'volumes.txt') -Encoding utf8

foreach ($path in $RepositoryPaths) {
  if (Test-Path -LiteralPath $path) {
    Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue |
      Select-Object Name, Length, LastWriteTime |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 50 |
      Format-Table -AutoSize | Out-File (Join-Path $out ("repository-{0}.txt" -f (Split-Path $path -Leaf))) -Encoding utf8
  } else {
    "Repository path not found: $path" | Out-File (Join-Path $out 'repository-errors.txt') -Append -Encoding utf8
  }
}

Write-Host "Backup evidence written to: $out" -ForegroundColor Green
Write-Warning 'This evidence does not replace a documented restore test. Verify RPO/RTO with the application owner.'`,
    requires: ['PowerShell 5.1+', 'Local administrator for VSS and event data', 'Read access to repository paths'],
    rollback: 'No backups, shadow copies or services are modified. Delete the report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows Server 2016+', 'Windows 10/11'],
    permissions: ['Local administrator for VSS data', 'Read access to backup repository paths'],
    dependencies: ['VSS', 'Windows event log'],
    expectedOutput: {
      en: 'Shadow copy inventory, recent backup/VSS events, volume free space and recent repository file listings.',
      ar: 'جرد نسخ VSS وأحداث النسخ/VSS الأخيرة ومساحة الأحجام وقوائم ملفات المستودع الأخيرة.',
    },
    usage: {
      en: 'Run on the protected host. Pass repository paths to include a recent file listing; the script does not open backup contents.',
      ar: 'شغّله على المضيف المحمي. مرّر مسارات المستودع لتضمين قائمة ملفات حديثة؛ لا يفتح السكربت محتوى النسخ.',
    },
    validation: {
      en: 'Confirm the expected backup events are present for the retention window and schedule a real restore test separately.',
      ar: 'تأكد من وجود أحداث النسخ المتوقعة لفترة الاحتفاظ وجدول اختبار استرداد حقيقياً بشكل منفصل.',
    },
    sources: [
      { title: 'Microsoft Learn - Volume Shadow Copy Service', url: 'https://learn.microsoft.com/en-us/windows-server/storage/file-server/volume-shadow-copy-service' },
      { title: 'CISA - Data backups', url: 'https://www.cisa.gov/stopransomware/data-backups' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. This collector intentionally makes no claim about restore success.',
      ar: 'مراجعة ثابتة فقط. لا يدّعي هذا الجامع نجاح الاسترداد عمداً.',
    },
  },
  {
    id: 'script-security-baseline-audit',
    title: { en: 'Windows security baseline audit', ar: 'تدقيق خط أساس أمان Windows' },
    description: {
      en: 'Read-only inventory of Defender, firewall, SMBv1, BitLocker, local administrators and audit policy for review.',
      ar: 'جرد للقراءة فقط لحالة Defender والجدار وSMBv1 وBitLocker والمسؤولين المحليين وسياسة التدقيق للمراجعة.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'cybersecurity',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only Windows security baseline inventory.
.NOTES
  Some cmdlets require elevation. No security setting is changed by this script.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-Security-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Get-MpComputerStatus -ErrorAction SilentlyContinue |
  Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled,
    AntivirusSignatureVersion, AntivirusSignatureLastUpdated, QuickScanEndTime, FullScanEndTime |
  Format-List | Out-File (Join-Path $out 'defender.txt') -Encoding utf8

Get-NetFirewallProfile -ErrorAction SilentlyContinue |
  Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction, LogBlocked |
  Format-Table -AutoSize | Out-File (Join-Path $out 'firewall-profiles.txt') -Encoding utf8

Get-SmbServerConfiguration -ErrorAction SilentlyContinue |
  Select-Object EnableSMB1Protocol, EnableSMB2Protocol, RequireSecuritySignature,
    EnableSecuritySignature, EncryptData, Smb2DialectMax |
  Format-List | Out-File (Join-Path $out 'smb.txt') -Encoding utf8

Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction SilentlyContinue |
  Select-Object FeatureName, State |
  Format-List | Out-File (Join-Path $out 'smb1-feature.txt') -Encoding utf8

Get-BitLockerVolume -ErrorAction SilentlyContinue |
  Select-Object MountPoint, VolumeStatus, ProtectionStatus, EncryptionPercentage, KeyProtector |
  Format-List | Out-File (Join-Path $out 'bitlocker.txt') -Encoding utf8

try {
  Get-LocalGroupMember -Group 'Administrators' -ErrorAction Stop |
    Select-Object Name, ObjectClass, PrincipalSource |
    Format-Table -AutoSize | Out-File (Join-Path $out 'local-admins.txt') -Encoding utf8
} catch {
  "Unable to read Administrators group: $($_.Exception.Message)" |
    Out-File (Join-Path $out 'local-admins.txt') -Encoding utf8
}

auditpol /get /category:* 2>&1 | Out-File (Join-Path $out 'audit-policy.txt') -Encoding utf8

Get-CimInstance Win32_QuickFixEngineering | Sort-Object InstalledOn -Descending |
  Select-Object -First 20 HotFixID, Description, InstalledOn |
  Format-Table -AutoSize | Out-File (Join-Path $out 'recent-updates.txt') -Encoding utf8

Write-Host "Security baseline written to: $out" -ForegroundColor Green
Write-Warning 'The report describes configuration only. It is not a vulnerability scan or a compliance certification.'`,
    requires: ['PowerShell 5.1+', 'Local administrator for complete data', 'Defender and BitLocker cmdlets where available'],
    rollback: 'No settings are changed. Delete the report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10 21H2+', 'Windows 11', 'Windows Server 2016+'],
    permissions: ['Local administrator'],
    dependencies: ['Defender module', 'BitLocker module', 'LocalAccounts module', 'auditpol'],
    expectedOutput: {
      en: 'Configuration snapshots for Defender, firewall, SMB, BitLocker, local administrators, audit policy and recent updates.',
      ar: 'لقطات إعداد لـ Defender والجدار وSMB وBitLocker والمسؤولين المحليين وسياسة التدقيق والتحديثات الأخيرة.',
    },
    usage: {
      en: 'Run as administrator on a representative endpoint. Compare results against your approved baseline.',
      ar: 'شغّله كمسؤول على جهاز تمثيلي. قارن النتائج بخط الأساس المعتمد.',
    },
    validation: {
      en: 'Confirm each section reflects the real system state and that missing cmdlets are reported rather than assumed compliant.',
      ar: 'تأكد من أن كل قسم يعكس حالة النظام الفعلية وأن الأوامر المفقودة تُبلّغ عنها لا تُفترض ممتثلة.',
    },
    sources: [
      { title: 'Microsoft Learn - Windows security baselines', url: 'https://learn.microsoft.com/en-us/windows/security/operating-system-security/device-management/windows-security-configuration-framework/windows-security-baselines' },
      { title: 'Microsoft Learn - Get-MpComputerStatus', url: 'https://learn.microsoft.com/en-us/powershell/module/defender/get-mpcomputerstatus' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Some cmdlets are unavailable on older Windows builds; the script reports those failures.',
      ar: 'مراجعة ثابتة فقط. بعض الأوامر غير متوفرة في إصدارات Windows الأقدم؛ يبلّغ السكربت عن تلك الإخفاقات.',
    },
  },
  {
    id: 'script-network-path-diagnostics',
    title: { en: 'Network path and port diagnostics', ar: 'تشخيص مسار الشبكة والمنافذ' },
    description: {
      en: 'Read-only DNS, route, trace and TCP port checks for a target host, saved as a report for comparison.',
      ar: 'فحوص للقراءة فقط لـ DNS والمسار والتتبع ومنافذ TCP لمضيف هدف، تُحفظ كتقرير للمقارنة.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'networking',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only network path diagnostics to a target.
.NOTES
  The script sends ICMP/TCP probes. Obtain authorization before probing hosts
  you do not own. It does not change routes, DNS or firewall rules.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Target,
  [int[]]$Ports = @(443, 80, 53, 3389),
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$safeTarget = ($Target -replace '[^a-zA-Z0-9.-]', '_')
$out = Join-Path $OutputRoot "AdnanTech-Net-$safeTarget-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Resolve-DnsName $Target -ErrorAction SilentlyContinue |
  Format-List | Out-File (Join-Path $out 'dns.txt') -Encoding utf8

Get-NetIPConfiguration |
  Select-Object InterfaceAlias, IPv4Address, IPv4DefaultGateway, DNSServer |
  Format-List | Out-File (Join-Path $out 'local-ipconfig.txt') -Encoding utf8

Get-NetRoute -AddressFamily IPv4 |
  Sort-Object RouteMetric |
  Select-Object -First 30 DestinationPrefix, NextHop, InterfaceAlias, RouteMetric |
  Format-Table -AutoSize | Out-File (Join-Path $out 'routes.txt') -Encoding utf8

Test-NetConnection -ComputerName $Target -TraceRoute -WarningAction SilentlyContinue |
  Format-List | Out-File (Join-Path $out 'traceroute.txt') -Encoding utf8

foreach ($port in $Ports) {
  Test-NetConnection -ComputerName $Target -Port $port -WarningAction SilentlyContinue |
    Select-Object ComputerName, RemotePort, TcpTestSucceeded, SourceAddress |
    Format-List | Out-File (Join-Path $out ("port-{0}.txt" -f $port)) -Encoding utf8
}

Write-Host "Network evidence written to: $out" -ForegroundColor Green
Write-Warning 'Only probe hosts you are authorized to test. Results are point-in-time evidence, not a guarantee.'`,
    requires: ['PowerShell 5.1+', 'Network access to the target', 'Authorization to probe the target'],
    rollback: 'No configuration changes are made. Delete the report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10 21H2+', 'Windows 11', 'Windows Server 2016+'],
    permissions: ['Standard user', 'No elevation required for normal probes'],
    dependencies: ['NetTCPIP module', 'DnsClient module'],
    expectedOutput: {
      en: 'DNS answer, local IP configuration, routes, traceroute and per-port TCP results.',
      ar: 'إجابة DNS وإعداد IP المحلي والمسارات والتتبع ونتائج TCP لكل منفذ.',
    },
    usage: {
      en: 'Run with -Target name or IP. Adjust -Ports to the service under test. Do not use it to scan third-party networks.',
      ar: 'شغّله مع -Target اسماً أو IP. عدّل -Ports حسب الخدمة. لا تستخدمه لمسح شبكات طرف ثالث.',
    },
    validation: {
      en: 'Compare results before and after a change and confirm the target port matches the service actually listening.',
      ar: 'قارن النتائج قبل التغيير وبعده وتأكد من تطابق منفذ الهدف مع الخدمة المستمعة فعلاً.',
    },
    sources: [
      { title: 'Microsoft Learn - Test-NetConnection', url: 'https://learn.microsoft.com/en-us/powershell/module/nettcpip/test-netconnection' },
      { title: 'Microsoft Learn - Get-NetRoute', url: 'https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-netroute' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. ICMP may be filtered in your environment; a failed ping is not proof the host is down.',
      ar: 'مراجعة ثابتة فقط. قد تُفلتر ICMP في بيئتك؛ فشل ping ليس دليلاً على توقف المضيف.',
    },
  },
  {
    id: 'script-printer-inventory',
    title: { en: 'Printer and spooler inventory', ar: 'جرد الطابعات وخدمة الطباعة' },
    description: {
      en: 'Read-only inventory of printers, ports, drivers, jobs and spooler state; it does not clear queues or restart the spooler.',
      ar: 'جرد للقراءة فقط للطابعات والمنافذ والتعريفات والمهام وحالة خدمة الطباعة؛ لا يمسح الطوابير أو يعيد تشغيل الخدمة.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'printing',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only printer and spooler inventory.
.NOTES
  Use the spooler recovery template only after reviewing this evidence and
  obtaining user approval. This script changes nothing.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "AdnanTech-Print-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

Get-Printer -ErrorAction SilentlyContinue |
  Select-Object Name, DriverName, PortName, Shared, Published, PrinterStatus, JobCount |
  Format-Table -AutoSize | Out-File (Join-Path $out 'printers.txt') -Encoding utf8

Get-PrinterPort -ErrorAction SilentlyContinue |
  Select-Object Name, Description, PrinterHostAddress, PortNumber, Protocol |
  Format-Table -AutoSize | Out-File (Join-Path $out 'ports.txt') -Encoding utf8

Get-PrinterDriver -ErrorAction SilentlyContinue |
  Select-Object Name, Manufacturer, DriverVersion, PrinterEnvironment |
  Format-Table -AutoSize | Out-File (Join-Path $out 'drivers.txt') -Encoding utf8

Get-Service Spooler |
  Select-Object Name, Status, StartType |
  Format-List | Out-File (Join-Path $out 'spooler-service.txt') -Encoding utf8

Get-PrintJob -PrinterName * -ErrorAction SilentlyContinue |
  Select-Object PrinterName, Id, DocumentName, UserName, SubmittedTime, JobStatus |
  Format-Table -AutoSize | Out-File (Join-Path $out 'jobs.txt') -Encoding utf8

Get-WinEvent -LogName 'Microsoft-Windows-PrintService/Admin' -MaxEvents 100 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated, Id, LevelDisplayName, Message |
  Format-List | Out-File (Join-Path $out 'print-admin-events.txt') -Encoding utf8

Write-Host "Printer inventory written to: $out" -ForegroundColor Green
Write-Warning 'Document names and usernames may be sensitive. Review before sharing.'`,
    requires: ['PowerShell 5.1+', 'Print management cmdlets', 'Read access to the PrintService log'],
    rollback: 'No changes are made. Delete the report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Windows 10 21H2+', 'Windows 11', 'Windows Server 2016+'],
    permissions: ['Standard user for local printers', 'Print Management rights for server queues'],
    dependencies: ['PrintManagement module'],
    expectedOutput: {
      en: 'Printer, port, driver, spooler service, job and PrintService admin event reports.',
      ar: 'تقارير الطابعات والمنافذ والتعريفات وخدمة الطباعة والمهام وأحداث إدارة خدمة الطباعة.',
    },
    usage: {
      en: 'Run on the print server or affected client. Do not clear jobs until the user confirms no work is lost.',
      ar: 'شغّله على خادم الطباعة أو العميل المتأثر. لا تمسح المهام حتى يؤكد المستخدم عدم فقدان عمل.',
    },
    validation: {
      en: 'Confirm the affected printer and queue appear, and that the error timestamp matches the PrintService event.',
      ar: 'تأكد من ظهور الطابعة والطابور المتأثر ومن تطابق وقت الخطأ مع حدث خدمة الطباعة.',
    },
    sources: [
      { title: 'Microsoft Learn - Get-Printer', url: 'https://learn.microsoft.com/en-us/powershell/module/printmanagement/get-printer' },
      { title: 'Microsoft Learn - Print and Document Services', url: 'https://learn.microsoft.com/en-us/windows-server/print-server/print-server' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Get-PrintJob with a wildcard may not be supported on every build.',
      ar: 'مراجعة ثابتة فقط. قد لا يدعم Get-PrintJob مع حرف البدل كل إصدارات Windows.',
    },
  },
  {
    id: 'script-docker-diagnostics',
    title: { en: 'Docker container diagnostics', ar: 'تشخيص حاويات Docker' },
    description: {
      en: 'Read-only Docker state, inspect summary, logs, events, stats, disk usage and network inventory for a container.',
      ar: 'حالة Docker للقراءة فقط وملخص inspect والسجلات والأحداث والإحصاءات واستخدام القرص وجرد الشبكة لحاوية.',
    },
    language: 'bash',
    risk: 'low',
    category: 'cloud-devops',
    code: `#!/usr/bin/env bash
# Read-only Docker diagnostics for a single container.
# Usage: ./adnan-tech-docker-diagnostics.sh <container> [output-dir]
set -euo pipefail

CONTAINER="\${1:?usage: $0 <container> [output-dir]}"
OUT="\${2:-/tmp/adnan-tech-docker-$CONTAINER-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT"

run() {
  local name="$1"; shift
  "$@" >"$OUT/$name.txt" 2>&1 || echo "command failed: $*" >>"$OUT/$name.txt"
}

run version docker version
run info docker info
run ps docker ps -a --no-trunc
run inspect docker inspect "$CONTAINER"
run logs docker logs --tail 500 "$CONTAINER"
run events docker events --since 30m --until 0s
run stats docker stats --no-stream
run disk docker system df -v
run networks docker network ls
run mounts docker inspect "$CONTAINER" --format '{{json .Mounts}}'
run health docker inspect "$CONTAINER" --format '{{json .State.Health}}'
run os cat /etc/os-release

echo "Docker evidence written to: $OUT"
echo "Review before sharing: inspect output can contain environment variables and secrets."`,
    requires: ['Docker CLI access', 'bash 4+', 'Permission to inspect the container'],
    rollback: 'No containers, images or volumes are modified. Delete the output directory to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
    operatingSystems: ['Linux with Docker Engine 24+', 'Docker Desktop'],
    permissions: ['Member of the docker group or root-equivalent access (review the security impact)'],
    dependencies: ['Docker CLI'],
    expectedOutput: {
      en: 'Docker version/info, container state, inspect JSON, logs, recent events, stats, disk usage and mounts.',
      ar: 'إصدار/معلومات Docker وحالة الحاوية وJSON inspect والسجلات والأحداث الأخيرة والإحصاءات واستخدام القرص والتركيبات.',
    },
    usage: {
      en: 'Run with the container name or ID. The script does not stop, remove or restart anything. Sanitize inspect output before sharing.',
      ar: 'شغّله باسم أو معرّف الحاوية. لا يوقف السكربت أو يحذف أو يعيد تشغيل أي شيء. نقّح مخرجات inspect قبل المشاركة.',
    },
    validation: {
      en: 'Confirm the logs cover the failure time and that the exit code and health state match the reported symptom.',
      ar: 'تأكد من تغطية السجلات لوقت الفشل ومن تطابق رمز الخروج وحالة الصحة مع العَرَض المبلّغ عنه.',
    },
    sources: [
      { title: 'Docker - Troubleshooting', url: 'https://docs.docker.com/engine/troubleshooting/' },
      { title: 'Docker - docker inspect', url: 'https://docs.docker.com/reference/cli/docker/inspect/' },
    ],
    testStatus: 'not-executed',
    testNotes: {
      en: 'Static review only. Docker group membership is effectively root-equivalent on many hosts; review before use.',
      ar: 'مراجعة ثابتة فقط. عضوية مجموعة docker تعادل صلاحية root على كثير من المضيفات؛ راجعها قبل الاستخدام.',
    },
  },
]
