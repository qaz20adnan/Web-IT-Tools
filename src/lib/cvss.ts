export type CvssAttackVector = 'N' | 'A' | 'L' | 'P'
export type CvssAttackComplexity = 'L' | 'H'
export type CvssPrivilegesRequired = 'N' | 'L' | 'H'
export type CvssUserInteraction = 'N' | 'R'
export type CvssScope = 'U' | 'C'
export type CvssImpact = 'H' | 'L' | 'N'

export interface CvssVector {
  AV: CvssAttackVector
  AC: CvssAttackComplexity
  PR: CvssPrivilegesRequired
  UI: CvssUserInteraction
  S: CvssScope
  C: CvssImpact
  I: CvssImpact
  A: CvssImpact
}

export const DEFAULT_CVSS: CvssVector = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H' }

const AV: Record<CvssAttackVector, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }
const AC: Record<CvssAttackComplexity, number> = { L: 0.77, H: 0.44 }
const UI: Record<CvssUserInteraction, number> = { N: 0.85, R: 0.62 }
const IMPACT: Record<CvssImpact, number> = { H: 0.56, L: 0.22, N: 0 }

function privilegeWeight(value: CvssPrivilegesRequired, scopeChanged: boolean): number {
  if (value === 'N') return 0.85
  if (value === 'L') return scopeChanged ? 0.68 : 0.62
  return scopeChanged ? 0.5 : 0.27
}

function roundUp(value: number): number {
  const rounded = Math.round(value * 100000) / 100000
  return Math.ceil(rounded * 10) / 10
}

export function cvssVectorString(vector: CvssVector): string {
  return `CVSS:3.1/AV:${vector.AV}/AC:${vector.AC}/PR:${vector.PR}/UI:${vector.UI}/S:${vector.S}/C:${vector.C}/I:${vector.I}/A:${vector.A}`
}

export function calculateCvss(vector: CvssVector): { baseScore: number; severity: string; vector: string; impact: number; exploitability: number } {
  const scopeChanged = vector.S === 'C'
  const iss = 1 - (1 - IMPACT[vector.C]) * (1 - IMPACT[vector.I]) * (1 - IMPACT[vector.A])
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss
  const exploitability = 8.22 * AV[vector.AV] * AC[vector.AC] * privilegeWeight(vector.PR, scopeChanged) * UI[vector.UI]
  const raw = impact <= 0 ? 0 : scopeChanged ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10)
  const baseScore = roundUp(raw)
  const severity =
    baseScore === 0 ? 'None' : baseScore < 4 ? 'Low' : baseScore < 7 ? 'Medium' : baseScore < 9 ? 'High' : 'Critical'
  return { baseScore, severity, vector: cvssVectorString(vector), impact: Number(impact.toFixed(2)), exploitability: Number(exploitability.toFixed(2)) }
}

export function parseCvssVector(value: string): CvssVector | null {
  const trimmed = value.trim().replace(/^CVSS:3\.[01]\//i, '')
  const parts = Object.fromEntries(trimmed.split('/').map((part) => part.split(':'))) as Record<string, string>
  const pick = <T extends string>(key: string, allowed: readonly T[]): T | null => {
    const entry = parts[key] as T | undefined
    return entry && allowed.includes(entry) ? entry : null
  }
  const vector: CvssVector = {
    AV: pick('AV', ['N', 'A', 'L', 'P'] as const) ?? 'N',
    AC: pick('AC', ['L', 'H'] as const) ?? 'L',
    PR: pick('PR', ['N', 'L', 'H'] as const) ?? 'N',
    UI: pick('UI', ['N', 'R'] as const) ?? 'N',
    S: pick('S', ['U', 'C'] as const) ?? 'U',
    C: pick('C', ['H', 'L', 'N'] as const) ?? 'N',
    I: pick('I', ['H', 'L', 'N'] as const) ?? 'N',
    A: pick('A', ['H', 'L', 'N'] as const) ?? 'N',
  }
  if (Object.keys(parts).length === 0) return null
  return vector
}
