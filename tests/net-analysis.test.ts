import { describe, expect, it } from 'vitest'
import {
  buildAnalyzerReport,
  buildCauses,
  buildRecommendations,
  ddnsAnalysis,
  detectService,
  isCgnat,
  portService,
  type AnalyzerReportInput,
  type PortProbeResult,
  type PublicIpInfo,
} from '../netlify/lib/net-analysis'

const publicIp: PublicIpInfo = {
  ipv4: '8.8.8.8',
  ipv6: null,
  country: 'AE',
  colo: 'DXB',
  source: 'test',
}

function probe(port: number, state: PortProbeResult['state'], overrides: Partial<PortProbeResult> = {}): PortProbeResult {
  return {
    port,
    state,
    latencyMs: state === 'open' ? 12 : null,
    service: portService(port),
    banner: null,
    errorCode: state === 'closed' ? 'ECONNREFUSED' : null,
    ...overrides,
  }
}

function input(overrides: Partial<AnalyzerReportInput> = {}): AnalyzerReportInput {
  return {
    lang: 'en',
    checkedAt: '2026-10-23T10:00:00.000Z',
    publicIp,
    target: { host: '8.8.8.8', address: '8.8.8.8' },
    ddns: null,
    ports: [probe(80, 'closed'), probe(443, 'closed')],
    ...overrides,
  }
}

describe('net-analysis', () => {
  it('detects CGNAT only inside 100.64.0.0/10', () => {
    expect(isCgnat('100.64.0.1')).toBe(true)
    expect(isCgnat('100.127.255.254')).toBe(true)
    expect(isCgnat('100.63.255.255')).toBe(false)
    expect(isCgnat('100.128.0.1')).toBe(false)
    expect(isCgnat('8.8.8.8')).toBe(false)
    expect(isCgnat(null)).toBe(false)
  })

  it('maps known ports and detects banners', () => {
    expect(portService(443)).toBe('HTTPS')
    expect(portService(3389)).toBe('RDP')
    expect(portService(9999)).toBeNull()
    expect(detectService(22, 'SSH-2.0-OpenSSH_9.6')).toBe('SSH')
    expect(detectService(8080, 'HTTP/1.1 200 OK')).toBe('HTTP')
    expect(detectService(8080, 'Server: nginx/1.25')).toBe('HTTP (nginx)')
  })

  it('classifies DDNS states', () => {
    expect(ddnsAnalysis(publicIp, null, 'en').status).toBe('not_configured')
    expect(ddnsAnalysis(publicIp, { host: 'home.test', ipv4: [], ipv6: [], error: 'ENOTFOUND' }, 'en').status).toBe('unresolved')
    expect(ddnsAnalysis(publicIp, { host: 'home.test', ipv4: ['8.8.8.8'], ipv6: [], error: null }, 'en').status).toBe('match')
    expect(ddnsAnalysis(publicIp, { host: 'home.test', ipv4: ['1.1.1.1'], ipv6: [], error: null }, 'en').status).toBe('mismatch')
    expect(
      ddnsAnalysis(
        { ...publicIp, ipv6: '2001:4860:4860::8888' },
        { host: 'home.test', ipv4: ['8.8.8.8'], ipv6: [], error: null },
        'en',
      ).status,
    ).toBe('partial')
  })

  it('ranks a stale DDNS record as a likely cause', () => {
    const causes = buildCauses(
      input({
        ddns: { host: 'home.test', ipv4: ['1.1.1.1'], ipv6: [], error: null },
      }),
    )
    expect(causes[0]?.id).toBe('ddns-stale')
    expect(causes.some((cause) => cause.id === 'dynamic-lease')).toBe(true)
    expect(causes.some((cause) => cause.id === 'ont-reboot')).toBe(true)
  })

  it('raises risk for open high-risk ports and recommends closing them', () => {
    const data = input({ ports: [probe(3389, 'open'), probe(443, 'open')] })
    const report = buildAnalyzerReport(data)
    expect(report.riskLevel).toBe('high')
    expect(report.recommendations.join(' ')).toContain('3389')
    expect(report.causes.some((cause) => cause.id === 'unexpected-exposure')).toBe(true)
    expect(report.observations.find((entry) => entry.label === 'Open ports')?.tone).toBe('danger')
  })

  it('explains CGNAT and recommends a public address', () => {
    const cgnatIp: PublicIpInfo = { ...publicIp, ipv4: '100.100.1.1' }
    const data = input({ publicIp: cgnatIp, target: { host: '100.100.1.1', address: '100.100.1.1' } })
    const report = buildAnalyzerReport(data)
    expect(report.riskLevel).toBe('medium')
    expect(report.headline).toContain('carrier-grade NAT')
    expect(report.recommendations.join(' ')).toContain('dedicated public IPv4')
    expect(buildRecommendations(data).length).toBeGreaterThan(0)
  })

  it('builds a bilingual Markdown report with port evidence', () => {
    const english = buildAnalyzerReport(input())
    expect(english.markdown).toContain('# NEXORA DDNS & Port Analysis')
    expect(english.markdown).toContain('| 443 | closed |')
    expect(english.markdown).toContain('## Limitations')

    const arabic = buildAnalyzerReport(input({ lang: 'ar' }))
    expect(arabic.markdown).toContain('# تحليل NEXORA لـ DDNS والمنافذ')
    expect(arabic.limitations.length).toBeGreaterThan(0)
    expect(arabic.observations[0]?.label).toBe('IPv4 العام')
  })
})
