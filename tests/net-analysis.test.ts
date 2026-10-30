import { describe, expect, it } from 'vitest'
import {
  buildAnalyzerReport,
  buildCauses,
  buildRecommendations,
  detectService,
  isCgnat,
  nameAnalysis,
  portService,
  type AnalyzerReportInput,
  type NameResolution,
  type PortProbeResult,
  type ProbeSourceInfo,
} from '../netlify/lib/net-analysis'

/**
 * A real deployment egress address. Nothing in a report may present it as the
 * visitor's own public IP, which is the bug these tests guard.
 */
const probeSource: ProbeSourceInfo = {
  ipv4: '18.223.102.247',
  ipv6: null,
  country: 'US',
  colo: 'CMH',
  source: 'cloudflare-trace',
}

const name: NameResolution = { host: 'home.test', ipv4: ['8.8.8.8'], ipv6: [], lowestTtl: 300, error: null }

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
    probeSource,
    name,
    expectedIp: null,
    target: { host: 'home.test', address: '8.8.8.8' },
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
    expect(isCgnat('')).toBe(false)
  })

  it('maps known ports and detects banners', () => {
    expect(portService(443)).toBe('HTTPS')
    expect(portService(3389)).toBe('RDP')
    expect(portService(9999)).toBeNull()
    expect(detectService(22, 'SSH-2.0-OpenSSH_9.6')).toBe('SSH')
    expect(detectService(8080, 'HTTP/1.1 200 OK')).toBe('HTTP')
    expect(detectService(8080, 'Server: nginx/1.25')).toBe('HTTP (nginx)')
  })

  it('classifies name resolution states', () => {
    expect(nameAnalysis(null, null, 'en').status).toBe('not_provided')
    expect(nameAnalysis({ host: 'home.test', ipv4: [], ipv6: [], lowestTtl: null, error: 'no A record' }, null, 'en').status).toBe('unresolved')
    expect(nameAnalysis(name, null, 'en').status).toBe('resolved')
    expect(nameAnalysis(name, '8.8.8.8', 'en').status).toBe('match')
    expect(nameAnalysis(name, '1.1.1.1', 'en').status).toBe('mismatch')
    expect(nameAnalysis({ ...name, ipv6: ['2001:4860:4860::8888'] }, '8.8.8.8', 'en').status).toBe('partial')
  })

  it('carries the resolver error into the unresolved state', () => {
    const state = nameAnalysis({ host: 'home.test', ipv4: [], ipv6: [], lowestTtl: null, error: 'No public resolver answered.' }, null, 'en')
    expect(state.detail).toContain('No public resolver answered.')
  })

  it('ranks a stale record as the likely cause when the address drifts', () => {
    const causes = buildCauses(input({ expectedIp: '1.1.1.1' }))
    expect(causes[0]?.id).toBe('ddns-stale')
    expect(causes.some((cause) => cause.id === 'dynamic-lease')).toBe(true)
    expect(causes.some((cause) => cause.id === 'ont-reboot')).toBe(false)
  })

  it('does not invent change causes when the record is healthy', () => {
    const causes = buildCauses(input({ expectedIp: '8.8.8.8', ports: [probe(443, 'open')] }))
    expect(causes).toHaveLength(0)
  })

  it('separates a filtered sweep from a refused sweep', () => {
    const filtered = buildCauses(input({ ports: [probe(443, 'timeout')] }))
    expect(filtered[0]?.id).toBe('no-inbound')
    expect(filtered[0]?.likelihood).toBe('high')
    expect(filtered[0]?.explanation).toContain('dropped')

    const refused = buildCauses(input({ ports: [probe(443, 'closed')] }))
    expect(refused[0]?.explanation).toContain('refused')
  })

  it('raises risk for open high-risk ports and recommends closing them', () => {
    const data = input({ ports: [probe(3389, 'open'), probe(443, 'open')] })
    const report = buildAnalyzerReport(data)
    expect(report.riskLevel).toBe('high')
    expect(report.recommendations.join(' ')).toContain('3389')
    expect(report.causes.some((cause) => cause.id === 'unexpected-exposure')).toBe(true)
    expect(report.observations.find((entry) => entry.label === 'Open ports')?.tone).toBe('danger')
  })

  it('judges CGNAT on the probe target, not on the deployment egress', () => {
    const cgnat = input({
      name: { host: 'home.test', ipv4: ['100.100.1.1'], ipv6: [], lowestTtl: 60, error: null },
      target: { host: 'home.test', address: '100.100.1.1' },
    })
    const report = buildAnalyzerReport(cgnat)
    expect(report.riskLevel).toBe('medium')
    expect(report.headline).toContain('carrier-grade NAT')
    expect(report.recommendations.join(' ')).toContain('dedicated public IPv4')
    expect(buildCauses(cgnat)[0]?.id).toBe('cgnat')
    expect(buildRecommendations(cgnat).length).toBeGreaterThan(0)
  })

  it('reports an unresolved name without pretending a port sweep ran', () => {
    const missing = input({
      name: { host: 'gone.example', ipv4: [], ipv6: [], lowestTtl: null, error: 'The name returned no A or AAAA record.' },
      target: { host: 'gone.example', address: '' },
      ports: [],
    })
    const report = buildAnalyzerReport(missing)
    expect(report.riskLevel).toBe('medium')
    expect(report.headline).toContain('publishes no address')
    expect(report.summary).toContain('no TCP port was probed')
    expect(report.observations.find((entry) => entry.label === 'Open ports')?.value).toContain('nothing was probed')
    expect(report.markdown).toContain('No TCP port was probed')
    expect(report.causes.some((cause) => cause.id === 'name-missing')).toBe(true)
  })

  it('never presents the deployment egress as the visitor address', () => {
    const report = buildAnalyzerReport(input())
    expect(report.observations.map((entry) => entry.label)).not.toContain('Public IPv4')
    expect(report.observations.map((entry) => entry.label)).not.toContain('IPv4 العام')
    expect(report.summary).not.toContain(probeSource.ipv4 as string)
    expect(report.markdown).toContain('Probe origin (this platform, not the visitor)')
    expect(report.limitations.join(' ')).toContain("platform's address, not yours")
    expect(report.observations.find((entry) => entry.label === 'Probe origin (platform)')?.value).toContain('CMH')
  })

  it('recommends waiting for the published TTL', () => {
    expect(buildRecommendations(input()).join(' ')).toContain('300s')
  })

  it('builds a bilingual Markdown report with port evidence', () => {
    const english = buildAnalyzerReport(input())
    expect(english.markdown).toContain('# Adnan Tech DDNS & Port Analysis')
    expect(english.markdown).toContain('| 443 | closed |')
    expect(english.markdown).toContain('## Limitations')
    expect(english.markdown).toContain('Shortest TTL')

    const arabic = buildAnalyzerReport(input({ lang: 'ar' }))
    expect(arabic.markdown).toContain('# تحليل منصة عدنان تك لـ DDNS والمنافذ')
    expect(arabic.limitations.length).toBeGreaterThan(0)
    expect(arabic.observations[0]?.label).toBe('هدف الفحص')
    expect(arabic.observations[1]?.label).toBe('تحليل الاسم')
  })
})
