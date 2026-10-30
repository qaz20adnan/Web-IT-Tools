import { Link } from 'react-router-dom'
import { useApp } from '@/context/AppContext'
import { APP_FOUNDER, APP_NAME } from '@/lib/config'
import { cn } from '@/lib/utils'

export function BrandMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/icons/adnan-tech-favicon.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={cn('shrink-0 rounded-xl shadow-[0_0_24px_-10px_rgba(53,214,242,0.6)]', className)}
      style={{ width: size, height: size }}
    />
  )
}

export function BrandLogo({
  to = '/',
  compact = false,
  className,
  onClick,
}: {
  to?: string
  compact?: boolean
  className?: string
  onClick?: () => void
}) {
  const { t, settings } = useApp()
  const arabic = settings.language === 'ar'

  if (compact) {
    return (
      <Link
        to={to}
        onClick={onClick}
        className={cn('nx-brand-lockup group min-w-0', className)}
        aria-label={`${APP_NAME} — ${t('brand.homeAria')}`}
      >
        <BrandMark size={30} />
      </Link>
    )
  }

  return (
    <Link
      to={to}
      onClick={onClick}
      dir={arabic ? 'rtl' : 'ltr'}
      className={cn('nx-brand-lockup group min-w-0', arabic && 'is-arabic', className)}
      aria-label={`${APP_NAME} — ${APP_FOUNDER}`}
    >
      <BrandMark size={36} />
      <span className="min-w-0">
        <span className="nx-brand-name block truncate">
          {t('brand.nameFirst')} <span className="text-primary">{t('brand.nameAccent')}</span>
        </span>
        <span className="nx-brand-sub block truncate">{t('brand.lockupSub')}</span>
      </span>
    </Link>
  )
}
