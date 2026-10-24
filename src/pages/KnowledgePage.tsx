import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookMarked, Bookmark, BookOpen, ChevronRight, Search } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { KNOWLEDGE_ARTICLES } from '@/data/knowledge'
import { getDomain } from '@/data/domains'
import { formatDate, pickText } from '@/i18n'
import type { ProblemCategory } from '@/types'

export function KnowledgePage() {
  const { t, settings } = useApp()
  const navigate = useNavigate()
  const { saveItem, isSaved } = useLibrary()
  const { notify } = useToast()
  const [query, setQuery] = useState('')
  const [domain, setDomain] = useState<'all' | ProblemCategory>('all')
  const [difficulty, setDifficulty] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all')

  const articles = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return KNOWLEDGE_ARTICLES.filter((article) => {
      if (domain !== 'all' && article.domain !== domain) return false
      if (difficulty !== 'all' && article.difficulty !== difficulty) return false
      if (!needle) return true
      const haystack = [
        article.title.en,
        article.title.ar,
        article.summary.en,
        article.summary.ar,
        article.productVersion,
        ...article.tags,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [query, domain, difficulty])

  return (
    <div className="animate-in">
      <PageHeader
        title={t('knowledge.title')}
        subtitle={t('knowledge.subtitle')}
        badge={<Badge>{t('knowledge.articleCount', { count: KNOWLEDGE_ARTICLES.length })}</Badge>}
        actions={
          <Button
            size="sm"
            variant="secondary"
            icon={<BookMarked className="h-3.5 w-3.5" />}
            onClick={() => navigate('/kb')}
          >
            {settings.language === 'ar' ? 'قاعدة معرفتي' : 'My Knowledge Base'}
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_12rem_11rem]">
          <div className="relative">
            <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('knowledge.searchPlaceholder')}
              className="ps-8"
              aria-label={t('common.search')}
            />
          </div>
          <Select value={domain} onChange={(event) => setDomain(event.target.value as typeof domain)} aria-label={t('knowledge.allDomains')}>
            <option value="all">{t('knowledge.allDomains')}</option>
            {[...new Set(KNOWLEDGE_ARTICLES.map((article) => article.domain))].map((id) => (
              <option key={id} value={id}>
                {t(getDomain(id).labelKey)}
              </option>
            ))}
          </Select>
          <Select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)} aria-label={t('knowledge.difficulty')}>
            <option value="all">{t('common.all')}</option>
            {(['beginner', 'intermediate', 'advanced'] as const).map((id) => (
              <option key={id} value={id}>
                {t(`knowledge.difficulty.${id}`)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <p className="mb-3 text-[11px] text-subtle">{t('knowledge.contentNotice')}</p>

      {articles.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-8 w-8" />} title={t('knowledge.empty')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {articles.map((article) => {
            const saved = isSaved(article.id)
            return (
              <Card key={article.id} className="flex flex-col p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="primary">{t(getDomain(article.domain).labelKey)}</Badge>
                  <Badge tone={article.verification === 'draft' ? 'warning' : 'success'}>{t(`verification.${article.verification}`)}</Badge>
                </div>
                <Link to={`/solutions/${article.slug}`} className="mt-2 line-clamp-2 text-sm font-semibold hover:text-primary">
                  {pickText(article.title, settings.language)}
                </Link>
                <p className="mt-1 line-clamp-3 text-xs text-muted">{pickText(article.summary, settings.language)}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {article.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-subtle">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[10px] text-subtle">
                  <span>
                    {t(`knowledge.difficulty.${article.difficulty}`)} · {article.productVersion} · {formatDate(article.updatedAt, settings.language)}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        saveItem({ kind: 'article', title: pickText(article.title, settings.language), refId: article.id, url: `/solutions/${article.slug}`, payload: article })
                        notify('success', t('common.saved'))
                      }}
                      disabled={saved}
                      className="rounded p-1 text-subtle hover:text-primary disabled:text-success"
                      aria-label={t('knowledge.save')}
                    >
                      <Bookmark className="h-3.5 w-3.5" />
                    </button>
                    <Link to={`/solutions/${article.slug}`} className="rounded p-1 text-subtle hover:text-primary" aria-label={t('common.open')}>
                      <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
                    </Link>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default KnowledgePage
