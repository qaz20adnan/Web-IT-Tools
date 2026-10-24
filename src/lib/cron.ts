export interface CronValidation {
  valid: boolean
  error?: string
  fields?: string[]
}

const LIMITS: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 6],
]

const NAMES: Record<number, string[]> = {
  3: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'],
  4: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
}

function parseValue(token: string, index: number): number | null {
  if (/^\d+$/.test(token)) return Number(token)
  const names = NAMES[index]
  if (names) {
    const upper = token.toUpperCase()
    const found = names.indexOf(upper)
    if (found >= 0) return index === 3 ? found + 1 : found
  }
  return null
}

function parseField(field: string, index: number): Set<number> | null {
  const [min, max] = LIMITS[index]
  const values = new Set<number>()
  for (const part of field.split(',')) {
    if (!part) return null
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1 || step > max) return null
    let start = min
    let end = max
    if (rangePart !== '*') {
      const [left, right] = rangePart.split('-')
      const leftValue = parseValue(left, index)
      if (leftValue === null) return null
      start = leftValue
      end = right === undefined ? leftValue : parseValue(right, index) ?? NaN
      if (Number.isNaN(end)) return null
    }
    if (start < min || end > max || start > end) return null
    for (let value = start; value <= end; value += step) values.add(value)
  }
  return values
}

export function validateCron(expression: string): CronValidation {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return { valid: false, error: 'Expected exactly 5 space-separated fields: minute hour day-of-month month day-of-week.' }
  for (let index = 0; index < 5; index += 1) {
    if (!parseField(fields[index], index)) return { valid: false, error: `Field ${index + 1} is not valid.` }
  }
  return { valid: true, fields }
}

export interface CronMatch {
  date: Date
}

export function nextCronRuns(expression: string, from: Date, count = 5): Date[] | null {
  const validation = validateCron(expression)
  if (!validation.valid || !validation.fields) return null
  const sets = validation.fields.map((field, index) => parseField(field, index))
  if (sets.some((set) => !set)) return null
  const [minutes, hours, days, months, weekdays] = sets as Set<number>[]
  const dayRestricted = validation.fields[2] !== '*'
  const weekdayRestricted = validation.fields[4] !== '*'

  const results: Date[] = []
  const cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = new Date(from.getTime() + 366 * 86_400_000)

  while (cursor <= limit && results.length < count) {
    if (!months.has(cursor.getMonth() + 1)) {
      cursor.setMonth(cursor.getMonth() + 1, 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    const dayMatches = days.has(cursor.getDate())
    const weekdayMatches = weekdays.has(cursor.getDay())
    const dateMatches =
      dayRestricted && weekdayRestricted ? dayMatches || weekdayMatches : dayRestricted ? dayMatches : weekdayRestricted ? weekdayMatches : true
    if (!dateMatches) {
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    if (!hours.has(cursor.getHours())) {
      cursor.setHours(cursor.getHours() + 1, 0, 0, 0)
      continue
    }
    if (!minutes.has(cursor.getMinutes())) {
      cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
      continue
    }
    results.push(new Date(cursor))
    cursor.setMinutes(cursor.getMinutes() + 1, 0, 0)
  }
  return results
}
