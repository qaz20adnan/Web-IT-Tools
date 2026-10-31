import { translate } from '@/i18n'
import { ApiError } from '@/services/api'
import type { ApiErrorCode, Language } from '@/types'

/**
 * Codes whose `detail` is the identity provider's own wording ("invalid_grant",
 * "Email not confirmed"), which restates the translated message in jargon. The
 * server already decided every `detail` it sends is safe for a browser; this set
 * is about noise, not secrecy.
 */
const DETAIL_IS_INTERNAL: ReadonlySet<ApiErrorCode> = new Set([
  'invalid_credentials',
  'email_not_verified',
  'already_exists',
  'unauthorized',
])

/**
 * The one mapping from a caught value to text a person can read.
 *
 * The server's own `message` wins over a per-code translation: it is written
 * where the failure is actually understood, so it is nearly always the more
 * precise of the two. Three cases are exceptions, and each is a message that was
 * addressed to the wrong reader — `not_configured` names environment variables
 * that mean nothing to a visitor, a status of 0 never reached a server that could
 * describe it, and a `Retry-After` window is a number the visitor can count down
 * from rather than a sentence to re-read.
 */
export function describeError(error: unknown, lang: Language, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'not_configured') return translate(lang, 'errors.not_configured')
    // status 0 is either a cancelled request or a request that never arrived.
    if (error.status === 0) return error.code === 'timeout' ? error.message : translate(lang, 'errors.network')
    if (error.status === 429 && error.retryAfterSeconds !== null) {
      return translate(lang, 'errors.retryAfter', { seconds: error.retryAfterSeconds })
    }
    if (error.detail && !DETAIL_IS_INTERNAL.has(error.code)) return `${error.message} — ${error.detail}`
    return error.message
  }
  if (error instanceof Error) return error.message || fallback
  return fallback
}
