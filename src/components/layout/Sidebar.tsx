import { NavLink } from 'react-router-dom'
import { ChevronsLeft, X } from 'lucide-react'
import { NAV_GROUPS } from './nav'
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
      <div className={cn('flex items-center gap-2.5 border-b border-line px-4 py-3.5', collapsed && 'justify-center px-2')}>
        <img src="/icons/logo.svg" alt="" className="h-8 w-8 shrink-0 rounded-lg" width={32} height={32} />
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight">NEXORA AI</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-subtle">{t('app.shortTagline')}</p>
          </div>
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
          'sticky top-0 hidden h-screen shrink-0 border-e border-line bg-[var(--sidebar)] transition-[width] duration-200 lg:block',
          collapsed ? 'w-[4.25rem]' : 'w-64',
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
