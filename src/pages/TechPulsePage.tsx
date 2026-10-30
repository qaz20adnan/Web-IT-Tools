import { useMemo, useState } from 'react'
import { AlertTriangle, Bookmark, ExternalLink, Newspaper, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { Alert, Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { useNews } from '@/hooks/useNews'
import { formatDateTime } from '@/i18n'
import { safeExternalUrl, truncate } from '@/lib/utils'
import type { TranslationKey } from '@/i18n'
import type { NewsItem } from '@/types'

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  security: 'news.category.security',
  networking: 'news.category.networking',
  'windows-server': 'news.category.windows-server',
  cloud: 'news.category.cloud',
  'backup-dr': 'news.category.backup-dr',
  ai: 'news.category.ai',
  'ai-models': 'news.category.ai-models',
  microsoft: 'news.category.microsoft',
  industry: 'news.category.industry',
}

export function TechPulsePage() {
  const { t, settings } = useApp()
  const { items, fetchedAt, sources, errors, loading, error, stale, refresh } = useNews()
  const { saveItem, isSaved } = useLibrary()
  const { notify } = useToast()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [source, setSource] = useState('all')
  const [range, setRange] = useState('all')
  const [criticalOnly, setCriticalOnly] = useState(false)

  const categories = useMemo(() => [...new Set(items.map((item) => item.category))].sort(), [items])
  const sourceOptions = useMemo(() => [...new Set([...sources, ...items.map((item) => item.source)])].sort(), [sources, items])

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    // Date ranges are relative to the retrieval time so results stay stable
    // across re-renders (and honest about what the snapshot contains).
    const now = fetchedAt ? Date.parse(fetchedAt) : 0
    const windowMs = range === '24h' ? 86_400_000 : range === '7d' ? 7 * 86_400_000 : range === '30d' ? 30 * 86_400_000 : 0
    return items.filter((item) => {
      if (criticalOnly && !item.critical) return false
      if (category !== 'all' && item.category !== category) return false
      if (source !== 'all' && item.source !== source) return false
      if (windowMs > 0 && now > 0) {
        if (!item.publishedAt) return false
        const published = Date.parse(item.publishedAt)
        if (Number.isNaN(published) || now - published > windowMs) return false
      }
      if (!term) return true
      return item.title.toLowerCase().includes(term) || item.source.toLowerCase().includes(term) || (item.summary ?? '').toLowerCase().includes(term)
    })
  }, [items, fetchedAt, query, category, source, range, criticalOnly])

  const save = (item: NewsItem) => {
    saveItem({ kind: 'news', title: item.title, url: item.url, refId: item.id, payload: { category: item.category, source: item.source, publishedAt: item.publishedAt } })
    notify('success', t('common.saved'))
  }

  const label = (id: string) => (CATEGORY_KEYS[id] ? t(CATEGORY_KEYS[id]) : id)

  return (
    <div className="animate-in">
      <PageHeader
        title={t('news.title')}
        subtitle={t('news.subtitle')}
        actions={
          <Button variant="secondary" icon={<RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />} onClick={() => void refresh()} loading={loading}>
            {loading ? t('news.refreshing') : t('news.refresh')}
          </Button>
        }
      />

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('news.searchPlaceholder')} className="ps-8" />
        </div>
        <Select value={category} onChange={(event) => setCategory(event.target.value)} className="w-48" aria-label={t('news.category')}>
          <option value="all">{t('news.all')}</option>
          {categories.map((entry) => (
            <option key={entry} value={entry}>
              {label(entry)}
            </option>
          ))}
        </Select>
        <Select value={source} onChange={(event) => setSource(event.target.value)} className="w-52" aria-label={t('news.source')}>
          <option value="all">{t('news.sourceFilter')}</option>
          {sourceOptions.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </Select>
        <Select value={range} onChange={(event) => setRange(event.target.value)} className="w-40" aria-label={t('news.dateRange')}>
          <option value="all">{t('news.anyDate')}</option>
          <option value="24h">{t('news.last24h')}</option>
          <option value="7d">{t('news.last7d')}</option>
          <option value="30d">{t('news.last30d')}</option>
        </Select>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs">
          <input type="checkbox" checked={criticalOnly} onChange={(event) => setCriticalOnly(event.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
          {t('news.criticalOnly')}
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-subtle">
        <span className="inline-flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {filtered.length} / {items.length} {t('common.items')}
        </span>
        {sourceOptions.length > 0 ? <span>{t('news.sourcesOk', { ok: sources.length, total: sourceOptions.length })}</span> : null}
        <span>{fetchedAt ? t('news.lastFetched', { time: formatDateTime(fetchedAt, settings.language) }) : t('news.neverFetched')}</span>
      </div>

      {stale ? <Alert tone="warning" className="mb-3" title={t('news.stale')} /> : null}
      {error && !stale ? <Alert tone="warning" className="mb-3" title={t('news.failed')}>{t('news.apiError')}</Alert> : null}
      {errors.length > 0 ? (
        <Alert tone="warning" className="mb-3" title={t('news.errorsTitle')}>
          <ul className="list-inside list-disc space-y-0.5">
            {errors.slice(0, 6).map((message) => (
              <li key={message} className="break-words font-mono text-[11px]" dir="ltr">{message}</li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" className="mt-2" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void refresh()} loading={loading}>
            {t('news.retryFailed')}
          </Button>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Newspaper className="h-8 w-8" />} title={items.length === 0 ? t('news.empty') : t('common.noResults')} description={t('news.disclaimer')} />
      ) : (
        <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const url = safeExternalUrl(item.url)
            return (
              <Card key={item.id} className="lift flex flex-col p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary">{label(item.category)}</Badge>
                  {item.critical ? (
                    <Badge tone="danger" icon={<AlertTriangle className="h-3 w-3" />}>
                      {t('news.security')}
                    </Badge>
                  ) : null}
                  {stale ? <Badge tone="warning">{t('common.offlineMode')}</Badge> : null}
                </div>
                <h2 className="mt-2 line-clamp-3 text-sm font-semibold">{truncate(item.title, 180)}</h2>
                {item.summary ? <p className="mt-1 line-clamp-3 text-xs text-muted">{truncate(item.summary, 220)}</p> : null}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-subtle">
                  <span>{item.source}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {t('news.published')}: {item.publishedAt ? formatDateTime(item.publishedAt, settings.language) : t('common.unknown')}
                  </span>
                  <span aria-hidden>·</span>
                  <span>
                    {t('news.retrieved')}: {formatDateTime(item.fetchedAt, settings.language)}
                  </span>
                </div>
                <div className="mt-auto flex items-center gap-1.5 pt-3">
                  {url ? (
                    <Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                      {t('news.openSource')}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon={<Bookmark className="h-3.5 w-3.5" />} disabled={isSaved(item.id)} onClick={() => save(item)}>
                    {isSaved(item.id) ? t('common.saved') : t('news.save')}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      <p className="mt-4 text-[11px] text-subtle">{t('news.disclaimer')}</p>
    </div>
  )
}

export default TechPulsePage
