export type CapacitySystem = 'binary' | 'decimal'

export interface LocalizedText {
  en: string
  ar: string
}

export interface CapacityUnit {
  symbol: string
  name: LocalizedText
  system: CapacitySystem
  exponent: number
  factor: number
}

function unit(symbol: string, en: string, ar: string, system: CapacitySystem, exponent: number): CapacityUnit {
  return { symbol, name: { en, ar }, system, exponent, factor: (system === 'binary' ? 1024 : 1000) ** exponent }
}

export const BYTE_UNIT: CapacityUnit = unit('B', 'Byte', 'بايت', 'decimal', 0)

export const CAPACITY_UNITS: CapacityUnit[] = [
  BYTE_UNIT,
  unit('KiB', 'Kibibyte', 'كيبي بايت', 'binary', 1),
  unit('MiB', 'Mebibyte', 'ميبي بايت', 'binary', 2),
  unit('GiB', 'Gibibyte', 'جيبي بايت', 'binary', 3),
  unit('TiB', 'Tebibyte', 'تيبي بايت', 'binary', 4),
  unit('PiB', 'Pebibyte', 'بيبي بايت', 'binary', 5),
  unit('KB', 'Kilobyte', 'كيلوبايت', 'decimal', 1),
  unit('MB', 'Megabyte', 'ميغابايت', 'decimal', 2),
  unit('GB', 'Gigabyte', 'جيغابايت', 'decimal', 3),
  unit('TB', 'Terabyte', 'تيرابايت', 'decimal', 4),
  unit('PB', 'Petabyte', 'بيتابايت', 'decimal', 5),
]

const ALIASES: Record<string, { symbol: string; ambiguous?: boolean }> = {
  b: { symbol: 'B' },
  byte: { symbol: 'B' },
  bytes: { symbol: 'B' },
  kib: { symbol: 'KiB' },
  mib: { symbol: 'MiB' },
  gib: { symbol: 'GiB' },
  tib: { symbol: 'TiB' },
  pib: { symbol: 'PiB' },
  kb: { symbol: 'KB' },
  mb: { symbol: 'MB' },
  gb: { symbol: 'GB' },
  tb: { symbol: 'TB' },
  pb: { symbol: 'PB' },
  k: { symbol: 'KB', ambiguous: true },
  m: { symbol: 'MB', ambiguous: true },
  g: { symbol: 'GB', ambiguous: true },
  t: { symbol: 'TB', ambiguous: true },
  p: { symbol: 'PB', ambiguous: true },
}

export function unitFor(symbol: string): CapacityUnit | null {
  const key = symbol.trim().toLowerCase()
  const alias = ALIASES[key]
  const target = alias ? alias.symbol.toLowerCase() : key
  return CAPACITY_UNITS.find((entry) => entry.symbol.toLowerCase() === target) ?? null
}

export function aliasIsAmbiguous(symbol: string): boolean {
  return Boolean(ALIASES[symbol.trim().toLowerCase()]?.ambiguous)
}

export function toBytes(value: number, symbol: string): number | null {
  const unitEntry = unitFor(symbol)
  if (!unitEntry || !Number.isFinite(value) || value < 0) return null
  return value * unitEntry.factor
}

export function fromBytes(bytes: number, symbol: string): number | null {
  const unitEntry = unitFor(symbol)
  if (!unitEntry || !Number.isFinite(bytes) || bytes < 0) return null
  return bytes / unitEntry.factor
}

export interface ParsedCapacity {
  bytes: number
  value: number
  unit: CapacityUnit
  ambiguous: boolean
}

export function parseCapacity(text: string): ParsedCapacity | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes(',') && !trimmed.includes('.') ? trimmed.replace(',', '.') : trimmed
  const pattern = normalized.match(/^([0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z]*)$/)
  if (!pattern) return null
  const value = Number(pattern[1])
  if (!Number.isFinite(value) || value < 0) return null
  const symbol = pattern[2] || 'B'
  const unitEntry = unitFor(symbol)
  if (!unitEntry) return null
  return { bytes: value * unitEntry.factor, value, unit: unitEntry, ambiguous: aliasIsAmbiguous(symbol) }
}

export interface CapacityRow {
  unit: CapacityUnit
  value: number
}

export function capacityTable(bytes: number): CapacityRow[] {
  if (!Number.isFinite(bytes) || bytes < 0) return []
  return CAPACITY_UNITS.map((entry) => ({ unit: entry, value: bytes / entry.factor }))
}

export function largestUnitAtLeastOne(bytes: number, system: CapacitySystem): CapacityRow {
  const rows = capacityTable(bytes).filter((row) => row.unit.system === system && row.value >= 1)
  return rows.reduce<CapacityRow>((best, row) => (row.unit.exponent > best.unit.exponent ? row : best), {
    unit: BYTE_UNIT,
    value: bytes,
  })
}

export function formatCapacity(bytes: number, system: CapacitySystem, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const row = largestUnitAtLeastOne(bytes, system)
  return `${row.value.toFixed(decimals)} ${row.unit.symbol}`
}

export interface SystemDivergence {
  exponent: number
  binaryUnit: CapacityUnit
  decimalUnit: CapacityUnit
  binaryValue: number
  decimalValue: number
  shortfallPercent: number
  labelGapBytes: number
}

export function divergence(bytes: number): SystemDivergence | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null
  const binary = largestUnitAtLeastOne(bytes, 'binary')
  const decimal = largestUnitAtLeastOne(bytes, 'decimal')
  const exponent = Math.max(binary.unit.exponent, decimal.unit.exponent)
  if (exponent === 0) return null
  const binaryUnit = CAPACITY_UNITS.find((entry) => entry.system === 'binary' && entry.exponent === exponent) as CapacityUnit
  const decimalUnit = CAPACITY_UNITS.find((entry) => entry.system === 'decimal' && entry.exponent === exponent) as CapacityUnit
  const binaryValue = bytes / binaryUnit.factor
  const decimalValue = bytes / decimalUnit.factor
  return {
    exponent,
    binaryUnit,
    decimalUnit,
    binaryValue,
    decimalValue,
    shortfallPercent: (1 - binaryValue / decimalValue) * 100,
    labelGapBytes: decimalValue * binaryUnit.factor - bytes,
  }
}
