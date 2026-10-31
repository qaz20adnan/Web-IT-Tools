import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ExternalLink, FileText, Search } from 'lucide-react'
import { Badge, Card, CardHeader, EmptyState, Input, PageHeader, Select } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { KNOWLEDGE_META } from '@/data/knowledgeMeta'
import { REFERENCE_SITES } from '@/data/referenceSites'
import { getDomain } from '@/data/domains'
import { pickText } from '@/i18n'

export function DocsHubPage() {
  const { t, settings } = useApp()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [sourceType, setSourceType] = useState<'all' | 'official' | 'community' | 'informal'>('all')

  const categories = useMemo(() => [...new Set(REFERENCE_SITES.map((site) => site.category))].sort(), [])
  const sites = useMemo(
    () => REFERENCE_SITES.filter((site) => (category === 'all' || site.category === category) && (sourceType === 'all' || site.sourceType === sourceType)),
    [category, sourceType],
  )
  const guides = useMemo(() => {
    const term = query.trim().toLowerCase()
    return KNOWLEDGE_META.filter((article) => !term || pickText(article.title, settings.language).toLowerCase().includes(term) || article.tags.some((tag) => tag.includes(term))).slice(0, 9)
  }, [query, settings.language])

  return (
    <div className="animate-in">
      <PageHeader title={t('docs.title')} subtitle={t('docs.subtitle')} />
      <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_11rem_11rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('docs.searchPlaceholder')} className="ps-8" aria-label={t('common.search')} />
        </div>
        <Select value={category} onChange={(event) => setCategory(event.target.value)} aria-label={t('news.category')}>
          <option value="all">{t('common.all')}</option>
          {categories.map((entry) => <option key={entry} value={entry}>{entry.replace(/-/g, ' ')}</option>)}
        </Select>
        <Select value={sourceType} onChange={(event) => setSourceType(event.target.value as typeof sourceType)} aria-label={t('common.source')}>
          <option value="all">{t('common.all')}</option>
          <option value="official">{t('docs.official')}</option>
          <option value="community">{t('docs.community')}</option>
          <option value="informal">{t('docs.informal')}</option>
        </Select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title={t('docs.references')} icon={<BookOpen className="h-4 w-4" />} subtitle={t('docs.notice')} />
          {sites.length === 0 ? <div className="p-4"><EmptyState title={t('common.noResults')} /></div> : (
            <ul className="divide-y divide-line">
              {sites.map((site) => (
                <li key={site.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{site.name}</p>
                    <p className="text-[10px] uppercase text-subtle">{site.category.replace(/-/g, ' ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={site.sourceType === 'official' ? 'success' : site.sourceType === 'community' ? 'primary' : 'warning'}>{t(`docs.${site.sourceType}`)}</Badge>
                    <button
                      type="button"
                      className="btn btn-secondary text-xs px-2.5 py-1.5 rounded-md"
                      onClick={() => window.open(site.search(query.trim() || 'documentation'), '_blank', 'noopener,noreferrer')}
                    >
                      {t('docs.searchSite')} <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title={t('docs.guides')} icon={<FileText className="h-4 w-4" />} />
          {guides.length === 0 ? <div className="p-4"><EmptyState title={t('common.noResults')} /></div> : (
            <ul className="divide-y divide-line">
              {guides.map((article) => (
                <li key={article.id}>
                  <Link to={`/solutions/${article.slug}`} className="block px-4 py-3 hover:bg-surface-2">
                    <p className="line-clamp-2 text-sm font-medium">{pickText(article.title, settings.language)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-subtle">
                      <Badge>{t(getDomain(article.domain).labelKey)}</Badge>
                      <span>{article.difficulty}</span>
                      <span>·</span>
                      <span>{t(`verification.${article.verification}`)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

export default DocsHubPage
