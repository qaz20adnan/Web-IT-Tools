import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert, Button, Field, Input, PasswordInput } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/api'

export function RegisterPage() {
  const { t } = useApp()
  const { status, account, signUp, configured } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (status === 'authenticated' && account) navigate('/account', { replace: true })
  }, [status, account, navigate])

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!email.trim() || !password || !confirm) {
      setError(t('auth.requiredFields'))
      return
    }
    if (password.length < 10) {
      setError(t('auth.passwordHint'))
      return
    }
    if (password !== confirm) {
      setError(t('auth.passwordsMismatch'))
      return
    }
    setSubmitting(true)
    try {
      const response = await signUp({ email: email.trim(), password, fullName: fullName.trim() || undefined })
      if (response.needsVerification) {
        navigate(`/check-email?email=${encodeURIComponent(email.trim())}`, { replace: true })
      } else {
        navigate('/account', { replace: true })
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('auth.genericError'))
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
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t('auth.fullName')} htmlFor="register-name">
            <Input
              id="register-name"
              autoComplete="name"
              maxLength={120}
              placeholder={t('auth.fullNamePlaceholder')}
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label={t('auth.email')} htmlFor="register-email" required>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label={t('auth.password')} htmlFor="register-password" hint={t('auth.passwordHint')} required>
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Field label={t('auth.confirmPassword')} htmlFor="register-confirm" required>
            <PasswordInput
              id="register-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
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
