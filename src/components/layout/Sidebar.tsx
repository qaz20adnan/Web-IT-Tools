import { NavLink } from 'react-router-dom'
import { ChevronsLeft, Sparkles, X } from 'lucide-react'
import { NAV_GROUPS } from './nav'
import { BrandLogo } from '@/components/brand/BrandLogo'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'

export function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapse,
}: {
  collapsed: boolean
  mobileOpen: boolean
  onCloseMobile: () => void
  onToggleCollapse: () => void
}) {
  const { t } = useApp()
  const { hasPermission } = useAuth()

  const content = (
    <div className="flex h-full flex-col">
      <div className={cn('relative flex items-center gap-2.5 border-b border-line/80 px-4 py-4', collapsed && 'justify-center px-2')}>
        <BrandLogo compact={collapsed} onClick={onCloseMobile} className={cn(collapsed && 'justify-center')} />
        {!collapsed ? (
          <span className="ms-auto hidden rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 font-mono text-[9px] font-bold text-primary/80 sm:block">
            v2
          </span>
        ) : null}
        <button
          type="button"
          onClick={onCloseMobile}
          className="ms-auto rounded p-1 text-muted hover:bg-surface-2 hover:text-text lg:hidden"
          aria-label={t('common.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!collapsed ? (
        <div className="px-3 pt-3">
          <NavLink
            to="/diagnostics"
            onClick={onCloseMobile}
            className="group flex items-center gap-2.5 rounded-lg border border-primary/30 bg-gradient-to-r from-primary/12 to-accent/5 px-3 py-2 text-xs font-semibold text-text transition-colors hover:border-primary/60 hover:from-primary/20"
          >
            <span className="grid h-6 w-6 place-items-center rounded-md bg-primary/15 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{t('nav.diagnostics')}</span>
            <span className="text-[10px] font-bold text-primary">→</span>
          </NavLink>
        </div>
      ) : null}

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.permission || hasPermission(item.permission))
          if (items.length === 0) return null
          return (
            <div key={group.id} className="mb-3">
              {!collapsed ? (
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-subtle">{t(group.labelKey)}</p>
              ) : (
                <div className="mx-2 mb-1 border-t border-line" aria-hidden />
              )}
              <ul className="space-y-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onCloseMobile}
                      className={cn('nav-link', collapsed && 'justify-center px-2')}
                      title={collapsed ? t(item.labelKey) : undefined}
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                      {!collapsed ? <span className="truncate">{t(item.labelKey)}</span> : null}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
            )
        })}
      </nav>

      <div className="border-t border-line p-2">
        {!collapsed ? (
          <div className="px-2 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-subtle">Eng. Adnan Al Qadi</p>
            <p className="text-[10px] text-subtle" dir="rtl">م. عدنان القاضي</p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onToggleCollapse}
          className={cn('nav-link hidden w-full lg:flex', collapsed && 'justify-center px-2')}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
        >
          <ChevronsLeft className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')} aria-hidden />
          {!collapsed ? <span>Collapse</span> : null}
        </button>
      </div>
    </div>
  )

  return (
    <>
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 border-e border-line bg-[var(--sidebar)] transition-[width] duration-300 ease-in-out lg:block',
          collapsed ? 'w-[4.5rem]' : 'w-[16.5rem]',
        )}
      >
        {content}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCloseMobile} aria-hidden />
          <aside className="absolute inset-y-0 start-0 w-72 border-e border-line bg-[var(--sidebar)] shadow-2xl animate-fade">
            {content}
          </aside>
        </div>
      ) : null}
    </>
  )
}
