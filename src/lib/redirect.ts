/**
 * Returns an internal path safe to navigate to after sign-in.
 *
 * Rejects absolute URLs, protocol-relative URLs, backslash tricks and control
 * characters so `state.from` can never become an open redirect.
 */
export function safeRedirect(value: unknown, fallback = '/account'): string {
  if (typeof value !== 'string') return fallback
  const target = value.trim()
  if (!target.startsWith('/')) return fallback
  if (target.startsWith('//') || target.startsWith('/\\')) return fallback
  if (target.includes('://') || target.includes('\\')) return fallback
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(target)) return fallback
  return target
}
