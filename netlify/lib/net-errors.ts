import { HttpError } from './http'

/**
 * Transport failures reach Node as free-form strings that can contain internal
 * addresses, ports or library wording. These helpers convert them into a small,
 * stable set of sentences the interface can show without leaking internals.
 */

/**
 * `fetch` wraps the real socket failure in `cause`, so a code check that stops at
 * the outer error sees nothing. Both layers are inspected.
 */
function codeOf(error: unknown): string {
  const chain = [error, (error as { cause?: unknown } | null)?.cause]
  for (const entry of chain) {
    const code = (entry as NodeJS.ErrnoException | null)?.code
    if (typeof code === 'string' && code) return code.toUpperCase()
  }
  return ''
}

function messageOf(error: unknown): string {
  const outer = error instanceof Error ? error.message : ''
  const cause = (error as { cause?: unknown } | null)?.cause
  const inner = cause instanceof Error ? cause.message : ''
  return `${outer} ${inner}`.trim()
}

export function describeHttpFailure(error: unknown): string {
  if (error instanceof HttpError) return error.message
  const code = codeOf(error)
  const message = messageOf(error)
  if (code === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(message)) return 'The server refused the connection.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|ENOTFOUND/i.test(message)) return 'The hostname did not resolve.'
  if (code === 'ETIMEDOUT' || /timed out|ETIMEDOUT/i.test(message)) return 'The request timed out before the server answered.'
  if (code === 'ECONNRESET' || /ECONNRESET|socket hang up|closed/i.test(message)) return 'The server closed the connection before answering.'
  if (code === 'ENETUNREACH' || /ENETUNREACH|network unreachable/i.test(message)) return 'This platform has no route to that network.'
  if (/redirect/i.test(message)) return 'The redirect chain could not be followed safely.'
  if (/private|loopback|reserved|blocked/i.test(message)) return 'The address is private or reserved and cannot be probed from the internet.'
  return 'The HTTP request could not be completed from this platform.'
}

export function describeTlsFailure(error: unknown): string {
  const code = codeOf(error)
  const message = messageOf(error)
  if (error instanceof HttpError) return error.message
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'The certificate does not cover this hostname.'
  if (/expired/i.test(message)) return 'The certificate has expired.'
  if (/revoked/i.test(message)) return 'The certificate was revoked.'
  if (/unable to verify|self[- ]signed|not after|not before|certificate/i.test(message)) return 'The certificate chain could not be verified.'
  if (code === 'ETIMEDOUT' || /timed out/i.test(message)) return 'The TLS handshake timed out.'
  if (code === 'ECONNREFUSED') return 'The endpoint refused the connection.'
  if (code === 'ENOTFOUND' || /getaddrinfo/i.test(message)) return 'The hostname did not resolve.'
  if (/no peer certificate/i.test(message)) return 'The endpoint returned no certificate.'
  if (/alert|handshake|protocol|cipher|reset|closed/i.test(message)) return 'The TLS handshake failed before a certificate was returned.'
  return 'TLS inspection failed for this endpoint.'
}
