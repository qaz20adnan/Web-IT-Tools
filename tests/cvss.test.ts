import { describe, expect, it } from 'vitest'
import { calculateCvss, cvssVectorString, DEFAULT_CVSS, parseCvssVector } from '@/lib/cvss'

describe('CVSS v3.1', () => {
  it('scores the default network vector as critical 9.8', () => {
    const result = calculateCvss(DEFAULT_CVSS)
    expect(result.baseScore).toBe(9.8)
    expect(result.severity).toBe('Critical')
    expect(result.vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
  })

  it('scores a changed-scope vector as 10.0', () => {
    const result = calculateCvss({ ...DEFAULT_CVSS, S: 'C' })
    expect(result.baseScore).toBe(10)
  })

  it('scores no impact as zero', () => {
    const result = calculateCvss({ ...DEFAULT_CVSS, C: 'N', I: 'N', A: 'N' })
    expect(result.baseScore).toBe(0)
    expect(result.severity).toBe('None')
  })

  it('parses vectors with and without the prefix', () => {
    const parsed = parseCvssVector('CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:L/A:N')
    expect(parsed).toMatchObject({ AV: 'L', AC: 'H', PR: 'H', UI: 'R', C: 'L', I: 'L', A: 'N' })
    expect(cvssVectorString(parseCvssVector('AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')!)).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
  })
})
