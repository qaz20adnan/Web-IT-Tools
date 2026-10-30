import { describe, expect, it } from 'vitest'
import {
  decodeTextBytes,
  extractPdfText,
  extractTextFromFile,
  isTextExtension,
  redactSensitiveData,
  scanSensitiveData,
} from '../src/lib/fileInspection'

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

describe('file text extraction', () => {
  it('decodes UTF-8 and UTF-16 text with BOMs', () => {
    expect(decodeTextBytes(bytes('hello')).text).toBe('hello')
    const encoded = new Uint8Array(2 + 4 * 2)
    encoded[0] = 0xff
    encoded[1] = 0xfe
    const text = 'test'
    for (let index = 0; index < text.length; index += 1) {
      encoded[2 + index * 2] = text.charCodeAt(index)
      encoded[3 + index * 2] = 0
    }
    expect(decodeTextBytes(encoded).text).toBe('test')
  })

  it('recognizes text extensions and refuses binary text files', () => {
    expect(isTextExtension('MD')).toBe(true)
    expect(isTextExtension('json')).toBe(true)
    expect(isTextExtension('exe')).toBe(false)
    const result = extractTextFromFile('notes.txt', new Uint8Array([0x00, 0x01, 0x02]))
    expect(result.kind).toBe('none')
    expect(result.note).toContain('binary content')
  })

  it('extracts basic literal text from an uncompressed PDF', () => {
    const pdf = `%PDF-1.4
1 0 obj << /Length 44 >> stream
BT /F1 12 Tf (Printer offline on floor 2) Tj ET
endstream endobj
%%EOF`
    const result = extractPdfText(bytes(pdf))
    expect(result.kind).toBe('pdf')
    expect(result.text).toContain('Printer offline on floor 2')
    expect(result.note).toContain('OCR')
  })

  it('reports image-only or compressed PDFs without inventing text', () => {
    const result = extractPdfText(bytes('%PDF-1.7\n% binary stream\n%%EOF'))
    expect(result.kind).toBe('none')
    expect(result.text).toBe('')
    expect(result.note).toContain('OCR')
  })
})

describe('sensitive data detection', () => {
  it('detects secrets, cards, emails, IPs, and password assignments', () => {
    const text = [
      'email: admin@example.com',
      'host 192.168.1.20',
      'card 4111 1111 1111 1111',
      'password=SuperSecret123',
      'key sk-abcdefghijklmnopqrstuvwx',
      'aws AKIAIOSFODNN7EXAMPLE',
    ].join('\n')
    const findings = scanSensitiveData(text)
    const kinds = findings.map((entry) => entry.kind)
    expect(kinds).toEqual(expect.arrayContaining(['email', 'ipv4', 'credit-card', 'password', 'api-key']))
    const serialized = JSON.stringify(findings)
    expect(serialized).not.toContain('admin@example.com')
    expect(serialized).not.toContain('SuperSecret123')
    expect(serialized).not.toContain('4111 1111 1111 1111')
  })

  it('does not treat arbitrary long numbers as credit cards', () => {
    const findings = scanSensitiveData('order 1234567890123 shipped')
    expect(findings.some((entry) => entry.kind === 'credit-card')).toBe(false)
  })

  it('redacts detected values while keeping the rest of the report', () => {
    const redacted = redactSensitiveData('Contact admin@example.com from 10.0.0.5 with token=abc12345')
    expect(redacted).toContain('[REDACTED:email]')
    expect(redacted).toContain('[REDACTED:ipv4]')
    expect(redacted).toContain('[REDACTED:password]')
    expect(redacted).not.toContain('admin@example.com')
    expect(redacted).not.toContain('abc12345')
  })
})
