import { describe, expect, it } from 'vitest'
import { isValidEmail, isValidPassword, isValidUsername } from '../src/lib/authValidation'

describe('registration field validation', () => {
  it('accepts usernames with letters, numbers and separators', () => {
    expect(isValidUsername('adnan_92')).toBe(true)
    expect(isValidUsername('دعم-فني')).toBe(true)
    expect(isValidUsername('  user.name  ')).toBe(true)
  })

  it('rejects short, long or spaced usernames', () => {
    expect(isValidUsername('ab')).toBe(false)
    expect(isValidUsername('a'.repeat(33))).toBe(false)
    expect(isValidUsername('bad name')).toBe(false)
    expect(isValidUsername('bad@name')).toBe(false)
  })

  it('validates email addresses and password length', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidPassword('12345678')).toBe(true)
    expect(isValidPassword('1234567')).toBe(false)
  })
})
