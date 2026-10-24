import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { LockKeyhole } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useApp } from '@/context/AppContext'
import { Button } from '@/components/ui'

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { status, account } = useAuth()
  const { t } = useApp()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div role="status" className="flex min-h-[40vh] items-center justify-center text-sm text-muted">
        {t('auth.loading')}
      </div>
    )
  }

  if (status !== 'authenticated' || !account) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
  }

  if (permission && !account.permissions.includes(permission as never)) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-lg flex-col items-center justify-center gap-3 text-center">
        <LockKeyhole className="h-8 w-8 text-warning" />
        <h1 className="text-lg font-semibold">{t('auth.permissionDenied')}</h1>
        <Link to="/account">
          <Button variant="secondary" size="sm">
            {t('auth.account')}
          </Button>
        </Link>
      </div>
    )
  }

  return <>{children}</>
}
