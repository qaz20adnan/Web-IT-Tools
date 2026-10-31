import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/api'
import { describeError } from '@/services/apiError'
import { safeRedirect } from '@/lib/redirect'

interface LocationState {
  from?: string
  message?: string
}

export function LoginPage() {
  const { t, settings } = useApp()
  const { status, account, signIn, configured, config } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const state = (location.state ?? {}) as LocationState
  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated' && account) {
      navigate(safeRedirect(state.from), { replace: true })
    }
  }, [status, account, navigate, state.from])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setUnverified(false)
    if (!email.trim() || !password) {
      setError(t('auth.requiredFields'))
      return
    }
    setSubmitting(true)
    try {
      await signIn(email.trim(), password)
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      if (apiError?.code === 'email_not_verified') {
        setUnverified(true)
        setError(t('auth.emailUnverified'))
      } else {
        setError(describeError(caught, settings.language, t('auth.genericError')))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.signIn')}
      subtitle={t('auth.welcomeBack')}
      footer={
        <span>
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-semibold text-primary hover:underline">
            {t('auth.signUp')}
          </Link>
        </span>
      }
    >
      {!configured ? (
        <Alert tone="warning" title={t('auth.notConfigured')}>
          {t('auth.notConfiguredBody')}
        </Alert>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {config?.localMode ? <Alert tone="info">{t('auth.localAuthNotice')}</Alert> : null}
          {params.get('verify') === '1' ? (
            <Alert tone="success" title={t('auth.checkEmail')}>
              {t('auth.checkEmailBody', { email: params.get('email') ?? '' })}
            </Alert>
          ) : null}
          {params.get('reset') === '1' ? <Alert tone="success">{t('auth.passwordUpdated')}</Alert> : null}
          {state.message ? <Alert tone="info">{state.message}</Alert> : null}
          {error ? (
            <Alert tone="danger">
              {error}
              {unverified ? (
                <>
                  {' '}
                  <Link to={`/check-email?email=${encodeURIComponent(email)}`} className="font-semibold underline">
                    {t('auth.checkEmail')}
                  </Link>
                </>
              ) : null}
            </Alert>
          ) : null}

          <Field label={t('auth.email')} htmlFor="login-email" required>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label={t('auth.password')} htmlFor="login-password" required>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </Field>

          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-xs font-semibold text-primary hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          </div>

          <Button type="submit" className="w-full" loading={submitting} disabled={!configured}>
            {t('auth.signIn')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
