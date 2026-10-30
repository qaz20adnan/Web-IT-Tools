import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  decodeCertificateDer,
  decodePemBundle,
  integerToHex,
  normalizeDn,
  parseDer,
  parsePem,
  readTlv,
  decodeOid,
} from '@/lib/x509'

const enc = (text: string) => new TextEncoder().encode(text)

function concat(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0)
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function tlv(tag: number, value: Uint8Array): Uint8Array {
  const header: number[] = [tag]
  if (value.length < 128) {
    header.push(value.length)
  } else {
    const lengthBytes: number[] = []
    let rest = value.length
    while (rest > 0) {
      lengthBytes.unshift(rest & 0xff)
      rest = Math.floor(rest / 256)
    }
    header.push(0x80 | lengthBytes.length, ...lengthBytes)
  }
  return concat(Uint8Array.from(header), value)
}

const seq = (...items: Uint8Array[]) => tlv(0x30, concat(...items))
const setOf = (...items: Uint8Array[]) => tlv(0x31, concat(...items))
const context = (tag: number, ...items: Uint8Array[]) => tlv(0xa0 | tag, concat(...items))
const octet = (value: Uint8Array) => tlv(0x04, value)
const bitString = (content: Uint8Array) => tlv(0x03, concat(Uint8Array.from([0]), content))
const printable = (text: string) => tlv(0x13, enc(text))
const utf8String = (text: string) => tlv(0x0c, enc(text))
const utcTime = (text: string) => tlv(0x17, enc(text))
const boolTrue = tlv(0x01, Uint8Array.from([0xff]))

function integerFromHex(hex: string): Uint8Array {
  const bytes: number[] = []
  for (let index = 0; index < hex.length; index += 2) bytes.push(parseInt(hex.slice(index, index + 2), 16))
  if ((bytes[0] & 0x80) !== 0) bytes.unshift(0)
  return tlv(0x02, Uint8Array.from(bytes))
}

function oidTlv(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map(Number)
  const out: number[] = [arcs[0] * 40 + arcs[1]]
  for (let index = 2; index < arcs.length; index += 1) {
    const chunk: number[] = [arcs[index] & 0x7f]
    let rest = Math.floor(arcs[index] / 128)
    while (rest > 0) {
      chunk.unshift((rest & 0x7f) | 0x80)
      rest = Math.floor(rest / 128)
    }
    out.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(out))
}

const rdn = (oidValue: string, value: Uint8Array) => setOf(seq(oidTlv(oidValue), value))
const nameOf = (...rdns: Uint8Array[]) => seq(...rdns)

function extension(oidValue: string, value: Uint8Array, critical = false): Uint8Array {
  const parts = [oidTlv(oidValue)]
  if (critical) parts.push(boolTrue)
  parts.push(octet(value))
  return seq(...parts)
}

const SHA256_RSA = '1.2.840.113549.1.1.11'
const SHA1_RSA = '1.2.840.113549.1.1.5'
const MD5_RSA = '1.2.840.113549.1.1.4'

function rsaSpki(): Uint8Array {
  const modulus = integerFromHex(`c0${'de'.repeat(127)}`)
  const exponent = integerFromHex('010001')
  return seq(seq(oidTlv('1.2.840.113549.1.1.1'), tlv(0x05, new Uint8Array(0))), bitString(seq(modulus, exponent)))
}

function ecSpki(): Uint8Array {
  const point = Uint8Array.from([0x04, ...Array.from({ length: 64 }, (_, index) => index + 1)])
  return seq(seq(oidTlv('1.2.840.10045.2.1'), oidTlv('1.2.840.10045.3.1.7')), bitString(point))
}

const ISSUER = nameOf(rdn('2.5.4.6', printable('US')), rdn('2.5.4.10', printable('Adnan Test CA')), rdn('2.5.4.3', printable('Adnan Root')))
const SUBJECT = nameOf(
  rdn('2.5.4.6', printable('US')),
  rdn('2.5.4.3', printable('web.example.com')),
  setOf(seq(oidTlv('0.9.2342.19200300.100.1.25'), printable('example')), seq(oidTlv('2.5.4.11'), printable('Ops'))),
  rdn('1.2.840.113549.1.9.1', printable('ops@example.com')),
)

const EXTENSIONS = seq(
  extension('2.5.29.19', seq(boolTrue, integerFromHex('01')), true),
  extension('2.5.29.15', tlv(0x03, Uint8Array.from([0x05, 0xa0])), true),
  extension('2.5.29.37', seq(oidTlv('1.3.6.1.5.5.7.3.1'), oidTlv('1.3.6.1.5.5.7.3.2'))),
  extension(
    '2.5.29.17',
    seq(
      tlv(0x82, enc('web.example.com')),
      tlv(0x81, enc('ops@example.com')),
      tlv(0x86, enc('https://example.com/policy')),
      tlv(0x87, Uint8Array.from([192, 0, 2, 1])),
      tlv(0xa4, nameOf(rdn('2.5.4.3', printable('Nested DN')))),
    ),
  ),
  extension('2.5.29.31', seq(seq(context(0, context(0, tlv(0x86, enc('http://crl.example.com/root.crl'))))))),
  extension('2.5.29.35', seq(tlv(0x80, Uint8Array.from([0xab, 0xcd, 0xef])))),
  extension('2.5.29.14', octet(Uint8Array.from([0x11, 0x22, 0x33]))),
  extension('1.3.6.1.5.5.7.1.1', seq(seq(oidTlv('1.3.6.1.5.5.7.48.1'), tlv(0x86, enc('http://ocsp.example.com'))))),
  extension('2.5.29.99', octet(Uint8Array.from([0xde, 0xad]))),
)

function buildCert(options: { signatureOid?: string; subject?: Uint8Array; issuer?: Uint8Array; notAfter?: string } = {}): Uint8Array {
  const signatureOid = options.signatureOid ?? SHA256_RSA
  const subject = options.subject ?? SUBJECT
  const issuer = options.issuer ?? ISSUER
  const tbs = seq(
    context(0, integerFromHex('02')),
    integerFromHex('04ff1122'),
    seq(oidTlv(signatureOid)),
    issuer,
    seq(utcTime('240101000000Z'), utcTime(options.notAfter ?? '260101000000Z')),
    subject,
    rsaSpki(),
    context(3, EXTENSIONS),
  )
  return seq(tbs, seq(oidTlv(signatureOid)), bitString(Uint8Array.from([0x01, 0x02, 0x03])))
}

function buildCsr(signatureOid = '1.2.840.10045.4.3.2'): Uint8Array {
  const attributes = context(
    0,
    seq(oidTlv('1.2.840.113549.1.9.7'), setOf(printable('p1ssw0rd'))),
    seq(oidTlv('1.2.840.113549.1.9.1'), setOf(printable('admin@example.com'))),
    seq(
      oidTlv('1.2.840.113549.1.9.14'),
      setOf(
        seq(
          extension('2.5.29.17', seq(tlv(0x82, enc('csr.example.com')), tlv(0x82, enc('alt.example.com')))),
          extension('2.5.29.15', tlv(0x03, Uint8Array.from([0x07, 0x80]))),
        ),
      ),
    ),
  )
  const info = seq(integerFromHex('00'), SUBJECT, ecSpki(), attributes)
  return seq(info, seq(oidTlv(signatureOid)), bitString(new Uint8Array(0)))
}

function toBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = bytes.subarray(index, Math.min(index + 3, bytes.length))
    const value = (chunk[0] << 16) | ((chunk[1] ?? 0) << 8) | (chunk[2] ?? 0)
    out += alphabet[(value >> 18) & 63] + alphabet[(value >> 12) & 63]
    out += chunk.length > 1 ? alphabet[(value >> 6) & 63] : '='
    out += chunk.length > 2 ? alphabet[value & 63] : '='
  }
  return out
}

function pem(type: string, der: Uint8Array): string {
  const body = toBase64(der)
  const lines = body.match(/.{1,64}/g) ?? []
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----\n`
}

const NOW = Date.UTC(2025, 10, 15, 12, 0, 0)

describe('ASN.1 / DER reader', () => {
  it('reads a short-form primitive', () => {
    const read = readTlv(tlv(0x0c, enc('hi')), 0)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.tlv.tag).toBe(0x0c)
    expect(read.tlv.constructed).toBe(false)
    expect(new TextDecoder().decode(read.tlv.bytes)).toBe('hi')
  })

  it('reads high tag number form', () => {
    const bytes = Uint8Array.from([0x3f, 0x9f, 0x1f, 0x00])
    const read = readTlv(bytes, 0)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.tlv.tag).toBe(3999)
    expect(read.tlv.tagClass).toBe('universal')
    expect(read.tlv.constructed).toBe(true)
  })

  it('rejects non-minimal high tag numbers', () => {
    const read = readTlv(Uint8Array.from([0x3f, 0x81, 0x05, 0x00]), 0)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('non-minimal')
  })

  it('rejects indefinite length', () => {
    const read = readTlv(Uint8Array.from([0x30, 0x80, 0x00, 0x00]), 0)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('indefinite length')
  })

  it('rejects a length that exceeds the remaining bytes', () => {
    const read = readTlv(Uint8Array.from([0x30, 0x05, 0x01]), 0)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.error).toContain('exceeds')
  })

  it('rejects a truncated length octet and a missing length byte', () => {
    expect(readTlv(Uint8Array.from([0x30]), 0).ok).toBe(false)
    expect(readTlv(Uint8Array.from([0x30, 0x82, 0x01]), 0).ok).toBe(false)
    expect(readTlv(Uint8Array.from([0x30, 0x81, 0x05, 0x00, 0x00, 0x00]), 0).ok).toBe(false)
  })

  it('rejects non-minimal long form lengths and reserved universal tags', () => {
    const nonMinimal = readTlv(concat(Uint8Array.from([0x30, 0x81, 0x05]), new Uint8Array(5)), 0)
    expect(nonMinimal.ok).toBe(false)
    if (!nonMinimal.ok) expect(nonMinimal.error).toContain('non-minimal long form')
    expect(readTlv(Uint8Array.from([0x00, 0x00]), 0).ok).toBe(false)
    const booleanTag = readTlv(Uint8Array.from([0x01, 0x01, 0xff]), 0)
    expect(booleanTag.ok).toBe(true)
  })

  it('rejects reads at an offset past the buffer without throwing', () => {
    expect(() => readTlv(new Uint8Array(0), 0)).not.toThrow()
    expect(readTlv(Uint8Array.from([0x30, 0x00]), 5).ok).toBe(false)
    expect(parseDer(new Uint8Array(0)).ok).toBe(false)
  })

  it('decodes OIDs including multi-byte arcs', () => {
    expect(decodeOid(oidTlv('1.2.840.113549.1.1.11').subarray(2))).toBe('1.2.840.113549.1.1.11')
    expect(decodeOid(oidTlv('2.16.840.1.101.3.4.2.1').subarray(2))).toBe('2.16.840.1.101.3.4.2.1')
    expect(decodeOid(new Uint8Array(0))).toBe(null)
  })

  it('renders integers as minimal hex', () => {
    const parsed = parseDer(integerFromHex('04ff1122'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(integerToHex(parsed.tlv)).toBe('4ff1122')
    const negative = parseDer(tlv(0x02, Uint8Array.from([0xff, 0x11])))
    expect(negative.ok && integerToHex(negative.tlv)).toBe('-ef')
    expect(integerToHex(null)).toBe(null)
  })
})

describe('PEM armour', () => {
  it('decodes strict base64 and rejects junk', () => {
    const decoded = base64ToBytes(toBase64(Uint8Array.from([1, 2, 3, 250])))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(Array.from(decoded.bytes)).toEqual([1, 2, 3, 250])
    expect(base64ToBytes('not base64!!').ok).toBe(false)
    expect(base64ToBytes('   ').ok).toBe(false)
  })

  it('reports missing and unclosed armour instead of throwing', () => {
    expect(parsePem('').issues[0].code).toBe('empty-input')
    expect(parsePem('just some text').issues[0].code).toBe('no-pem-block')
    const unclosed = parsePem('-----BEGIN CERTIFICATE-----\nQUJD\n')
    expect(unclosed.blocks).toHaveLength(0)
    expect(unclosed.issues[0].code).toBe('unclosed-block')
  })

  it('splits a chain into separate blocks', () => {
    const der = buildCert()
    const bundle = pem('CERTIFICATE', der) + '\n' + pem('CERTIFICATE', buildCert({ subject: ISSUER, issuer: ISSUER }))
    const parsed = parsePem(bundle)
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.issues).toHaveLength(0)
  })
})

describe('certificate decoding', () => {
  const der = buildCert()
  const result = decodePemBundle(pem('CERTIFICATE', der), NOW)
  const info = result.blocks[0].info

  it('decodes serial, version and signature algorithm', () => {
    expect(result.ok).toBe(true)
    expect(info?.serialHex).toBe('4ff1122')
    expect(info?.versionLabel).toBe('v3')
    expect(info?.signatureAlgorithm).toMatchObject({ oid: SHA256_RSA, name: 'sha256WithRSAEncryption', hash: 'SHA-256', flagged: false })
  })

  it('flags SHA-1 and MD5 signature algorithms', () => {
    const sha1 = decodePemBundle(pem('CERTIFICATE', buildCert({ signatureOid: SHA1_RSA })), NOW)
    expect(sha1.blocks[0].info?.signatureAlgorithm.flagged).toBe(true)
    expect(sha1.stats.flaggedSignature).toBe(1)
    const md5 = decodePemBundle(pem('CERTIFICATE', buildCert({ signatureOid: MD5_RSA })), NOW)
    expect(md5.blocks[0].info?.signatureAlgorithm.hash).toBe('MD5')
    expect(md5.blocks[0].info?.signatureAlgorithm.flagged).toBe(true)
  })

  it('decodes every attribute OID in issuer and subject', () => {
    expect(info?.issuer?.dn).toBe('C=US, O=Adnan Test CA, CN=Adnan Root')
    const shortNames = info?.subject?.rdns.flat().map((attr) => attr.shortName) ?? []
    expect(shortNames).toEqual(['C', 'CN', 'DC', 'OU', 'EMAILADDRESS'])
    expect(info?.subject?.rdns[2]).toHaveLength(2)
  })

  it('reports RSA key size and flags a short key', () => {
    expect(info?.publicKey).toMatchObject({ algorithm: 'RSA', keyBits: 1024, weak: true })
    expect(info?.publicKey?.detail).toBe('e = 65537')
  })

  it('computes validity with days remaining against a fixed clock', () => {
    expect(info?.validity?.notBeforeIso).toBe('2024-01-01T00:00:00.000Z')
    expect(info?.validity?.notAfterIso).toBe('2026-01-01T00:00:00.000Z')
    expect(info?.validity?.expired).toBe(false)
    expect(info?.validity?.notYetValid).toBe(false)
    expect(info?.validity?.daysRemaining).toBe(46)
    const expired = decodePemBundle(pem('CERTIFICATE', buildCert({ notAfter: '240101000000Z' })), Date.UTC(2026, 0, 1))
    expect(expired.blocks[0].info?.validity?.expired).toBe(true)
    expect(expired.stats.expired).toBe(1)
  })

  it('decodes basic constraints, key usage and EKU', () => {
    expect(info?.extensions.basicConstraints).toEqual({ ca: true, pathLen: 1, critical: true })
    expect(info?.extensions.keyUsage?.usages).toEqual(['digitalSignature', 'keyEncipherment'])
    expect(info?.extensions.keyUsage?.critical).toBe(true)
    expect(info?.extensions.extendedKeyUsage?.purposes).toEqual(['TLS Web Server Authentication', 'TLS Web Client Authentication'])
  })

  it('decodes SAN entries including IP and directory name', () => {
    const kinds = info?.extensions.subjectAltName?.entries.map((entry) => `${entry.kind}:${entry.value}`) ?? []
    expect(kinds).toEqual([
      'dNSName:web.example.com',
      'rfc822Name:ops@example.com',
      'uniformResourceIdentifier:https://example.com/policy',
      'iPAddress:192.0.2.1',
      'directoryName:CN=Nested DN',
    ])
  })

  it('decodes CRL points, key identifiers and AIA', () => {
    expect(info?.extensions.crlDistributionPoints).toEqual(['http://crl.example.com/root.crl'])
    expect(info?.extensions.authorityKeyIdentifier).toBe('ab:cd:ef')
    expect(info?.extensions.subjectKeyIdentifier).toBe('11:22:33')
    expect(info?.extensions.authorityInfoAccess).toEqual([{ method: 'OCSP', location: 'http://ocsp.example.com' }])
  })

  it('lists unhandled extensions without losing the certificate', () => {
    const raw = info?.extensions.raw.find((entry) => entry.oid === '2.5.29.99')
    expect(raw?.handled).toBe(false)
    expect(raw?.critical).toBe(false)
    expect(info?.extensions.raw).toHaveLength(9)
  })

  it('decodes EC keys with the named curve', () => {
    const csr = decodePemBundle(pem('CERTIFICATE REQUEST', buildCsr()), NOW)
    expect(csr.blocks[0].info?.publicKey).toMatchObject({ algorithm: 'EC', curve: 'P-256 (prime256v1)', keyBits: 256 })
  })
})

describe('CSR decoding', () => {
  const result = decodePemBundle(pem('CERTIFICATE REQUEST', buildCsr()), NOW)
  const info = result.blocks[0].info

  it('recognises the request type and subject', () => {
    expect(result.stats.csrs).toBe(1)
    expect(info?.kind).toBe('csr')
    expect(info?.versionLabel).toBe('PKCS#10 v1')
    expect(info?.issuer).toBe(null)
    expect(info?.signatureAlgorithm.name).toBe('ecdsa-with-SHA256')
  })

  it('decodes requested attributes', () => {
    const names = info?.csrAttributes.map((attr) => attr.name) ?? []
    expect(names).toEqual(['challengePassword', 'emailAddress', 'extensionRequest'])
    expect(info?.csrAttributes[0].values).toEqual(['p1ssw0rd'])
  })

  it('decodes extensions inside extensionRequest', () => {
    expect(info?.requestedExtensions?.subjectAltName?.entries.map((entry) => entry.value)).toEqual(['csr.example.com', 'alt.example.com'])
    expect(info?.requestedExtensions?.keyUsage?.usages).toEqual(['digitalSignature'])
  })
})

describe('chain analysis', () => {
  const rootDer = buildCert({ subject: ISSUER, issuer: ISSUER })
  const leafDer = buildCert({ issuer: ISSUER })

  it('says which links match when the leaf is listed after its issuer', () => {
    const result = decodePemBundle(pem('CERTIFICATE', rootDer) + pem('CERTIFICATE', leafDer), NOW)
    expect(result.links).toHaveLength(1)
    expect(result.links[0]).toMatchObject({ a: 1, b: 2, relation: 'b-issued-by-a' })
    expect(result.chainChecks[1]).toMatchObject({ selfSigned: false, issuerBlock: 1 })
    expect(result.chainChecks[0].selfSigned).toBe(true)
  })

  it('marks a reversed order pair as reverse and a stranger as unmatched', () => {
    const reversed = decodePemBundle(pem('CERTIFICATE', leafDer) + pem('CERTIFICATE', rootDer), NOW)
    expect(reversed.links[0].relation).toBe('a-issued-by-b')
    const unrelated = decodePemBundle(pem('CERTIFICATE', leafDer) + pem('CERTIFICATE', buildCert({ notAfter: '300101000000Z' })), NOW)
    expect(unrelated.links[0].relation).toBe('unmatched')
    expect(unrelated.chainChecks[0].issuerBlock).toBe(null)
    expect(unrelated.stats.expiringSoon).toBe(0)
  })

  it('ignores CSRs when matching issuers', () => {
    const mixed = decodePemBundle(pem('CERTIFICATE', rootDer) + pem('CERTIFICATE REQUEST', buildCsr()), NOW)
    expect(mixed.links).toHaveLength(0)
    expect(mixed.chainChecks).toHaveLength(1)
    expect(mixed.stats.csrs).toBe(1)
  })

  it('normalizes DN comparison', () => {
    expect(normalizeDn('C = US, CN=Example')).toBe('c=us,cn=example')
  })
})

describe('failure safety', () => {
  const der = buildCert()

  it('never throws on truncated DER', () => {
    const half = der.subarray(0, Math.floor(der.length / 2))
    const result = decodePemBundle(pem('CERTIFICATE', half), NOW)
    expect(result.ok).toBe(false)
    expect(result.blocks[0].issue).not.toBe(null)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('never throws on random bytes, empty bodies and wrong PEM types', () => {
    for (const input of [
      pem('CERTIFICATE', Uint8Array.from([0xff, 0xff, 0xff, 0xff])),
      '-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----',
      pem('RSA PRIVATE KEY', der),
      pem('CERTIFICATE', Uint8Array.from(Array.from({ length: 300 }, (_, index) => index % 256))),
    ]) {
      expect(() => decodePemBundle(input, NOW)).not.toThrow()
      expect(() => decodeCertificateDer(Uint8Array.from([0x30, 0x00]), 'CERTIFICATE', NOW)).not.toThrow()
    }
    const wrongType = decodePemBundle(pem('RSA PRIVATE KEY', der), NOW)
    expect(wrongType.blocks[0].issue?.code).toBe('unsupported-type')
    const emptyBody = decodePemBundle('-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----', NOW)
    expect(emptyBody.blocks[0].issue?.code).toBe('empty-body')
  })

  it('reports invalid base64 armour per block', () => {
    const result = decodePemBundle('-----BEGIN CERTIFICATE-----\n@@@@ not base64 @@@@\n-----END CERTIFICATE-----\n', NOW)
    expect(result.blocks[0].issue?.code).toBe('invalid-base64')
    expect(result.ok).toBe(false)
  })

  it('survives hostile non-ASCII and control characters in subject fields', () => {
    const hostile = buildCert({
      subject: nameOf(rdn('2.5.4.3', utf8String('ev\u0000il\u202e.example.com'))),
    })
    const result = decodePemBundle(pem('CERTIFICATE', hostile), NOW)
    const cn = result.blocks[0].info?.subject?.rdns[0][0].value ?? ''
    expect(cn).not.toContain('\u0000')
    expect(cn).not.toContain('\u202e')
    expect(cn).toContain('\uFFFD')
  })

  it('survives a structurally valid but semantically wrong SEQUENCE', () => {
    const nonsense = seq(seq(integerFromHex('02'), integerFromHex('03'), integerFromHex('04')))
    expect(() => decodeCertificateDer(nonsense, 'CERTIFICATE', NOW)).not.toThrow()
    const result = decodePemBundle(pem('CERTIFICATE', nonsense), NOW)
    expect(result.blocks[0].info).toBe(null)
    expect(result.blocks[0].issue?.code).toBe('structure-error')
  })

  it('accepts GeneralizedTime and offsets', () => {
    const generalized = seq(
      seq(
        context(0, integerFromHex('02')),
        integerFromHex('01'),
        seq(oidTlv(SHA256_RSA)),
        ISSUER,
        seq(tlv(0x18, enc('20240101000000Z')), tlv(0x17, enc('260101000000+0100'))),
        SUBJECT,
        rsaSpki(),
      ),
      seq(oidTlv(SHA256_RSA)),
      bitString(new Uint8Array(0)),
    )
    const result = decodePemBundle(pem('CERTIFICATE', generalized), Date.UTC(2025, 0, 1))
    expect(result.blocks[0].info?.validity?.notBeforeIso).toBe('2024-01-01T00:00:00.000Z')
    expect(result.blocks[0].info?.validity?.notAfterIso).toBe('2025-12-31T23:00:00.000Z')
  })

  it('caps the bundle size instead of hanging', () => {
    const many = Array.from({ length: 40 }, () => pem('CERTIFICATE', der)).join('')
    const result = decodePemBundle(many, NOW)
    expect(result.blocks).toHaveLength(32)
    expect(result.issues.some((entry) => entry.code === 'too-large')).toBe(true)
  })
})
