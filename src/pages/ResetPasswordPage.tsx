import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Field, PasswordInput } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { clearAuthHash, readSessionFromHash } from '@/services/authSession'
import { ApiError } from '@/services/api'
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/authValidation'

export function ResetPasswordPage() {
  const { t } = useApp()
  const { verify, resetPassword, adoptSession, accessToken } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash') ?? params.get('token')
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const hashSession = readSessionFromHash()
    if (hashSession) {
      adoptSession(hashSession)
      clearAuthHash()
      setReady(true)
      return
    }
    if (params.get('ready') === '1' && accessToken()) {
      setReady(true)
      return
    }
    if (!tokenHash) {
      setError(t('auth.verifyMissing'))
      return
    }
    const run = async () => {
      try {
        await verify(tokenHash, 'recovery')
        setReady(true)
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : t('auth.verifyFailed'))
      }
    }
    void run()
  }, [tokenHash, verify, t, adoptSession, accessToken, params])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!password || !confirm) {
      setError(t('auth.requiredFields'))
      return
    }
    if (!isValidPassword(password)) {
      setError(t('auth.passwordHint'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.passwordsMismatch'))
      return
    }
    setSubmitting(true)
    try {
      await resetPassword(password)
      navigate('/login?reset=1', { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('auth.genericError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.resetTitle')}
      subtitle={t('auth.resetSubtitle')}
      footer={
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t('auth.signIn')}
        </Link>
      }
    >
      {!ready ? (
        <Alert tone={error ? 'danger' : 'info'}>{error ?? t('auth.verifying')}</Alert>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t('auth.newPassword')} htmlFor="reset-password" hint={t('auth.passwordHint')} required>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="reset-confirm" required>
            <PasswordInput
              id="reset-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Button type="submit" className="w-full" loading={submitting}>
            {t('auth.updatePassword')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
