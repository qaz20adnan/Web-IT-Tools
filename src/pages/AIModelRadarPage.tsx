import { useMemo, useState } from 'react'
import { Cpu, ExternalLink, RefreshCw, Search, Server } from 'lucide-react'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, Spinner } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useProviders } from '@/context/ProvidersContext'
import { MODEL_CATALOG, MODEL_KINDS } from '@/data/models'
import { fetchLiveModels, type LiveModel } from '@/services/api'
import { describeError } from '@/services/apiError'
import { safeExternalUrl } from '@/lib/utils'
import { formatDateTime, pickText } from '@/i18n'

export function AIModelRadarPage() {
  const { t, settings } = useApp()
  const { credentials, defaultProvider, hasClientProvider } = useProviders()
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState('all')
  const [kind, setKind] = useState('all')
  const [live, setLive] = useState<LiveModel[] | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [liveQuery, setLiveQuery] = useState('')
  const [liveAt, setLiveAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const providers = useMemo(() => [...new Set(MODEL_CATALOG.map((model) => model.provider))].sort(), [])
  const models = useMemo(() => {
    const term = query.trim().toLowerCase()
    return MODEL_CATALOG.filter((model) => {
      if (provider !== 'all' && model.provider !== provider) return false
      if (kind !== 'all' && model.kind !== kind) return false
      if (!term) return true
      return model.name.toLowerCase().includes(term) || model.provider.toLowerCase().includes(term) || pickText(model.notes, settings.language).toLowerCase().includes(term)
    })
  }, [query, provider, kind, settings.language])

  const loadLive = async () => {
    if (!credentials) {
      setLiveError(t('radar.liveFailed'))
      return
    }
    setLoading(true)
    setLiveError(null)
    try {
      const response = await fetchLiveModels(credentials)
      setLive(response.models)
      setLiveAt(response.fetchedAt ?? new Date().toISOString())
    } catch (caught) {
      setLiveError(describeError(caught, settings.language, t('radar.liveFailed')))
    } finally {
      setLoading(false)
    }
  }

  const liveFiltered = useMemo(() => {
    if (!live) return null
    const term = liveQuery.trim().toLowerCase()
    if (!term) return live
    return live.filter((model) => model.id.toLowerCase().includes(term) || model.name.toLowerCase().includes(term))
  }, [live, liveQuery])

  return (
    <div className="animate-in">
      <PageHeader title={t('radar.title')} subtitle={t('radar.subtitle')} badge={<Cpu className="h-5 w-5 text-primary" />} />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('radar.searchPlaceholder')} className="ps-8" />
        </div>
        <Select value={provider} onChange={(event) => setProvider(event.target.value)} className="w-44" aria-label={t('radar.provider')}>
          <option value="all">{t('common.all')}</option>
          {providers.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </Select>
        <Select value={kind} onChange={(event) => setKind(event.target.value)} className="w-44" aria-label={t('radar.kind')}>
          <option value="all">{t('common.all')}</option>
          {MODEL_KINDS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
        </Select>
      </div>

      <Alert tone="info" className="mb-4">{t('radar.verifyNotice')}</Alert>

      {models.length === 0 ? <EmptyState title={t('radar.empty')} /> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {models.map((model) => {
            const reference = safeExternalUrl(model.reference)
            return (
              <Card key={model.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">{model.name}</h2>
                    <p className="text-xs text-muted">{model.provider} · {model.kind}</p>
                  </div>
                  <Badge tone={model.kind === 'local' ? 'warning' : 'primary'}>{model.kind}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                  <div><dt className="text-subtle">{t('radar.context')}</dt><dd className="font-mono">{model.contextWindow ? model.contextWindow.toLocaleString() : t('common.unknown')}</dd></div>
                  <div><dt className="text-subtle">{t('radar.pricing')}</dt><dd>{model.pricing}</dd></div>
                  <div><dt className="text-subtle">{t('radar.license')}</dt><dd>{model.license}</dd></div>
                  <div><dt className="text-subtle">{t('radar.tools')}</dt><dd>{model.toolCalling}</dd></div>
                  <div><dt className="text-subtle">{t('radar.structured')}</dt><dd>{model.structuredOutput}</dd></div>
                  <div><dt className="text-subtle">{t('radar.openrouter')}</dt><dd>{model.openRouterCompatible ? t('toolLabel.yes') : t('toolLabel.no')}</dd></div>
                </dl>
                <p className="mt-3 text-xs text-muted">{pickText(model.notes, settings.language)}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                  <span className="text-[10px] text-subtle">{t('common.verifiedAt')}: {model.verifiedAt}</span>
                  {reference ? (
                    <a href={reference} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                      {t('radar.reference')} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Card className="mt-4">
        <CardHeader
          title={t('radar.live')}
          subtitle={t('radar.liveHint')}
          icon={<Server className="h-4 w-4" />}
          actions={<Button size="sm" variant="secondary" icon={<RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />} onClick={() => void loadLive()} loading={loading} disabled={!hasClientProvider}>{t('radar.loadLive')}</Button>}
        />
        <div className="space-y-3 p-4">
          {!hasClientProvider ? <Alert tone="info" title={t('common.notConfigured')}>{t('radar.liveHint')}</Alert> : null}
          {loading ? <Spinner label={t('common.loading')} /> : null}
          {liveError ? <Alert tone={live ? 'warning' : 'danger'}>{liveError}</Alert> : null}
          {live && live.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-48 flex-1">
                <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <Input value={liveQuery} onChange={(event) => setLiveQuery(event.target.value)} placeholder={t('radar.searchPlaceholder')} className="ps-8" dir="ltr" />
              </div>
              <Badge tone="primary">{t('providers.modelsLoaded', { count: live.length })}</Badge>
              {liveAt ? <span className="text-[10px] text-subtle">{t('common.updated')}: {formatDateTime(liveAt, settings.language)}</span> : null}
            </div>
          ) : null}
          {live ? (
            live.length === 0 ? <EmptyState title={t('common.noResults')} /> : (
              <div className="max-h-80 overflow-auto rounded-lg border border-line">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-2 text-subtle">
                    <tr>
                      <th className="p-2 text-start">ID</th>
                      <th className="p-2 text-start">{t('providers.capabilities')}</th>
                      <th className="p-2 text-start">{t('radar.context')}</th>
                      <th className="p-2 text-start">{t('radar.pricing')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(liveFiltered ?? live).map((model) => {
                      const caps: string[] = []
                      if (model.inputModalities?.includes('image')) caps.push('vision')
                      if (model.supportedParameters?.includes('tools')) caps.push('tools')
                      if (model.supportedParameters?.includes('response_format') || model.supportedParameters?.includes('structured_outputs')) caps.push('json')
                      return (
                        <tr key={model.id} className="border-t border-line">
                          <td className="break-all p-2 font-mono" dir="ltr">{model.id}</td>
                          <td className="p-2">
                            <span className="flex flex-wrap gap-1">
                              {caps.length ? caps.map((cap) => <Badge key={cap}>{cap}</Badge>) : <span className="text-subtle">—</span>}
                            </span>
                          </td>
                          <td className="p-2 font-mono">{model.contextLength ? model.contextLength.toLocaleString() : '—'}</td>
                          <td className="p-2">{model.pricing ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
          {defaultProvider ? <p className="text-[10px] text-subtle">{t('radar.provider')}: {defaultProvider.label} · {defaultProvider.model}</p> : null}
        </div>
      </Card>
      <p className="mt-4 text-[11px] text-subtle">{t('radar.sourceNotice')}</p>
    </div>
  )
}

export default AIModelRadarPage
