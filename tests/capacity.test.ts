import { describe, expect, it } from 'vitest'
import {
  CAPACITY_UNITS,
  capacityTable,
  divergence,
  formatCapacity,
  fromBytes,
  largestUnitAtLeastOne,
  parseCapacity,
  toBytes,
  unitFor,
} from '@/lib/capacity'

describe('unit definitions', () => {
  it('keeps IEC binary and JEDEC decimal factors apart', () => {
    expect(toBytes(1, 'GiB')).toBe(1073741824)
    expect(toBytes(1, 'GB')).toBe(1000000000)
    expect(toBytes(1, 'KiB')).toBe(1024)
    expect(toBytes(1, 'KB')).toBe(1000)
    expect(toBytes(1, 'TiB')).toBe(1099511627776)
    expect(toBytes(1, 'TB')).toBe(1000000000000)
  })

  it('lists both families', () => {
    expect(CAPACITY_UNITS.filter((unit) => unit.system === 'binary').map((unit) => unit.symbol)).toEqual(['KiB', 'MiB', 'GiB', 'TiB', 'PiB'])
    expect(CAPACITY_UNITS.filter((unit) => unit.system === 'decimal').map((unit) => unit.symbol)).toEqual(['B', 'KB', 'MB', 'GB', 'TB', 'PB'])
  })

  it('resolves aliases case-insensitively', () => {
    expect(unitFor('gib')?.symbol).toBe('GiB')
    expect(unitFor('Mb')?.symbol).toBe('MB')
    expect(unitFor('GiB')?.factor).toBe(1024 ** 3)
    expect(unitFor('zz')).toBeNull()
  })
})

describe('parsing', () => {
  it('accepts human strings and plain numbers', () => {
    expect(parseCapacity('1.5TiB')?.bytes).toBe(1649267441664)
    expect(parseCapacity('4 TB')?.bytes).toBe(4000000000000)
    expect(parseCapacity('512 GB')?.unit.symbol).toBe('GB')
    expect(parseCapacity('2048')?.unit.symbol).toBe('B')
    expect(parseCapacity('1,5 GiB')?.bytes).toBe(1610612736)
  })

  it('marks a bare letter as an assumption, not a fact', () => {
    expect(parseCapacity('500G')?.ambiguous).toBe(true)
    expect(parseCapacity('500 GB')?.ambiguous).toBe(false)
  })

  it('rejects nonsense', () => {
    expect(parseCapacity('')).toBeNull()
    expect(parseCapacity('lots of bytes')).toBeNull()
    expect(parseCapacity('10 Qbit')).toBeNull()
    expect(parseCapacity('-5 GB')).toBeNull()
  })
})

describe('conversion', () => {
  it('round-trips through bytes', () => {
    for (const symbol of ['KiB', 'MiB', 'GiB', 'TiB', 'KB', 'MB', 'GB', 'TB']) {
      expect(fromBytes(toBytes(7.5, symbol) as number, symbol)).toBeCloseTo(7.5, 10)
    }
    expect(fromBytes(1073741824, 'GiB')).toBe(1)
    expect(toBytes(-1, 'GB')).toBeNull()
    expect(fromBytes(1, 'nope')).toBeNull()
  })

  it('shows the same size in every unit', () => {
    const rows = capacityTable(1073741824)
    expect(rows.find((row) => row.unit.symbol === 'GiB')?.value).toBe(1)
    expect(rows.find((row) => row.unit.symbol === 'GB')?.value).toBe(1.073741824)
    expect(rows.find((row) => row.unit.symbol === 'MiB')?.value).toBe(1024)
    expect(capacityTable(Number.NaN)).toEqual([])
  })

  it('picks a readable unit per system', () => {
    expect(largestUnitAtLeastOne(4000000000000, 'binary')).toMatchObject({ unit: { symbol: 'TiB' } })
    expect(largestUnitAtLeastOne(4000000000000, 'decimal').unit.symbol).toBe('TB')
    expect(formatCapacity(4000000000000, 'binary')).toBe('3.64 TiB')
    expect(formatCapacity(4000000000000, 'decimal')).toBe('4.00 TB')
    expect(formatCapacity(900, 'binary')).toBe('900 B')
  })
})

describe('binary versus decimal divergence', () => {
  it('explains a marketed 4 TB drive', () => {
    const gap = divergence(4000000000000)
    expect(gap).not.toBeNull()
    expect(gap?.decimalUnit.symbol).toBe('TB')
    expect(gap?.binaryUnit.symbol).toBe('TiB')
    expect(gap?.decimalValue).toBe(4)
    expect(gap?.binaryValue).toBeCloseTo(3.6379788071, 9)
    expect(gap?.shortfallPercent).toBeCloseTo(9.05, 2)
    expect(gap?.labelGapBytes).toBe(398046511104)
  })

  it('grows with the magnitude', () => {
    expect(divergence(1000000)?.shortfallPercent).toBeCloseTo(4.63, 2)
    expect(divergence(1000000000)?.shortfallPercent).toBeCloseTo(6.87, 2)
    expect(divergence(1024 ** 4)?.binaryValue).toBe(1)
    expect(divergence(1024 ** 4)?.decimalValue).toBeCloseTo(1.0995, 4)
  })

  it('has no meaningful gap below the kilo range', () => {
    expect(divergence(500)).toBeNull()
    expect(divergence(0)).toBeNull()
  })
})
