import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/api'
import {
  isValidEmail,
  isValidPassword,
  isValidUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
} from '@/lib/authValidation'
import type { TranslationKey } from '@/i18n'

function registrationErrorKey(error: ApiError): TranslationKey | null {
  if (error.code === 'already_exists') return 'auth.emailExists'
  if (error.code === 'rate_limited') return 'auth.tooManyAttempts'
  if (error.code === 'timeout') return 'auth.authTimeout'
  if (error.code === 'not_configured' || error.code === 'upstream_error') return 'auth.authUnavailable'
  if (error.code === 'forbidden') return 'auth.registrationDisabled'
  if (error.code === 'invalid_input') return 'auth.invalidRegistration'
  return null
}

export function RegisterPage() {
  const { t } = useApp()
  const { status, account, signUp, configured, config } = useAuth()
  const navigate = useNavigate()
  const localMode = config?.localMode === true
  const passwordMinLength = config?.passwordMinLength ?? PASSWORD_MIN_LENGTH
  const passwordMaxLength = config?.passwordMaxLength ?? PASSWORD_MAX_LENGTH
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated' && account) navigate('/account', { replace: true })
  }, [status, account, navigate])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    const normalizedUsername = username.trim()
    const normalizedEmail = email.trim()
    if (!normalizedUsername || !normalizedEmail || !password) {
      setError(t('auth.requiredFields'))
      return
    }
    if (!isValidUsername(normalizedUsername)) {
      setError(t('auth.invalidUsername'))
      return
    }
    if (!isValidEmail(normalizedEmail)) {
      setError(t('auth.invalidEmail'))
      return
    }
    if (localMode ? password.length > passwordMaxLength : !isValidPassword(password)) {
      setError(localMode ? t('auth.localPasswordTooLong') : t('auth.passwordHint'))
      return
    }
    setSubmitting(true)
    try {
      const response = await signUp({ username: normalizedUsername, email: normalizedEmail, password })
      if (response.needsVerification) {
        navigate(`/check-email?email=${encodeURIComponent(normalizedEmail)}`, { replace: true })
      } else {
        navigate('/account', { replace: true })
      }
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      const key = apiError ? registrationErrorKey(apiError) : null
      const message = key ? t(key) : apiError?.message ?? t('auth.genericError')
      const detail = import.meta.env.DEV && apiError?.detail ? ` (${apiError.detail})` : ''
      setError(`${message}${detail}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.signUp')}
      subtitle={t('auth.protectedNote')}
      footer={
        <span>
          {t('auth.haveAccount')}{' '}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            {t('auth.signIn')}
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
          {localMode ? <Alert tone="info">{t('auth.localAuthNotice')}</Alert> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t('auth.username')} htmlFor="register-username" hint={t('auth.usernameHint')} required>
            <Input
              id="register-username"
              autoComplete="username"
              maxLength={USERNAME_MAX_LENGTH}
              placeholder={t('auth.usernamePlaceholder')}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label={t('auth.email')} htmlFor="register-email" required>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field
            label={t('auth.password')}
            htmlFor="register-password"
            hint={localMode ? t('auth.localPasswordHint') : t('auth.passwordHint')}
            required
          >
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              minLength={localMode ? 1 : passwordMinLength}
              maxLength={passwordMaxLength}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Button type="submit" className="w-full" loading={submitting} disabled={!configured}>
            {t('auth.signUp')}
          </Button>
          <p className="text-center text-[11px] leading-relaxed text-subtle">{t('auth.protectedNote')}</p>
        </form>
      )}
    </AuthLayout>
  )
}
