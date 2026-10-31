import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bookmark, ExternalLink, Globe2, Search } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useToast } from '@/context/ToastContext'
import { ApiError, searchResearch, type ResearchResponse } from '@/services/api'
import { describeError } from '@/services/apiError'
import { REFERENCE_SITES } from '@/data/referenceSites'
import { formatDate } from '@/i18n'
import type { ResearchResult } from '@/types'

export function ResearchPage() {
  const { t, settings } = useApp()
  const { saveItem, isSaved } = useLibrary()
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const initial = params.get('q') ?? ''
  const [query, setQuery] = useState(initial)
  const [committed, setCommitted] = useState(initial)
  const [officialOnly, setOfficialOnly] = useState(false)
  const [data, setData] = useState<ResearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const run = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      notify('warning', t('research.queryRequired'))
      return
    }
    setCommitted(trimmed)
    setParams({ q: trimmed })
    setLoading(true)
    setError(null)
    setErrorCode(null)
    try {
      const response = await searchResearch(trimmed, officialOnly)
      setData(response)
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      setError(describeError(caught, settings.language, t('research.failed')))
      setErrorCode(apiError?.code ?? null)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!initial) return
    void run(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const links = useMemo(() => {
    const list = officialOnly ? REFERENCE_SITES.filter((site) => site.sourceType === 'official') : REFERENCE_SITES
    return list.map((site) => ({ ...site, href: site.search(committed) }))
  }, [committed, officialOnly])

  const sourceTone = (type: ResearchResult['sourceType']) =>
    type === 'official' ? 'success' : type === 'community' ? 'primary' : 'warning'

  return (
    <div className="animate-in">
      <PageHeader title={t('research.title')} subtitle={t('research.subtitle')} />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <Field label={t('research.query')} htmlFor="research-query" className="flex-1">
            <Input
              id="research-query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void run(query)
                }
              }}
              placeholder={t('research.queryPlaceholder')}
              maxLength={400}
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={officialOnly}
              onChange={(event) => setOfficialOnly(event.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            {t('research.officialOnly')}
          </label>
          <Button onClick={() => void run(query)} loading={loading} icon={<Search className="h-4 w-4" />}>
            {t('research.search')}
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="mb-4">
          <Alert tone={errorCode === 'not_configured' ? 'warning' : 'danger'} title={errorCode === 'not_configured' ? t('research.configureTitle') : t('research.failed')}>
            {errorCode === 'not_configured' ? t('research.configureBody') : error}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={t('research.results')}
            subtitle={data ? `${data.providers.join(', ') || '—'} · ${formatDate(data.results[0]?.retrievedAt ?? new Date().toISOString(), settings.language)}` : undefined}
            icon={<Globe2 className="h-4 w-4" />}
          />
          <div className="p-4">
            {loading ? (
              <div className="flex justify-center py-10">
                <Spinner label={t('research.searching')} />
              </div>
            ) : data && data.results.length > 0 ? (
              <ul className="space-y-3">
                {data.results.map((result) => {
                  const saved = isSaved(result.id)
                  return (
                    <li key={result.id} className="rounded-lg border border-line p-3">
                      <div className="flex items-start justify-between gap-2">
                        <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary hover:underline">
                          {result.title}
                        </a>
                        <Badge tone={sourceTone(result.sourceType)}>{t(`research.${result.sourceType}`)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted">{result.snippet}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-subtle">
                        <span>{result.source}</span>
                        {result.publishedAt ? <span>· {t('research.published')}: {formatDate(result.publishedAt, settings.language)}</span> : null}
                        <span>· {t('research.retrieved')}: {formatDate(result.retrievedAt, settings.language)}</span>
                        <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                          <ExternalLink className="h-3 w-3" />
                          {t('research.openSource')}
                        </a>
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 text-primary hover:underline disabled:opacity-50"
                          disabled={saved}
                          onClick={() => {
                            saveItem({
                              kind: 'research',
                              title: result.title,
                              url: result.url,
                              refId: result.id,
                              payload: result,
                            })
                            notify('success', t('common.saved'))
                          }}
                        >
                          <Bookmark className="h-3 w-3" />
                          {saved ? t('common.saved') : t('research.save')}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : data ? (
              <EmptyState icon={<Search className="h-7 w-7" />} title={t('research.noResults')} description={t('research.officialHint')} />
            ) : (
              <EmptyState
                icon={<Search className="h-7 w-7" />}
                title={t('research.title')}
                description={errorCode === 'not_configured' ? t('research.configureBody') : t('research.analysisHint')}
              />
            )}
            {data && data.providers.length === 0 ? (
              <Alert className="mt-3" tone="warning" title={t('research.title')}>
                {t('research.configureBody')}
              </Alert>
            ) : data?.note ? (
              <p className="mt-3 text-[11px] text-subtle">{data.note}</p>
            ) : null}
          </div>
        </Card>

        <Card className="self-start">
          <CardHeader title={t('research.officialSearchLinks')} subtitle={t('research.officialHint')} />
          <div className="grid gap-1.5 p-4 sm:grid-cols-2 xl:grid-cols-1">
            {links.map((site) => (
              <a
                key={site.id}
                href={site.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2 text-xs text-muted hover:border-primary/40 hover:text-text"
              >
                <span className="truncate">{site.name}</span>
                <Badge tone={site.sourceType === 'official' ? 'success' : site.sourceType === 'community' ? 'primary' : 'warning'}>
                  {t(`research.${site.sourceType}`)}
                </Badge>
              </a>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

export default ResearchPage
