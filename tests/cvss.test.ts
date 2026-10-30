import { describe, expect, it } from 'vitest'
import { calculateCvss, cvssSeverity, cvssVectorString, DEFAULT_CVSS, parseCvssVector } from '@/lib/cvss'

describe('CVSS v3.1', () => {
  it('scores the default network vector as critical 9.8', () => {
    const result = calculateCvss(DEFAULT_CVSS)
    expect(result.baseScore).toBe(9.8)
    expect(result.severity).toBe('Critical')
    expect(result.vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
  })

  it('bands scores on the official v3.1 boundaries', () => {
    expect(cvssSeverity(0)).toBe('None')
    expect(cvssSeverity(0.1)).toBe('Low')
    expect(cvssSeverity(3.4)).toBe('Low')
    expect(cvssSeverity(3.5)).toBe('Medium')
    expect(cvssSeverity(6.9)).toBe('Medium')
    expect(cvssSeverity(7)).toBe('High')
    expect(cvssSeverity(8.9)).toBe('High')
    expect(cvssSeverity(9)).toBe('Critical')
    expect(cvssSeverity(10)).toBe('Critical')
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
    expect(parsed).not.toBeNull()
    expect(parsed!.vector).toMatchObject({ AV: 'L', AC: 'H', PR: 'H', UI: 'R', C: 'L', I: 'L', A: 'N' })
    expect(parsed!.defaulted).toEqual([])
    expect(cvssVectorString(parseCvssVector('AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')!.vector)).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
  })

  it('reports missing and invalid metrics instead of defaulting silently', () => {
    const partial = parseCvssVector('AV:N/AC:L')
    expect(partial!.vector.AV).toBe('N')
    expect(partial!.defaulted).toEqual(['PR', 'UI', 'S', 'C', 'I', 'A'])
    expect(parseCvssVector('AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')!.defaulted).toEqual(['AV'])
    expect(parseCvssVector('')).toBeNull()
  })
})

