import { describe, expect, it } from 'vitest'
import { buildPrinterAgentScript } from '@/lib/printer-agent'

describe('printer agent script', () => {
  it('generates a read-only inventory by default', () => {
    const script = buildPrinterAgentScript()
    expect(script).toContain('# NEXORA AI - local printer diagnostics and queue agent')
    expect(script).toContain('[switch]$RestartSpooler = $false')
    expect(script).toContain('[switch]$CancelJobs = $false')
    expect(script).toContain('Get-Printer')
    expect(script).toContain('Get-PrintJob')
    expect(script).toContain('Get-PrinterPort')
    expect(script).toContain('Get-Service -Name Spooler')
    expect(script).toContain('if ($CancelJobs)')
    expect(script).toContain('if ($RestartSpooler)')
  })

  it('opts in to cancel and restart explicitly', () => {
    const script = buildPrinterAgentScript({ restartSpooler: true, cancelJobs: true })
    expect(script).toContain('[switch]$RestartSpooler = $true')
    expect(script).toContain('[switch]$CancelJobs = $true')
    expect(script).toContain('Remove-PrintJob')
    expect(script).toContain('Restart-Service -Name Spooler -Force')
    expect(script).toContain('requires an elevated PowerShell window')
  })

  it('escapes queue names for PowerShell single-quoted strings', () => {
    const script = buildPrinterAgentScript({ queueName: "HP's Lab Printer" })
    expect(script).toContain("[string]$QueueName = 'HP''s Lab Printer'")
  })
})
