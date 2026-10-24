import type { AuthTokens } from '@/types'

export const AUTH_SESSION_KEY = 'nexora.auth.session.v1'

export function readStoredSession(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY)
    if (!raw) return null
    const stored = JSON.parse(raw) as Partial<AuthTokens> | null
    if (!stored?.accessToken || !stored.refreshToken || !Number.isFinite(stored.expiresAt)) return null
    return stored as AuthTokens
  } catch {
    return null
  }
}

export function writeStoredSession(tokens: AuthTokens | null): void {
  try {
    if (!tokens) {
      localStorage.removeItem(AUTH_SESSION_KEY)
      return
    }
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(tokens))
  } catch {
    /* storage can be unavailable in private mode */
  }
}

/**
 * Reads the implicit-flow session that Supabase appends to the URL fragment
 * after email confirmation or recovery. Returns null when no valid fragment
 * is present.
 */
export function clearAuthHash(): void {
  if (typeof window === 'undefined' || !window.location.hash) return
  try {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
  } catch {
    /* history can be unavailable in restricted contexts */
  }
}

export function readHashValue(key: string): string | null {
  if (typeof window === 'undefined' || !window.location.hash) return null
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get(key)
}

export function readSessionFromHash(): AuthTokens | null {
  if (typeof window === 'undefined' || !window.location.hash) return null
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return null
  const expiresIn = Number(params.get('expires_in'))
  const expiresAt = Number(params.get('expires_at'))
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresAt) && expiresAt > 0
      ? expiresAt * 1000
      : Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
  }
}
