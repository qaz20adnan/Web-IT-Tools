import { describe, expect, it } from 'vitest'
import {
  SETGID,
  SETUID,
  STICKY,
  parseOctal,
  parseSymbolic,
  toOctal,
  toSymbolic,
  type FileKind,
} from '@/lib/permissions'

const KINDS: FileKind[] = ['file', 'dir', 'link']

describe('octal parsing', () => {
  it('accepts three and four octal digits', () => {
    expect(parseOctal('0755')).toBe(0o755)
    expect(parseOctal('755')).toBe(0o755)
    expect(parseOctal('4755')).toBe(0o4755)
    expect(parseOctal('0000')).toBe(0)
  })

  it('rejects anything that is not three or four octal digits', () => {
    expect(parseOctal('0789')).toBeNull()
    expect(parseOctal('75')).toBeNull()
    expect(parseOctal('07555')).toBeNull()
    expect(parseOctal('')).toBeNull()
  })
})

describe('symbolic to octal', () => {
  it.each([
    ['0755', '-rwxr-xr-x'],
    ['0644', '-rw-r--r--'],
    ['4755', '-rwsr-xr-x'],
    ['2755', '-rwxr-sr-x'],
    ['1777', 'drwxrwxrwt'],
    ['6644', '-rwSr-Sr--'],
    ['0000', '----------'],
    ['7777', '-rwsrwsrwt'],
    ['644', '-rw-r--r--'],
    ['0777', '-rwxrwxrwx'],
    ['0750', '-rwxr-x---'],
    ['1644', '-rw-r--r-T'],
  ])('parses %s as %s', (octal, symbolic) => {
    const parsed = parseSymbolic(symbolic)
    expect(parsed).not.toBeNull()
    expect(parsed!.mode).toBe(parseInt(octal, 8))
    expect(toSymbolic(parseOctal(octal)!, parsed!.kind ?? 'file')).toBe(symbolic)
  })

  it('places special bits as absolute values, never shifted', () => {
    expect(parseSymbolic('-rwsr-xr-x')!.mode).toBe(0o4755)
    expect(parseSymbolic('-rwsrwxrwx')!.mode).toBeLessThanOrEqual(0o7777)
    expect(parseSymbolic('-rwsrwsrwt')!.mode).toBe(0o7777)
    expect(parseSymbolic('-rwsrwsrwt')!.mode & SETUID).toBe(SETUID)
    expect(parseSymbolic('-rwsrwsrwt')!.mode & SETGID).toBe(SETGID)
    expect(parseSymbolic('-rwsrwsrwt')!.mode & STICKY).toBe(STICKY)
  })

  it('remembers the leading type character', () => {
    expect(parseSymbolic('drwxr-xr-x')!.kind).toBe('dir')
    expect(parseSymbolic('lrwxrwxrwx')!.kind).toBe('link')
    expect(parseSymbolic('-rw-r--r--')!.kind).toBe('file')
    expect(parseSymbolic('rw-r--r--')!.kind).toBeNull()
  })

  it('rejects malformed symbolic modes', () => {
    expect(parseSymbolic('-rwSr--S--')).toBeNull()
    expect(parseSymbolic('-rwxr-xr')).toBeNull()
    expect(parseSymbolic('-rwxr-xrq')).toBeNull()
    expect(parseSymbolic('-rwxr-xr-xx')).toBeNull()
    expect(parseSymbolic('zrwxr-xr-x')).toBeNull()
    expect(parseSymbolic('')).toBeNull()
  })
})

describe('round trips', () => {
  it('reproduces every base mode 0000-0777 through symbolic text', () => {
    for (let base = 0o0000; base <= 0o777; base += 1) {
      for (const kind of KINDS) {
        const symbolic = toSymbolic(base, kind)
        const parsed = parseSymbolic(symbolic)
        expect(parsed, symbolic).not.toBeNull()
        expect(toSymbolic(parsed!.mode, kind), symbolic).toBe(symbolic)
        expect(parsed!.mode).toBe(base)
      }
    }
  })

  it('reproduces every mode including special bits 0000-7777', () => {
    for (let mode = 0o0000; mode <= 0o7777; mode += 1) {
      const symbolic = toSymbolic(mode, 'file')
      expect(parseSymbolic(symbolic)!.mode, symbolic).toBe(mode)
      expect(parseOctal(toOctal(mode)), symbolic).toBe(mode)
    }
  })
})
