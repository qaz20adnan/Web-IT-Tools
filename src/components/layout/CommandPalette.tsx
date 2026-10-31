import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { Modal } from '@/components/ui'
import { FLAT_NAV } from './nav'
import { TOOLS } from '@/data/tools'
import { KNOWLEDGE_META } from '@/data/knowledgeMeta'
import { useApp } from '@/context/AppContext'
import { pickText } from '@/i18n'
import { cn } from '@/lib/utils'

interface CommandEntry {
  id: string
  group: 'pages' | 'tools' | 'actions'
  label: string
  hint?: string
  icon?: React.ReactNode
  run: () => void
  keywords: string
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, settings, setLanguage, cycleTheme } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const entries = useMemo<CommandEntry[]>(() => {
    const pages: CommandEntry[] = FLAT_NAV.map((item) => {
      const Icon = item.icon
      return {
        id: `page:${item.to}`,
        group: 'pages',
        label: t(item.labelKey),
        icon: <Icon className="h-4 w-4" />,
        keywords: `${t(item.labelKey)} ${item.to}`,
        run: () => navigate(item.to),
      }
    })

    const tools: CommandEntry[] = TOOLS.map((tool) => ({
      id: `tool:${tool.id}`,
      group: 'tools',
      label: pickText(tool.name, settings.language),
      hint: t('nav.toolkit'),
      icon: <span className="text-xs">⌘</span>,
      keywords: `${pickText(tool.name, settings.language)} ${pickText(tool.description, settings.language)} ${tool.keywords.join(' ')}`,
      run: () => navigate(`/toolkit?tool=${tool.id}`),
    }))

    const articles: CommandEntry[] = KNOWLEDGE_META.map((article) => ({
      id: `article:${article.slug}`,
      group: 'pages',
      label: pickText(article.title, settings.language),
      hint: t('knowledge.title'),
      icon: <span className="text-xs">§</span>,
      keywords: `${pickText(article.title, settings.language)} ${pickText(article.summary, settings.language)} ${article.tags.join(' ')}`,
      run: () => navigate(`/solutions/${article.slug}`),
    }))

    const actions: CommandEntry[] = [
      {
        id: 'action:new-analysis',
        group: 'actions',
        label: t('command.actionNewAnalysis'),
        icon: <span className="text-xs">+</span>,
        keywords: 'new analysis troubleshooting lab تحليل مشكلة',
        run: () => navigate('/lab'),
      },
      {
        id: 'action:theme',
        group: 'actions',
        label: t('command.actionToggleTheme'),
        icon: <span className="text-xs">◐</span>,
        keywords: 'theme dark light سمة',
        run: cycleTheme,
      },
      {
        id: 'action:language',
        group: 'actions',
        label: t('command.actionToggleLang'),
        icon: <span className="text-xs">ع</span>,
        keywords: 'language arabic english لغة',
        run: () => setLanguage(settings.language === 'en' ? 'ar' : 'en'),
      },
      {
        id: 'action:providers',
        group: 'actions',
        label: t('command.actionProviders'),
        icon: <span className="text-xs">⚙</span>,
        keywords: 'provider api key openrouter openai anthropic مزود',
        run: () => navigate('/providers'),
      },
    ]

    return [...actions, ...pages, ...articles, ...tools]
  }, [t, navigate, settings.language, cycleTheme, setLanguage])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) => entry.keywords.toLowerCase().includes(needle))
  }, [entries, query])

  // When the filter matches nothing there is no option to point at, and
  // `aria-activedescendant` would name an id that is not in the DOM.
  const activeIndex = filtered.length === 0 ? -1 : active

  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const move = (next: number) => {
    if (filtered.length === 0) return
    setActive(Math.max(0, Math.min(next, filtered.length - 1)))
  }

  const groups: Array<{ id: CommandEntry['group']; label: string }> = [
    { id: 'actions', label: t('command.actions') },
    { id: 'pages', label: t('command.pages') },
    { id: 'tools', label: t('command.tools') },
  ]

  const execute = (entry: CommandEntry | undefined) => {
    if (!entry) return
    onClose()
    entry.run()
  }

  return (
    <Modal open={open} onClose={onClose} title={t('command.title')} size="md">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            // Both updates in one handler: a separate effect on [query] commits a
            // frame where the highlight still points past the end of the shorter
            // list the keystroke just produced.
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(activeIndex + 1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(activeIndex - 1)
            } else if (event.key === 'Home') {
              event.preventDefault()
              move(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              move(filtered.length - 1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              execute(filtered[activeIndex])
            }
          }}
          placeholder={t('command.placeholder')}
          className="input-base ps-9"
          aria-label={t('command.placeholder')}
          aria-controls="command-results"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-activedescendant={activeIndex === -1 ? undefined : `command-option-${activeIndex}`}
        />
      </div>

      <div id="command-results" ref={listRef} className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto" role="listbox">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{t('command.noResults')}</p>
        ) : (
          groups.map((group) => {
            const groupEntries = filtered.filter((entry) => entry.group === group.id)
            if (groupEntries.length === 0) return null
            const headingId = `command-group-${group.id}`
            return (
              <div key={group.id} role="group" aria-labelledby={headingId}>
                <p id={headingId} className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-subtle">{group.label}</p>
                <div className="space-y-0.5">
                  {groupEntries.map((entry) => {
                    const index = filtered.indexOf(entry)
                    return (
                      <button
                        key={entry.id}
                        id={`command-option-${index}`}
                        type="button"
                        data-index={index}
                        role="option"
                        aria-selected={activeIndex === index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => execute(entry)}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-start text-sm',
                          activeIndex === index ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-2',
                        )}
                      >
                        <span className="text-subtle">{entry.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                        {entry.hint ? <span className="shrink-0 text-[10px] text-subtle">{entry.hint}</span> : null}
                        {activeIndex === index ? <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-subtle" /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-3 border-t border-line pt-2 text-[10px] text-subtle">
        <span>↑↓ {t('command.select')}</span>
        <span>↵ {t('command.navigate')}</span>
        <span>Esc {t('command.close')}</span>
      </div>
    </Modal>
  )
}
