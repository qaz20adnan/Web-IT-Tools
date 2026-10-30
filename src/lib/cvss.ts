export type CvssAttackVector = 'N' | 'A' | 'L' | 'P'
export type CvssAttackComplexity = 'L' | 'H'
export type CvssPrivilegesRequired = 'N' | 'L' | 'H'
export type CvssUserInteraction = 'N' | 'R'
export type CvssScope = 'U' | 'C'
export type CvssImpact = 'H' | 'L' | 'N'
export type CvssSeverity = 'None' | 'Low' | 'Medium' | 'High' | 'Critical'

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

export function cvssSeverity(score: number): CvssSeverity {
  if (score <= 0) return 'None'
  if (score < 3.5) return 'Low'
  if (score < 7) return 'Medium'
  if (score < 9) return 'High'
  return 'Critical'
}

export function calculateCvss(vector: CvssVector): { baseScore: number; severity: CvssSeverity; vector: string; impact: number; exploitability: number } {
  const scopeChanged = vector.S === 'C'
  const iss = 1 - (1 - IMPACT[vector.C]) * (1 - IMPACT[vector.I]) * (1 - IMPACT[vector.A])
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss
  const exploitability = 8.22 * AV[vector.AV] * AC[vector.AC] * privilegeWeight(vector.PR, scopeChanged) * UI[vector.UI]
  const raw = impact <= 0 ? 0 : scopeChanged ? Math.min(1.08 * (impact + exploitability), 10) : Math.min(impact + exploitability, 10)
  const baseScore = roundUp(raw)
  return { baseScore, severity: cvssSeverity(baseScore), vector: cvssVectorString(vector), impact: Number(impact.toFixed(2)), exploitability: Number(exploitability.toFixed(2)) }
}

export type CvssMetric = keyof CvssVector

export interface ParsedCvssVector {
  vector: CvssVector
  /** Metrics that were absent or invalid in the input and therefore fell back to a default. */
  defaulted: CvssMetric[]
}

const CVSS_METRICS: Array<{ key: CvssMetric; allowed: readonly string[]; fallback: string }> = [
  { key: 'AV', allowed: ['N', 'A', 'L', 'P'], fallback: 'N' },
  { key: 'AC', allowed: ['L', 'H'], fallback: 'L' },
  { key: 'PR', allowed: ['N', 'L', 'H'], fallback: 'N' },
  { key: 'UI', allowed: ['N', 'R'], fallback: 'N' },
  { key: 'S', allowed: ['U', 'C'], fallback: 'U' },
  { key: 'C', allowed: ['H', 'L', 'N'], fallback: 'N' },
  { key: 'I', allowed: ['H', 'L', 'N'], fallback: 'N' },
  { key: 'A', allowed: ['H', 'L', 'N'], fallback: 'N' },
]

export function parseCvssVector(value: string): ParsedCvssVector | null {
  const trimmed = value.trim().replace(/^CVSS:3\.[01]\//i, '')
  if (!trimmed) return null
  const parts = Object.fromEntries(trimmed.split('/').map((part) => part.split(':'))) as Record<string, string>
  const values: Record<string, string> = {}
  const defaulted: CvssMetric[] = []
  for (const metric of CVSS_METRICS) {
    const provided = parts[metric.key]
    if (provided && metric.allowed.includes(provided)) values[metric.key] = provided
    else {
      values[metric.key] = metric.fallback
      defaulted.push(metric.key)
    }
  }
  return { vector: values as unknown as CvssVector, defaulted }
}

