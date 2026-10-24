import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { clearAuthHash, readHashValue, readSessionFromHash } from '@/services/authSession'
import { ApiError } from '@/services/api'

const TYPES = ['signup', 'recovery', 'invite', 'email_change'] as const
type VerifyType = (typeof TYPES)[number]

function verifyType(value: string | null): VerifyType {
  return TYPES.includes(value as VerifyType) ? (value as VerifyType) : 'signup'
}

export function VerifyEmailPage() {
  const { t } = useApp()
  const { verify, adoptSession, refreshAccount } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash') ?? params.get('token')
  const type = verifyType(params.get('type') ?? readHashValue('type'))
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working')
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const hashSession = readSessionFromHash()
    if (hashSession) {
      adoptSession(hashSession)
      clearAuthHash()
      if (type === 'recovery') {
        navigate('/reset-password?ready=1', { replace: true })
        return
      }
      void refreshAccount()
        .then(() => {
          setState('done')
          navigate('/account', { replace: true })
        })
        .catch((caught) => {
          setState('failed')
          setError(caught instanceof ApiError ? caught.message : t('auth.verifyFailed'))
        })
      return
    }
    if (!tokenHash) {
      setState('failed')
      setError(t('auth.verifyMissing'))
      return
    }
    const run = async () => {
      try {
        const response = await verify(tokenHash, type)
        if (type === 'recovery') {
          navigate('/reset-password', { replace: true })
          return
        }
        setState('done')
        if (response.account) {
          navigate('/account', { replace: true })
        }
      } catch (caught) {
        setState('failed')
        setError(caught instanceof ApiError ? caught.message : t('auth.verifyFailed'))
      }
    }
    void run()
  }, [tokenHash, type, verify, navigate, t, adoptSession, refreshAccount])

  return (
    <AuthLayout
      title={t('auth.verifyTitle')}
      subtitle={t('auth.verifySubtitle')}
      footer={
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t('auth.signIn')}
        </Link>
      }
    >
      <div className="space-y-4">
        {state === 'working' ? (
          <Alert tone="info">{t('auth.verifying')}</Alert>
        ) : state === 'done' ? (
          <>
            <Alert tone="success">{t('auth.verified')}</Alert>
            <Link to="/login">
              <Button className="w-full">{t('auth.signIn')}</Button>
            </Link>
          </>
        ) : (
          <>
            <Alert tone="danger" title={t('auth.verifyFailed')}>
              {error}
            </Alert>
            <Link to="/login">
              <Button variant="secondary" className="w-full">
                {t('auth.signIn')}
              </Button>
            </Link>
          </>
        )}
      </div>
    </AuthLayout>
  )
}
