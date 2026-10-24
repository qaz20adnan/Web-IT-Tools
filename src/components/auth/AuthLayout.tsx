import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, Sparkles } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { APP_NAME, APP_VERSION } from '@/lib/config'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const { t, settings } = useApp()
  return (
    <div className="mx-auto grid min-h-[70vh] w-full max-w-5xl items-center gap-8 py-6 lg:grid-cols-[1fr_430px]">
      <section className="hidden lg:block">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-surface p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,var(--primary)/18,transparent_45%)]" aria-hidden />
          <div className="relative">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {t('app.shortTagline')}
            </div>
            <h2 className="max-w-md text-2xl font-bold tracking-tight">{APP_NAME}</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">{t('app.tagline')}</p>
            <ul className="mt-8 space-y-4 text-sm">
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{t('auth.protectedNote')}</span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{t('auth.serverKeyNote')}</span>
              </li>
            </ul>
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] text-subtle">
          {APP_NAME} · v{APP_VERSION}
        </p>
      </section>

      <section className="mx-auto w-full max-w-md">
        <div className="mb-5 flex items-center justify-between gap-3 lg:hidden">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold">
            <ArrowLeft className={cn('h-4 w-4', settings.language === 'ar' && 'rotate-180')} />
            {t('common.back')}
          </Link>
          <span className="text-xs text-subtle">{APP_NAME}</span>
        </div>
        <div className="card p-6 sm:p-7">
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
          {footer ? <div className="mt-6 border-t border-line pt-4 text-center text-xs text-muted">{footer}</div> : null}
        </div>
        <p className="mt-4 text-center text-[11px] text-subtle">Built by Eng. Adnan Al Qadi · م. عدنان القاضي</p>
        <p className="mt-3 text-center text-[11px] text-subtle">
          <Link to="/" className="hover:text-text">
            {t('auth.continueGuest')}
          </Link>
        </p>
      </section>
    </div>
  )
}
