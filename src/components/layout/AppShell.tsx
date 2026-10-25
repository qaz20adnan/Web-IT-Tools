import { useEffect, useState, type ReactNode } from 'react'
import { TrialBanner } from '@/components/auth/TrialBanner'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { readJson, writeJson } from '@/lib/storage'
import { useApp } from '@/context/AppContext'

const COLLAPSE_KEY = 'nexora.sidebar.v1'

export function AppShell({ children }: { children: ReactNode }) {
  const { t, settings } = useApp()
  const [collapsed, setCollapsed] = useState(() => readJson<boolean>(COLLAPSE_KEY, false))
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    writeJson(COLLAPSE_KEY, collapsed)
  }, [collapsed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((current) => !current)
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex min-h-screen" dir={settings.language === 'ar' ? 'rtl' : 'ltr'}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[70] focus:rounded focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-fg"
      >
        Skip to content
      </a>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((current) => !current)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMobileOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <TrialBanner />
        <main id="main-content" className="mx-auto w-full max-w-[1600px] flex-1 px-3 py-5 sm:px-5 lg:px-6" tabIndex={-1}>
          {children}
        </main>
        <footer className="border-t border-line px-4 py-4 text-center text-[11px] text-subtle">
          <div className="flex flex-col items-center gap-0.5">
            <span>{t('footer.developedBy')}</span>
            <span>{t('footer.developerName')}</span>
          </div>
        </footer>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
