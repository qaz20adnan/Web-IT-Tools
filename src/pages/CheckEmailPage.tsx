import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { Alert, Button } from '@/components/ui'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { ApiError } from '@/services/api'

export function CheckEmailPage() {
  const { t } = useApp()
  const { resendVerification, configured } = useAuth()
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const resend = async () => {
    if (!email) return
    setStatus('sending')
    setError(null)
    try {
      await resendVerification(email)
      setStatus('sent')
    } catch (caught) {
      setStatus('error')
      setError(caught instanceof ApiError ? caught.message : t('auth.genericError'))
    }
  }

  return (
    <AuthLayout
      title={t('auth.checkEmail')}
      subtitle={t('auth.checkEmailBody', { email })}
      footer={
        <Link to="/login" className="font-semibold text-primary hover:underline">
          {t('auth.signIn')}
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex justify-center py-4">
          <span className="rounded-full border border-primary/30 bg-primary/10 p-4 text-primary">
            <MailCheck className="h-8 w-8" />
          </span>
        </div>
        {status === 'sent' ? <Alert tone="success">{t('auth.recoverySent')}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button
          variant="secondary"
          className="w-full"
          loading={status === 'sending'}
          onClick={resend}
          disabled={!configured || !email}
        >
          {t('auth.sendRecovery')}
        </Button>
      </div>
    </AuthLayout>
  )
}
