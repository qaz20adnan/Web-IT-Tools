import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { useApp } from '@/context/AppContext'

export function NotFoundPage() {
  const { t } = useApp()
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <Compass className="h-10 w-10 text-subtle" />
      <p className="mt-4 text-4xl font-bold tracking-tight">404</p>
      <h1 className="mt-2 text-lg font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="mt-1 max-w-md text-sm text-muted">{t('errors.notFoundBody')}</p>
      <Link to="/" className="btn btn-primary mt-5 text-sm">{t('errors.home')}</Link>
    </div>
  )
}

export default NotFoundPage
