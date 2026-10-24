import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Languages, LogIn, Menu, Moon, Palette, Search, Settings, Sun, UserRound, WifiOff } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useHealth } from '@/hooks/useHealth'
import { cn } from '@/lib/utils'

export function Topbar({ onOpenMenu, onOpenPalette }: { onOpenMenu: () => void; onOpenPalette: () => void }) {
  const { t, settings, setLanguage, cycleTheme, isDark } = useApp()
  const { status, account } = useAuth()
  const { data: health } = useHealth()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const aiConfigured = health?.services.ai.configured ?? false

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-[var(--bg)]/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text lg:hidden"
          aria-label={t('topbar.openMenu')}
        >
          <Menu className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onOpenPalette}
          className="group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-start text-xs text-subtle transition-colors hover:border-line-strong hover:text-muted sm:max-w-md"
          aria-label={t('common.searchAll')}
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="truncate">{t('topbar.searchPlaceholder')}</span>
          <kbd className="ms-auto hidden shrink-0 rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:block">
            Ctrl K
          </kbd>
        </button>

        <div className="ms-auto flex items-center gap-1">
          {!online ? (
            <span className="me-1 hidden items-center gap-1 text-[11px] text-warning sm:inline-flex">
              <WifiOff className="h-3.5 w-3.5" />
              {t('topbar.offline')}
            </span>
          ) : null}

          <Link
            to="/providers"
            className={cn(
              'hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium sm:inline-flex',
              aiConfigured ? 'border-success/40 text-success' : 'border-warning/40 text-warning',
            )}
            title={aiConfigured ? `${health?.services.ai.provider ?? 'AI'} · ${health?.services.ai.model ?? ''}` : t('common.notConfigured')}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', aiConfigured ? 'bg-success' : 'bg-warning')} aria-hidden />
            AI
          </Link>

          <button
            type="button"
            onClick={() => setLanguage(settings.language === 'en' ? 'ar' : 'en')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('topbar.toggleLanguage')}
            title={t('topbar.toggleLanguage')}
          >
            <Languages className="h-4 w-4" />
            <span className="hidden sm:inline">{t('topbar.toggleLanguage')}</span>
          </button>

          <button
            type="button"
            onClick={cycleTheme}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('topbar.toggleTheme')}
            title={`${t('common.theme')}: ${t(`theme.${settings.theme}`)}`}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <Palette className="hidden h-3.5 w-3.5 xl:block" aria-hidden />
          </button>

          {status === 'authenticated' && account?.profile ? (
            <Link
              to="/account"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-medium text-muted hover:border-line-strong hover:text-text"
              title={`${t('auth.signedInAs')} ${account.profile.email}`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                {(account.profile.fullName || account.profile.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-28 truncate xl:inline">{account.profile.fullName || account.profile.email}</span>
            </Link>
          ) : status === 'guest' ? (
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-text"
              aria-label={t('nav.login')}
              title={t('nav.login')}
            >
              <LogIn className="h-4 w-4" />
              <span className="hidden sm:inline">{t('nav.login')}</span>
            </Link>
          ) : (
            <span className="rounded-lg p-2 text-subtle" aria-hidden>
              <UserRound className="h-4 w-4" />
            </span>
          )}

          <Link
            to="/settings"
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('nav.settings')}
            title={t('nav.settings')}
          >
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </header>
  )
}
