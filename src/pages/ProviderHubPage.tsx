import { useMemo, useState } from 'react'
import {
  Check,
  CheckCircle2,
  KeyRound,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  PasswordInput,
  Select,
  StatusDot,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useProviders } from '@/context/ProvidersContext'
import { useHealth } from '@/hooks/useHealth'
import { useToast } from '@/context/ToastContext'
import { ApiError, fetchLiveModels, testProvider, type AiCredentials, type LiveModel } from '@/services/api'
import { describeError } from '@/services/apiError'
import { formatDateTime } from '@/i18n'
import { cn, safeExternalUrl } from '@/lib/utils'
import type { ProviderConfig, ProviderDraft, ProviderKind } from '@/types'

interface Preset {
  kind: ProviderKind
  label: string
  baseUrl: string
  model: string
  visionModel: string
  supportsVision: boolean
}

const PRESETS: Record<ProviderKind, Preset> = {
  openai: { kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', visionModel: 'gpt-4.1', supportsVision: true },
  anthropic: { kind: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', visionModel: 'claude-sonnet-4-5', supportsVision: true },
  // Gemini uses the native Generative Language API (v1beta) because the adapter
  // calls models/{id}:generateContent. The OpenAI-compatible sub-path is not
  // used and pointing the base URL at it caused 404s.
  gemini: { kind: 'gemini', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-pro', visionModel: 'gemini-2.5-pro', supportsVision: true },
  openrouter: { kind: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1', visionModel: 'openai/gpt-4.1', supportsVision: true },
  ollama: { kind: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434', model: 'llama3.2', visionModel: 'llava', supportsVision: false },
  custom: { kind: 'custom', label: 'Custom OpenAI-compatible', baseUrl: '', model: '', visionModel: '', supportsVision: false },
}

const BLANK_DRAFT: ProviderDraft = {
  ...PRESETS.openai,
  fallbackModel: '',
  isDefault: true,
  apiKey: '',
}

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'fail'
  mode: 'connectivity' | 'chat' | null
  message?: string
  detail?: string
  latencyMs?: number
  models?: number
  modelAvailable?: boolean | null
  unverifiedReason?: 'public_catalog' | 'no_key_provider' | null
}

function hasCapability(model: LiveModel, capability: 'vision' | 'tools' | 'structured'): boolean {
  if (capability === 'vision') return Boolean(model.inputModalities?.includes('image'))
  if (capability === 'tools') return Boolean(model.supportedParameters?.includes('tools'))
  return Boolean(model.supportedParameters?.includes('response_format') || model.supportedParameters?.includes('structured_outputs'))
}

function capLabel(model: LiveModel): string[] {
  const labels: string[] = []
  if (hasCapability(model, 'vision')) labels.push('vision')
  if (hasCapability(model, 'tools')) labels.push('tools')
  if (hasCapability(model, 'structured')) labels.push('json')
  return labels
}

export function ProviderHubPage() {
  const { t, settings } = useApp()
  const { providers, saveProvider, removeProvider, makeDefault, hasKey, getKey } = useProviders()
  const { data: health } = useHealth()
  const { notify } = useToast()

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<ProviderConfig | null>(null)
  const [draft, setDraft] = useState<ProviderDraft>(BLANK_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle', mode: null })

  const [models, setModels] = useState<LiveModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsAt, setModelsAt] = useState<string | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [capability, setCapability] = useState('all')
  const [cardTests, setCardTests] = useState<Record<string, TestState>>({})
  const [cardTestingId, setCardTestingId] = useState<string | null>(null)

  const serverConfigured = Boolean(health?.services.ai.configured)
  const healthModel = health?.services.ai.model ?? null

  const draftCredentials = (): AiCredentials => {
    const provider: ProviderConfig = { ...draft, id: editing?.id ?? 'draft', createdAt: new Date().toISOString() }
    return { provider, apiKey: draft.apiKey.trim() || (editing ? getKey(editing.id) : null) }
  }

  const openNew = () => {
    setEditing(null)
    setDraft({ ...BLANK_DRAFT, label: '', baseUrl: PRESETS.openai.baseUrl, model: PRESETS.openai.model, isDefault: providers.length === 0 })
    setError(null)
    setTest({ status: 'idle', mode: null })
    resetModels()
    setOpen(true)
  }

  const openEdit = (provider: ProviderConfig) => {
    setEditing(provider)
    setDraft({
      kind: provider.kind,
      label: provider.label,
      baseUrl: provider.baseUrl,
      model: provider.model,
      fallbackModel: provider.fallbackModel ?? '',
      visionModel: provider.visionModel,
      supportsVision: provider.supportsVision,
      isDefault: provider.isDefault,
      apiKey: '',
    })
    setError(null)
    setTest({ status: 'idle', mode: null })
    resetModels()
    setOpen(true)
  }

  const resetModels = () => {
    setModels([])
    setModelsError(null)
    setModelsAt(null)
    setModelQuery('')
    setCapability('all')
  }

  const applyKind = (kind: ProviderKind) => {
    setDraft((current) => ({ ...current, ...PRESETS[kind], label: current.label || PRESETS[kind].label, fallbackModel: kind === current.kind ? current.fallbackModel : '' }))
    setTest({ status: 'idle', mode: null })
    resetModels()
  }

  const validate = (): string | null => {
    if (!draft.model.trim()) return t('common.requiredField')
    if (draft.kind === 'custom' && !draft.baseUrl.trim()) return t('providers.baseUrlRequired')
    if (draft.baseUrl.trim()) {
      const url = safeExternalUrl(draft.baseUrl.trim())
      if (!url) return t('providers.insecureUrl')
      const parsed = new URL(url)
      const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      if (parsed.protocol !== 'https:' && !local) return t('providers.insecureUrl')
    }
    return null
  }

  const submit = () => {
    const validation = validate()
    if (validation) {
      setError(validation)
      return
    }
    saveProvider(draft, editing?.id)
    notify('success', t('common.saved'))
    setOpen(false)
  }

  const refreshModels = async () => {
    const validation = validate()
    if (validation) {
      setError(validation)
      return
    }
    setError(null)
    setModelsLoading(true)
    setModelsError(null)
    try {
      const response = await fetchLiveModels(draftCredentials())
      setModels(response.models)
      setModelsAt(response.fetchedAt ?? new Date().toISOString())
      if (response.models.length === 0) setModelsError(t('providers.modelsEmpty'))
    } catch (caught) {
      setModels([])
      setModelsError(describeError(caught, settings.language, t('providers.modelsFailed')))
    } finally {
      setModelsLoading(false)
    }
  }

  const runTest = async (mode: 'connectivity' | 'chat') => {
    const validation = validate()
    if (validation) {
      setError(validation)
      return
    }
    setError(null)
    setTest({ status: 'testing', mode })
    try {
      const result = await testProvider(draftCredentials(), mode)
      const unverifiedReason = mode === 'connectivity' && result.keyVerified === false ? result.unverifiedReason ?? null : null
      setTest({
        status: 'ok',
        mode,
        latencyMs: result.latencyMs,
        message:
          unverifiedReason
            ? `${t('providers.connectionReachable')} · ${result.provider}/${result.model ?? draft.model} · ${result.latencyMs}ms`
            : `${t('providers.connectionOk')} · ${result.provider}/${result.model ?? draft.model} · ${result.latencyMs}ms`,
        models: result.models,
        modelAvailable: result.modelAvailable ?? null,
        unverifiedReason,
      })
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      setTest({
        status: 'fail',
        mode,
        message: apiError?.message ?? (caught instanceof Error ? caught.message : t('providers.testFailed')),
        detail: apiError?.detail,
      })
    }
  }

  const testCard = async (provider: ProviderConfig) => {
    setCardTestingId(provider.id)
    try {
      const result = await testProvider({ provider, apiKey: getKey(provider.id) }, 'connectivity')
      const unproven = result.keyVerified === false
      setCardTests((current) => ({
        ...current,
        [provider.id]: {
          status: 'ok',
          mode: 'connectivity',
          latencyMs: result.latencyMs,
          message: unproven
            ? `${result.latencyMs}ms · ${result.models ?? 0} models · ${t('providers.connectionReachable')}`
            : `${result.latencyMs}ms · ${result.models ?? 0} models`,
        },
      }))
      notify(unproven ? 'warning' : 'success', `${unproven ? t('providers.connectionReachable') : t('providers.connectionOk')} · ${result.latencyMs}ms`)
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      setCardTests((current) => ({
        ...current,
        [provider.id]: { status: 'fail', mode: 'connectivity', message: apiError?.message ?? t('providers.testFailed'), detail: apiError?.detail },
      }))
      notify('error', apiError?.message ?? t('providers.testFailed'))
    } finally {
      setCardTestingId(null)
    }
  }

  const filteredModels = useMemo(() => {
    const term = modelQuery.trim().toLowerCase()
    return models.filter((model) => {
      if (capability !== 'all' && !hasCapability(model, capability as 'vision' | 'tools' | 'structured')) return false
      if (!term) return true
      return model.id.toLowerCase().includes(term) || model.name.toLowerCase().includes(term)
    })
  }, [models, modelQuery, capability])

  const kinds = useMemo(() => Object.keys(PRESETS) as ProviderKind[], [])

  return (
    <div className="animate-in">
      <PageHeader
        title={t('providers.title')}
        subtitle={t('providers.subtitle')}
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
            {t('providers.add')}
          </Button>
        }
      />

      {serverConfigured ? (
        <Alert tone="success" title={t('providers.serverDefault')} className="mb-4">
          {t('providers.serverDefaultBody')}
          <span className="mt-1 block font-mono text-[11px]" dir="ltr">
            {health?.services.ai.provider} / {healthModel ?? '—'}
          </span>
        </Alert>
      ) : null}

      {providers.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-8 w-8" />}
          title={t('providers.empty')}
          description={t('providers.clientNote')}
          action={
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={openNew}>
              {t('providers.add')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {providers.map((provider) => {
            const cardTest = cardTests[provider.id]
            const status = cardTest?.status ?? 'idle'
            return (
              <Card key={provider.id} className="flex flex-col">
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {provider.label}
                      {provider.isDefault ? (
                        <Badge tone="primary" icon={<Star className="h-3 w-3" />}>
                          {t('providers.default')}
                        </Badge>
                      ) : null}
                    </span>
                  }
                  subtitle={<span dir="ltr">{provider.kind} · {provider.model}</span>}
                  icon={<Plug className="h-4 w-4" />}
                  actions={
                    <div className="flex items-center gap-1">
                      <span className="me-1 hidden items-center gap-1.5 sm:inline-flex">
                        <StatusDot tone={status === 'ok' ? 'success' : status === 'fail' ? 'danger' : 'muted'} />
                        <span
                          className={cn(
                            'text-[10px] font-medium',
                            status === 'ok' ? 'text-success' : status === 'fail' ? 'text-danger' : 'text-subtle',
                          )}
                        >
                          {status === 'ok' ? t('providers.statusReady') : status === 'fail' ? t('providers.statusFailed') : t('providers.statusUntested')}
                        </span>
                      </span>
                      <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(provider)} aria-label={t('providers.edit')} />
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => {
                          if (window.confirm(t('providers.removeConfirm'))) removeProvider(provider.id)
                        }}
                        aria-label={t('providers.remove')}
                      />
                    </div>
                  }
                />
                <div className="flex-1 space-y-2 p-4 text-xs">
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-subtle">{t('providers.baseUrl')}</span>
                    <span className="truncate font-mono" dir="ltr">{provider.baseUrl || '—'}</span>
                  </p>
                  {provider.fallbackModel ? (
                    <p className="flex items-center justify-between gap-2">
                      <span className="text-subtle">{t('providers.fallbackModel')}</span>
                      <span className="truncate font-mono" dir="ltr">{provider.fallbackModel}</span>
                    </p>
                  ) : null}
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-subtle">{t('providers.apiKey')}</span>
                    <span className="flex items-center gap-1">
                      <KeyRound className="h-3 w-3" />
                      {hasKey(provider.id) ? t('providers.keyPresent') : t('providers.noKey')}
                    </span>
                  </p>
                  {cardTest?.message ? (
                    <p className={cn('rounded-md border px-2 py-1.5 text-[11px]', cardTest.status === 'ok' ? 'border-success/30 bg-success/5 text-success' : 'border-danger/30 bg-danger/5 text-danger')}>
                      {cardTest.message}
                      {cardTest.detail ? <span className="mt-0.5 block text-subtle" dir="ltr">{cardTest.detail}</span> : null}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Zap className="h-3.5 w-3.5" />}
                      loading={cardTestingId === provider.id}
                      onClick={() => void testCard(provider)}
                    >
                      {t('providers.testConnection')}
                    </Button>
                    {!provider.isDefault ? (
                      <Button size="sm" variant="ghost" icon={<Star className="h-3.5 w-3.5" />} onClick={() => makeDefault(provider.id)}>
                        {t('providers.makeDefault')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-[11px] text-subtle">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('providers.keyHandling')}
      </p>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('providers.edit') : t('providers.add')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={submit} icon={<Check className="h-3.5 w-3.5" />}>
              {t('providers.saveProvider')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => applyKind(kind)}
                className={cn('badge cursor-pointer border border-line', draft.kind === kind && 'badge-primary')}
                aria-pressed={draft.kind === kind}
              >
                {PRESETS[kind].label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('providers.kind')} htmlFor="provider-kind">
              <Select id="provider-kind" value={draft.kind} onChange={(event) => applyKind(event.target.value as ProviderKind)}>
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {PRESETS[kind].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('providers.label')} htmlFor="provider-label">
              <Input id="provider-label" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} />
            </Field>
          </div>

          <Field label={t('providers.baseUrl')} htmlFor="provider-base-url" hint={t('providers.baseUrlHint')}>
            <Input id="provider-base-url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} dir="ltr" placeholder="https://api.example.com/v1" />
          </Field>

          <Field label={t('providers.apiKey')} htmlFor="provider-key" hint={t('providers.apiKeyHint')}>
            <PasswordInput
              id="provider-key"
              value={draft.apiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              placeholder={editing && hasKey(editing.id) ? '•••••••• (saved)' : 'sk-…'}
              autoComplete="off"
            />
          </Field>

          {/* Model discovery */}
          <div className="rounded-xl border border-line bg-surface-2/40">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <span className="text-xs font-semibold">{t('providers.models')}</span>
              {models.length > 0 ? <Badge tone="primary">{t('providers.modelsLoaded', { count: models.length })}</Badge> : null}
              <Button
                size="sm"
                variant="secondary"
                className="ms-auto"
                icon={<RefreshCw className={cn('h-3.5 w-3.5', modelsLoading && 'animate-spin')} />}
                loading={modelsLoading}
                onClick={() => void refreshModels()}
              >
                {modelsLoading ? t('providers.refreshingModels') : t('providers.refreshModels')}
              </Button>
            </div>
            <div className="space-y-2 p-3">
              <div className="flex flex-wrap gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                  <Input value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder={t('providers.searchModels')} className="ps-8" dir="ltr" />
                </div>
                <Select value={capability} onChange={(event) => setCapability(event.target.value)} className="w-48" aria-label={t('providers.filterCapability')}>
                  <option value="all">{t('providers.allCapabilities')}</option>
                  <option value="vision">{t('providers.filterVision')}</option>
                  <option value="tools">{t('providers.filterTools')}</option>
                  <option value="structured">{t('providers.filterStructured')}</option>
                </Select>
              </div>

              {modelsError ? <Alert tone={models.length ? 'warning' : 'danger'}>{modelsError}</Alert> : null}

              {models.length === 0 && !modelsLoading && !modelsError ? (
                <p className="px-1 py-3 text-xs text-subtle">{t('providers.noModelsYet')}</p>
              ) : null}

              {filteredModels.length > 0 ? (
                <div className="max-h-64 overflow-auto rounded-lg border border-line">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-2 text-subtle">
                      <tr>
                        <th className="p-2 text-start">ID</th>
                        <th className="p-2 text-start">{t('providers.capabilities')}</th>
                        <th className="p-2 text-start">{t('providers.contextLength')}</th>
                        <th className="p-2 text-end">{t('providers.useModel')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredModels.slice(0, 300).map((model) => {
                        const caps = capLabel(model)
                        const selected = draft.model === model.id
                        return (
                          <tr key={model.id} className={cn('border-t border-line', selected && 'bg-primary/5')}>
                            <td className="p-2 align-top">
                              <span className="block font-mono" dir="ltr">{model.id}</span>
                              <span className="block text-[10px] text-subtle">{model.name}</span>
                            </td>
                            <td className="p-2 align-top">
                              <span className="flex flex-wrap gap-1">
                                {caps.length ? caps.map((cap) => <Badge key={cap} tone="default">{cap}</Badge>) : <span className="text-subtle">—</span>}
                              </span>
                            </td>
                            <td className="p-2 align-top font-mono">{model.contextLength ? model.contextLength.toLocaleString() : '—'}</td>
                            <td className="p-2 align-top">
                              <span className="flex items-center justify-end gap-1">
                                <Button size="sm" variant={selected ? 'ghost' : 'secondary'} disabled={selected} onClick={() => setDraft((current) => ({ ...current, model: model.id }))}>
                                  {selected ? t('providers.selected') : t('providers.useModel')}
                                </Button>
                                {hasCapability(model, 'vision') && draft.visionModel !== model.id ? (
                                  <Button size="sm" variant="ghost" title={t('providers.visionModel')} onClick={() => setDraft((current) => ({ ...current, visionModel: model.id }))}>
                                    vision
                                  </Button>
                                ) : null}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : models.length > 0 && !modelsLoading ? (
                <p className="px-1 py-3 text-xs text-subtle">{t('common.noResults')}</p>
              ) : null}

              {modelsAt ? <p className="text-[10px] text-subtle">{t('common.updated')}: {formatDateTime(modelsAt, settings.language)}</p> : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('providers.model')} htmlFor="provider-model" hint={t('providers.modelHint')}>
              <Input id="provider-model" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} dir="ltr" />
            </Field>
            <Field label={t('providers.fallbackModel')} htmlFor="provider-fallback" hint={t('providers.fallbackHint')}>
              <Input id="provider-fallback" value={draft.fallbackModel} onChange={(event) => setDraft({ ...draft, fallbackModel: event.target.value })} dir="ltr" />
            </Field>
          </div>

          <Field label={t('providers.visionModel')} htmlFor="provider-vision">
            <Input id="provider-vision" value={draft.visionModel} onChange={(event) => setDraft({ ...draft, visionModel: event.target.value })} dir="ltr" />
          </Field>

          <div className="flex flex-wrap gap-4">
            <Checkbox label={t('providers.supportsVision')} checked={draft.supportsVision} onChange={(event) => setDraft({ ...draft, supportsVision: event.target.checked })} />
            <Checkbox label={t('providers.default')} checked={draft.isDefault} onChange={(event) => setDraft({ ...draft, isDefault: event.target.checked })} />
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" loading={test.status === 'testing' && test.mode === 'connectivity'} icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => void runTest('connectivity')}>
              {t('providers.testConnection')}
            </Button>
            <Button size="sm" variant="ghost" loading={test.status === 'testing' && test.mode === 'chat'} icon={<Search className="h-3.5 w-3.5" />} onClick={() => void runTest('chat')}>
              {t('providers.testChat')}
            </Button>
            {test.status === 'fail' ? (
              <Button size="sm" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void runTest(test.mode ?? 'connectivity')}>
                {t('common.retry')}
              </Button>
            ) : null}
          </div>

          {test.status === 'ok' ? (
            <Alert tone={test.unverifiedReason ? 'warning' : 'success'} title={test.unverifiedReason ? t('providers.connectionReachable') : t('providers.connectionOk')}>
              <span className="block">{test.message}</span>
              {test.mode === 'connectivity' && test.models !== undefined ? (
                <span className="mt-0.5 block text-[11px] text-subtle">
                  {t('providers.modelsLoaded', { count: test.models })}
                  {test.modelAvailable === false ? ' · ⚠ configured model was not found in the catalog' : ''}
                </span>
              ) : null}
              {test.unverifiedReason ? (
                <span className="mt-1 block text-[11px] text-warning">
                  {test.unverifiedReason === 'no_key_provider'
                    ? t('providers.keyUnverifiedNoKeyProvider')
                    : t('providers.keyUnverifiedPublicCatalog')}
                </span>
              ) : null}
            </Alert>
          ) : null}
          {test.status === 'fail' ? (
            <Alert tone="danger" title={t('providers.connectionFailed')}>
              <span className="flex items-start gap-1.5">
                <XCircle className="mt-0.5 h-3.5 w-3.5 text-danger" />
                <span>
                  {test.message}
                  {test.detail ? <span className="mt-0.5 block font-mono text-[11px] text-subtle" dir="ltr">{test.detail}</span> : null}
                </span>
              </span>
            </Alert>
          ) : null}
        </div>
      </Modal>
    </div>
  )
}

export default ProviderHubPage
