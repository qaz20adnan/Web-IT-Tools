import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot,
  Copy,
  CornerDownLeft,
  ExternalLink,
  Globe,
  MessageSquareCode,
  Paperclip,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Stethoscope,
  Terminal,
  Trash2,
  User,
} from 'lucide-react'
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useHealth } from '@/hooks/useHealth'
import { useProviders } from '@/context/ProvidersContext'
import { useToast } from '@/context/ToastContext'
import { ApiError, sendChat } from '@/services/api'
import { extractCommands } from '@/lib/answerParts'
import { copyToClipboard, formatBytes, uid } from '@/lib/utils'
import type { ApiErrorCode, ChatMessage, CopilotMode, WebSearchMode } from '@/types'

const MODES: CopilotMode[] = ['professional', 'beginner', 'expert', 'diagnostic', 'script-review', 'incident-response', 'documentation']

const SEARCH_ERRORS: Partial<Record<ApiErrorCode, string>> = {
  not_configured: 'copilot.error.notConfigured',
  rate_limited: 'copilot.error.rateLimited',
  invalid_key: 'copilot.error.invalidKey',
  timeout: 'copilot.error.timeout',
  upstream_error: 'copilot.error.upstream',
  not_found: 'copilot.error.model',
}

const SEARCH_MODES: Array<{ id: WebSearchMode; label: string; hint: string }> = [
  { id: 'off', label: 'copilot.assistant.chat', hint: 'copilot.assistant.chatHint' },
  { id: 'on', label: 'copilot.assistant.research', hint: 'copilot.assistant.researchHint' },
  { id: 'auto', label: 'copilot.assistant.auto', hint: 'copilot.assistant.autoHint' },
]

const SUGGESTIONS: Array<{ key: string; mode: CopilotMode }> = [
  { key: 'copilot.suggestion.bsod', mode: 'diagnostic' },
  { key: 'copilot.suggestion.dns', mode: 'diagnostic' },
  { key: 'copilot.suggestion.script', mode: 'script-review' },
  { key: 'copilot.suggestion.rca', mode: 'incident-response' },
]

interface LabContext {
  summary?: string
  causes?: string[]
  diagnostics?: string[]
}

interface AnswerActionsProps {
  message: ChatMessage
  onCopy: () => Promise<void>
  onCopyCommands: (commands: string[]) => Promise<void>
  onResearchAgain: () => void
  onContinue: () => void
}

/** Renders only what the provider actually returned: real citations and real commands. */
function AnswerActions({ message, onCopy, onCopyCommands, onResearchAgain, onContinue }: AnswerActionsProps) {
  const { t } = useApp()
  const { notify } = useToast()
  const commands = extractCommands(message.content)
  const sources = message.meta?.sources ?? []
  const queries = message.meta?.searchQueries ?? []

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => void onCopy()} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-2">
          <Copy className="h-3 w-3" />
          {t('copilot.copyAnswer')}
        </button>
        <button
          type="button"
          disabled={commands.length === 0}
          title={commands.length === 0 ? t('copilot.research.noCommands') : undefined}
          onClick={() => {
            if (commands.length === 0) {
              notify('info', t('copilot.research.noCommands'))
              return
            }
            void onCopyCommands(commands)
          }}
          className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-2 disabled:opacity-45"
        >
          <Terminal className="h-3 w-3" />
          {t('copilot.research.copyCommands')}
          {commands.length > 0 ? <span dir="ltr">({commands.length})</span> : null}
        </button>
        <button type="button" onClick={onResearchAgain} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-2">
          <RefreshCw className="h-3 w-3" />
          {t('copilot.research.retry')}
        </button>
        <button type="button" onClick={onContinue} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-2">
          <Stethoscope className="h-3 w-3" />
          {t('copilot.research.continue')}
        </button>
      </div>

      {queries.length > 0 ? (
        <p className="text-[10px] text-subtle">
          {t('copilot.research.queries')}: <span dir="ltr">{queries.join(' · ')}</span>
        </p>
      ) : null}

      {sources.length > 0 ? (
        <div className="rounded-lg border border-line bg-surface-2/60 p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold">{t('copilot.research.sources')}</p>
          <ol className="space-y-1.5">
            {sources.map((source, index) => (
              <li key={source.url} className="flex items-start gap-2 text-[11px]">
                <span className="mt-0.5 text-subtle" dir="ltr">{index + 1}.</span>
                <span className="min-w-0 flex-1">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                    className="break-all text-primary hover:underline"
                  >
                    {source.title}
                  </a>
                  <span className="block text-[10px] text-subtle" dir="ltr">{source.host}</span>
                </span>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow ugc"
                  className="shrink-0 rounded border border-line p-1 text-subtle hover:text-text"
                  aria-label={`${t('copilot.research.open')}: ${source.title}`}
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ol>
        </div>
      ) : message.webSearch === 'on' ? (
        <p className="text-[10px] text-subtle">{t('copilot.research.noSources')}</p>
      ) : null}
    </div>
  )
}

export function CopilotPage() {
  const { t } = useApp()
  const { credentials, hasClientProvider } = useProviders()
  const { data: health } = useHealth()
  const { notify } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<CopilotMode>('professional')
  const [webSearch, setWebSearch] = useState<WebSearchMode>('off')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<LabContext | null>(null)
  const [attachName, setAttachName] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const aiAvailable = hasClientProvider || Boolean(health?.services.ai.configured)
  const grounded = health?.services.research?.grounded
  const researchReady = Boolean(grounded?.configured && grounded?.webSearchEnabled)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('nexora.copilot.context')
      if (!raw) return
      const parsed = JSON.parse(raw) as LabContext
      setContext(parsed)
      sessionStorage.removeItem('nexora.copilot.context')
    } catch {
      /* ignore malformed context */
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  const send = async (override?: string, options: { search?: WebSearchMode; history?: ChatMessage[] } = {}) => {
    const content = (override ?? input).trim()
    if (!content || busy) return
    const search = options.search ?? webSearch
    const history = options.history ?? messages
    setError(null)
    const userMessage: ChatMessage = { id: uid('msg'), role: 'user', content, createdAt: new Date().toISOString(), mode, webSearch: search }
    const next = [...history, userMessage]
    setMessages(next)
    setInput('')
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const response = await sendChat(
        next.map((message) => ({ role: message.role, content: message.content })),
        mode,
        search,
        credentials,
        controller.signal,
      )
      setMessages((current) => [
        ...current,
        {
          id: uid('msg'),
          role: 'assistant',
          content: response.content,
          createdAt: new Date().toISOString(),
          mode,
          webSearch: search,
          meta: {
            provider: response.provider,
            model: response.model,
            engine: response.engine,
            searchUsed: Boolean(response.searchUsed),
            searchQueries: response.searchQueries ?? [],
            searchRequests: response.searchRequests ?? 0,
            sources: response.sources ?? [],
            elapsedMs: response.elapsedMs ?? 0,
          },
        },
      ])
    } catch (caught) {
      const apiError = caught instanceof ApiError ? caught : null
      const localized = apiError && search === 'on' ? SEARCH_ERRORS[apiError.code] : undefined
      setError(
        localized
          ? t(localized as Parameters<typeof t>[0])
          : (apiError?.message ?? (caught instanceof Error ? caught.message : t('copilot.error'))),
      )
      setMessages((current) => current.slice(0, -1))
      setInput(content)
    } finally {
      setBusy(false)
      controllerRef.current = null
    }
  }

  /** Re-runs the newest question through live search, discarding its stale answer. */
  const researchAgain = () => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role !== 'user') continue
      const question = messages[index]
      void send(question.content, { search: 'on', history: messages.slice(0, index) })
      return
    }
  }

  const continueDiagnosis = () => {
    setInput((current) => `${current}${current ? '\n' : ''}${t('copilot.research.followUp')}`)
    document.getElementById('copilot-input')?.focus()
  }

  const stop = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
  }

  return (
    <div className="animate-in">
      <PageHeader
        title={t('copilot.title')}
        subtitle={t('copilot.subtitle')}
        badge={<Badge tone="accent" icon={<Sparkles className="h-3 w-3" />}>AI</Badge>}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<MessageSquareCode className="h-4 w-4" />}
            onClick={() => {
              setMessages([])
              setError(null)
            }}
            disabled={messages.length === 0}
          >
            {t('copilot.newChat')}
          </Button>
        }
      />

      {!aiAvailable ? (
        <Alert tone="warning" title={t('copilot.needsProvider')} className="mb-4">
          <Link to="/providers" className="btn btn-secondary mt-2 text-xs">
            {t('dashboard.configureAi')}
          </Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="flex min-h-[60vh] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-3">
              <Field label={t('copilot.mode')} htmlFor="copilot-mode" className="!gap-1">
                <Select id="copilot-mode" value={mode} onChange={(event) => setMode(event.target.value as CopilotMode)} className="w-44">
                  {MODES.map((id) => (
                    <option key={id} value={id}>
                      {t(`copilot.mode.${id}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('copilot.assistant')} htmlFor="copilot-search" className="!gap-1">
                <Select
                  id="copilot-search"
                  value={webSearch}
                  onChange={(event) => setWebSearch(event.target.value as WebSearchMode)}
                  className="w-52"
                >
                  {SEARCH_MODES.map((option) => (
                    <option key={option.id} value={option.id}>
                      {t(option.label as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex items-center gap-2">
              {busy ? <Spinner label={t('copilot.thinking')} /> : null}
              {messages.length > 0 ? (
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setMessages([])} aria-label={t('copilot.clear')} />
              ) : null}
            </div>
          </div>

          {webSearch !== 'off' ? (
            <p className={`border-b border-line px-4 py-1.5 text-[11px] ${researchReady ? 'text-muted' : 'text-warn'}`}>
              <Globe className="me-1 inline h-3 w-3" />
              {researchReady
                ? t(`copilot.assistant.${webSearch === 'on' ? 'research' : 'auto'}Hint` as Parameters<typeof t>[0])
                : t('copilot.research.unavailable')}
            </p>
          ) : null}

          {context ? (
            <div className="border-b border-line bg-primary/5 px-4 py-2 text-xs">
              <p className="flex items-center gap-1.5 font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t('lab.result')}
              </p>
              <p className="mt-0.5 line-clamp-2 text-muted">{context.summary}</p>
            </div>
          ) : null}

          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && !busy ? (
              <EmptyState
                icon={<Bot className="h-8 w-8" />}
                title={t('copilot.emptyTitle')}
                description={t('copilot.emptyBody')}
                action={
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion.key}
                        type="button"
                        onClick={() => {
                          setMode(suggestion.mode)
                          void send(t(suggestion.key as Parameters<typeof t>[0]))
                        }}
                        disabled={!aiAvailable}
                        className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-start text-xs hover:border-primary/40 disabled:opacity-50"
                      >
                        {t(suggestion.key as Parameters<typeof t>[0])}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className={`flex gap-2.5 ${message.role === 'user' ? 'justify-end' : ''}`}>
                {message.role === 'assistant' ? (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <Bot className="h-4 w-4" />
                  </span>
                ) : null}
                <div className={`${message.role === 'user' ? 'order-first max-w-[85%]' : 'w-full max-w-[90%]'}`}>
                  <div
                    className={`whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm ${
                      message.role === 'user' ? 'bg-primary text-primary-fg' : 'border border-line bg-surface-2'
                    }`}
                  >
                    {message.content}
                  </div>

                  {message.role === 'assistant' ? (
                    <AnswerActions
                      message={message}
                      onCopy={async () => {
                        await copyToClipboard(message.content)
                        notify('success', t('common.copied'))
                      }}
                      onCopyCommands={async (commands) => {
                        await copyToClipboard(commands.join('\n'))
                        notify('success', t('common.copied'))
                      }}
                      onResearchAgain={researchAgain}
                      onContinue={continueDiagnosis}
                    />
                  ) : null}

                  <div className={`mt-1 flex items-center gap-2 text-[10px] text-subtle ${message.role === 'user' ? 'justify-end' : ''}`}>
                    {message.meta ? <span dir="ltr">{message.meta.provider} · {message.meta.model}</span> : <span>{t(`copilot.mode.${message.mode ?? mode}`)}</span>}
                    {message.meta?.searchUsed ? (
                      <span className="inline-flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        {t('copilot.research.live')} · {Math.round((message.meta.elapsedMs ?? 0) / 100) / 10}s
                      </span>
                    ) : message.role === 'assistant' && message.webSearch === 'on' ? (
                      <span>{t('copilot.research.offline')}</span>
                    ) : null}
                  </div>
                </div>
                {message.role === 'user' ? (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <User className="h-4 w-4" />
                  </span>
                ) : null}
              </div>
            ))}

            {busy ? (
              <div className="flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <Bot className="h-4 w-4" />
                </span>
                <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-2.5">
                  <Spinner label={t('copilot.thinking')} />
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="border-t border-line p-3">
              <Alert tone="danger" title={t('copilot.error')}>{error}</Alert>
            </div>
          ) : null}

          <div className="border-t border-line p-3">
            {attachName ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px]">
                <span className="flex items-center gap-1.5">
                  <Paperclip className="h-3 w-3" />
                  {attachName}
                </span>
                <button type="button" onClick={() => setAttachName(null)} className="text-subtle hover:text-text">
                  {t('common.remove')}
                </button>
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <Textarea
                id="copilot-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                placeholder={t('copilot.placeholder')}
                className="min-h-16 flex-1"
                rows={2}
                maxLength={12000}
              />
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.log,.csv,.json,.md,text/plain"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  if (file.size > 200 * 1024) {
                    notify('warning', t('common.fileTooLarge', { max: 0.2 }))
                    return
                  }
                  const text = await file.text()
                  setInput((current) => `${current}${current ? '\n\n' : ''}[${file.name} — ${formatBytes(file.size)}]\n${text}`.slice(0, 12000))
                  setAttachName(`${file.name} (${formatBytes(file.size)})`)
                }}
              />
              <div className="flex flex-col gap-1.5">
                <Button size="icon" variant="secondary" icon={<Paperclip className="h-4 w-4" />} onClick={() => fileRef.current?.click()} aria-label={t('copilot.attach')} />
                {busy ? (
                  <Button size="icon" variant="danger" icon={<Square className="h-3.5 w-3.5" />} onClick={stop} aria-label={t('copilot.stop')} />
                ) : (
                  <Button size="icon" icon={<Send className="h-4 w-4" />} onClick={() => void send()} disabled={!aiAvailable || !input.trim()} aria-label={t('copilot.send')} />
                )}
              </div>
            </div>
            <p className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-subtle">
              <span>{t('copilot.contextNote')}</span>
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" />
                Enter
              </span>
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-2 text-sm font-semibold">{t('copilot.suggestion.script')}</h2>
            <p className="text-xs text-muted">{t('copilot.attachHint')}</p>
            <div className="mt-3 space-y-1.5">
              {MODES.slice(0, 4).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`block w-full rounded-md border px-2.5 py-1.5 text-start text-xs ${
                    mode === id ? 'border-primary bg-primary/10 text-text' : 'border-line text-muted hover:bg-surface-2'
                  }`}
                >
                  {t(`copilot.mode.${id}`)}
                </button>
              ))}
            </div>
          </Card>
          <Alert tone="info">{t('about.honestyBody')}</Alert>
        </div>
      </div>
    </div>
  )
}

export default CopilotPage
