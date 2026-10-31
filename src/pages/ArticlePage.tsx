import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Bookmark, BookmarkCheck, Copy, ExternalLink, FileText, Printer, TerminalSquare } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, RiskBadge } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { getArticleBySlug } from '@/data/knowledge'
import { KNOWLEDGE_META } from '@/data/knowledgeMeta'
import { SCRIPT_TEMPLATES } from '@/data/scripts'
import { getDomain } from '@/data/domains'
import { formatDate, pickText } from '@/i18n'
import { renderMarkdown } from '@/lib/markdown'
import { copyToClipboard } from '@/lib/utils'

export function ArticlePage() {
  const { slug } = useParams()
  const { t, settings } = useApp()
  const { saveItem, isSaved } = useLibrary()
  const { notify } = useToast()
  const article = slug ? getArticleBySlug(slug) : undefined

  const related = useMemo(
    () => (article ? KNOWLEDGE_META.filter((item) => item.id !== article.id && item.domain === article.domain).slice(0, 3) : []),
    [article],
  )
  const scripts = useMemo(
    () => (article?.relatedScriptIds ?? []).map((id) => SCRIPT_TEMPLATES.find((script) => script.id === id)).filter((script): script is (typeof SCRIPT_TEMPLATES)[number] => Boolean(script)),
    [article],
  )

  if (!article) {
    return (
      <div className="animate-in">
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={t('knowledge.empty')}
          action={
            <Link to="/solutions" className="btn btn-primary text-sm">
              {t('nav.solutions')}
            </Link>
          }
        />
      </div>
    )
  }

  const saved = isSaved(article.id)
  const html = renderMarkdown(pickText(article.body, settings.language))

  return (
    <div className="animate-in">
      <Link to="/solutions" className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
        {t('nav.solutions')}
      </Link>

      <PageHeader
        title={pickText(article.title, settings.language)}
        subtitle={pickText(article.summary, settings.language)}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={saved ? <BookmarkCheck className="h-3.5 w-3.5 text-success" /> : <Bookmark className="h-3.5 w-3.5" />}
              onClick={() => {
                saveItem({ kind: 'article', title: pickText(article.title, settings.language), refId: article.id, url: `/solutions/${article.slug}`, payload: article })
                notify('success', saved ? t('common.saved') : t('knowledge.save'))
              }}
            >
              {saved ? t('common.saved') : t('knowledge.save')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Copy className="h-3.5 w-3.5" />}
              onClick={async () => {
                await copyToClipboard(`${window.location.origin}/solutions/${article.slug}`)
                notify('success', t('common.copied'))
              }}
            >
              {t('common.copy')}
            </Button>
            <Button variant="ghost" size="sm" icon={<Printer className="h-3.5 w-3.5" />} onClick={() => window.print()}>
              {t('common.download')}
            </Button>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="primary">{t(getDomain(article.domain).labelKey)}</Badge>
        <Badge tone={article.verification === 'draft' ? 'warning' : 'success'}>{t(`verification.${article.verification}`)}</Badge>
        <Badge>{t(`knowledge.difficulty.${article.difficulty}`)}</Badge>
        <span className="text-[11px] text-subtle">
          {article.productVersion} · {formatDate(article.updatedAt, settings.language)} · {article.author}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <article className="prose-nexus p-5 sm:p-6" dangerouslySetInnerHTML={{ __html: html }} />
        </Card>

        <div className="space-y-4">
          {article.verification === 'draft' ? <Alert tone="warning">{t('knowledge.contentNotice')}</Alert> : null}

          <Card>
            <CardHeader title={t('knowledge.provenance')} />
            <div className="space-y-2 p-4 text-xs">
              <p className="flex justify-between gap-2">
                <span className="text-subtle">{t('knowledge.verification')}</span>
                <span>{t(`verification.${article.verification}`)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span className="text-subtle">{t('common.sources')}</span>
                <span>{article.sources.length}</span>
              </p>
              <ul className="space-y-1.5 border-t border-line pt-2">
                {article.sources.map((source) => (
                  <li key={source.url}>
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-primary hover:underline">
                      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="break-words">{source.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </Card>

          {scripts.length > 0 ? (
            <Card>
              <CardHeader title={t('knowledge.relatedScripts')} icon={<TerminalSquare className="h-4 w-4" />} />
              <ul className="divide-y divide-line text-xs">
                {scripts.map((script) => (
                  <li key={script.id}>
                    <Link to={`/scripts?template=${script.id}`} className="block px-4 py-2.5 hover:bg-surface-2">
                      <span className="font-medium">{pickText(script.title, settings.language)}</span>
                      <span className="mt-0.5 block text-[10px] text-subtle">
                        {script.language} · <RiskBadge risk={script.risk} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {related.length > 0 ? (
            <Card>
              <CardHeader title={t('knowledge.relatedArticles')} />
              <ul className="divide-y divide-line text-xs">
                {related.map((item) => (
                  <li key={item.id}>
                    <Link to={`/solutions/${item.slug}`} className="block px-4 py-2.5 hover:bg-surface-2">
                      <span className="line-clamp-2 font-medium">{pickText(item.title, settings.language)}</span>
                      <span className="mt-0.5 block text-[10px] text-subtle">{t(`verification.${item.verification}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default ArticlePage
