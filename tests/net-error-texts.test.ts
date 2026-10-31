import { describe, expect, it } from 'vitest'
import { HttpError } from '../netlify/lib/http'
import { describeHttpFailure, describeTlsFailure } from '../netlify/lib/net-errors'

/**
 * Every network and TLS probe can fail with a raw Node transport error whose
 * message contains an internal address, a port or a library sentence — and the
 * handlers hand these sentences straight to the browser as the user-visible
 * explanation. Two properties matter: the wording must come from the small fixed
 * vocabulary, and nothing that identifies the platform's own network may survive.
 */

const HTTP_VOCABULARY = [
  'The server refused the connection.',
  'The hostname did not resolve.',
  'The request timed out before the server answered.',
  'The server closed the connection before answering.',
  'This platform has no route to that network.',
  'The redirect chain could not be followed safely.',
  'The address is private or reserved and cannot be probed from the internet.',
  'The HTTP request could not be completed from this platform.',
]

const TLS_VOCABULARY = [
  'The certificate does not cover this hostname.',
  'The certificate has expired.',
  'The certificate was revoked.',
  'The certificate chain could not be verified.',
  'The TLS handshake timed out.',
  'The endpoint refused the connection.',
  'The hostname did not resolve.',
  'The endpoint returned no certificate.',
  'The TLS handshake failed before a certificate was returned.',
  'TLS inspection failed for this endpoint.',
]

function errno(code: string, inner: string): Error {
  // `fetch` and the socket APIs wrap the real failure, so the code usually lives one level down.
  return Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error(inner), { code }) })
}

/** The shape Node actually produces: the outer message says nothing, the cause carries only a `code`. */
function causeCodeOnly(code: string): Error {
  return Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('a sentence with no token'), { code }) })
}

describe('the code is read from the cause, not only from the outer error', () => {
  const cases: Array<[string, string]> = [
    ['ECONNREFUSED', 'The server refused the connection.'],
    ['ENOTFOUND', 'The hostname did not resolve.'],
    ['EAI_AGAIN', 'The hostname did not resolve.'],
    ['ETIMEDOUT', 'The request timed out before the server answered.'],
    ['ECONNRESET', 'The server closed the connection before answering.'],
    ['ENETUNREACH', 'This platform has no route to that network.'],
  ]

  it.each(cases)('a bare %s in the cause still names the failure', (code, expected) => {
    expect(describeHttpFailure(causeCodeOnly(code))).toBe(expected)
  })

  it.each([
    ['ETIMEDOUT', 'The TLS handshake timed out.'],
    ['ECONNREFUSED', 'The endpoint refused the connection.'],
    ['ENOTFOUND', 'The hostname did not resolve.'],
  ])('TLS reads a bare %s in the cause too', (code, expected) => {
    expect(describeTlsFailure(causeCodeOnly(code))).toBe(expected)
  })

  it('does not look past the cause for a code', () => {
    expect(describeHttpFailure(causeCodeOnly('ERR_TLS_CERT_ALTNAME_INVALID'))).toBe(
      'The HTTP request could not be completed from this platform.',
    )
  })
})

describe('describeHttpFailure answers from a fixed vocabulary', () => {
  const cases: Array<[string, unknown, string]> = [
    ['refused by code', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), 'The server refused the connection.'],
    ['refused by cause', errno('ECONNREFUSED', 'connect ECONNREFUSED 10.0.4.17:8080'), 'The server refused the connection.'],
    ['refused by wording', new Error('Connection refused by the peer'), 'The server refused the connection.'],
    ['not resolved by code', Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }), 'The hostname did not resolve.'],
    ['temporary DNS failure', Object.assign(new Error('lookup failed'), { code: 'EAI_AGAIN' }), 'The hostname did not resolve.'],
    ['not resolved by wording', new Error('getaddrinfo ENOTFOUND api.internal'), 'The hostname did not resolve.'],
    ['timed out', Object.assign(new Error('read failed'), { code: 'ETIMEDOUT' }), 'The request timed out before the server answered.'],
    ['timed out by wording', new Error('The operation timed out'), 'The request timed out before the server answered.'],
    ['reset', Object.assign(new Error('socket'), { code: 'ECONNRESET' }), 'The server closed the connection before answering.'],
    ['hang up', new Error('socket hang up'), 'The server closed the connection before answering.'],
    ['closed', new Error('socket closed unexpectedly'), 'The server closed the connection before answering.'],
    ['no route', Object.assign(new Error('send'), { code: 'ENETUNREACH' }), 'This platform has no route to that network.'],
    ['no route by wording', new Error('network unreachable while connecting'), 'This platform has no route to that network.'],
    ['redirect', new Error('Maximum redirect count reached to http://169.254.169.254'), 'The redirect chain could not be followed safely.'],
    ['blocked host', new Error('the address is private and was blocked'), 'The address is private or reserved and cannot be probed from the internet.'],
    ['loopback', new Error('loopback target is not allowed'), 'The address is private or reserved and cannot be probed from the internet.'],
    ['anything else', new Error('some library said something odd'), 'The HTTP request could not be completed from this platform.'],
  ]

  it.each(cases)('%s', (_label, error, expected) => {
    expect(describeHttpFailure(error)).toBe(expected)
  })

  it('passes an HttpError through with its own message', () => {
    const error = new HttpError(403, 'blocked_host', 'Private or reserved addresses are not allowed.')
    expect(describeHttpFailure(error)).toBe('Private or reserved addresses are not allowed.')
  })

  it('survives a thrown value that is not an Error at all', () => {
    for (const value of [undefined, null, 'ECONNREFUSED 127.0.0.1:3128', 42, { code: 'ECONNREFUSED' }]) {
      expect(HTTP_VOCABULARY).toContain(describeHttpFailure(value))
    }
  })

  it('reads the code from the outer error when the cause carries none', () => {
    const error = Object.assign(new Error('read ECONNRESET'), { cause: new Error('inner') })
    expect(describeHttpFailure(error)).toBe('The server closed the connection before answering.')
  })

  it.each(HTTP_VOCABULARY)('keeps "%s" free of addresses', (sentence) => {
    expect(sentence).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
  })

  it('never repeats an internal address, port or library sentence', () => {
    const leaks = [
      errno('ECONNREFUSED', 'connect ECONNREFUSED 10.0.4.17:5432'),
      errno('ECONNRESET', 'read ECONNRESET 127.0.0.1:11434'),
      new Error('getaddrinfo ENOTFOUND db.internal.svc.cluster.local:5432'),
      new Error('socket closed after 30000ms on 192.168.1.254:631'),
      new Error('redirect loop towards 169.254.169.254/latest/meta-data'),
      Object.assign(new Error('node:internal/deps/undici:1234'), { code: 'UND_ERR_SOCKET' }),
    ]
    for (const error of leaks) {
      const answer = describeHttpFailure(error)
      expect(HTTP_VOCABULARY).toContain(answer)
      expect(answer).not.toMatch(/\d/)
      expect(answer).not.toMatch(/internal|undici|cluster|svc|meta-data|11434|5432|631/)
    }
  })
})

describe('describeTlsFailure answers from a fixed vocabulary', () => {
  const cases: Array<[string, unknown, string]> = [
    ['name mismatch', Object.assign(new Error('ERR_TLS_CERT_ALTNAME_INVALID'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), 'The certificate does not cover this hostname.'],
    ['expired', new Error('certificate has expired'), 'The certificate has expired.'],
    ['revoked', new Error('certificate was revoked'), 'The certificate was revoked.'],
    ['self signed', new Error('unable to verify the first certificate'), 'The certificate chain could not be verified.'],
    ['self signed wording', new Error('self-signed certificate detected'), 'The certificate chain could not be verified.'],
    ['validity window', new Error('certificate is not yet valid (not before) 2030'), 'The certificate chain could not be verified.'],
    ['handshake timeout', Object.assign(new Error('handshake'), { code: 'ETIMEDOUT' }), 'The TLS handshake timed out.'],
    ['timed out by wording', new Error('TLS handshake timed out after 7000ms'), 'The TLS handshake timed out.'],
    ['refused', Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }), 'The endpoint refused the connection.'],
    ['not resolved', Object.assign(new Error('lookup'), { code: 'ENOTFOUND' }), 'The hostname did not resolve.'],
    ['not resolved by wording', new Error('getaddrinfo ENOTFOUND internal.host'), 'The hostname did not resolve.'],
    ['no certificate', new Error('no peer certificate available'), 'The endpoint returned no certificate.'],
    ['alert', new Error('SSL alert number 40'), 'The TLS handshake failed before a certificate was returned.'],
    ['cipher', new Error('no shared cipher'), 'The TLS handshake failed before a certificate was returned.'],
    ['reset', new Error('connection reset by peer'), 'The TLS handshake failed before a certificate was returned.'],
    ['anything else', new Error('something unknown happened'), 'TLS inspection failed for this endpoint.'],
  ]

  it.each(cases)('%s', (_label, error, expected) => {
    expect(describeTlsFailure(error)).toBe(expected)
  })

  it('answers the exact sentence the certificate inspector raises', () => {
    // This wording comes from `inspectCertificate()` (netlify/lib/tls.ts:48); the two
    // files must not drift apart, and an earlier `certificate` match used to swallow it.
    expect(describeTlsFailure(new Error('No peer certificate was returned.'))).toBe('The endpoint returned no certificate.')
  })

  it('answers the expiry sentence before the generic certificate one', () => {
    expect(describeTlsFailure(new Error('certificate has expired and cannot be verified'))).toBe('The certificate has expired.')
  })

  it('passes an HttpError through before matching its message', () => {
    const error = new HttpError(403, 'blocked_host', 'Local hosts are disabled on this deployment.')
    expect(describeTlsFailure(error)).toBe('Local hosts are disabled on this deployment.')
  })

  it('survives a thrown value that is not an Error at all', () => {
    for (const value of [undefined, null, 'handshake failure', 7]) {
      expect(TLS_VOCABULARY).toContain(describeTlsFailure(value))
    }
  })

  it('never repeats an internal address, port or library sentence', () => {
    const leaks = [
      errno('ECONNREFUSED', 'connect ECONNREFUSED 10.0.4.17:443'),
      new Error('unable to verify the first certificate from 127.0.0.1:11434'),
      new Error('node:internal/tls: handshake protocol error'),
      new Error('SSL alert number 80 received from 192.168.0.10:8443'),
    ]
    for (const error of leaks) {
      const answer = describeTlsFailure(error)
      expect(TLS_VOCABULARY).toContain(answer)
      expect(answer).not.toMatch(/\d+\.\d+\.\d+\.\d+/)
      expect(answer).not.toContain('node:internal')
    }
  })
})
