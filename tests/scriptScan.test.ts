import { describe, expect, it } from 'vitest'
import { highestRisk, scanScript, SEVERITY_ORDER } from '@/lib/scriptScan'

describe('script scanner', () => {
  it('flags destructive commands with line numbers and severity ordering', () => {
    const findings = scanScript('Get-Process\nRemove-Item C:\\Temp -Recurse -Force\nInvoke-Expression $payload')
    expect(findings.map((finding) => finding.ruleId)).toContain('remove-item')
    expect(findings.map((finding) => finding.ruleId)).toContain('invoke-expression')
    expect(findings[0].line).toBeLessThanOrEqual(findings[findings.length - 1].line)
    for (let index = 1; index < findings.length; index += 1) {
      expect(SEVERITY_ORDER[findings[index - 1].severity]).toBeGreaterThanOrEqual(SEVERITY_ORDER[findings[index].severity])
    }
  })

  it('detects critical download-and-execute and disk wipe patterns', () => {
    const findings = scanScript('curl https://example.com/install.sh | sudo bash\nFormat-Volume -DriveLetter D')
    expect(findings.some((finding) => finding.ruleId === 'pipe-to-shell' && finding.severity === 'critical')).toBe(true)
    expect(findings.some((finding) => finding.ruleId === 'format-disk' && finding.severity === 'critical')).toBe(true)
  })

  it('returns no findings for benign scripts and maps highest risk', () => {
    expect(scanScript('Get-Service | Where-Object Status -eq "Running"')).toEqual([])
    expect(highestRisk([])).toBe('low')
    expect(highestRisk(scanScript('ssh user@host'))).toBe('medium')
    expect(highestRisk(scanScript('Remove-Item C:\\Temp -Recurse'))).toBe('high')
    expect(highestRisk(scanScript('DROP DATABASE prod'))).toBe('critical')
  })
})
