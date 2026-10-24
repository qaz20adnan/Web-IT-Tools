import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ApiError,
  authChangePassword,
  authDeleteAccount,
  authExportData,
  authLogin,
  authLogout,
  authMe,
  authRecover,
  authRefresh,
  authRegister,
  authResendVerification,
  authResetPassword,
  authUpdateProfile,
  authVerify,
  getAuthConfig,
  setAuthTokenProvider,
  type AuthSessionResponse,
} from '@/services/api'
import type { AccountPayload, AuthConfig, AuthTokens, Permission } from '@/types'
import { readStoredSession, writeStoredSession } from '@/services/authSession'

const REFRESH_MARGIN_MS = 120_000

type AuthStatus = 'loading' | 'guest' | 'authenticated'

interface AuthContextValue {
  status: AuthStatus
  account: AccountPayload | null
  config: AuthConfig | null
  configured: boolean
  busy: boolean
  signIn: (email: string, password: string) => Promise<AuthSessionResponse>
  signUp: (input: { email: string; password: string; fullName?: string }) => Promise<AuthSessionResponse>
  signOut: () => Promise<void>
  recover: (email: string) => Promise<AuthSessionResponse>
  resendVerification: (email: string) => Promise<AuthSessionResponse>
  verify: (tokenHash: string, type: 'signup' | 'recovery' | 'invite' | 'email_change') => Promise<AuthSessionResponse>
  resetPassword: (newPassword: string) => Promise<void>
  refreshAccount: () => Promise<AccountPayload | null>
  updateProfile: (fullName: string) => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  deleteAccount: (password: string) => Promise<void>
  exportData: () => Promise<Record<string, unknown> & { ok: true; exportedAt: string }>
  hasPermission: (permission: Permission) => boolean
  accessToken: () => string | null
  adoptSession: (tokens: AuthTokens) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [account, setAccount] = useState<AccountPayload | null>(null)
  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [tokenExpiry, setTokenExpiry] = useState<number | null>(() => readStoredSession()?.expiresAt ?? null)
  const sessionRef = useRef<AuthTokens | null>(readStoredSession())
  const refreshRef = useRef<Promise<AuthTokens | null> | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const storeSession = useCallback((tokens: AuthTokens | null) => {
    sessionRef.current = tokens
    writeStoredSession(tokens)
    setTokenExpiry(tokens?.expiresAt ?? null)
  }, [])

  const clearSession = useCallback(() => {
    storeSession(null)
    setAccount(null)
    setStatus('guest')
  }, [storeSession])

  const refreshTokens = useCallback(async (): Promise<AuthTokens | null> => {
    if (refreshRef.current) return refreshRef.current
    const current = sessionRef.current
    if (!current?.refreshToken) return null
    const task = (async () => {
      try {
        const response = await authRefresh(current.refreshToken)
        const tokens = response.tokens ?? null
        if (!tokens) {
          clearSession()
          return null
        }
        storeSession(tokens)
        if (response.account) setAccount(response.account)
        return tokens
      } catch {
        clearSession()
        return null
      } finally {
        refreshRef.current = null
      }
    })()
    refreshRef.current = task
    return task
  }, [clearSession, storeSession])

  const freshAccessToken = useCallback(async (): Promise<string | null> => {
    const current = sessionRef.current
    if (!current) return null
    if (current.expiresAt - REFRESH_MARGIN_MS > Date.now()) return current.accessToken
    const refreshed = await refreshTokens()
    return refreshed?.accessToken ?? null
  }, [refreshTokens])

  useEffect(() => {
    setAuthTokenProvider(() => sessionRef.current?.accessToken ?? null)
    return () => setAuthTokenProvider(null)
  }, [])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      try {
        const nextConfig = await getAuthConfig()
        if (cancelled) return
        setConfig(nextConfig)
        if (!nextConfig.configured) {
          setStatus('guest')
          return
        }
        let token = await freshAccessToken()
        if (!token) {
          setStatus('guest')
          return
        }
        let me
        try {
          me = await authMe(token)
        } catch (error) {
          if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) throw error
          token = (await refreshTokens())?.accessToken ?? null
          if (!token) {
            setStatus('guest')
            return
          }
          me = await authMe(token)
        }
        if (cancelled) return
        setAccount(me.account)
        setStatus('authenticated')
      } catch {
        if (!cancelled) setStatus('guest')
      }
    }
    void bootstrap()
    return () => {
      cancelled = true
    }
  }, [freshAccessToken, refreshTokens])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const current = sessionRef.current
    if (!current) return
    const delay = Math.max(30_000, current.expiresAt - REFRESH_MARGIN_MS - Date.now())
    timerRef.current = setTimeout(() => {
      void refreshTokens()
    }, delay)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [status, tokenExpiry, refreshTokens])

  const applySession = useCallback(
    (response: AuthSessionResponse) => {
      if (response.tokens) storeSession(response.tokens)
      if (response.account) {
        setAccount(response.account)
        setStatus('authenticated')
      }
      return response
    },
    [storeSession],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      setBusy(true)
      try {
        return applySession(await authLogin({ email, password }))
      } finally {
        setBusy(false)
      }
    },
    [applySession],
  )

  const signUp = useCallback(
    async (input: { email: string; password: string; fullName?: string }) => {
      setBusy(true)
      try {
        return applySession(await authRegister(input))
      } finally {
        setBusy(false)
      }
    },
    [applySession],
  )

  const signOut = useCallback(async () => {
    const token = sessionRef.current?.accessToken
    setBusy(true)
    try {
      if (token) await authLogout(token).catch(() => undefined)
    } finally {
      clearSession()
      setBusy(false)
    }
  }, [clearSession])

  const recover = useCallback((email: string) => authRecover(email), [])

  const resendVerification = useCallback((email: string) => authResendVerification(email), [])

  const verify = useCallback(
    async (tokenHash: string, type: 'signup' | 'recovery' | 'invite' | 'email_change') => {
      setBusy(true)
      try {
        const response = await authVerify(tokenHash, type)
        if (response.tokens) storeSession(response.tokens)
        if (response.account) {
          setAccount(response.account)
          setStatus('authenticated')
        }
        return response
      } finally {
        setBusy(false)
      }
    },
    [storeSession],
  )

  const resetPassword = useCallback(
    async (newPassword: string) => {
      const token = await freshAccessToken()
      if (!token) throw new ApiError('unauthorized', 'The recovery session has expired. Request a new link.', 401)
      await authResetPassword(newPassword, token)
      clearSession()
    },
    [clearSession, freshAccessToken],
  )

  const refreshAccount = useCallback(async () => {
    const token = await freshAccessToken()
    if (!token) {
      clearSession()
      return null
    }
    const response = await authMe(token)
    setAccount(response.account)
    setStatus('authenticated')
    return response.account
  }, [clearSession, freshAccessToken])

  const updateProfile = useCallback(
    async (fullName: string) => {
      const token = await freshAccessToken()
      await authUpdateProfile(fullName, token ?? undefined)
      await refreshAccount()
    },
    [freshAccessToken, refreshAccount],
  )

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      const token = await freshAccessToken()
      await authChangePassword(currentPassword, newPassword, token ?? undefined)
    },
    [freshAccessToken],
  )

  const deleteAccount = useCallback(
    async (password: string) => {
      const token = await freshAccessToken()
      await authDeleteAccount(password, token ?? undefined)
      clearSession()
    },
    [clearSession, freshAccessToken],
  )

  const exportData = useCallback(async () => {
    const token = await freshAccessToken()
    return authExportData(token ?? undefined)
  }, [freshAccessToken])

  const hasPermission = useCallback(
    (permission: Permission) => Boolean(account?.permissions.includes(permission)),
    [account],
  )

  const accessToken = useCallback(() => sessionRef.current?.accessToken ?? null, [])

  const adoptSession = useCallback(
    (tokens: AuthTokens) => {
      storeSession(tokens)
    },
    [storeSession],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      config,
      configured: Boolean(config?.configured),
      busy,
      signIn,
      signUp,
      signOut,
      recover,
      resendVerification,
      verify,
      resetPassword,
      refreshAccount,
      updateProfile,
      changePassword,
      deleteAccount,
      exportData,
      hasPermission,
      accessToken,
      adoptSession,
    }),
    [
      status,
      account,
      config,
      busy,
      signIn,
      signUp,
      signOut,
      recover,
      resendVerification,
      verify,
      resetPassword,
      refreshAccount,
      updateProfile,
      changePassword,
      deleteAccount,
      exportData,
      hasPermission,
      accessToken,
      adoptSession,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
