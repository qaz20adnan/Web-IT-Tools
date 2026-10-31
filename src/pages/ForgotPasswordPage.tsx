import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Field, Input } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { describeError } from '@/services/apiError'

export function ForgotPasswordPage() {
  const { t, settings } = useApp()
  const { recover, configured } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError(t('auth.requiredFields'))
      return
    }
    setSubmitting(true)
    try {
      await recover(email.trim())
      setSent(true)
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t('auth.signIn')}
        </Link>
      }
    >
      {!configured ? (
        <Alert tone="warning" title={t('auth.notConfigured')}>
          {t('auth.notConfiguredBody')}
        </Alert>
      ) : sent ? (
        <div className="space-y-4">
          <Alert tone="success" title={t('auth.checkEmail')}>
            {t('auth.recoverySent')}
          </Alert>
          <Button variant="secondary" className="w-full" onClick={() => setSent(false)}>
            {t('auth.sendRecovery')}
          </Button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t('auth.email')} htmlFor="recover-email" required>
            <Input
              id="recover-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </Field>
          <Button type="submit" className="w-full" loading={submitting} disabled={!configured}>
            {t('auth.sendRecovery')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
