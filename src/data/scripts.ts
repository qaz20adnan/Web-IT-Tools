import type { ScriptTemplate } from '@/types'
import { EXTRA_SCRIPT_TEMPLATES } from './scriptsExtra'

const CREATED = '2026-10-22'

const CORE_SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'script-win-health',
    title: { en: 'Windows health evidence collector', ar: 'جامع أدلة صحة Windows' },
    description: {
      en: 'Read-only PowerShell that collects OS build, disk, memory, service state and the latest critical events into a timestamped folder.',
      ar: 'سكربت PowerShell للقراءة فقط يجمع بنية النظام والقرص والذاكرة وحالة الخدمات وأحدث الأحداث الحرجة في مجلد مؤرخ.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'windows-client',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only Windows health evidence collector.
.DESCRIPTION
  Creates a folder on the Desktop and writes text reports. It does not change system settings.
  Review the output before sharing: logs can contain hostnames, usernames and IP addresses.
.NOTES
  Risk: LOW (read-only). Run in an elevated PowerShell for complete service and event data.
#>
[CmdletBinding()]
param(
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "TNX-Health-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

'Collecting operating system information...'
Get-ComputerInfo |
  Select-Object WindowsProductName, WindowsVersion, OsBuildNumber, OsArchitecture,
    CsName, CsManufacturer, CsModel, CsTotalPhysicalMemory, OsLastBootUpTime |
  Format-List | Out-File (Join-Path $out 'os.txt') -Encoding utf8

'Collecting disk and volume state...'
Get-Volume |
  Select-Object DriveLetter, FileSystemLabel, FileSystem, HealthStatus, DriveType,
    @{n='SizeGB';e={[math]::Round($_.Size/1GB,2)}},
    @{n='FreeGB';e={[math]::Round($_.SizeRemaining/1GB,2)}} |
  Format-Table -AutoSize | Out-File (Join-Path $out 'volumes.txt') -Encoding utf8

Get-PhysicalDisk |
  Select-Object FriendlyName, MediaType, HealthStatus, OperationalStatus, Size |
  Format-Table -AutoSize | Out-File (Join-Path $out 'physical-disks.txt') -Encoding utf8

'Collecting relevant service state...'
Get-Service wuauserv, bits, cryptsvc, Spooler, TermService, Dnscache, LanmanServer, LanmanWorkstation -ErrorAction SilentlyContinue |
  Select-Object Name, DisplayName, Status, StartType |
  Format-Table -AutoSize | Out-File (Join-Path $out 'services.txt') -Encoding utf8

'Collecting recent critical and error events...'
Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1,2; StartTime = (Get-Date).AddDays(-2) } -MaxEvents 200 -ErrorAction SilentlyContinue |
  Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message |
  Format-List | Out-File (Join-Path $out 'system-errors.txt') -Encoding utf8

'Collecting update history...'
Get-HotFix | Sort-Object InstalledOn -Descending |
  Select-Object -First 25 HotFixID, Description, InstalledOn |
  Format-Table -AutoSize | Out-File (Join-Path $out 'hotfixes.txt') -Encoding utf8

Write-Host "Evidence collected in: $out" -ForegroundColor Green
Write-Warning 'Review the files before sharing. They can contain sensitive environment data.'`,
    requires: ['PowerShell 5.1+', 'Elevated session for complete event and service data', 'Write access to the output folder'],
    rollback: 'No system changes are made. Delete the generated report folder to roll back the only artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-print-spooler',
    title: { en: 'Print spooler recovery (queue clear opt-in)', ar: 'استعادة Print Spooler (تفريغ الطابور اختياري)' },
    description: {
      en: 'Restarts the spooler and, only with an explicit switch, clears the print queue while archiving spool files first.',
      ar: 'يعيد تشغيل Spooler، ومع مفتاح صريح فقط يفرّغ طابور الطباعة بعد أرشفة ملفاته.',
    },
    language: 'powershell',
    risk: 'medium',
    category: 'printing',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Print Spooler recovery with an explicit queue-clear opt-in.
.DESCRIPTION
  Always copies spool files to an archive folder before clearing.
  Pending print jobs are lost when -ClearQueue is used. Confirm with users first.
.NOTES
  Risk: MEDIUM. Requires elevation. No driver or registry changes are made.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [switch]$ClearQueue,
  [string]$ArchiveRoot = 'C:\\ProgramData\\NEXORA\\SpoolArchive'
)

$spool = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $ArchiveRoot $stamp

if ($PSCmdlet.ShouldProcess('Print Spooler', 'Stop service')) {
  Stop-Service -Name Spooler -Force
}

if ($ClearQueue) {
  if (-not (Test-Path -LiteralPath $spool)) {
    throw "Spool directory not found: $spool"
  }
  $files = Get-ChildItem -LiteralPath $spool -File -ErrorAction SilentlyContinue
  if ($files) {
    New-Item -ItemType Directory -Path $archive -Force | Out-Null
    foreach ($file in $files) {
      Copy-Item -LiteralPath $file.FullName -Destination $archive -Force
    }
    Write-Host "Archived $($files.Count) spool file(s) to $archive"
    foreach ($file in $files) {
      if ($PSCmdlet.ShouldProcess($file.FullName, 'Remove spool file')) {
        Remove-Item -LiteralPath $file.FullName -Force
      }
    }
  } else {
    Write-Host 'Spool directory is already empty.'
  }
} else {
  Write-Host 'Queue not cleared. Re-run with -ClearQueue after confirming with users.'
}

if ($PSCmdlet.ShouldProcess('Print Spooler', 'Start service')) {
  Start-Service -Name Spooler
}

Get-Service -Name Spooler | Select-Object Name, Status, StartType`,
    requires: ['PowerShell 5.1+', 'Administrator privileges', 'User confirmation before -ClearQueue'],
    rollback: 'Restore archived .SPL/.SHD files to C:\\Windows\\System32\\spool\\PRINTERS while the spooler is stopped, then restart it. Restarting does not restore deleted jobs.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-win-update-reset',
    title: { en: 'Windows Update component reset (reviewed)', ar: 'إعادة ضبط مكونات Windows Update (للمراجعة)' },
    description: {
      en: 'Renames the update cache and catroot2 with backup, after stopping dependent services. Supports -WhatIf for a dry run.',
      ar: 'يعيد تسمية ذاكرة التحديث وcatroot2 مع نسخ احتياطي بعد إيقاف الخدمات، ويدعم -WhatIf للمعاينة.',
    },
    language: 'powershell',
    risk: 'high',
    category: 'windows-client',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Reset Windows Update components with reversible folder renames.
.DESCRIPTION
  Stops update services, renames SoftwareDistribution and catroot2, then restarts services.
  This is NOT a first-line diagnostic. Collect CBS/WindowsUpdate logs and identify the error code first.
  Use -WhatIf to preview actions without changes.
.NOTES
  Risk: HIGH. Requires elevation. Creates timestamped backups next to the original folders.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param()

$services = 'wuauserv', 'bits', 'cryptsvc', 'msiserver'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'This script must run in an elevated PowerShell session.'
}

$logPath = Join-Path $env:ProgramData "NEXORA\\wu-reset-$stamp.log"
New-Item -ItemType Directory -Path (Split-Path $logPath) -Force | Out-Null
Start-Transcript -Path $logPath | Out-Null

try {
  foreach ($name in $services) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') {
      if ($PSCmdlet.ShouldProcess($name, 'Stop service')) {
        Stop-Service -Name $name -Force -ErrorAction Continue
      }
    }
  }

  $targets = @(
    (Join-Path $env:SystemRoot 'SoftwareDistribution'),
    (Join-Path $env:SystemRoot 'System32\\catroot2')
  )

  foreach ($target in $targets) {
    if (-not (Test-Path -LiteralPath $target)) {
      Write-Host "Skip (missing): $target"
      continue
    }
    $backup = "$target.bak-$stamp"
    if ($PSCmdlet.ShouldProcess($target, "Rename to $backup")) {
      Rename-Item -LiteralPath $target -NewName (Split-Path $backup -Leaf) -ErrorAction Stop
      Write-Host "Renamed: $target -> $backup"
    }
  }
} finally {
  foreach ($name in $services) {
    $service = Get-Service -Name $name -ErrorAction SilentlyContinue
    if ($service -and $service.StartType -ne 'Disabled') {
      if ($PSCmdlet.ShouldProcess($name, 'Start service')) {
        Start-Service -Name $name -ErrorAction Continue
      }
    }
  }
  Stop-Transcript | Out-Null
}

Write-Host "Transcript: $logPath"
Write-Host "Rollback: stop services, delete the new folders, then rename *.bak-$stamp back to their original names."`,
    requires: ['PowerShell 5.1+', 'Administrator privileges', 'Change approval', 'Collected update error logs (CBS/WindowsUpdate)'],
    rollback: 'Stop update services, remove the recreated SoftwareDistribution/catroot2 folders, rename the .bak-<timestamp> folders back, then start the services. Test update installation after rollback.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-ad-health',
    title: { en: 'Active Directory read-only health report', ar: 'تقرير صحة Active Directory للقراءة فقط' },
    description: {
      en: 'Runs repadmin and dcdiag read-only checks, writing output to a timestamped folder. Does not force replication.',
      ar: 'يشغّل فحوص repadmin وdcdiag للقراءة فقط ويكتب المخرجات في مجلد مؤرخ، دون فرض التكرار.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'windows-server',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only Active Directory replication and DNS health evidence.
.NOTES
  Risk: LOW. Requires the AD DS RSAT tools and domain credentials with read access.
  Does NOT run /syncall or change replication topology.
#>
[CmdletBinding()]
param([string]$OutputRoot = 'C:\\Temp')

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "TNX-ADHealth-$stamp"
New-Item -ItemType Directory -Path $out -Force | Out-Null

$commands = @(
  @{ Name = 'replsummary'; Args = @('/replsummary') },
  @{ Name = 'showrepl';    Args = @('/showrepl', '*', '/csv') },
  @{ Name = 'dcdiag';      Args = @('/v', '/c', '/d', '/e') }
)

foreach ($item in $commands) {
  $file = Join-Path $out ("{0}.txt" -f $item.Name)
  Write-Host "Running: repadmin/dcdiag $($item.Name)"
  if ($item.Name -eq 'dcdiag') {
    & dcdiag @($item.Args) *>&1 | Out-File -FilePath $file -Encoding utf8
  } else {
    & repadmin @($item.Args) *>&1 | Out-File -FilePath $file -Encoding utf8
  }
}

Get-ADDomainController -Filter * |
  Select-Object Name, Site, OperatingSystem, IPv4Address, IsGlobalCatalog, Enabled |
  Format-Table -AutoSize | Out-File (Join-Path $out 'domain-controllers.txt') -Encoding utf8

Write-Host "Read-only AD health report: $out" -ForegroundColor Green
Write-Warning 'Review output before sharing. It may contain internal hostnames and topology.'`,
    requires: ['RSAT Active Directory PowerShell module', 'repadmin and dcdiag', 'Read-only domain credentials'],
    rollback: 'No changes are made. Delete the report folder to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-linux-disk-report',
    title: { en: 'Linux disk and inode report', ar: 'تقرير أقراص وinode في Linux' },
    description: {
      en: 'Read-only Bash report of filesystem usage, inodes, top directories and deleted-but-open files.',
      ar: 'تقرير Bash للقراءة فقط عن استخدام أنظمة الملفات وinode وأكبر المجلدات والملفات المحذوفة المفتوحة.',
    },
    language: 'bash',
    risk: 'low',
    category: 'linux',
    code: `#!/usr/bin/env bash
# NEXORA AI - read-only Linux disk report
# Risk: LOW. Does not delete or modify files.
set -u

OUT="${'$'}{1:-/tmp}/tnx-disk-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT" || exit 1

{
  echo "=== date ==="; date -Is
  echo "=== hostname / kernel ==="; hostname; uname -a
  echo "=== filesystems ==="; df -hT
  echo "=== inodes ==="; df -i
  echo "=== top level usage ==="; du -xhd1 / 2>/dev/null | sort -h
  echo "=== largest files under /var (top 30) ==="
  find /var -xdev -type f -printf '%s\\t%p\\n' 2>/dev/null | sort -nr | head -30
} > "$OUT/report.txt" 2>&1

if command -v lsof >/dev/null 2>&1; then
  lsof +L1 > "$OUT/deleted-open-files.txt" 2>/dev/null || true
else
  echo "lsof not installed; skipped deleted-open-file scan." > "$OUT/deleted-open-files.txt"
fi

echo "Report written to: $OUT"
echo "Review before sharing; paths and process names may be sensitive."`,
    requires: ['Bash 4+', 'Read access to filesystem metadata', 'Optional: lsof for deleted-open-file detection'],
    rollback: 'No changes are made. Remove the generated report directory to delete the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-network-diagnostics',
    title: { en: 'Windows network path diagnostics', ar: 'تشخيص مسار الشبكة في Windows' },
    description: {
      en: 'Read-only DNS, route, TCP reachability and MTU probes for a target host, saved to a report file.',
      ar: 'فحوص DNS والمسارات وإمكانية الوصول بـ TCP وMTU لمضيف هدف، للقراءة فقط، محفوظة في تقرير.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'networking',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only network diagnostics for one host.
.PARAMETER Target
  Hostname or IP address to test.
.PARAMETER Port
  TCP port to test. Default 443.
.NOTES
  Risk: LOW. Sends ICMP/TCP probes and DNS queries only.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Target,
  [int]$Port = 443,
  [string]$OutputRoot = [Environment]::GetFolderPath('Desktop')
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$out = Join-Path $OutputRoot "TNX-NetDiag-$stamp.txt"
Start-Transcript -Path $out | Out-Null

try {
  Write-Host "=== DNS servers ==="
  Get-DnsClientServerAddress -AddressFamily IPv4 |
    Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize

  Write-Host "=== Name resolution ==="
  Resolve-DnsName -Name $Target -ErrorAction Continue

  Write-Host "=== Route lookup ==="
  Find-NetRoute -RemoteIPAddress $Target -ErrorAction Continue |
    Select-Object InterfaceAlias, IPAddress, NextHop, RouteMetric

  Write-Host "=== TCP $Port ==="
  Test-NetConnection -ComputerName $Target -Port $Port -InformationLevel Detailed

  Write-Host "=== ICMP (4 probes) ==="
  Test-Connection -ComputerName $Target -Count 4 -ErrorAction Continue

  Write-Host "=== Interface MTU ==="
  Get-NetIPInterface -AddressFamily IPv4 |
    Select-Object InterfaceAlias, NlMtu, ConnectionState | Format-Table -AutoSize
} finally {
  Stop-Transcript | Out-Null
}

Write-Host "Report saved to: $out"
Write-Warning 'Reports may contain internal IPs and hostnames. Review before sharing.'`,
    requires: ['PowerShell 5.1+', 'Network access to the target', 'No elevation required for most checks'],
    rollback: 'No changes are made. Delete the transcript file if it is not needed.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-sql-health',
    title: { en: 'SQL Server read-only health queries', ar: 'استعلامات صحة SQL Server للقراءة فقط' },
    description: {
      en: 'Read-only T-SQL for database size, backup age, index fragmentation and wait statistics.',
      ar: 'استعلامات T-SQL للقراءة فقط لحجم قاعدة البيانات وعمر النسخ وتفتت الفهارس وإحصاءات الانتظار.',
    },
    language: 'sql',
    risk: 'low',
    category: 'datacenter',
    code: `-- NEXORA AI - read-only SQL Server health queries
-- Risk: LOW. SELECT-only. Run on a secondary/reporting replica where possible.
SET NOCOUNT ON;

-- Database size and free space
SELECT DB_NAME(database_id) AS database_name,
       CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(18,2)) AS total_mb
FROM sys.master_files
GROUP BY database_id
ORDER BY total_mb DESC;

-- Backup recency (msdb)
SELECT d.name AS database_name,
       MAX(b.backup_finish_date) AS last_backup,
       DATEDIFF(HOUR, MAX(b.backup_finish_date), GETDATE()) AS hours_since_backup
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset b ON b.database_name = d.name
WHERE d.database_id > 4
GROUP BY d.name
ORDER BY hours_since_backup DESC;

-- Wait statistics since last restart (top 10)
SELECT TOP (10) wait_type,
       waiting_tasks_count,
       wait_time_ms,
       max_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type NOT LIKE '%SLEEP%'
ORDER BY wait_time_ms DESC;

-- Fragmentation for indexes above 5% (may be expensive on very large databases)
SELECT OBJECT_NAME(i.object_id) AS table_name,
       i.name AS index_name,
       ps.avg_fragmentation_in_percent,
       ps.page_count
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ps
JOIN sys.indexes i ON i.object_id = ps.object_id AND i.index_id = ps.index_id
WHERE ps.avg_fragmentation_in_percent > 5
  AND ps.page_count > 1000
ORDER BY ps.avg_fragmentation_in_percent DESC;`,
    requires: ['Read access to system catalog views', 'VIEW SERVER STATE for wait statistics', 'msdb read access for backup history'],
    rollback: 'No changes are made. The queries are read-only.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-m365-mailbox-report',
    title: { en: 'Microsoft 365 mailbox size report', ar: 'تقرير أحجام صناديق Microsoft 365' },
    description: {
      en: 'Read-only Exchange Online PowerShell report of mailbox size, archive status and item counts.',
      ar: 'تقرير PowerShell للقراءة فقط لـ Exchange Online عن حجم الصناديق وحالة الأرشيف وعدد العناصر.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'microsoft-365',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only Exchange Online mailbox size report.
.NOTES
  Risk: LOW. Requires the ExchangeOnlineManagement module and a role with read access.
  Sign-in uses modern authentication. No mailbox data is modified.
#>
[CmdletBinding()]
param(
  [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'm365-mailboxes.csv')
)

Import-Module ExchangeOnlineManagement -ErrorAction Stop
Connect-ExchangeOnline -ShowBanner:$false

try {
  Get-EXOMailbox -ResultSize Unlimited -PropertySets Mailbox |
    Select-Object DisplayName, UserPrincipalName, PrimarySmtpAddress,
      RecipientTypeDetails, ArchiveStatus, IsInactiveMailbox |
    Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

  $stats = Get-EXOMailbox -ResultSize Unlimited |
    Get-EXOMailboxStatistics |
    Select-Object DisplayName, TotalItemSize, ItemCount, LastLogonTime, DeletedItemCount

  $stats | Export-Csv -Path ($OutputPath -replace '\\.csv$', '-stats.csv') -NoTypeInformation -Encoding UTF8
  Write-Host "Mailbox report written to: $OutputPath"
} finally {
  Disconnect-ExchangeOnline -Confirm:$false
}`,
    requires: ['ExchangeOnlineManagement module', 'Exchange Administrator or Global Reader role', 'Modern authentication'],
    rollback: 'No changes are made. Delete the exported CSV files to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
]

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  ...CORE_SCRIPT_TEMPLATES,
  ...EXTRA_SCRIPT_TEMPLATES,
]

export function getScriptTemplate(id: string): ScriptTemplate | undefined {
  return SCRIPT_TEMPLATES.find((script) => script.id === id)
}
