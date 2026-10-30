export interface PrinterAgentOptions {
  queueName?: string
  restartSpooler?: boolean
  cancelJobs?: boolean
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function buildPrinterAgentScript(options: PrinterAgentOptions = {}): string {
  const queue = (options.queueName ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
  const restart = options.restartSpooler === true
  const cancel = options.cancelJobs === true

  return `# Adnan Tech - local printer diagnostics and queue agent
# Generated on ${new Date().toISOString()}
# Run in an elevated PowerShell window on the Windows device that owns the printer.
# This script only reads state unless you enabled restart/cancel below.

param(
  [string]$QueueName = ${quote(queue)},
  [switch]$RestartSpooler = ${restart ? '$true' : '$false'},
  [switch]$CancelJobs = ${cancel ? '$true' : '$false'}
)

$ErrorActionPreference = 'Continue'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)

$logPath = Join-Path $env:TEMP 'adnan-tech-printer-report.txt'
try { Start-Transcript -Path $logPath -Force | Out-Null } catch { }

Write-Host ''
Write-Host '=== Adnan Tech printer inventory ===' -ForegroundColor Cyan
Write-Host "Administrator: $isAdmin"
Write-Host "Report log: $logPath"

try {
  Get-Printer -ErrorAction Stop |
    Select-Object Name, DriverName, PortName, PrinterStatus, Shared, Published, Type |
    Format-Table -AutoSize
} catch {
  Write-Warning "Could not enumerate printers: $($_.Exception.Message)"
}

Write-Host ''
Write-Host '=== Printer ports ===' -ForegroundColor Cyan
try {
  Get-PrinterPort -ErrorAction Stop |
    Select-Object Name, Description, PrinterHostAddress, PortNumber, Protocol |
    Format-Table -AutoSize
} catch {
  Write-Warning "Could not enumerate printer ports: $($_.Exception.Message)"
}

Write-Host ''
Write-Host '=== Spooler service ===' -ForegroundColor Cyan
Get-Service -Name Spooler |
  Select-Object Name, Status, StartType, DisplayName |
  Format-Table -AutoSize

Write-Host ''
Write-Host '=== Queue and jobs ===' -ForegroundColor Cyan
$printers = if ($QueueName) {
  Get-Printer -Name $QueueName -ErrorAction SilentlyContinue
} else {
  Get-Printer -ErrorAction SilentlyContinue
}

if (-not $printers) {
  Write-Warning "No printer matched QueueName '$QueueName'."
} else {
  foreach ($printer in $printers) {
    Write-Host ''
    Write-Host "Printer: $($printer.Name) [$($printer.PrinterStatus)]" -ForegroundColor Yellow
    $jobs = Get-PrintJob -PrinterName $printer.Name -ErrorAction SilentlyContinue
    if ($jobs) {
      $jobs |
        Select-Object Id, DocumentName, UserName, SubmittedTime, JobStatus, PagesPrinted, TotalPages |
        Format-Table -AutoSize
    } else {
      Write-Host '  No queued jobs.'
    }
  }
}

if ($CancelJobs) {
  Write-Host ''
  Write-Host '=== Canceling jobs ===' -ForegroundColor Red
  if (-not $isAdmin) {
    Write-Warning 'Canceling jobs requires an elevated PowerShell window.'
  } elseif (-not $printers) {
    Write-Warning 'No printer matched; nothing to cancel.'
  } else {
    foreach ($printer in $printers) {
      $jobs = Get-PrintJob -PrinterName $printer.Name -ErrorAction SilentlyContinue
      foreach ($job in $jobs) {
        try {
          Remove-PrintJob -PrinterName $printer.Name -ID $job.Id -ErrorAction Stop
          Write-Host "  Removed job $($job.Id) from $($printer.Name)."
        } catch {
          Write-Warning "  Could not remove job $($job.Id): $($_.Exception.Message)"
        }
      }
    }
  }
}

if ($RestartSpooler) {
  Write-Host ''
  Write-Host '=== Restarting the print spooler ===' -ForegroundColor Red
  if (-not $isAdmin) {
    Write-Warning 'Restarting the spooler requires an elevated PowerShell window.'
  } else {
    try {
      Restart-Service -Name Spooler -Force -ErrorAction Stop
      Start-Sleep -Seconds 2
      Get-Service -Name Spooler | Select-Object Name, Status, StartType | Format-Table -AutoSize
      Write-Host 'Spooler restarted. Re-check the queue above or rerun this script.'
    } catch {
      Write-Warning "Could not restart the spooler: $($_.Exception.Message)"
    }
  }
}

Write-Host ''
Write-Host '=== Common checks ===' -ForegroundColor Cyan
Write-Host '1. If the printer is offline, verify USB/network cable, Wi-Fi and the printer IP.'
Write-Host '2. If jobs are stuck, cancel them and restart the spooler from an elevated prompt.'
Write-Host '3. If the queue keeps pausing, check "Use Printer Offline" and the driver version.'
Write-Host '4. For network printers, confirm TCP 631 (IPP), 9100 (raw) or 515 (LPD) is reachable.'

try { Stop-Transcript | Out-Null } catch { }
`
}
