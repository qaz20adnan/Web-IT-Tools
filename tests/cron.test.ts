import { describe, expect, it } from 'vitest'
import { nextCronRuns, validateCron } from '@/lib/cron'

describe('cron validation', () => {
  it('accepts five-field expressions with lists, ranges and steps', () => {
    expect(validateCron('*/15 9-17 * * 1-5').valid).toBe(true)
    expect(validateCron('0 0 1,15 * *').valid).toBe(true)
    expect(validateCron('0 9 * JAN,MAR MON-FRI').valid).toBe(true)
  })

  it('accepts 7 as Sunday, the POSIX and vixie-cron spelling', () => {
    expect(validateCron('0 0 * * 7').valid).toBe(true)
    expect(validateCron('0 0 * * 5-7').valid).toBe(true)
  })

  it('rejects wrong field counts and out-of-range values', () => {
    expect(validateCron('* * * *').valid).toBe(false)
    expect(validateCron('60 * * * *').valid).toBe(false)
    expect(validateCron('* 24 * * *').valid).toBe(false)
    expect(validateCron('* * 0 * *').valid).toBe(false)
    expect(validateCron('* * * * 8').valid).toBe(false)
  })
})

describe('nextCronRuns', () => {
  it('returns the next weekday morning runs in local time', () => {
    const fridayMorning = new Date(2026, 9, 23, 10, 0, 0)
    const runs = nextCronRuns('0 9 * * 1-5', fridayMorning, 3)
    expect(runs).not.toBeNull()
    expect(runs!.map((date) => [date.getDay(), date.getHours(), date.getMinutes()])).toEqual([
      [1, 9, 0],
      [2, 9, 0],
      [3, 9, 0],
    ])
    expect(runs![0].getDate()).toBe(26)
  })

  it('handles steps and returns null for invalid expressions', () => {
    const runs = nextCronRuns('*/30 * * * *', new Date(2026, 0, 1, 10, 5, 0), 2)
    expect(runs!.map((date) => date.getMinutes())).toEqual([30, 0])
    expect(nextCronRuns('bad expression', new Date(), 3)).toBeNull()
  })

  it('treats weekday 7 as Sunday when scheduling', () => {
    const runs = nextCronRuns('0 0 * * 7', new Date(2026, 9, 23, 10, 0, 0), 2)
    expect(runs).not.toBeNull()
    expect(runs!.map((date) => [date.getDay(), date.getDate()])).toEqual([[0, 25], [0, 1]])
    expect(nextCronRuns('0 0 * * 0', new Date(2026, 9, 23, 10, 0, 0), 1)![0].getDay()).toBe(0)
  })
})
