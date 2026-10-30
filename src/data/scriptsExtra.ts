import type { ScriptTemplate } from '@/types'

const CREATED = '2026-10-23'

export const EXTRA_SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'script-cert-expiry-report',
    title: {
      en: 'Certificate expiry inventory (read-only)',
      ar: 'جرد انتهاء صلاحية الشهادات (للقراءة فقط)',
    },
    description: {
      en: 'Lists local machine certificates with subject, issuer, expiry and private-key status, and flags certificates expiring within 30 days. Makes no changes.',
      ar: 'يسرد شهادات الجهاز المحلي مع الموضوع والجهة المُصدرة والانتهاء وحالة المفتاح الخاص، وينبّه للشهادات المنتهية خلال 30 يوماً. لا يجري أي تغيير.',
    },
    language: 'powershell',
    risk: 'low',
    category: 'cybersecurity',
    code: `#requires -Version 5.1
<#
.SYNOPSIS
  Read-only certificate expiry inventory for the local machine store.
.DESCRIPTION
  Exports a CSV of certificates and prints those expiring within 30 days.
  Does not export private keys and does not modify the certificate store.
.NOTES
  Risk: LOW (read-only). Review the CSV before sharing; subjects may contain hostnames.
#>
[CmdletBinding()]
param(
  [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) "CertInventory-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"),
  [int]$WarnDays = 30
)

$now = Get-Date
$certificates = Get-ChildItem -Path Cert:\\LocalMachine\\My |
  ForEach-Object {
    $remaining = [math]::Floor(($_.NotAfter - $now).TotalDays)
    [pscustomobject]@{
      Subject        = $_.Subject
      Issuer         = $_.Issuer
      Thumbprint     = $_.Thumbprint
      NotBefore      = $_.NotBefore
      NotAfter       = $_.NotAfter
      DaysRemaining  = $remaining
      HasPrivateKey  = $_.HasPrivateKey
      Expired        = $_.NotAfter -lt $now
      ExpiringSoon   = $remaining -ge 0 -and $remaining -le $WarnDays
    }
  } |
  Sort-Object NotAfter

$certificates | Export-Csv -Path $OutputPath -NoTypeInformation -Encoding UTF8

Write-Host "Certificates written to: $OutputPath"
Write-Host "Expired or expiring within $WarnDays days:"
$certificates | Where-Object { $_.Expired -or $_.ExpiringSoon } |
  Format-Table Subject, NotAfter, DaysRemaining, HasPrivateKey -AutoSize`,
    requires: ['Windows PowerShell 5.1+ or PowerShell 7', 'Read access to Cert:\\LocalMachine\\My'],
    rollback: 'No changes are made. Delete the exported CSV to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
  {
    id: 'script-linux-evidence',
    title: {
      en: 'Linux incident evidence bundle (read-only)',
      ar: 'حزمة أدلة حادث Linux (للقراءة فقط)',
    },
    description: {
      en: 'Collects read-only host, disk, service, network and recent journal evidence into a timestamped archive for analysis.',
      ar: 'يجمع أدلة القراءة فقط للمضيف والقرص والخدمات والشبكة وسجل journal الحديث في أرشيف مؤرخ للتحليل.',
    },
    language: 'bash',
    risk: 'low',
    category: 'linux',
    code: `#!/usr/bin/env bash
# Read-only Linux incident evidence bundle.
# Does not change services, networking, users or files outside the output folder.
set -euo pipefail

OUT_DIR="\${1:-/tmp/adnan-tech-evidence-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$OUT_DIR"

run() {
  local name="$1"; shift
  "$@" >"$OUT_DIR/$name.txt" 2>&1 || echo "command failed: $*" >>"$OUT_DIR/$name.txt"
}

run uname uname -a
run uptime uptime
run os-release cat /etc/os-release
run disk-usage df -hT
run block-devices lsblk -f
run memory free -m
run failed-units systemctl --failed --no-pager
run listening-sockets ss -lntup
run addresses ip -brief address
run routes ip route
run recent-errors journalctl -p err -n 300 --no-pager

echo "Evidence written to: $OUT_DIR"
echo "Review before sharing: journals and socket lists may contain hostnames, usernames and addresses."
printf 'Archive with: tar -czf %s.tar.gz -C %s %s\n' "$OUT_DIR" "$(dirname "$OUT_DIR")" "$(basename "$OUT_DIR")"`,
    requires: ['Linux with systemd', 'bash 4+', 'Read access to journal and network state', 'Optional root for complete socket details'],
    rollback: 'No changes are made. Delete the output directory and archive to remove the artifact.',
    verification: 'template',
    createdAt: CREATED,
    version: '1.0.0',
  },
]
