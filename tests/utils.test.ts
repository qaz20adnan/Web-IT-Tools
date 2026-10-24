import { describe, expect, it } from 'vitest'
import {
  clamp,
  csvEscape,
  dataUrlByteSize,
  escapeHtml,
  formatBytes,
  safeExternalUrl,
  truncate,
  uid,
} from '@/lib/utils'

describe('formatting helpers', () => {
  it('formats byte sizes and clamps values', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536, 0)).toBe('2 KB')
    expect(formatBytes(-1)).toBeTruthy()
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
  })

  it('escapes HTML and CSV safely', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('a,"b"\nc')).toBe('"a,""b""\nc"')
    expect(csvEscape(undefined)).toBe('')
  })

  it('truncates only when needed', () => {
    expect(truncate('short', 10)).toBe('short')
    const cut = truncate('a'.repeat(20), 5)
    expect(cut).toHaveLength(5)
    expect(cut.startsWith('aaaa')).toBe(true)
  })

  it('allows only http(s) external URLs', () => {
    expect(safeExternalUrl('https://learn.microsoft.com/en-us/')).toBe('https://learn.microsoft.com/en-us/')
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(safeExternalUrl('not a url')).toBeNull()
  })

  it('computes base64 payload size and unique ids', () => {
    expect(dataUrlByteSize('data:text/plain;base64,QUJD')).toBe(3)
    const first = uid('tool')
    const second = uid('tool')
    expect(first.startsWith('tool_')).toBe(true)
    expect(first).not.toBe(second)
  })
})
