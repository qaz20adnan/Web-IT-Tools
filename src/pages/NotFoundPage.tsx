import { Link } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { BrandMark } from '@/components/brand/BrandLogo'

export function NotFoundPage() {
  const { t } = useApp()
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <BrandMark size={44} />
      <p className="mt-4 text-4xl font-bold tracking-tight">404</p>
      <h1 className="mt-2 text-lg font-semibold">{t('errors.notFoundTitle')}</h1>
      <p className="mt-1 max-w-md text-sm text-muted">{t('errors.notFoundBody')}</p>
      <Link to="/" className="btn btn-primary mt-5 text-sm">{t('errors.home')}</Link>
    </div>
  )
}

export default NotFoundPage
