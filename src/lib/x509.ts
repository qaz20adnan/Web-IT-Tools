export type DerClass = 'universal' | 'application' | 'context' | 'private'

const CLASS_BY_BITS: DerClass[] = ['universal', 'application', 'context', 'private']

/** X.680 universal tag numbers (not identifier octets): SEQUENCE is 16, so the octet is 0x30. */
const U = {
  boolean: 0x01,
  integer: 0x02,
  bitString: 0x03,
  octetString: 0x04,
  null: 0x05,
  objectIdentifier: 0x06,
  enumerated: 0x0a,
  utf8String: 0x0c,
  sequence: 0x10,
  set: 0x11,
  numericString: 0x12,
  printableString: 0x13,
  t61String: 0x14,
  videotexString: 0x15,
  ia5String: 0x16,
  utcTime: 0x17,
  generalizedTime: 0x18,
  graphicString: 0x19,
  visibleString: 0x1a,
  generalString: 0x1c,
  bmpString: 0x1e,
} as const

export interface DerTlv {
  tagClass: DerClass
  constructed: boolean
  tag: number
  bytes: Uint8Array
  children: DerTlv[]
  childError: string | null
  start: number
  end: number
}

export type DerRead = { ok: true; tlv: DerTlv; next: number } | { ok: false; error: string }

const MAX_CONTENT_BYTES = 4_000_000
const MAX_PEM_BYTES = 1_500_000
const MAX_PEM_BLOCKS = 32

export type CertIssueCode =
  | 'empty-input'
  | 'too-large'
  | 'no-pem-block'
  | 'unclosed-block'
  | 'invalid-base64'
  | 'empty-body'
  | 'der-error'
  | 'structure-error'
  | 'unsupported-type'

export interface CertIssue {
  code: CertIssueCode
  detail: string
  block?: number
}

function issue(code: CertIssueCode, detail: string, block?: number): CertIssue {
  return { code, detail, block }
}

/* ------------------------------ DER reader ------------------------------ */

export function readTlv(bytes: Uint8Array, offset = 0): DerRead {
  if (offset < 0 || offset >= bytes.length) {
    return { ok: false, error: `no tag byte at offset ${offset} (buffer is ${bytes.length} bytes)` }
  }
  const first = bytes[offset]
  const tagClass = CLASS_BY_BITS[first >> 6]
  const constructed = (first & 0x20) !== 0
  let tag = first & 0x1f
  let pos = offset + 1

  if (tag === 0x1f) {
    tag = 0
    let octets = 0
    for (;;) {
      if (pos >= bytes.length) return { ok: false, error: 'high tag number cut off mid-buffer' }
      const octet = bytes[pos]
      pos += 1
      octets += 1
      if (octets > 4) return { ok: false, error: 'high tag number longer than 4 octets' }
      if (octets === 1 && (octet & 0x7f) < 0x1f) return { ok: false, error: 'non-minimal high tag number form' }
      tag = tag * 128 + (octet & 0x7f)
      if ((octet & 0x80) === 0) break
    }
  }

  if (tagClass === 'universal' && tag === 0) {
    return { ok: false, error: `reserved universal tag 0 (end-of-content) at offset ${offset}` }
  }

  if (pos >= bytes.length) return { ok: false, error: `no length byte after tag at offset ${offset}` }
  const lengthFirst = bytes[pos]
  pos += 1
  let length: number

  if (lengthFirst === 0x80) return { ok: false, error: 'indefinite length is BER only and not valid DER' }
  if (lengthFirst < 0x80) {
    length = lengthFirst
  } else {
    const count = lengthFirst & 0x7f
    if (count === 0 || count > 4) return { ok: false, error: `length of ${count} octets is not supported` }
    if (pos + count > bytes.length) return { ok: false, error: `length needs ${count} octets but the buffer ends at offset ${bytes.length}` }
    if (bytes[pos] === 0) return { ok: false, error: 'length has a leading zero octet' }
    length = 0
    for (let index = 0; index < count; index += 1) length = length * 256 + bytes[pos + index]
    pos += count
    if (length < 0x80) return { ok: false, error: 'non-minimal long form length' }
  }

  if (length > MAX_CONTENT_BYTES) return { ok: false, error: `content of ${length} bytes exceeds the ${MAX_CONTENT_BYTES} byte limit` }
  if (pos + length > bytes.length) {
    return { ok: false, error: `length ${length} exceeds the ${bytes.length - pos} bytes left after the header` }
  }

  const valueStart = pos
  const value = bytes.subarray(valueStart, valueStart + length)
  const tlv: DerTlv = {
    tagClass,
    constructed,
    tag,
    bytes: value,
    children: [],
    childError: null,
    start: offset,
    end: valueStart + length,
  }

  if (constructed) {
    const parsed = readTlvChildren(value)
    if (parsed.ok) tlv.children = parsed.children
    else tlv.childError = parsed.error
  }

  return { ok: true, tlv, next: valueStart + length }
}

function readTlvChildren(content: Uint8Array): { ok: true; children: DerTlv[] } | { ok: false; error: string } {
  const children: DerTlv[] = []
  let offset = 0
  while (offset < content.length) {
    const read = readTlv(content, offset)
    if (!read.ok) return { ok: false, error: `${read.error} (inside a constructed value)` }
    children.push(read.tlv)
    offset = read.next
  }
  return { ok: true, children }
}

export function parseDer(bytes: Uint8Array): { ok: true; tlv: DerTlv; trailing: number } | { ok: false; error: string } {
  const read = readTlv(bytes, 0)
  if (!read.ok) return read
  return { ok: true, tlv: read.tlv, trailing: bytes.length - read.next }
}

function parseDerSafe(bytes: Uint8Array): DerTlv | null {
  const parsed = parseDer(bytes)
  return parsed.ok ? parsed.tlv : null
}

function childAt(tlv: DerTlv | null, index: number): DerTlv | null {
  if (!tlv) return null
  return index >= 0 && index < tlv.children.length ? tlv.children[index] : null
}

function isUniversal<T extends number>(tlv: DerTlv | null, tag: T): tlv is DerTlv & { tag: T } {
  return tlv !== null && tlv.tagClass === 'universal' && tlv.tag === tag
}

const isSequence = (tlv: DerTlv | null): tlv is DerTlv & { tag: 16 } => isUniversal(tlv, U.sequence)
const isSet = (tlv: DerTlv | null): tlv is DerTlv & { tag: 17 } => isUniversal(tlv, U.set)

function isContextTag(tlv: DerTlv, tag: number): boolean {
  return tlv.tagClass === 'context' && tlv.tag === tag
}

export function tagLabel(tlv: DerTlv): string {
  if (tlv.tagClass === 'context') return `[${tlv.tag}]`
  if (tlv.tagClass === 'universal') {
    const name = Object.keys(U).find((key) => U[key as keyof typeof U] === tlv.tag)
    return name ? `${name} (0x${tlv.tag.toString(16)})` : `universal 0x${tlv.tag.toString(16)}`
  }
  return `${tlv.tagClass} ${tlv.tag}`
}

/* ------------------------------ value readers ------------------------------ */

export function decodeOid(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return null
  const arcs: number[] = []
  let accumulator = 0
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (index === 0) {
      if (byte > 0x7f) return null
      accumulator = byte
    } else {
      accumulator = accumulator * 128 + (byte & 0x7f)
      if (accumulator > 4_294_967_295) return null
    }
    if ((byte & 0x80) !== 0) continue
    if (index === 0) {
      const top = accumulator < 80 ? (accumulator < 40 ? 0 : 1) : 2
      arcs.push(top, accumulator - top * 40)
    } else {
      arcs.push(accumulator)
    }
    accumulator = 0
  }
  return arcs.join('.')
}

export function oidOf(tlv: DerTlv | null): string | null {
  if (!isUniversal(tlv, U.objectIdentifier)) return null
  return decodeOid(tlv.bytes)
}

export function integerBytes(tlv: DerTlv | null): Uint8Array | null {
  return isUniversal(tlv, U.integer) ? tlv.bytes : null
}

export function integerToHex(tlv: DerTlv | null): string | null {
  const raw = integerBytes(tlv)
  if (raw === null) return null
  if (raw.length === 0) return '0'
  const negative = (raw[0] & 0x80) !== 0
  const magnitude: number[] = []
  if (negative) {
    let carry = 1
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      const value = (~raw[index] & 0xff) + carry
      carry = value > 0xff ? 1 : 0
      magnitude.push(value & 0xff)
    }
    magnitude.reverse()
  } else {
    for (const byte of raw) magnitude.push(byte)
  }
  while (magnitude.length > 1 && magnitude[0] === 0) magnitude.shift()
  let hex = magnitude.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hex.startsWith('0')) hex = hex.slice(1)
  return negative ? `-${hex}` : hex
}

export function integerToNumber(tlv: DerTlv | null): number | null {
  const raw = integerBytes(tlv)
  if (raw === null || raw.length === 0 || raw.length > 6) return null
  let value = 0
  for (const byte of raw) value = value * 256 + byte
  if ((raw[0] & 0x80) !== 0) value -= Math.pow(256, raw.length)
  return value
}

function boolValue(tlv: DerTlv | null): boolean | null {
  if (!isUniversal(tlv, U.boolean)) return null
  return tlv.bytes.length > 0 && tlv.bytes[tlv.bytes.length - 1] !== 0
}

export function bitStringOf(tlv: DerTlv | null): { unusedBits: number; bytes: Uint8Array } | null {
  if (!tlv || tlv.constructed || !isUniversal(tlv, U.bitString)) return null
  if (tlv.bytes.length === 0) return { unusedBits: 0, bytes: new Uint8Array(0) }
  const unusedBits = tlv.bytes[0]
  if (unusedBits > 7) return null
  return { unusedBits, bytes: tlv.bytes.subarray(1) }
}

const STRING_TAGS: Record<number, { name: string; decoder: 'utf-8' | 'utf-16be' | 'ascii' }> = {
  [U.utf8String]: { name: 'UTF8String', decoder: 'utf-8' },
  [U.numericString]: { name: 'NumericString', decoder: 'ascii' },
  [U.printableString]: { name: 'PrintableString', decoder: 'ascii' },
  [U.t61String]: { name: 'T61String', decoder: 'utf-8' },
  [U.videotexString]: { name: 'VideotexString', decoder: 'utf-8' },
  [U.ia5String]: { name: 'IA5String', decoder: 'ascii' },
  [U.graphicString]: { name: 'GraphicString', decoder: 'utf-8' },
  [U.visibleString]: { name: 'VisibleString', decoder: 'ascii' },
  [U.generalString]: { name: 'GeneralString', decoder: 'utf-8' },
  [U.bmpString]: { name: 'BMPString', decoder: 'utf-16be' },
}

/** Certificate fields are attacker-controlled text: strip control and bidi override characters. */
export function sanitizeDisplayText(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0xfffd
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += ' '
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) out += '\uFFFD'
    else if ((code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0x200e || code === 0x200f || code === 0xfeff) out += '\uFFFD'
    else out += char
  }
  return out
}

export function stringOf(tlv: DerTlv | null): { text: string; kind: string } | null {
  if (!tlv || tlv.tagClass !== 'universal') return null
  const info = STRING_TAGS[tlv.tag]
  if (!info) return null
  let text: string
  if (info.decoder === 'utf-16be') {
    const usable = tlv.bytes.length % 2 === 0 ? tlv.bytes : tlv.bytes.subarray(0, tlv.bytes.length - 1)
    let units = ''
    for (let index = 0; index < usable.length; index += 2) units += String.fromCharCode((usable[index] << 8) | usable[index + 1])
    text = units
  } else {
    text = new TextDecoder(info.decoder, { fatal: false }).decode(tlv.bytes)
  }
  return { text: sanitizeDisplayText(text), kind: info.name }
}

function decodeText(tlv: DerTlv | null, fallback: 'utf-8' | 'ascii' = 'utf-8'): string {
  if (!tlv) return ''
  return sanitizeDisplayText(new TextDecoder(fallback, { fatal: false }).decode(tlv.bytes))
}

function parseAsnTime(tlv: DerTlv | null): { iso: string | null; epoch: number | null } {
  if (!isUniversal(tlv, U.utcTime) && !isUniversal(tlv, U.generalizedTime)) return { iso: null, epoch: null }
  const utc = tlv.tag === U.utcTime
  const raw = new TextDecoder('ascii', { fatal: false }).decode(tlv.bytes).trim()
  const pattern = utc
    ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(\d{2})?(Z|[+-]\d{4}|[+-]\d{2})?$/
    : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(\.\d+)?(Z|[+-]\d{4}|[+-]\d{2})?$/
  const match = raw.match(pattern)
  if (!match) return { iso: null, epoch: null }
  const groups = match.slice(1)
  let yearText = groups[0]
  if (utc) {
    const twoDigit = Number(yearText)
    yearText = String(twoDigit >= 50 ? 1900 + twoDigit : 2000 + twoDigit)
  }
  const year = Number(yearText)
  const month = Number(groups[1])
  const day = Number(groups[2])
  const hour = Number(groups[3])
  const minute = groups[4] ? Number(groups[4]) : 0
  const second = groups[5] ? Number(groups[5]) : 0
  const offsetText = groups[6]
  let offsetMinutes = 0
  if (offsetText && offsetText !== 'Z') {
    const sign = offsetText[0] === '-' ? -1 : 1
    const digits = offsetText.slice(1)
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0))
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return { iso: null, epoch: null }
  const epoch = Date.UTC(year, month - 1, day, hour, minute - offsetMinutes, second)
  if (!Number.isFinite(epoch)) return { iso: null, epoch: null }
  return { iso: new Date(epoch).toISOString(), epoch }
}

/* ------------------------------ OID tables ------------------------------ */

export const ATTRIBUTE_OIDS: Record<string, string> = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'STREET',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'TITLE',
  '2.5.4.13': 'DESCRIPTION',
  '2.5.4.15': 'BUSINESSCATEGORY',
  '2.5.4.16': 'POSTALADDRESS',
  '2.5.4.17': 'POSTALCODE',
  '2.5.4.18': 'POSTOFFICEBOX',
  '2.5.4.20': 'TELEPHONENUMBER',
  '2.5.4.41': 'NAME',
  '2.5.4.42': 'GIVENNAME',
  '2.5.4.43': 'SN',
  '2.5.4.44': 'X500UNIQUEIDENTIFIER',
  '2.5.4.45': 'SERIALNUMBER',
  '2.5.4.5': 'SERIALNUMBER',
  '2.5.4.54': 'DNQUALIFIER',
  '2.5.4.65': 'PSEUDONYM',
  '2.5.4.97': 'ORGID',
  '0.9.2342.19200300.100.1.1': 'DC',
  '0.9.2342.19200300.100.1.3': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.2.840.113549.1.9.1': 'EMAILADDRESS',
  '1.2.840.113549.1.9.2': 'UNSTRUCTUREDNAME',
  '1.2.840.113549.1.9.8': 'UNSTRUCTUREDIDENTIFIER',
  '1.3.6.1.4.1.311.20.2.3': 'UPN',
}

const SIGNATURE_OIDS: Record<string, { name: string; hash: string; flagged: boolean }> = {
  '1.2.840.113549.1.1.2': { name: 'md2WithRSAEncryption', hash: 'MD2', flagged: true },
  '1.2.840.113549.1.1.3': { name: 'md4WithRSAEncryption', hash: 'MD4', flagged: true },
  '1.2.840.113549.1.1.4': { name: 'md5WithRSAEncryption', hash: 'MD5', flagged: true },
  '1.2.840.113549.1.1.5': { name: 'sha1WithRSAEncryption', hash: 'SHA-1', flagged: true },
  '1.2.840.113549.1.1.11': { name: 'sha256WithRSAEncryption', hash: 'SHA-256', flagged: false },
  '1.2.840.113549.1.1.12': { name: 'sha384WithRSAEncryption', hash: 'SHA-384', flagged: false },
  '1.2.840.113549.1.1.13': { name: 'sha512WithRSAEncryption', hash: 'SHA-512', flagged: false },
  '1.2.840.113549.1.1.14': { name: 'sha224WithRSAEncryption', hash: 'SHA-224', flagged: false },
  '1.2.840.113549.1.1.15': { name: 'sha512-224WithRSAEncryption', hash: 'SHA-512/224', flagged: false },
  '1.2.840.113549.1.1.16': { name: 'sha512-256WithRSAEncryption', hash: 'SHA-512/256', flagged: false },
  '1.2.840.10045.4.1': { name: 'ecdsa-with-SHA1', hash: 'SHA-1', flagged: true },
  '1.2.840.10045.4.3.1': { name: 'ecdsa-with-SHA224', hash: 'SHA-224', flagged: false },
  '1.2.840.10045.4.3.2': { name: 'ecdsa-with-SHA256', hash: 'SHA-256', flagged: false },
  '1.2.840.10045.4.3.3': { name: 'ecdsa-with-SHA384', hash: 'SHA-384', flagged: false },
  '1.2.840.10045.4.3.4': { name: 'ecdsa-with-SHA512', hash: 'SHA-512', flagged: false },
  '1.2.840.113549.1.4.3': { name: 'dsa-with-sha1', hash: 'SHA-1', flagged: true },
  '1.2.840.10040.4.3': { name: 'dsa-with-sha1', hash: 'SHA-1', flagged: true },
  '2.16.840.1.101.3.4.3.1': { name: 'dsa-with-sha224', hash: 'SHA-224', flagged: false },
  '2.16.840.1.101.3.4.3.2': { name: 'dsa-with-sha256', hash: 'SHA-256', flagged: false },
  '1.3.101.112': { name: 'Ed25519', hash: 'SHA-512', flagged: false },
  '1.3.101.113': { name: 'Ed448', hash: 'SHAKE-256', flagged: false },
}

const HASH_OIDS: Record<string, string> = {
  '1.2.840.113549.2.2': 'MD2',
  '1.2.840.113549.2.4': 'MD4',
  '1.2.840.113549.2.5': 'MD5',
  '1.3.14.3.2.26': 'SHA-1',
  '2.16.840.1.101.3.4.2.1': 'SHA-256',
  '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512',
  '2.16.840.1.101.3.4.2.4': 'SHA-224',
  '2.16.840.1.101.3.4.2.5': 'SHA-512/224',
  '2.16.840.1.101.3.4.2.6': 'SHA-512/256',
}

const PUBLIC_KEY_OIDS: Record<string, string> = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.113549.1.1.22': 'DSA',
  '1.2.840.113549.1.3.1': 'DH',
  '1.2.840.10045.2.1': 'EC',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
}

const CURVE_OIDS: Record<string, { name: string; bits: number }> = {
  '1.2.840.10045.3.1.1': { name: 'prime192v1', bits: 192 },
  '1.2.840.10045.3.1.7': { name: 'P-256 (prime256v1)', bits: 256 },
  '1.3.132.0.1': { name: 'prime192v1', bits: 192 },
  '1.3.132.0.2': { name: 'prime192v2', bits: 192 },
  '1.3.132.0.3': { name: 'prime192v3', bits: 192 },
  '1.3.132.0.4': { name: 'sect233k1', bits: 233 },
  '1.3.132.0.5': { name: 'sect233r1', bits: 233 },
  '1.3.132.0.6': { name: 'sect283k1', bits: 283 },
  '1.3.132.0.7': { name: 'sect283r1', bits: 283 },
  '1.3.132.0.9': { name: 'sect409k1', bits: 409 },
  '1.3.132.0.10': { name: 'secp256k1', bits: 256 },
  '1.3.132.0.33': { name: 'secp224r1', bits: 224 },
  '1.3.132.0.34': { name: 'P-384 (secp384r1)', bits: 384 },
  '1.3.132.0.35': { name: 'P-521 (secp521r1)', bits: 521 },
  '1.3.36.3.3.2.8.1.1.7': { name: 'brainpoolP256r1', bits: 256 },
  '1.3.36.3.3.2.8.1.1.11': { name: 'brainpoolP384r1', bits: 384 },
  '1.3.36.3.3.2.8.1.1.13': { name: 'brainpoolP512r1', bits: 512 },
}

const KEY_USAGE_BITS = [
  'digitalSignature',
  'nonRepudiation / contentCommitment',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
]

const EKU_OIDS: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS Web Server Authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS Web Client Authentication',
  '1.3.6.1.5.5.7.3.3': 'Code Signing',
  '1.3.6.1.5.5.7.3.4': 'E-mail Protection',
  '1.3.6.1.5.5.7.3.8': 'Time Stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
  '1.3.6.1.5.5.7.3.10': 'DVCS',
  '1.3.6.1.5.5.7.3.11': 'ipsec IKE',
  '1.3.6.1.4.1.311.10.3.3': 'Microsoft Server Gated Crypto',
  '1.3.6.1.4.1.311.20.2.2': 'smartcard logon',
}

const POLICY_OIDS: Record<string, string> = {
  '2.23.140.1.1': 'CA/Browser Forum EV',
  '2.23.140.1.2.1': 'CA/Browser Forum Domain Validation',
  '2.23.140.1.2.2': 'CA/Browser Forum Organization Validation',
  '2.23.140.1.2.3': 'CA/Browser Forum Individual Validation',
  '2.23.140.1.4': 'CA/Browser Forum EV code signing',
  '2.23.140.1.5.1.1': 'CA/Browser Forum EV TLS signing',
}

const EXTENSION_OIDS: Record<string, string> = {
  '2.5.29.14': 'Subject Key Identifier',
  '2.5.29.15': 'Key Usage',
  '2.5.29.16': 'Private Key Usage Period',
  '2.5.29.17': 'Subject Alternative Name',
  '2.5.29.18': 'Issuer Alternative Name',
  '2.5.29.19': 'Basic Constraints',
  '2.5.29.20': 'CRL Number',
  '2.5.29.21': 'Reason Code',
  '2.5.29.23': 'Hold Instruction Code',
  '2.5.29.24': 'Invalidity Date',
  '2.5.29.29': 'Certificate Issuer',
  '2.5.29.30': 'Name Constraints',
  '2.5.29.31': 'CRL Distribution Points',
  '2.5.29.32': 'Certificate Policies',
  '2.5.29.33': 'Any Policy',
  '2.5.29.35': 'Authority Key Identifier',
  '2.5.29.36': 'Policy Constraints',
  '2.5.29.37': 'Extended Key Usage',
  '2.5.29.54': 'Inhibit Any Policy',
  '1.3.6.1.5.5.7.1.1': 'Authority Information Access',
  '1.3.6.1.5.5.7.1.2': 'Subject Information Access',
  '1.3.6.1.4.1.11129.2.4.2': 'Signed Certificate Timestamp (SCT)',
  '1.3.6.1.4.1.11129.2.4.3': 'OCSP No Check',
  '1.3.6.1.4.1.311.20.2': 'Microsoft Enroll Name Policy',
  '1.3.6.1.4.1.311.21.1': 'Microsoft CA Version',
  '1.3.6.1.4.1.311.21.7': 'Microsoft CA Certificate Templates',
}

const AIA_METHODS: Record<string, string> = {
  '1.3.6.1.5.5.7.48.1': 'OCSP',
  '1.3.6.1.5.5.7.48.2': 'CA Issuers',
}

const CSR_ATTRIBUTE_OIDS: Record<string, string> = {
  '1.2.840.113549.1.9.1': 'emailAddress',
  '1.2.840.113549.1.9.2': 'unstructuredName',
  '1.2.840.113549.1.9.7': 'challengePassword',
  '1.2.840.113549.1.9.8': 'unstructuredIdentifier',
  '1.2.840.113549.1.9.14': 'extensionRequest',
  '1.2.840.113549.1.9.15': 'smimeCapabilities',
  '1.3.6.1.4.1.311.13.2.1': 'Microsoft attested certificate key',
  '1.3.6.1.4.1.311.20.2': 'Microsoft certificate template',
}

const VERSION_LABELS: Record<number, string> = { 0: 'v1', 1: 'v2', 2: 'v3', 3: 'v4', 4: 'v5', 5: 'v6' }

export function extensionName(oidValue: string): string {
  return EXTENSION_OIDS[oidValue] ?? 'Unknown extension'
}

export function attributeShortName(oidValue: string): string {
  return ATTRIBUTE_OIDS[oidValue] ?? oidValue
}

/* ------------------------------ structured model ------------------------------ */

export interface NameAttribute {
  oid: string
  shortName: string
  value: string
  stringType: string
}

export interface ParsedName {
  rdns: NameAttribute[][]
  dn: string
}

export interface ParsedValidity {
  notBeforeRaw: string
  notAfterRaw: string
  notBeforeIso: string | null
  notAfterIso: string | null
  notBeforeEpoch: number | null
  notAfterEpoch: number | null
  daysRemaining: number | null
  expired: boolean
  notYetValid: boolean
}

export interface ParsedKey {
  algorithm: string
  algorithmOid: string | null
  keyBits: number | null
  curve: string | null
  detail: string
  weak: boolean
}

export interface SanEntry {
  kind: string
  label: string
  value: string
}

export interface ParsedExtensions {
  basicConstraints: { ca: boolean; pathLen: number | null; critical: boolean } | null
  keyUsage: { usages: string[]; otherBits: number[]; critical: boolean } | null
  extendedKeyUsage: { purposes: string[]; oids: string[]; critical: boolean } | null
  subjectAltName: { entries: SanEntry[]; critical: boolean } | null
  issuerAltName: { entries: SanEntry[]; critical: boolean } | null
  crlDistributionPoints: string[] | null
  authorityKeyIdentifier: string | null
  subjectKeyIdentifier: string | null
  authorityInfoAccess: { method: string; location: string }[] | null
  certificatePolicies: string[] | null
  nameConstraints: { permitted: string[]; excluded: string[] } | null
  raw: { oid: string; name: string; critical: boolean; handled: boolean; hexPreview: string }[]
}

export interface CsrAttribute {
  oid: string
  name: string
  values: string[]
}

export interface SignatureAlgorithmInfo {
  oid: string | null
  name: string
  hash: string
  flagged: boolean
}

export interface X509Info {
  kind: 'certificate' | 'csr'
  pemType: string
  version: number | null
  versionLabel: string | null
  serialHex: string | null
  signatureAlgorithm: SignatureAlgorithmInfo
  issuer: ParsedName | null
  subject: ParsedName | null
  publicKey: ParsedKey | null
  validity: ParsedValidity | null
  extensions: ParsedExtensions
  requestedExtensions: ParsedExtensions | null
  csrAttributes: CsrAttribute[]
  warnings: CertIssue[]
  signatureHexPreview: string
}

export interface PemBlockEntry {
  index: number
  pemType: string
  kind: 'certificate' | 'csr' | 'unsupported'
  byteLength: number
  info: X509Info | null
  issue: CertIssue | null
}

export interface ChainLink {
  a: number
  b: number
  relation: 'a-issued-by-b' | 'b-issued-by-a' | 'unmatched'
  issuerDn: string
  issuedDn: string
}

export interface CertChainCheck {
  block: number
  subject: string
  issuer: string
  selfSigned: boolean
  issuerBlock: number | null
}

export interface DecodeResult {
  ok: boolean
  blocks: PemBlockEntry[]
  issues: CertIssue[]
  chainChecks: CertChainCheck[]
  links: ChainLink[]
  stats: {
    blocks: number
    certificates: number
    csrs: number
    flaggedSignature: number
    expired: number
    expiringSoon: number
    notYetValid: number
  }
}

function newExtensions(): ParsedExtensions {
  return {
    basicConstraints: null,
    keyUsage: null,
    extendedKeyUsage: null,
    subjectAltName: null,
    issuerAltName: null,
    crlDistributionPoints: null,
    authorityKeyIdentifier: null,
    subjectKeyIdentifier: null,
    authorityInfoAccess: null,
    certificatePolicies: null,
    nameConstraints: null,
    raw: [],
  }
}

function toHex(bytes: Uint8Array, limit = 24): string {
  const head = Array.from(bytes.subarray(0, limit))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
  return bytes.length > limit ? `${head}… (${bytes.length} bytes)` : head
}

function toFullHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(':')
}

/* ------------------------------ name ------------------------------ */

function decodeRdns(children: DerTlv[]): ParsedName {
  const rdns: NameAttribute[][] = []
  for (const rdn of children) {
    if (!isSet(rdn)) continue
    const attrs: NameAttribute[] = []
    for (const atv of rdn.children) {
      if (!isSequence(atv) || atv.children.length < 2) continue
      const oidValue = oidOf(atv.children[0])
      if (oidValue === null) continue
      const valueTlv = atv.children[1]
      const text = stringOf(valueTlv)
      let value: string
      if (text) value = text.text
      else if (isUniversal(valueTlv, U.objectIdentifier)) value = decodeOid(valueTlv.bytes) ?? ''
      else value = `#hex-${toFullHex(valueTlv.bytes)}`
      attrs.push({ oid: oidValue, shortName: attributeShortName(oidValue), value, stringType: text ? text.kind : 'raw' })
    }
    if (attrs.length > 0) rdns.push(attrs)
  }
  const dn = rdns.map((attrs) => attrs.map((attr) => `${attr.shortName}=${attr.value}`).join(' + ')).join(', ')
  return { rdns, dn }
}

/** A Name is SEQUENCE OF RDN; an implicit tag swaps that SEQUENCE for the tag, so accept both shapes. */
function decodeName(tlv: DerTlv | null, depth = 0): ParsedName | null {
  if (!tlv || depth > 2) return null
  if (isSequence(tlv)) return decodeRdns(tlv.children)
  if (tlv.constructed) {
    if (tlv.children.length > 0 && tlv.children.every(isSet)) return decodeRdns(tlv.children)
    return decodeName(childAt(tlv, 0), depth + 1)
  }
  const parsed = parseDerSafe(tlv.bytes)
  return parsed ? decodeName(parsed, depth + 1) : null
}

export function normalizeDn(dn: string): string {
  return dn
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*=\s*/g, '=')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*\+\s*/g, '+')
    .trim()
}

/* ------------------------------ key ------------------------------ */

function bitLength(bytes: Uint8Array | null): number | null {
  if (!bytes || bytes.length === 0) return null
  let index = 0
  while (index < bytes.length - 1 && bytes[index] === 0) index += 1
  let value = bytes[index]
  let bits = 0
  while (value > 0) {
    bits += 1
    value >>= 1
  }
  return bits + (bytes.length - index - 1) * 8
}

function decodePublicKey(spki: DerTlv, warnings: CertIssue[]): ParsedKey {
  const algSeq = childAt(spki, 0)
  const oidValue = oidOf(childAt(algSeq, 0))
  const algorithm = oidValue ? PUBLIC_KEY_OIDS[oidValue] ?? 'Unknown' : 'Unknown'
  const bit = bitStringOf(childAt(spki, 1))
  const keyContent = bit?.bytes ?? new Uint8Array(0)
  let curve: string | null = null
  let size: number | null = null
  let detail = ''

  if (oidValue === '1.2.840.113549.1.1.1' || oidValue === '1.2.840.113549.1.1.10') {
    const parsed = parseDerSafe(keyContent)
    const rsaKey = isSequence(parsed) ? parsed : null
    const modulus = rsaKey ? integerBytes(childAt(rsaKey, 0)) : null
    if (modulus) {
      size = bitLength(modulus)
      const exponent = integerToNumber(childAt(rsaKey, 1))
      detail = exponent === null ? 'exponent not decoded' : `e = ${exponent}`
    } else {
      warnings.push(issue('structure-error', 'RSA subjectPublicKey is not SEQUENCE { modulus, exponent }'))
    }
  } else if (oidValue === '1.2.840.10045.2.1') {
    const curveOid = oidOf(childAt(algSeq, 1))
    if (curveOid && CURVE_OIDS[curveOid]) {
      curve = CURVE_OIDS[curveOid].name
      size = CURVE_OIDS[curveOid].bits
    } else if (curveOid) {
      curve = curveOid
      warnings.push(issue('structure-error', `unknown EC curve OID ${curveOid}`))
    } else {
      warnings.push(issue('structure-error', 'EC public key has no named curve parameter'))
    }
    if (size === null && bit && bit.bytes.length > 1) {
      const content = bit.bytes
      if (content[0] === 0x04 || content[0] === 0x02 || content[0] === 0x03) size = Math.round(((content.length - 1) / 2) * 8)
    }
    detail = curve ? `curve ${curve}` : 'uncompressed or compressed point'
  } else if (oidValue === '1.2.840.113549.1.1.22') {
    const params = childAt(algSeq, 1)
    const p = isSequence(params) ? integerBytes(childAt(params, 0)) : null
    size = bitLength(p)
    detail = size === null ? 'DSA parameters missing' : `p is ${size} bits`
  } else if (oidValue === '1.3.101.112') {
    size = 256
    detail = 'Edwards curve, 32-byte key'
  } else if (oidValue === '1.3.101.113') {
    size = 456
    detail = 'Edwards curve, 57-byte key'
  } else if (oidValue === '1.3.101.110') {
    size = 256
    detail = 'Montgomery curve, 32-byte key'
  } else if (oidValue === '1.3.101.111') {
    size = 448
    detail = 'Montgomery curve, 56-byte key'
  } else if (bit) {
    size = bit.bytes.length * 8
    detail = `${bit.bytes.length} raw key bytes`
  }

  return {
    algorithm,
    algorithmOid: oidValue,
    keyBits: size,
    curve,
    detail,
    weak: algorithm === 'RSA' && size !== null && size < 2048,
  }
}

/* ------------------------------ extensions ------------------------------ */

function generalNameEntries(sequence: DerTlv, warnings: CertIssue[]): SanEntry[] {
  const entries: SanEntry[] = []
  for (const item of sequence.children) {
    if (item.tagClass !== 'context') continue
    const raw = item.bytes
    switch (item.tag) {
      case 0: {
        const inner = item.constructed ? item : parseDerSafe(raw)
        const idOid = inner ? oidOf(childAt(inner, 0)) : null
        const name = inner ? stringOf(childAt(inner, 1)) : null
        entries.push({ kind: 'otherName', label: 'Other Name', value: name ? name.text : idOid ?? toHex(raw) })
        break
      }
      case 1:
        entries.push({ kind: 'rfc822Name', label: 'Email', value: decodeText(item, 'utf-8') })
        break
      case 2:
        entries.push({ kind: 'dNSName', label: 'DNS', value: decodeText(item, 'ascii') })
        break
      case 3:
        entries.push({ kind: 'x400Address', label: 'X.400 address', value: toHex(raw) })
        break
      case 4: {
        const name = decodeName(item)
        entries.push({ kind: 'directoryName', label: 'Directory DN', value: name ? name.dn : toHex(raw) })
        break
      }
      case 5:
        entries.push({ kind: 'ediPartyName', label: 'EDI party name', value: toHex(raw) })
        break
      case 6:
        entries.push({ kind: 'uniformResourceIdentifier', label: 'URI', value: decodeText(item, 'ascii') })
        break
      case 7: {
        let size = raw.length
        let prefix: number | null = null
        if (size === 5 || size === 17) {
          prefix = raw[size - 1]
          size -= 1
        }
        let value: string
        if (size === 4) value = Array.from(raw.subarray(0, 4)).join('.')
        else if (size === 16) {
          const groups: string[] = []
          for (let index = 0; index < 16; index += 2) groups.push(((raw[index] << 8) | raw[index + 1]).toString(16))
          value = groups.join(':')
        } else value = toHex(raw)
        entries.push({
          kind: 'iPAddress',
          label: size === 4 ? 'IPv4' : size === 16 ? 'IPv6' : 'IP address',
          value: prefix === null ? value : `${value}/${prefix}`,
        })
        break
      }
      default:
        entries.push({ kind: `tag ${item.tag}`, label: `GeneralName [${item.tag}]`, value: toHex(raw) })
        warnings.push(issue('structure-error', `unhandled GeneralName tag [${item.tag}]`))
    }
  }
  return entries
}

function generalNamesFrom(tlv: DerTlv | null, warnings: CertIssue[], depth = 0): SanEntry[] {
  if (!tlv || depth > 2) return []
  if (tlv.tagClass === 'context' && tlv.constructed) {
    const inner = tlv.children.length === 1 && tlv.children[0].tagClass === 'context' && tlv.children[0].constructed ? tlv.children[0] : tlv
    return generalNameEntries(inner, warnings)
  }
  if (isSequence(tlv)) return generalNameEntries(tlv, warnings)
  const parsed = parseDerSafe(tlv.bytes)
  return parsed ? generalNamesFrom(parsed, warnings, depth + 1) : []
}

function parseBitStringFromContent(content: Uint8Array): { unusedBits: number; bytes: Uint8Array } | null {
  const parsed = parseDerSafe(content)
  if (isUniversal(parsed, U.bitString)) return bitStringOf(parsed)
  if (content.length === 0) return null
  const unusedBits = content[0]
  if (unusedBits > 7) return null
  return { unusedBits, bytes: content.subarray(1) }
}

function decodeExtensionValue(oidValue: string, value: DerTlv, extensions: ParsedExtensions, warnings: CertIssue[], critical: boolean): boolean {
  const parsed = parseDerSafe(value.bytes)
  if (!parsed) {
    warnings.push(issue('der-error', `extension ${oidValue} value is not valid DER`))
    return false
  }

  if (oidValue === '2.5.29.19') {
    let ca = false
    let pathLen: number | null = null
    if (isSequence(parsed)) {
      const boolTlv = parsed.children.find((child) => isUniversal(child, U.boolean))
      ca = boolValue(boolTlv ?? null) ?? false
      const intTlv = parsed.children.find((child) => isUniversal(child, U.integer))
      pathLen = integerToNumber(intTlv ?? null)
    }
    extensions.basicConstraints = { ca, pathLen, critical }
    return true
  }

  if (oidValue === '2.5.29.15') {
    const bit = parseBitStringFromContent(value.bytes)
    if (bit === null) {
      warnings.push(issue('der-error', 'Key Usage value is not a BIT STRING'))
      return false
    }
    const usages: string[] = []
    const otherBits: number[] = []
    const totalBits = bit.bytes.length * 8 - bit.unusedBits
    for (let position = 0; position < totalBits; position += 1) {
      const byte = bit.bytes[Math.floor(position / 8)]
      if ((byte & (0x80 >> (position % 8))) === 0) continue
      if (position < KEY_USAGE_BITS.length) usages.push(KEY_USAGE_BITS[position])
      else otherBits.push(position)
    }
    extensions.keyUsage = { usages, otherBits, critical }
    return true
  }

  if (oidValue === '2.5.29.37') {
    const purposes: string[] = []
    const oids: string[] = []
    for (const child of parsed.children) {
      const purpose = oidOf(child)
      if (!purpose) continue
      oids.push(purpose)
      purposes.push(EKU_OIDS[purpose] ?? purpose)
    }
    extensions.extendedKeyUsage = { purposes, oids, critical }
    return true
  }

  if (oidValue === '2.5.29.17' || oidValue === '2.5.29.18') {
    const entries = isSequence(parsed) ? generalNameEntries(parsed, warnings) : []
    if (entries.length === 0) warnings.push(issue('structure-error', `alternative name extension ${oidValue} holds no GeneralNames`))
    if (oidValue === '2.5.29.17') extensions.subjectAltName = { entries, critical }
    else extensions.issuerAltName = { entries, critical }
    return true
  }

  if (oidValue === '2.5.29.31') {
    const urls: string[] = []
    for (const dp of parsed.children) {
      if (!isSequence(dp)) continue
      const fullName = dp.children.find((child) => isContextTag(child, 0))
      if (fullName) {
        for (const entry of generalNamesFrom(fullName, warnings)) {
          urls.push(entry.kind === 'uniformResourceIdentifier' ? entry.value : `${entry.label}: ${entry.value}`)
        }
      }
      const relative = dp.children.find((child) => isContextTag(child, 1))
      if (relative) {
        const name = decodeName(relative)
        if (name) urls.push(`CRL issuer DN: ${name.dn}`)
      }
      if (!fullName && !relative && dp.bytes.length > 0) urls.push(toHex(dp.bytes, 12))
    }
    extensions.crlDistributionPoints = urls
    return true
  }

  if (oidValue === '2.5.29.35') {
    const keyId = parsed.children.find((child) => isContextTag(child, 0))
    extensions.authorityKeyIdentifier = keyId ? toFullHex(keyId.bytes) : null
    return true
  }

  if (oidValue === '2.5.29.14') {
    const inner = parseDerSafe(value.bytes)
    extensions.subjectKeyIdentifier = inner && isUniversal(inner, U.octetString) ? toFullHex(inner.bytes) : toFullHex(value.bytes)
    return true
  }

  if (oidValue === '1.3.6.1.5.5.7.1.1' || oidValue === '1.3.6.1.5.5.7.1.2') {
    const access: { method: string; location: string }[] = []
    for (const entry of parsed.children) {
      if (!isSequence(entry)) continue
      const method = oidOf(childAt(entry, 0))
      const location = stringOf(childAt(entry, 1))
      const locationTlv = childAt(entry, 1)
      access.push({
        method: method ? AIA_METHODS[method] ?? method : 'unknown method',
        location: location ? location.text : decodeText(locationTlv, 'ascii') || toHex(locationTlv?.bytes ?? new Uint8Array(0)),
      })
    }
    if (oidValue === '1.3.6.1.5.5.7.1.1') extensions.authorityInfoAccess = access
    return true
  }

  if (oidValue === '2.5.29.32') {
    const policies: string[] = []
    for (const entry of parsed.children) {
      if (!isSequence(entry)) continue
      const policy = oidOf(childAt(entry, 0))
      if (policy) policies.push(POLICY_OIDS[policy] ?? policy)
    }
    extensions.certificatePolicies = policies
    return true
  }

  if (oidValue === '2.5.29.30') {
    const permitted: string[] = []
    const excluded: string[] = []
    for (const child of parsed.children) {
      if (child.tagClass !== 'context' || (child.tag !== 0 && child.tag !== 1)) continue
      for (const name of generalNamesFrom(child, warnings)) {
        const text = `${name.label}: ${name.value}`
        if (child.tag === 0) permitted.push(text)
        else excluded.push(text)
      }
    }
    extensions.nameConstraints = { permitted, excluded }
    return true
  }

  return false
}

function decodeExtensions(sequence: DerTlv, warnings: CertIssue[]): ParsedExtensions {
  const extensions = newExtensions()
  for (const entry of sequence.children) {
    if (!isSequence(entry) || entry.children.length < 2) continue
    const oidValue = oidOf(entry.children[0])
    if (!oidValue) continue
    const critical = entry.children.length > 2 ? boolValue(entry.children[1]) ?? false : false
    const valueTlv = entry.children[entry.children.length - 1]
    if (!isUniversal(valueTlv, U.octetString)) {
      warnings.push(issue('structure-error', `extension ${oidValue} value is not an OCTET STRING`))
      continue
    }
    const handled = decodeExtensionValue(oidValue, valueTlv, extensions, warnings, critical)
    extensions.raw.push({
      oid: oidValue,
      name: extensionName(oidValue),
      critical,
      handled,
      hexPreview: toHex(valueTlv.bytes, 20),
    })
  }
  return extensions
}

/* ------------------------------ signature algorithm ------------------------------ */

function decodeAlgorithmIdentifier(tlv: DerTlv | null): SignatureAlgorithmInfo {
  if (!isSequence(tlv)) return { oid: null, name: 'not an AlgorithmIdentifier', hash: '—', flagged: false }
  const oidValue = oidOf(childAt(tlv, 0))
  if (!oidValue) return { oid: null, name: 'algorithm OID missing', hash: '—', flagged: false }
  const known = SIGNATURE_OIDS[oidValue]
  if (known) return { oid: oidValue, name: known.name, hash: known.hash, flagged: known.flagged }
  if (oidValue === '1.2.840.113549.1.1.10') {
    const hash = hashFromPssParams(childAt(tlv, 1))
    return { oid: oidValue, name: 'rsassaPss', hash, flagged: hash === 'SHA-1' || hash === 'MD5' || hash === 'MD2' || hash === 'MD4' }
  }
  const hash = HASH_OIDS[oidValue] ?? '—'
  return { oid: oidValue, name: oidValue, hash, flagged: false }
}

function hashFromPssParams(params: DerTlv | null): string {
  if (!params) return 'from PSS params'
  const walk = (node: DerTlv): string | null => {
    for (const child of node.children) {
      const oidValue = oidOf(child)
      if (oidValue && HASH_OIDS[oidValue]) return HASH_OIDS[oidValue]
      const nested = child.children.length > 0 ? walk(child) : null
      if (nested) return nested
    }
    return null
  }
  return walk(params) ?? 'from PSS params'
}

/* ------------------------------ validity ------------------------------ */

function decodeValidity(tlv: DerTlv | null, now: number, warnings: CertIssue[]): ParsedValidity | null {
  if (!isSequence(tlv) || tlv.children.length < 2) return null
  const before = parseAsnTime(tlv.children[0])
  const after = parseAsnTime(tlv.children[1])
  if (before.epoch === null) warnings.push(issue('structure-error', 'notBefore is not a parsable UTCTime or GeneralizedTime'))
  if (after.epoch === null) warnings.push(issue('structure-error', 'notAfter is not a parsable UTCTime or GeneralizedTime'))
  return {
    notBeforeRaw: decodeText(tlv.children[0], 'ascii'),
    notAfterRaw: decodeText(tlv.children[1], 'ascii'),
    notBeforeIso: before.iso,
    notAfterIso: after.iso,
    notBeforeEpoch: before.epoch,
    notAfterEpoch: after.epoch,
    daysRemaining: after.epoch === null ? null : Math.floor((after.epoch - now) / 86_400_000),
    expired: after.epoch !== null && after.epoch < now,
    notYetValid: before.epoch !== null && before.epoch > now,
  }
}

/* ------------------------------ certificate / CSR ------------------------------ */

function readVersion(tlv: DerTlv | null): number | null {
  if (!tlv) return null
  if (isContextTag(tlv, 0)) return integerToNumber(tlv.children[0] ?? null)
  return integerToNumber(tlv)
}

export function decodeCertificateDer(
  der: Uint8Array,
  pemType: string,
  now = Date.now(),
): { ok: true; info: X509Info } | { ok: false; issue: CertIssue } {
  const warnings: CertIssue[] = []
  const outer = parseDer(der)
  if (!outer.ok) return { ok: false, issue: issue('der-error', outer.error) }
  if (outer.trailing > 0) warnings.push(issue('der-error', `${outer.trailing} trailing byte(s) after the top-level SEQUENCE`))
  const root = outer.tlv
  if (!isSequence(root) || root.children.length < 3) {
    return { ok: false, issue: issue('structure-error', `top level is ${tagLabel(root)}, expected a SEQUENCE of at least 3 fields`) }
  }

  const isCsr = /CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST|PKCS\s*#?\s*10/i.test(pemType)
  const info: X509Info = {
    kind: isCsr ? 'csr' : 'certificate',
    pemType,
    version: null,
    versionLabel: null,
    serialHex: null,
    signatureAlgorithm: { oid: null, name: '—', hash: '—', flagged: false },
    issuer: null,
    subject: null,
    publicKey: null,
    validity: null,
    extensions: newExtensions(),
    requestedExtensions: null,
    csrAttributes: [],
    warnings,
    signatureHexPreview: toHex(bitStringOf(childAt(root, 2))?.bytes ?? new Uint8Array(0), 12),
  }
  const head = root.children[0]

  if (isCsr) {
    if (head.children.length < 3) return { ok: false, issue: issue('structure-error', 'certificationRequestInfo has fewer than 3 fields') }
    info.version = readVersion(childAt(head, 0))
    info.versionLabel = info.version === 0 ? 'PKCS#10 v1' : `version ${info.version ?? '?'}`
    info.subject = decodeName(childAt(head, 1))
    const spki = childAt(head, 2)
    if (isSequence(spki)) info.publicKey = decodePublicKey(spki, warnings)
    else warnings.push(issue('structure-error', 'CSR subjectPublicKeyInfo is missing'))
    info.signatureAlgorithm = decodeAlgorithmIdentifier(childAt(root, 1))
    if (info.signatureAlgorithm.flagged) warnings.push(issue('structure-error', `${info.signatureAlgorithm.name} is a deprecated signature algorithm`))
    const attributeBlock = head.children.slice(1).find((child) => isContextTag(child, 0))
    if (attributeBlock) {
      for (const entry of attributeBlock.children) {
        if (!isSequence(entry)) continue
        const oidValue = oidOf(childAt(entry, 0))
        if (!oidValue) continue
        const setTlv = childAt(entry, 1)
        const values: string[] = []
        for (const value of setTlv ? setTlv.children.length > 0 ? setTlv.children : [setTlv] : []) {
          const text = stringOf(value)
          if (text) values.push(text.text)
          else if (isUniversal(value, U.objectIdentifier)) values.push(decodeOid(value.bytes) ?? '')
          else values.push(toHex(value.bytes, 16))
        }
        info.csrAttributes.push({ oid: oidValue, name: CSR_ATTRIBUTE_OIDS[oidValue] ?? oidValue, values })
        if (oidValue === '1.2.840.113549.1.9.14' && setTlv) {
          for (const value of setTlv.children.length > 0 ? setTlv.children : [setTlv]) {
            const candidate = isUniversal(value, U.octetString) ? parseDerSafe(value.bytes) : value
            if (isSequence(candidate) && candidate.children.length > 0) {
              info.requestedExtensions = decodeExtensions(candidate, warnings)
            }
          }
        }
      }
    }
    if (!info.subject) warnings.push(issue('structure-error', 'CSR subject could not be decoded'))
    return { ok: true, info }
  }

  if (!isSequence(head) || head.children.length < 6) {
    return { ok: false, issue: issue('structure-error', `tbsCertificate is ${tagLabel(head)}, expected a SEQUENCE of at least 6 fields`) }
  }

  let cursor = 0
  if (isContextTag(head.children[0], 0)) {
    info.version = readVersion(head.children[0])
    cursor += 1
  }
  info.versionLabel = info.version === null ? 'v1 (no explicit version)' : VERSION_LABELS[info.version] ?? `version ${info.version}`
  if (info.version === null) info.version = 0

  info.serialHex = integerToHex(childAt(head, cursor))
  if (info.serialHex === null) warnings.push(issue('structure-error', 'serialNumber is not an INTEGER'))

  const outerSig = decodeAlgorithmIdentifier(childAt(root, 1))
  const innerSig = decodeAlgorithmIdentifier(childAt(head, cursor + 1))
  info.signatureAlgorithm = outerSig.oid !== null ? outerSig : innerSig
  if (innerSig.oid && outerSig.oid && innerSig.oid !== outerSig.oid) {
    warnings.push(issue('structure-error', `inner signature algorithm ${innerSig.oid} differs from the outer ${outerSig.oid}`))
  }
  if (info.signatureAlgorithm.flagged) {
    warnings.push(issue('structure-error', `${info.signatureAlgorithm.name} (${info.signatureAlgorithm.hash}) is deprecated and rejected by browsers`))
  }

  info.issuer = decodeName(childAt(head, cursor + 2))
  info.validity = decodeValidity(childAt(head, cursor + 3), now, warnings)
  info.subject = decodeName(childAt(head, cursor + 4))
  const spki = childAt(head, cursor + 5)
  if (isSequence(spki)) info.publicKey = decodePublicKey(spki, warnings)
  else warnings.push(issue('structure-error', 'subjectPublicKeyInfo is missing'))

  for (const child of head.children.slice(cursor + 6)) {
    if (isContextTag(child, 3)) {
      const wrapper = child.constructed ? child.children[0] ?? null : parseDerSafe(child.bytes)
      const inner = wrapper ? wrapper.children[0] ?? null : null
      const target = isSequence(wrapper) ? wrapper : isSequence(inner) ? inner : null
      if (target) info.extensions = decodeExtensions(target, warnings)
      else warnings.push(issue('structure-error', 'extensions block is not a SEQUENCE OF Extension'))
    } else if (isContextTag(child, 1) || isContextTag(child, 2)) {
      warnings.push(issue('structure-error', `${child.tag === 1 ? 'issuer' : 'subject'} unique ID present (X.509 v2 field)`))
    }
  }

  if (!info.issuer) warnings.push(issue('structure-error', 'issuer could not be decoded'))
  if (!info.subject) warnings.push(issue('structure-error', 'subject could not be decoded'))
  return { ok: true, info }
}

/* ------------------------------ PEM ------------------------------ */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64ToBytes(text: string): { ok: true; bytes: Uint8Array } | { ok: false; error: string } {
  const clean = text.replace(/\s/g, '').replace(/=+$/, '')
  if (clean.length === 0) return { ok: false, error: 'empty base64 body' }
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8))
  let buffer = 0
  let bits = 0
  let written = 0
  for (let index = 0; index < clean.length; index += 1) {
    const value = BASE64_ALPHABET.indexOf(clean[index])
    if (value < 0) return { ok: false, error: `character "${clean[index]}" at position ${index} is not base64` }
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes[written] = (buffer >> bits) & 0xff
      buffer = bits === 0 ? 0 : buffer & ((1 << bits) - 1)
      written += 1
    }
  }
  return { ok: true, bytes: written === bytes.length ? bytes : bytes.subarray(0, written) }
}

export interface PemBlockRaw {
  type: string
  der: Uint8Array
  issue: CertIssue | null
}

export function parsePem(text: string): { blocks: PemBlockRaw[]; issues: CertIssue[] } {
  const issues: CertIssue[] = []
  const blocks: PemBlockRaw[] = []
  if (text.trim().length === 0) return { blocks, issues: [issue('empty-input', 'nothing pasted')] }
  if (text.length > MAX_PEM_BYTES) {
    return { blocks, issues: [issue('too-large', `${text.length} characters exceeds the ${MAX_PEM_BYTES} character limit`)] }
  }
  const headers = [...text.matchAll(/-----BEGIN ([A-Za-z0-9 #_-]+)-----/g)]
  if (headers.length === 0) return { blocks, issues: [issue('no-pem-block', 'no -----BEGIN ... ----- armour found')] }

  const pattern = /-----BEGIN ([A-Za-z0-9 #_-]+)-----([\s\S]*?)-----END \1-----/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const type = match[1].trim()
    const decoded = base64ToBytes(match[2])
    if (!decoded.ok) {
      const code: CertIssueCode = decoded.error.startsWith('empty') ? 'empty-body' : 'invalid-base64'
      blocks.push({ type, der: new Uint8Array(0), issue: issue(code, decoded.error) })
      continue
    }
    blocks.push({ type, der: decoded.bytes, issue: null })
  }
  for (const header of headers.slice(blocks.length)) {
    issues.push(issue('unclosed-block', `-----BEGIN ${header[1].trim()}----- has no matching END line`))
  }
  return { blocks, issues }
}

function typeKind(type: string): 'certificate' | 'csr' | 'unsupported' {
  if (/CERTIFICATE REQUEST|NEW CERTIFICATE REQUEST/i.test(type)) return 'csr'
  if (/CERTIFICATE/i.test(type)) return 'certificate'
  return 'unsupported'
}

/* ------------------------------ bundle decode ------------------------------ */

export function decodePemBundle(text: string, now = Date.now()): DecodeResult {
  const parsed = parsePem(text)
  const blocks: PemBlockEntry[] = []
  const issues: CertIssue[] = [...parsed.issues]

  parsed.blocks.slice(0, MAX_PEM_BLOCKS).forEach((block, index) => {
    const entry: PemBlockEntry = {
      index: index + 1,
      pemType: block.type,
      kind: typeKind(block.type),
      byteLength: block.der.length,
      info: null,
      issue: block.issue,
    }
    if (entry.issue) {
      issues.push({ ...entry.issue, block: entry.index })
      blocks.push(entry)
      return
    }
    if (block.der.length === 0) {
      entry.issue = issue('empty-body', 'armour body decoded to zero bytes')
    } else if (entry.kind === 'unsupported') {
      entry.issue = issue('unsupported-type', `-----BEGIN ${block.type}----- is neither a certificate nor a CSR`)
    } else {
      const decoded = decodeCertificateDer(block.der, block.type, now)
      if (decoded.ok) entry.info = decoded.info
      else entry.issue = decoded.issue
    }
    if (entry.issue) issues.push({ ...entry.issue, block: entry.index })
    blocks.push(entry)
  })

  if (parsed.blocks.length > MAX_PEM_BLOCKS) {
    issues.push(issue('too-large', `${parsed.blocks.length} PEM blocks present, only the first ${MAX_PEM_BLOCKS} were decoded`))
  }
  if (blocks.length === 0 && issues.length === 0) issues.push(issue('no-pem-block', 'no PEM block could be read'))

  const subjects = new Map<string, number>()
  for (const block of blocks) {
    if (block.info?.kind !== 'certificate' || !block.info.subject) continue
    const key = normalizeDn(block.info.subject.dn)
    if (!subjects.has(key)) subjects.set(key, block.index)
  }

  const chainChecks: CertChainCheck[] = []
  for (const block of blocks) {
    const info = block.info
    if (info?.kind !== 'certificate' || !info.subject || !info.issuer) continue
    const selfSigned = normalizeDn(info.subject.dn) === normalizeDn(info.issuer.dn)
    chainChecks.push({
      block: block.index,
      subject: info.subject.dn,
      issuer: info.issuer.dn,
      selfSigned,
      issuerBlock: selfSigned ? block.index : subjects.get(normalizeDn(info.issuer.dn)) ?? null,
    })
  }

  const links: ChainLink[] = []
  const certs = blocks.filter((block) => block.info?.kind === 'certificate' && block.info.subject && block.info.issuer)
  for (let index = 0; index < certs.length - 1; index += 1) {
    const a = certs[index]
    const b = certs[index + 1]
    const aIssuer = a.info!.issuer!.dn
    const aSubject = a.info!.subject!.dn
    const bIssuer = b.info!.issuer!.dn
    const bSubject = b.info!.subject!.dn
    if (normalizeDn(aIssuer) === normalizeDn(bSubject)) {
      links.push({ a: a.index, b: b.index, relation: 'a-issued-by-b', issuerDn: bSubject, issuedDn: aSubject })
    } else if (normalizeDn(bIssuer) === normalizeDn(aSubject)) {
      links.push({ a: a.index, b: b.index, relation: 'b-issued-by-a', issuerDn: aSubject, issuedDn: bSubject })
    } else {
      links.push({ a: a.index, b: b.index, relation: 'unmatched', issuerDn: aIssuer, issuedDn: bSubject })
    }
  }

  const infos = blocks.map((block) => block.info).filter((entry): entry is X509Info => entry !== null)
  const stats = {
    blocks: blocks.length,
    certificates: blocks.filter((block) => block.kind === 'certificate').length,
    csrs: blocks.filter((block) => block.kind === 'csr').length,
    flaggedSignature: infos.filter((entry) => entry.signatureAlgorithm.flagged).length,
    expired: infos.filter((entry) => entry.validity?.expired).length,
    expiringSoon: infos.filter((entry) => {
      const days = entry.validity?.daysRemaining
      return days !== undefined && days !== null && days >= 0 && days <= 30
    }).length,
    notYetValid: infos.filter((entry) => entry.validity?.notYetValid).length,
  }

  return { ok: blocks.some((block) => block.info !== null), blocks, issues, chainChecks, links, stats }
}
