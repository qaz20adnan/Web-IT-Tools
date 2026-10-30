export type TextExtractionKind = 'plain' | 'pdf' | 'none'

export interface TextExtraction {
  text: string
  kind: TextExtractionKind
  truncated: boolean
  note: string | null
}

export type SensitiveKind =
  | 'private-key'
  | 'api-key'
  | 'jwt'
  | 'credit-card'
  | 'email'
  | 'ipv4'
  | 'password'

export interface SensitiveFinding {
  kind: SensitiveKind
  count: number
  samples: string[]
}

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg', 'config', 'env',
  'md', 'markdown', 'rst', 'sql', 'html', 'htm', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'ps1', 'psm1', 'bat',
  'cmd', 'sh', 'bash', 'zsh', 'py', 'rb', 'go', 'java', 'cs', 'php', 'vbs', 'reg', 'properties', 'csv',
])

const MAX_EXTRACT_CHARS = 200_000
const MAX_TEXT_BYTES = 2 * 1024 * 1024

export function extensionOfName(name: string): string {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

export function isTextExtension(extension: string): boolean {
  return TEXT_EXTENSIONS.has(extension.toLowerCase())
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const pairs = Math.floor(bytes.length / 2)
  const units = new Uint16Array(pairs)
  for (let index = 0; index < pairs; index += 1) {
    const offset = index * 2
    units[index] = littleEndian
      ? bytes[offset] | (bytes[offset + 1] << 8)
      : (bytes[offset] << 8) | bytes[offset + 1]
  }
  return new TextDecoder('utf-16le').decode(units)
}

export function decodeTextBytes(bytes: Uint8Array, maxBytes = MAX_TEXT_BYTES): { text: string; truncated: boolean } {
  const truncated = bytes.length > maxBytes
  const sample = truncated ? bytes.slice(0, maxBytes) : bytes
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(sample.slice(3)), truncated }
  }
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
    return { text: decodeUtf16(sample.slice(2), true), truncated }
  }
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) {
    return { text: decodeUtf16(sample.slice(2), false), truncated }
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(sample), truncated }
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, char: string) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[char] ?? char))
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\\r?\n/g, '')
}

function decodeHexText(value: string): string {
  const hex = value.replace(/[^0-9a-f]/gi, '')
  if (hex.length < 4 || hex.length % 2 !== 0) return ''
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes.slice(2), false)
  return new TextDecoder('latin1').decode(bytes)
}

export function extractPdfText(bytes: Uint8Array): TextExtraction {
  const raw = new TextDecoder('latin1').decode(bytes)
  const chunks: string[] = []
  const literalPattern = /\(((?:\\.|[^\\()]){2,})\)\s*(?:Tj|TJ|'|")/g
  for (const match of raw.matchAll(literalPattern)) {
    const decoded = decodePdfLiteral(match[1]).trim()
    if (decoded) chunks.push(decoded)
  }
  const hexPattern = /<([0-9a-fA-F\s]{4,})>\s*Tj/g
  for (const match of raw.matchAll(hexPattern)) {
    const decoded = decodeHexText(match[1]).trim()
    if (decoded) chunks.push(decoded)
  }
  const text = chunks.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACT_CHARS)
  if (text.length > 20) {
    return {
      text,
      kind: 'pdf',
      truncated: text.length >= MAX_EXTRACT_CHARS,
      note: 'Basic text extracted from uncompressed PDF content streams. Compressed, scanned, or image-only PDFs require OCR, which this local analyzer does not perform.',
    }
  }
  return {
    text: '',
    kind: 'none',
    truncated: false,
    note: 'No readable text was found. This PDF may be compressed, scanned, or image-only; OCR is not available in this local analyzer.',
  }
}

export function extractTextFromFile(name: string, bytes: Uint8Array): TextExtraction {
  const extension = extensionOfName(name)
  if (extension === 'pdf') return extractPdfText(bytes)
  if (!isTextExtension(extension)) {
    return { text: '', kind: 'none', truncated: false, note: null }
  }
  const head = bytes.slice(0, 1000)
  if (head.includes(0) && !(head[0] === 0xff && head[1] === 0xfe) && !(head[0] === 0xfe && head[1] === 0xff)) {
    return { text: '', kind: 'none', truncated: false, note: 'The file has a text extension but binary content; no text was decoded.' }
  }
  const decoded = decodeTextBytes(bytes)
  const text = decoded.text.slice(0, MAX_EXTRACT_CHARS)
  return {
    text,
    kind: text.trim() ? 'plain' : 'none',
    truncated: decoded.truncated || decoded.text.length > MAX_EXTRACT_CHARS,
    note: decoded.truncated ? `Only the first ${(MAX_TEXT_BYTES / (1024 * 1024)).toFixed(0)} MB were decoded.` : null,
  }
}

function luhnValid(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index])
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }
  return sum % 10 === 0
}

function maskEmail(value: string): string {
  const [local, domain] = value.split('@')
  return `${local.slice(0, 1)}***@${domain ?? '***'}`
}

function maskSecret(value: string): string {
  const visible = value.slice(0, 4)
  return `${visible}${'*'.repeat(Math.max(4, Math.min(12, value.length - visible.length)))}`
}

function maskIp(value: string): string {
  const parts = value.split('.')
  return `${parts[0]}.${parts[1]}.${parts[2]}.***`
}

function maskCard(value: string): string {
  const digits = value.replace(/\D/g, '')
  return `**** **** **** ${digits.slice(-4)}`
}

interface PatternEntry {
  kind: SensitiveKind
  pattern: RegExp
  mask: (value: string) => string
  validate?: (value: string) => boolean
}

const PATTERNS: PatternEntry[] = [
  {
    kind: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]{0,4000}?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    mask: () => '[private key block]',
  },
  { kind: 'api-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g, mask: maskSecret },
  { kind: 'api-key', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, mask: maskSecret },
  { kind: 'api-key', pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, mask: maskSecret },
  { kind: 'api-key', pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, mask: maskSecret },
  { kind: 'api-key', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, mask: maskSecret },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, mask: maskSecret },
  { kind: 'credit-card', pattern: /\b(?:\d[ -]?){12,18}\d\b/g, mask: maskCard, validate: luhnValid },
  { kind: 'email', pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, mask: maskEmail },
  {
    kind: 'ipv4',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    mask: maskIp,
    validate: (value) => value.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255),
  },
  {
    kind: 'password',
    pattern: /\b(?:pass(?:word|wd|phrase)?|pwd|secret|token)\s*[:=]\s*["']?([^\s"',;]{4,})/gi,
    mask: () => '[redacted assignment]',
  },
]

export function scanSensitiveData(text: string): SensitiveFinding[] {
  if (!text) return []
  const findings: SensitiveFinding[] = []
  for (const entry of PATTERNS) {
    const samples = new Set<string>()
    let count = 0
    entry.pattern.lastIndex = 0
    for (const match of text.matchAll(entry.pattern)) {
      const value = entry.kind === 'password' ? match[1] : match[0]
      if (entry.validate && !entry.validate(value)) continue
      count += 1
      if (samples.size < 3) samples.add(entry.mask(value))
    }
    if (count > 0) findings.push({ kind: entry.kind, count, samples: [...samples] })
  }
  return findings.sort((a, b) => b.count - a.count)
}

export function redactSensitiveData(text: string): string {
  let output = text
  for (const entry of PATTERNS) {
    entry.pattern.lastIndex = 0
    output = output.replace(entry.pattern, (match, capture?: string) => {
      const value = entry.kind === 'password' ? capture ?? match : match
      if (entry.validate && !entry.validate(value)) return match
      return `[REDACTED:${entry.kind}]`
    })
  }
  return output
}
