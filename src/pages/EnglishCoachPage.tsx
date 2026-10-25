import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Check, Copy, Plus, Send, Trash2, User, X, Zap } from 'lucide-react'
import { Badge, Button, Card, EmptyState, Field, PageHeader, Select, Spinner, Textarea } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { sendChat } from '@/services/api'
import { useProviders } from '@/context/ProvidersContext'
import { readJson, scopedStorageKey, writeJson, STORAGE_KEYS } from '@/lib/storage'
import { uid, copyToClipboard } from '@/lib/utils'
import type { CoachConversation, CoachMessage, EnglishLevel, CopilotMode } from '@/types'
import { formatDateTime } from '@/i18n'

const LEVELS: Array<{ id: EnglishLevel; labelKey: string }> = [
  { id: 'beginner', labelKey: 'experience.beginner' },
  { id: 'intermediate', labelKey: 'coach.level.intermediate' },
  { id: 'advanced', labelKey: 'coach.level.advanced' },
]

const TOPICS: Array<{ id: string; labelKey: string; starter: string }> = [
  { id: 'daily', labelKey: 'coach.topic.daily', starter: 'Let us talk about daily life.' },
  { id: 'grammar', labelKey: 'coach.topic.grammar', starter: 'Help me with English grammar.' },
  { id: 'vocabulary', labelKey: 'coach.topic.vocabulary', starter: 'Teach me new English words.' },
  { id: 'pronunciation', labelKey: 'coach.topic.pronunciation', starter: 'Help me with pronunciation.' },
  { id: 'interview', labelKey: 'coach.topic.interview', starter: 'Prepare me for a job interview.' },
  { id: 'travel', labelKey: 'coach.topic.travel', starter: 'Teach me English for travel.' },
  { id: 'it-support', labelKey: 'coach.topic.itSupport', starter: 'Teach me English for IT support.' },
  { id: 'networking', labelKey: 'coach.topic.networking', starter: 'Teach me English for networking.' },
]

const SYSTEM_PROMPT_BY_LEVEL: Record<EnglishLevel, string> = {
  beginner: 'You are an English learning coach. Speak simply, use short sentences, and explain in Arabic when needed. Correct mistakes gently with the correct form and a brief explanation.',
  intermediate: 'You are an English learning coach. Help the user improve fluency. Correct grammar and vocabulary errors, suggest better phrasing, and explain why. Mix English with Arabic explanations when helpful.',
  advanced: 'You are an English learning coach for professionals. Focus on nuance, idioms, business English, and technical communication. Provide detailed corrections and alternative expressions.',
}

export function EnglishCoachPage() {
  const { t, settings } = useApp()
  const { status, account } = useAuth()
  const { credentials } = useProviders()
  const { notify } = useToast()

  const [conversations, setConversations] = useState<CoachConversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [input, setInput] = useState('')
  const [level, setLevel] = useState<EnglishLevel>('beginner')
  const [topic, setTopic] = useState<string>('daily')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newWords, setNewWords] = useState<string[]>([])
  const [correctedErrors, setCorrectedErrors] = useState<Array<{ original: string; corrected: string; explanation: string }>>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const userId = status === 'authenticated' ? (account?.profile?.id ?? null) : null
  const conversationsKey = scopedStorageKey(STORAGE_KEYS.conversations, userId)

  useEffect(() => {
    const stored = readJson<CoachConversation[]>(conversationsKey, [])
    setConversations(stored.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
  }, [conversationsKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  useEffect(() => {
    if (activeId) {
      const conv = conversations.find((c) => c.id === activeId)
      if (conv) {
        setMessages(conv.messages)
        setLevel(conv.level)
        setTopic(conv.topic)
        setNewWords(conv.newWords)
        setCorrectedErrors(conv.correctedErrors)
      }
    }
  }, [activeId, conversations])

  const saveConversation = useCallback(() => {
    if (!activeId) return
    const existing = conversations.find((c) => c.id === activeId)
    if (!existing) return
    const updated: CoachConversation = {
      ...existing,
      messages,
      level,
      topic,
      newWords,
      correctedErrors,
      updatedAt: new Date().toISOString(),
    }
    const next = conversations.map((c) => (c.id === activeId ? updated : c)).slice(0, 200)
    setConversations(next)
    writeJson(conversationsKey, next)
  }, [activeId, conversations, messages, level, topic, newWords, correctedErrors, conversationsKey])

  useEffect(() => {
    if (activeId) {
      saveConversation()
    }
  }, [messages, level, topic, newWords, correctedErrors, activeId, saveConversation])

  const startNew = useCallback(() => {
    const id = uid('coach')
    const conv: CoachConversation = {
      id,
      title: t('coach.newConversation'),
      level,
      topic,
      messages: [],
      newWords: [],
      correctedErrors: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userId,
    }
    const next = [conv, ...conversations].slice(0, 200)
    setConversations(next)
    writeJson(conversationsKey, next)
    setActiveId(id)
    setMessages([])
    setNewWords([])
    setCorrectedErrors([])
    setError(null)
  }, [conversations, level, topic, userId, conversationsKey])

  const extractCorrections = useCallback((content: string) => {
    const corrections: Array<{ original: string; corrected: string; explanation: string }> = []
    const words: string[] = []
    const lines = content.split('\n')
    for (const line of lines) {
      const match = line.match(/✓\s*["']([^"']+)["']\s*→\s*["']([^"']+)["']\s*[:—]\s*(.+)/)
      if (match) {
        corrections.push({ original: match[1], corrected: match[2], explanation: match[3].trim() })
      }
      const wordMatch = line.match(/📝\s*(.+)/)
      if (wordMatch) {
        words.push(wordMatch[1].trim())
      }
    }
    return { corrections, words }
  }, [])

  const send = async (override?: string) => {
    const content = (override ?? input).trim()
    if (!content || busy) return
    setError(null)

    const userMessage: CoachMessage = {
      id: uid('msg'),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    }
    setMessages((current) => [...current, userMessage])
    setInput('')
    setBusy(true)

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const systemPrompt = SYSTEM_PROMPT_BY_LEVEL[level]
      const chatMessages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages.map((m) => ({ role: m.role === 'coach' ? 'assistant' as const : 'user' as const, content: m.content })),
        { role: 'user' as const, content },
      ]
      const response = await sendChat(chatMessages, level as CopilotMode, credentials, controller.signal)

      const assistantMessage: CoachMessage = {
        id: uid('msg'),
        role: 'coach',
        content: response.content,
        createdAt: new Date().toISOString(),
      }

      const { corrections, words } = extractCorrections(response.content)
      if (corrections.length > 0) {
        assistantMessage.correction = corrections[0]
        setCorrectedErrors((current) => [...corrections, ...current].slice(0, 20))
      }
      if (words.length > 0) {
        setNewWords((current) => [...words, ...current].filter((w, i, arr) => arr.indexOf(w) === i).slice(0, 50))
      }

      setMessages((current) => [...current, assistantMessage])
    } catch (caught) {
      const apiError = caught as { code?: string; message?: string; status?: number }
      setError(apiError?.message ?? t('coach.error'))
      setMessages((current) => current.slice(0, -1))
      setInput(content)
    } finally {
      setBusy(false)
      controllerRef.current = null
    }
  }

  const stop = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setBusy(false)
  }

  const levelLabel = level === 'beginner' ? t('experience.beginner') : level === 'intermediate' ? t('coach.level.intermediate') : t('coach.level.advanced')
  const topicEntry = TOPICS.find((tpc) => tpc.id === topic)
  const topicLabel = t((topicEntry ? topicEntry.labelKey : 'coach.topic.daily') as any)

  return (
    <div className="animate-in">
      <PageHeader
        title={t('coach.title')}
        subtitle={t('coach.subtitle')}
        badge={<Badge tone="accent" icon={<Zap className="h-3 w-3" />}>AD-MOH</Badge>}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={startNew}
            disabled={busy}
          >
            {t('coach.newConversation')}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="card flex min-h-[60vh] flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <Field label={t('coach.level')} htmlFor="coach-level" className="!gap-1">
              <Select id="coach-level" value={level} onChange={(event) => setLevel(event.target.value as EnglishLevel)} className="w-44">
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>{t(l.labelKey as any)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('coach.topic')} htmlFor="coach-topic" className="!gap-1">
              <Select id="coach-topic" value={topic} onChange={(event) => setTopic(event.target.value)} className="w-44">
                {TOPICS.map((tpc) => (
                  <option key={tpc.id} value={tpc.id}>{t(tpc.labelKey as any)}</option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center gap-2">
              {busy ? <Spinner label={t('coach.thinking')} /> : null}
              {messages.length > 0 ? (
                <Button size="sm" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => setMessages([])} aria-label={t('coach.clear')} />
              ) : null}
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {messages.length === 0 && !busy ? (
              <EmptyState
                icon={<Bot className="h-8 w-8" />}
                title={t('coach.emptyTitle')}
                description={t('coach.emptyBody')}
                action={
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TOPICS.slice(0, 4).map((tpc) => (
                      <button
                        key={tpc.id}
                        type="button"
                        onClick={() => {
                          setTopic(tpc.id)
                          void send(tpc.starter)
                        }}
                        className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-start text-xs hover:border-primary/40"
                      >
                        {t(tpc.labelKey as any)}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : null}

            {messages.map((message) => (
              <div key={message.id} className={`flex gap-2.5 ${message.role === 'user' ? 'justify-end' : ''}`}>
                {message.role === 'coach' ? (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <Bot className="h-4 w-4" />
                  </span>
                ) : null}
                <div className={`max-w-[85%] ${message.role === 'user' ? 'order-first' : ''}`}>
                  <div
                    className={`whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm ${
                      message.role === 'user' ? 'bg-primary text-primary-fg' : 'border border-line bg-surface-2'
                    }`}
                  >
                    {message.content}
                  </div>
                  {message.role === 'coach' && message.correction ? (
                    <div className="mt-1 rounded-lg border border-success/40 bg-success/5 p-2 text-xs">
                      <p className="flex items-center gap-1 text-success font-medium">
                        <Check className="h-3 w-3" /> {t('coach.correction')}
                      </p>
                      <p className="mt-0.5 text-muted">"{message.correction.original}" → "{message.correction.corrected}"</p>
                      <p className="mt-0.5 text-[10px] text-subtle">{message.correction.explanation}</p>
                    </div>
                  ) : null}
                  <div className={`mt-1 flex items-center gap-2 text-[10px] text-subtle ${message.role === 'user' ? 'justify-end' : ''}`}>
                    <span>{formatDateTime(message.createdAt, settings.language)}</span>
                    {message.role === 'coach' ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await copyToClipboard(message.content)
                          notify('success', t('common.copied'))
                        }}
                        className="inline-flex items-center gap-0.5 hover:text-text"
                      >
                        <Copy className="h-3 w-3" />
                        {t('coach.copyAnswer')}
                      </button>
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
                  <Spinner label={t('coach.thinking')} />
                </div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div className="border-t border-line p-3">
              <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3.5 text-xs text-danger">
                {error}
              </div>
            </div>
          ) : null}

          <div className="border-t border-line p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
                placeholder={t('coach.placeholder')}
                className="min-h-16 flex-1"
                rows={2}
                maxLength={6000}
              />
              <div className="flex flex-col gap-1.5">
                {busy ? (
                  <Button size="icon" variant="danger" icon={<X className="h-3 w-3" />} onClick={stop} aria-label={t('coach.stop')} />
                ) : (
                  <Button size="icon" icon={<Send className="h-4 w-4" />} onClick={() => void send()} disabled={!input.trim()} aria-label={t('coach.send')} />
                )}
              </div>
            </div>
            <p className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-subtle">
              <span>{t('coach.contextNote')}</span>
              <span className="inline-flex items-center gap-1">
                Enter
              </span>
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">{t('coach.session')}</h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">{t('coach.level' as any)}:</span>
                <span className="text-text">{levelLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('coach.topic' as any)}:</span>
                <span className="text-text">{topicLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('coach.messages' as any)}:</span>
                <span className="text-text">{messages.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('coach.newWords' as any)}:</span>
                <span className="text-text">{newWords.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">{t('coach.corrections' as any)}:</span>
                <span className="text-text">{correctedErrors.length}</span>
              </div>
            </div>
          </Card>

          {newWords.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">{t('coach.newWordsTitle')}</h2>
              <div className="flex flex-wrap gap-1.5">
                {newWords.slice(0, 20).map((word) => (
                  <span key={word} className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[10px] text-muted">
                    {word}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {correctedErrors.length > 0 && (
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">{t('coach.commonErrors')}</h2>
              <div className="space-y-2">
                {correctedErrors.slice(0, 10).map((err, idx) => (
                  <div key={idx} className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <p className="text-xs font-medium text-subtle">{err.original}</p>
                    <p className="mt-0.5 text-sm text-text">{err.corrected}</p>
                    <p className="mt-0.5 text-[10px] text-muted">{err.explanation}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export default EnglishCoachPage
