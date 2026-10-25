import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  Languages,
  LogIn,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useHealth } from '@/hooks/useHealth'
import { cn } from '@/lib/utils'

export function Topbar({ onOpenMenu, onOpenPalette }: { onOpenMenu: () => void; onOpenPalette: () => void }) {
  const { t, settings, setLanguage, cycleTheme, isDark } = useApp()
  const { status, account, signOut } = useAuth()
  const { data: health, error: healthError, loading: healthLoading, refresh } = useHealth()
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const notificationsRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const L = (en: string, ar: string) => (settings.language === 'ar' ? ar : en)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (notificationsRef.current && !notificationsRef.current.contains(target)) setNotificationsOpen(false)
      if (userRef.current && !userRef.current.contains(target)) setUserOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const currentPage = (() => {
    const match = NAV_LABELS.find((entry) => entry.to === location.pathname)
    return match ? match.label : t('app.name')
  })()

  const notifications = (() => {
    const items: Array<{ id: string; title: string; detail: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }> = []
    if (!online) {
      items.push({ id: 'offline', title: L('You are offline', 'أنت غير متصل'), detail: L('Live checks are unavailable until the connection returns.', 'الفحوص الحية غير متاحة حتى يعود الاتصال.'), tone: 'bad' })
    }
    if (healthError) {
      items.push({ id: 'health-error', title: L('Service health unavailable', 'حالة الخدمات غير متاحة'), detail: L('The platform status endpoint did not respond.', 'لم يستجب مسار حالة المنصة.'), tone: 'warn' })
    }
    if (health) {
      if (!health.services.ai.configured) {
        items.push({ id: 'ai', title: L('AI provider not configured', 'مزود الذكاء الاصطناعي غير مهيأ'), detail: L('Local tools still work. Configure a provider to enable AI analysis.', 'الأدوات المحلية تعمل. هيّئ مزودًا لتفعيل التحليل بالذكاء الاصطناعي.'), tone: 'warn' })
      }
      if (!health.services.database.configured) {
        items.push({ id: 'db', title: L('Local storage fallback active', 'التخزين المحلي قيد الاستخدام'), detail: L('Workspace and history are stored in this browser.', 'مساحة العمل والسجل محفوظة في هذا المتصفح.'), tone: 'idle' })
      }
      if (health.services.ai.configured) {
        items.push({ id: 'ai-ok', title: L('AI services connected', 'خدمات الذكاء الاصطناعي متصلة'), detail: `${health.services.ai.provider ?? 'AI'}${health.services.ai.model ? ` · ${health.services.ai.model}` : ''}`, tone: 'ok' })
      }
    }
    return items
  })()

  const alertCount = notifications.filter((entry) => entry.tone === 'bad' || entry.tone === 'warn').length

  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-[var(--bg)]/88 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text lg:hidden"
          aria-label={t('topbar.openMenu')}
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="lg:hidden">
          <BrandLogo compact onClick={() => navigate('/')} />
        </div>

        <div className="hidden min-w-0 items-center gap-3 lg:flex">
          <BrandLogo />
          <span className="h-6 w-px bg-line" aria-hidden />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-subtle">{currentPage}</span>
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          className="group mx-1 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-surface/70 px-3 text-start text-xs text-subtle transition-colors hover:border-line-strong hover:bg-surface-2/70 hover:text-text sm:max-w-md"
          aria-label={t('common.searchAll')}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="truncate">{t('topbar.searchPlaceholder')}</span>
          <kbd className="ms-auto hidden shrink-0 rounded border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-subtle sm:block">
            Ctrl K
          </kbd>
        </button>

        <div className="ms-auto flex items-center gap-0.5 sm:gap-1">
          <span className={cn('hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold xl:inline-flex', online ? 'border-success/30 text-success' : 'border-warning/40 text-warning')}>
            {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {online ? t('topbar.online') : t('topbar.offline')}
          </span>

          <Link
            to="/providers"
            className={cn(
              'hidden items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold sm:inline-flex',
              health?.services.ai.configured ? 'border-success/35 text-success' : 'border-warning/40 text-warning',
            )}
            title={
              health?.services.ai.configured
                ? `${health.services.ai.provider ?? 'AI'} · ${health.services.ai.model ?? ''}`
                : t('common.notConfigured')
            }
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', health?.services.ai.configured ? 'bg-success' : 'bg-warning')} aria-hidden />
            AI
          </Link>

          <Link
            to="/diagnostics"
            className="hidden items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-fg shadow-[0_8px_24px_-12px_rgba(53,214,242,0.9)] transition-colors hover:bg-primary-hover sm:inline-flex"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {L('Start diagnosis', 'ابدأ التشخيص')}
          </Link>

          <button
            type="button"
            onClick={() => setLanguage(settings.language === 'en' ? 'ar' : 'en')}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('topbar.toggleLanguage')}
            title={t('topbar.toggleLanguage')}
          >
            <Languages className="h-4 w-4" />
            <span className="hidden text-[10px] uppercase xl:inline">{settings.language === 'en' ? 'AR' : 'EN'}</span>
          </button>

          <button
            type="button"
            onClick={cycleTheme}
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
            aria-label={t('topbar.toggleTheme')}
            title={`${t('common.theme')}: ${t(`theme.${settings.theme}`)}`}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div className="relative" ref={notificationsRef}>
            <button
              type="button"
              onClick={() => {
                setNotificationsOpen((current) => !current)
                if (!notificationsOpen && healthError) refresh()
              }}
              className="relative rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-text"
              aria-label={t('topbar.notifications')}
              aria-expanded={notificationsOpen}
              title={t('topbar.notifications')}
            >
              <Bell className="h-4 w-4" />
              {alertCount > 0 ? (
                <span className="absolute end-1 top-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-warning px-1 text-[8px] font-bold text-[#241b05]">
                  {alertCount}
                </span>
              ) : null}
            </button>
            {notificationsOpen ? (
              <div className="nx-panel absolute end-0 top-12 z-50 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
                  <div>
                    <p className="text-xs font-bold">{t('topbar.notifications')}</p>
                    <p className="text-[10px] text-subtle">
                      {healthLoading ? L('Checking services…', 'جارٍ فحص الخدمات…') : L('Derived from live platform checks', 'مستمدة من فحوص المنصة الحية')}
                    </p>
                  </div>
                  <button type="button" className="rounded p-1 text-subtle hover:bg-surface-2 hover:text-text" onClick={() => setNotificationsOpen(false)} aria-label={t('common.close')}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="max-h-80 divide-y divide-line overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-3.5 py-5 text-center text-xs text-subtle">{L('No notifications right now.', 'لا توجد إشعارات حاليًا.')}</p>
                  ) : (
                    notifications.map((entry) => (
                      <div key={entry.id} className="flex gap-2 px-3.5 py-2.5">
                        <span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', entry.tone === 'ok' ? 'bg-success' : entry.tone === 'warn' ? 'bg-warning' : entry.tone === 'bad' ? 'bg-danger' : 'bg-subtle')} />
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold">{entry.title}</p>
                          <p className="mt-0.5 text-[10px] leading-relaxed text-subtle">{entry.detail}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-line px-3.5 py-2">
                  <button type="button" onClick={refresh} className="text-[10px] font-semibold text-primary hover:underline">
                    {L('Refresh status', 'تحديث الحالة')}
                  </button>
                  <Link to="/settings" onClick={() => setNotificationsOpen(false)} className="inline-flex items-center gap-1 text-[10px] text-subtle hover:text-text">
                    <Settings className="h-3 w-3" /> {t('nav.settings')}
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          {status === 'authenticated' && account?.profile ? (
            <div className="relative" ref={userRef}>
              <button
                type="button"
                onClick={() => setUserOpen((current) => !current)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-1.5 py-1.5 text-xs font-medium text-muted hover:border-line-strong hover:text-text sm:px-2"
                aria-expanded={userOpen}
                title={`${t('auth.signedInAs')} ${account.profile.email}`}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {(account.profile.fullName || account.profile.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-24 truncate xl:inline">{account.profile.fullName || account.profile.email}</span>
                <ChevronDown className="hidden h-3 w-3 sm:block" />
              </button>
              {userOpen ? (
                <div className="nx-panel absolute end-0 top-12 z-50 w-56 overflow-hidden py-1">
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-xs font-semibold">{account.profile.fullName || t('auth.account')}</p>
                    <p className="truncate text-[10px] text-subtle">{account.profile.email}</p>
                    <span className="mt-1 inline-flex items-center gap-1 rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                      <ShieldCheck className="h-2.5 w-2.5" /> {account.profile.role.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <Link to="/account" onClick={() => setUserOpen(false)} className="flex items-center gap-2 px-3 py-2 text-xs text-muted hover:bg-surface-2 hover:text-text">
                    <UserRound className="h-3.5 w-3.5" /> {t('auth.account')}
                  </Link>
                  <Link to="/settings" onClick={() => setUserOpen(false)} className="flex items-center gap-2 px-3 py-2 text-xs text-muted hover:bg-surface-2 hover:text-text">
                    <Settings className="h-3.5 w-3.5" /> {t('nav.settings')}
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setUserOpen(false)
                      void signOut()
                      navigate('/')
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-danger hover:bg-danger/10"
                  >
                    <LogOut className="h-3.5 w-3.5" /> {t('auth.signOut')}
                  </button>
                </div>
              ) : null}
            </div>
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
        </div>
      </div>
    </header>
  )
}

const NAV_LABELS: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Dashboard' },
  { to: '/diagnostics', label: 'Network Diagnostics' },
  { to: '/security-lab', label: 'File & URL Security' },
  { to: '/lab', label: 'AI Troubleshooting Lab' },
  { to: '/copilot', label: 'Technical Copilot' },
  { to: '/research', label: 'Web Research' },
  { to: '/solutions', label: 'IT Support Solutions' },
  { to: '/scripts', label: 'Script Lab' },
  { to: '/toolkit', label: 'Engineering Toolkit' },
  { to: '/network-tools', label: 'Network Tools' },
  { to: '/kb', label: 'Knowledge Base' },
  { to: '/saved', label: 'Saved Items' },
  { to: '/history', label: 'Troubleshooting History' },
  { to: '/providers', label: 'AI Provider Hub' },
  { to: '/settings', label: 'Settings' },
  { to: '/account', label: 'Account' },
  { to: '/admin', label: 'Admin Center' },
  { to: '/about', label: 'About' },
  { to: '/english-coach', label: 'English Coach' },
  { to: '/windows-server', label: 'Windows & Server' },
  { to: '/microsoft-365', label: 'Microsoft 365' },
  { to: '/cybersecurity', label: 'Cybersecurity' },
  { to: '/datacenter', label: 'Data Center' },
  { to: '/backup', label: 'Backup & DR' },
  { to: '/cloud', label: 'Cloud & DevOps' },
  { to: '/news', label: 'Tech Pulse' },
  { to: '/radar', label: 'AI Model Radar' },
  { to: '/docs', label: 'Tech Docs Hub' },
]
