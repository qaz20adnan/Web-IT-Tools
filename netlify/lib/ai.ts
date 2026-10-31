import { defaultBaseUrl, providerKind, serverConfig, type ProviderKind } from './env'
import { fetchText, mapUpstreamStatus } from './fetch'
import { header, HttpError, type NetlifyEvent } from './http'
import { validateAiEndpoint } from './host'
import { MAX_IMAGE_BYTES, MAX_IMAGE_MB_LABEL } from '../../shared/upload-limits'

export interface AiConfig {
  provider: ProviderKind
  baseUrl: string
  model: string
  fallbackModel: string
  apiKey: string
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LiveModelInfo {
  id: string
  name: string
  contextLength: number | null
  pricing?: string
  description?: string
  /** Input modalities reported by the catalog (for example ["text","image"]). */
  inputModalities?: string[]
  /** Output modalities reported by the catalog (for example ["text"]). */
  outputModalities?: string[]
  /** Parameters the model accepts (for example ["tools","response_format"]). */
  supportedParameters?: string[]
  created?: number | null
  deprecated?: boolean
}

/** Documented base URLs. Kept here so endpoints are never assembled twice. */
export const PROVIDER_ENDPOINTS: Record<Exclude<ProviderKind, 'custom'>, {
  chat: string
  models: string
}> = {
  openai: { chat: 'chat/completions', models: 'models' },
  openrouter: { chat: 'chat/completions', models: 'models' },
  anthropic: { chat: 'messages', models: 'models' },
  gemini: { chat: 'models/{model}:generateContent', models: 'models' },
  ollama: { chat: 'api/chat', models: 'api/tags' },
}

const KNOWN_SUFFIXES = ['/chat/completions', '/completions', '/models', '/api/tags', '/api/chat', '/messages']

/**
 * Normalizes a user-supplied base URL. Users frequently paste a full endpoint
 * (for example `https://openrouter.ai/api/v1/models`) instead of the base URL,
 * which produces a doubled path such as `/v1/models/models` and an upstream 404.
 */
export function normalizeBaseUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '')
  // Gemini users often paste a full `.../models/<id>:generateContent` URL.
  value = value.replace(/:(?:stream)?generateContent$/i, '')
  value = value.replace(/\/(v1(?:beta|alpha)?)\/models\/[^/]+$/i, '/$1')
  let changed = true
  while (changed) {
    changed = false
    for (const suffix of KNOWN_SUFFIXES) {
      if (value.toLowerCase().endsWith(suffix)) {
        value = value.slice(0, -suffix.length).replace(/\/+$/, '')
        changed = true
      }
    }
  }
  return value
}

function requireModel(value: string): string {
  const model = value.trim()
  if (!model) throw new HttpError(400, 'not_configured', 'No model is configured for this provider.')
  return model
}

export function resolveAiConfig(
  event: NetlifyEvent,
  options: { vision?: boolean; requireModel?: boolean; allowAnonymous?: boolean } = {},
): AiConfig {
  const kind = providerKind(header(event, 'x-tn-provider')) ?? providerKind(process.env.AI_PROVIDER)
  if (!kind) throw new HttpError(400, 'not_configured', 'No AI provider is configured. Add one in Provider Hub or set AI_PROVIDER.')
  const envProvider = providerKind(process.env.AI_PROVIDER)
  const baseHeader = header(event, 'x-tn-base-url')?.trim()
  const useVisionEnv = options.vision && (process.env.AI_VISION_PROVIDER || process.env.AI_VISION_MODEL || process.env.AI_VISION_BASE_URL)
  const baseUrl =
    (useVisionEnv && kind === envProvider ? process.env.AI_VISION_BASE_URL?.trim() : undefined) ||
    baseHeader ||
    (kind === envProvider ? process.env.AI_BASE_URL?.trim() : undefined) ||
    defaultBaseUrl(kind)
  if (!baseUrl) throw new HttpError(400, 'not_configured', 'No base URL is configured for this provider.')
  const modelHeader = options.vision ? header(event, 'x-tn-vision-model')?.trim() : undefined
  const model =
    modelHeader ||
    (useVisionEnv && kind === envProvider ? process.env.AI_VISION_MODEL?.trim() : undefined) ||
    header(event, 'x-tn-model')?.trim() ||
    (kind === envProvider ? process.env.AI_MODEL?.trim() : undefined) ||
    ''
  const apiKey =
    header(event, 'x-tn-key')?.trim() ||
    (useVisionEnv && kind === envProvider ? process.env.AI_VISION_API_KEY?.trim() : undefined) ||
    (kind === envProvider ? process.env.AI_API_KEY?.trim() : undefined) ||
    ''
  if (!apiKey && kind !== 'ollama' && !options.allowAnonymous) {
    throw new HttpError(400, 'not_configured', 'No API key was supplied for this provider.')
  }
  const fallbackModel =
    header(event, 'x-tn-fallback-model')?.trim() ||
    (kind === envProvider ? process.env.AI_FALLBACK_MODEL?.trim() : undefined) ||
    ''
  return {
    provider: kind,
    baseUrl: normalizeBaseUrl(baseUrl),
    model: options.requireModel === false ? model : requireModel(model),
    fallbackModel: fallbackModel && fallbackModel !== model ? fallbackModel : '',
    apiKey,
  }
}

function endpoint(baseUrl: string, path: string): string {
  return `${normalizeBaseUrl(baseUrl)}/${path.replace(/^\/+/, '')}`
}

function authHeaders(config: AiConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else if (config.provider === 'gemini') {
    headers['x-goog-api-key'] = config.apiKey
  } else if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`
  }
  if (config.provider === 'openrouter') {
    // Optional app-attribution headers documented by OpenRouter.
    headers['HTTP-Referer'] = serverConfig.appReferer
    headers['X-Title'] = serverConfig.appTitle
    headers['X-OpenRouter-Title'] = serverConfig.appTitle
  }
  return headers
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

/**
 * Netlify standard functions are killed at 60 s and `vercel.json` sets
 * `maxDuration: 60`. A kill at that ceiling reaches the user as an opaque
 * platform error page, so every AI call shares a budget that stops short of it.
 */
export const PLATFORM_BUDGET_MS = 50_000

/** Below this an attempt cannot realistically be answered, so it is not started. */
const MIN_ATTEMPT_MS = 1_500

export interface Deadline {
  readonly budgetMs: number
  remainingMs(): number
  /** Per-attempt timeout to use, or null when the budget is too spent to try. */
  nextAttemptMs(desiredMs: number): number | null
  /** Whether enough budget remains to start another attempt at all. */
  canAttempt(): boolean
}

export function newDeadline(budgetMs = PLATFORM_BUDGET_MS, startedAt = Date.now()): Deadline {
  const remainingMs = () => Math.max(0, budgetMs - (Date.now() - startedAt))
  return {
    budgetMs,
    remainingMs,
    nextAttemptMs: (desiredMs) => {
      const timeout = Math.min(desiredMs, remainingMs())
      return timeout >= MIN_ATTEMPT_MS ? timeout : null
    },
    canAttempt: () => remainingMs() >= MIN_ATTEMPT_MS,
  }
}

function budgetExhausted(deadline: Deadline): HttpError {
  return new HttpError(
    504,
    'timeout',
    `The AI provider did not answer within the ${Math.round(deadline.budgetMs / 1000)} second request budget. No reply is shown rather than a partial one — try again or choose a faster model.`,
  )
}

/** Per-attempt timeout, or a structured 504 when the shared budget is already spent. */
function attemptTimeout(deadline: Deadline | undefined, desiredMs: number): number {
  if (!deadline) return desiredMs
  const timeout = deadline.nextAttemptMs(desiredMs)
  if (timeout === null) throw budgetExhausted(deadline)
  return timeout
}

/** Retries transient failures only. Never retries auth or invalid-request errors. */
async function withRetry<T>(operation: () => Promise<T>, attempts = 2, deadline?: Deadline): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const status = error instanceof HttpError ? error.statusCode : 0
      const retryable = status === 0 || status === 408 || isRetryable(status)
      if (!retryable || attempt === attempts - 1) throw error
      // Returning the real upstream cause beats spending the remaining seconds on
      // a retry the platform would kill anyway.
      if (deadline && !deadline.canAttempt()) throw error
      await delay(200 * (attempt + 1))
    }
  }
  throw lastError
}

async function postJson(url: string, config: AiConfig, body: unknown, timeoutMs: number, deadline?: Deadline): Promise<{ status: number; text: string }> {
  return withRetry(async () => {
    const response = await fetchText(url, {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify(body),
      timeoutMs: attemptTimeout(deadline, timeoutMs),
      maxBytes: 12 * 1024 * 1024,
    })
    if (!response.ok) throw mapUpstreamStatus(response.status, response.text.slice(0, 300), config.apiKey)
    return { status: response.status, text: response.text }
  }, 2, deadline)
}

function parseJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new HttpError(502, 'upstream_error', 'The provider returned a non-JSON response.')
  }
}

function readPath(record: unknown, path: Array<string | number>): unknown {
  let current: unknown = record
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}

export async function chatComplete(
  config: AiConfig,
  messages: AiMessage[],
  options: { maxTokens?: number; temperature?: number; deadline?: Deadline } = {},
): Promise<string> {
  await validateAiEndpoint(config.baseUrl)
  const maxTokens = Math.min(options.maxTokens ?? serverConfig.maxOutputTokens, 8000)
  const timeoutMs = serverConfig.timeoutMs
  const deadline = options.deadline ?? newDeadline()
  const temperature = options.temperature ?? 0.3

  if (config.provider === 'anthropic') {
    const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
    const conversation = messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role, content: message.content }))
    const { text } = await postJson(endpoint(config.baseUrl, 'messages'), config, {
      model: config.model,
      max_tokens: maxTokens,
      temperature,
      ...(system ? { system } : {}),
      messages: conversation,
    }, timeoutMs, deadline)
    const data = parseJson(text)
    const content = readPath(data, ['content'])
    if (Array.isArray(content)) {
      const joined = content
        .map((block) => (block && typeof block === 'object' ? (block as Record<string, unknown>).text : null))
        .filter((part): part is string => typeof part === 'string')
        .join('\n')
      if (joined) return joined
    }
    throw new HttpError(502, 'upstream_error', 'The provider returned an empty response.')
  }

  if (config.provider === 'gemini') {
    return geminiChat(config, messages, maxTokens, temperature, timeoutMs, deadline)
  }

  if (config.provider === 'ollama') {
    const { text } = await postJson(endpoint(config.baseUrl, 'api/chat'), config, {
      model: config.model,
      messages,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    }, timeoutMs, deadline)
    const data = parseJson(text)
    const content = readPath(data, ['message', 'content'])
    if (typeof content === 'string' && content.trim()) return content
    throw new HttpError(502, 'upstream_error', 'The local model returned an empty response.')
  }

  const { text } = await postJson(endpoint(config.baseUrl, 'chat/completions'), config, {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature,
  }, timeoutMs, deadline)
  const data = parseJson(text)
  const content = readPath(data, ['choices', 0, 'message', 'content'])
  if (typeof content === 'string' && content.trim()) return content
  throw new HttpError(502, 'upstream_error', 'The provider returned an empty response.')
}

function geminiContents(messages: AiMessage[]): { system: string; contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> } {
  const system = messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n')
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] }))
  return { system, contents }
}

async function geminiChat(config: AiConfig, messages: AiMessage[], maxTokens: number, temperature: number, timeoutMs: number, deadline?: Deadline): Promise<string> {
  const { system, contents } = geminiContents(messages)
  const model = encodeURIComponent(config.model.replace(/^models\//, ''))
  const { text } = await postJson(endpoint(config.baseUrl, `models/${model}:generateContent`), config, {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  }, timeoutMs, deadline)
  const data = parseJson(text)
  const parts = readPath(data, ['candidates', 0, 'content', 'parts'])
  if (Array.isArray(parts)) {
    const joined = parts.map((part) => (part && typeof part === 'object' ? (part as Record<string, unknown>).text : null)).filter((part): part is string => typeof part === 'string').join('')
    if (joined.trim()) return joined
  }
  const blockReason = readPath(data, ['promptFeedback', 'blockReason'])
  if (typeof blockReason === 'string') throw new HttpError(422, 'invalid_input', `The provider blocked the prompt (${blockReason}).`)
  throw new HttpError(502, 'upstream_error', 'The provider returned an empty response.')
}

interface ImagePayload {
  mediaType: string
  base64: string
}

function parseImageDataUrl(dataUrl: string): ImagePayload {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new HttpError(400, 'invalid_input', 'The image must be a PNG, JPEG, WebP or GIF data URL.')
  const bytes = Math.floor((match[2].length * 3) / 4)
  if (bytes > MAX_IMAGE_BYTES) throw new HttpError(413, 'payload_too_large', `The image exceeds the ${MAX_IMAGE_MB_LABEL} limit.`)
  return { mediaType: match[1], base64: match[2] }
}

export async function visionComplete(
  config: AiConfig,
  prompt: string,
  dataUrl: string,
  options: { maxTokens?: number; deadline?: Deadline } = {},
): Promise<string> {
  await validateAiEndpoint(config.baseUrl)
  const image = parseImageDataUrl(dataUrl)
  const maxTokens = Math.min(options.maxTokens ?? serverConfig.maxOutputTokens, 8000)
  const timeoutMs = serverConfig.timeoutMs
  const deadline = options.deadline ?? newDeadline()

  if (config.provider === 'gemini') {
    const model = encodeURIComponent(config.model.replace(/^models\//, ''))
    const { text } = await postJson(endpoint(config.baseUrl, `models/${model}:generateContent`), config, {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: image.mediaType, data: image.base64 } }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    }, timeoutMs, deadline)
    const data = parseJson(text)
    const parts = readPath(data, ['candidates', 0, 'content', 'parts'])
    if (Array.isArray(parts)) {
      const joined = parts.map((part) => (part && typeof part === 'object' ? (part as Record<string, unknown>).text : null)).filter((part): part is string => typeof part === 'string').join('')
      if (joined.trim()) return joined
    }
    throw new HttpError(502, 'upstream_error', 'The provider returned an empty vision response.')
  }

  if (config.provider === 'anthropic') {
    const { text } = await postJson(endpoint(config.baseUrl, 'messages'), config, {
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }, timeoutMs, deadline)
    const data = parseJson(text)
    const content = readPath(data, ['content'])
    if (Array.isArray(content)) {
      const joined = content.map((block) => (block && typeof block === 'object' ? (block as Record<string, unknown>).text : null)).filter((part): part is string => typeof part === 'string').join('\n')
      if (joined.trim()) return joined
    }
    throw new HttpError(502, 'upstream_error', 'The provider returned an empty vision response.')
  }

  if (config.provider === 'ollama') {
    const { text } = await postJson(endpoint(config.baseUrl, 'api/chat'), config, {
      model: config.model,
      messages: [{ role: 'user', content: prompt, images: [image.base64] }],
      stream: false,
      options: { temperature: 0.2, num_predict: maxTokens },
    }, timeoutMs, deadline)
    const data = parseJson(text)
    const content = readPath(data, ['message', 'content'])
    if (typeof content === 'string' && content.trim()) return content
    throw new HttpError(502, 'upstream_error', 'The local model returned an empty vision response.')
  }

  const { text } = await postJson(endpoint(config.baseUrl, 'chat/completions'), config, {
    model: config.model,
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    }],
  }, timeoutMs, deadline)
  const data = parseJson(text)
  const content = readPath(data, ['choices', 0, 'message', 'content'])
  if (typeof content === 'string' && content.trim()) return content
  throw new HttpError(502, 'upstream_error', 'The provider returned an empty vision response.')
}

const FALLBACK_CODES = new Set(['not_found', 'invalid_input', 'forbidden', 'upstream_error'])

/**
 * Runs a completion against the primary model and, when the provider reports the
 * model as unavailable/unsupported, transparently retries once with the
 * configured fallback model. Credential and rate-limit failures are never
 * retried with a different model.
 */
export async function completeWithFallback(
  config: AiConfig,
  messages: AiMessage[],
  options: { maxTokens?: number; temperature?: number; imageDataUrl?: string; deadline?: Deadline } = {},
): Promise<{ content: string; model: string; fallbackUsed: boolean }> {
  // One budget for the primary model *and* the fallback retry, so the two runs
  // together stay inside the platform's function ceiling.
  const deadline = options.deadline ?? newDeadline()
  const run = (model: string) =>
    options.imageDataUrl
      ? visionComplete({ ...config, model }, messages.map((message) => message.content).join('\n\n'), options.imageDataUrl, { maxTokens: options.maxTokens, deadline })
      : chatComplete({ ...config, model }, messages, { maxTokens: options.maxTokens, temperature: options.temperature, deadline })

  try {
    return { content: await run(config.model), model: config.model, fallbackUsed: false }
  } catch (error) {
    const code = error instanceof HttpError ? error.code : 'unknown'
    if (!config.fallbackModel || !FALLBACK_CODES.has(code)) throw error
    return { content: await run(config.fallbackModel), model: config.fallbackModel, fallbackUsed: true }
  }
}

/**
 * Verifies credentials with a lightweight authenticated request.
 *
 * The OpenRouter model catalog is public, so listing models does NOT prove the
 * key is valid. `GET /api/v1/key` is the documented authenticated endpoint and
 * returns 401 for missing or invalid keys.
 *
 * For every other provider the model list is fetched twice — once with the key
 * and once without. A host that answers both is publishing a public catalog, so
 * reaching it says nothing about the key; that case is reported as reachable but
 * unproven rather than as a passed authentication test.
 */
export interface ProviderVerification {
  latencyMs: number
  keyVerified: boolean
  /** Machine-readable cause for `keyVerified: false`, so the UI can translate it. */
  reason?: 'public_catalog' | 'no_key_provider'
  note?: string
}

export async function verifyProviderAuth(config: AiConfig, options: { deadline?: Deadline } = {}): Promise<ProviderVerification> {
  await validateAiEndpoint(config.baseUrl)
  const started = Date.now()
  // The keyed and keyless catalog reads below share one budget, so the whole
  // verification can never outlive the platform's function ceiling.
  const deadline = options.deadline ?? newDeadline()
  if (config.provider === 'openrouter') {
    const response = await fetchText(endpoint(config.baseUrl, 'key'), {
      headers: authHeaders(config),
      timeoutMs: attemptTimeout(deadline, 15000),
      maxBytes: 512 * 1024,
    })
    if (!response.ok) throw mapUpstreamStatus(response.status, response.text.slice(0, 300), config.apiKey)
    return { latencyMs: Date.now() - started, keyVerified: true }
  }
  if (config.provider === 'ollama') {
    const response = await fetchText(endpoint(config.baseUrl, 'api/tags'), { timeoutMs: attemptTimeout(deadline, 10000), maxBytes: 2 * 1024 * 1024 })
    if (!response.ok) throw mapUpstreamStatus(response.status, response.text.slice(0, 300), config.apiKey)
    return {
      latencyMs: Date.now() - started,
      keyVerified: false,
      reason: 'no_key_provider',
      note: 'Ollama does not use an API key. This proves the server is reachable, not a credential.',
    }
  }
  // OpenAI-compatible, Anthropic and Gemini all require auth on their model list.
  const models = await listModels(config, { deadline })
  if (models.length === 0 && config.model) {
    throw new HttpError(422, 'not_found', 'Authentication succeeded but the model catalog is empty or unreadable.')
  }
  // A second fetch with no credential distinguishes a real authentication from
  // an open catalog; a failure here simply means the catalog is not public.
  const publicCatalog = await listModels({ ...config, apiKey: '' }, { deadline })
    .then((entries) => entries.length > 0)
    .catch(() => false)
  if (publicCatalog) {
    return {
      latencyMs: Date.now() - started,
      keyVerified: false,
      reason: 'public_catalog',
      note: 'This endpoint publishes its model catalog without a key, so the connection works but the key itself was not verified. Run a chat test to prove it.',
    }
  }
  return { latencyMs: Date.now() - started, keyVerified: true }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function formatPricing(record: Record<string, unknown>): string | undefined {
  const pricing = record.pricing
  if (!pricing || typeof pricing !== 'object') return undefined
  const map = pricing as Record<string, unknown>
  const prompt = map.prompt ?? map.input
  const completion = map.completion ?? map.output
  const toUsd = (value: unknown): string | null => {
    const perToken = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    if (!Number.isFinite(perToken)) return null
    return `$${(perToken * 1_000_000).toFixed(perToken * 1_000_000 >= 1 ? 2 : 4)}/1M`
  }
  const parts = [prompt !== undefined ? `in ${toUsd(prompt)}` : null, completion !== undefined ? `out ${toUsd(completion)}` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

export async function listModels(config: AiConfig, options: { deadline?: Deadline } = {}): Promise<LiveModelInfo[]> {
  await validateAiEndpoint(config.baseUrl)
  const headers = authHeaders(config)
  const url = endpoint(config.baseUrl, config.provider === 'ollama' ? 'api/tags' : 'models')
  const deadline = options.deadline

  const data = await withRetry(async () => {
    const response = await fetchText(url, { headers, timeoutMs: attemptTimeout(deadline, 20000), maxBytes: 4 * 1024 * 1024 })
    if (!response.ok) throw mapUpstreamStatus(response.status, response.text.slice(0, 300), config.apiKey)
    return parseJson(response.text)
  }, 2, deadline)

  if (config.provider === 'ollama') {
    const models = readPath(data, ['models'])
    return Array.isArray(models)
      ? models
          .map((entry) => {
            const record = entry as Record<string, unknown>
            return { id: String(record.name ?? record.model ?? ''), name: String(record.name ?? ''), contextLength: null }
          })
          .filter((entry) => entry.id)
      : []
  }

  const items = config.provider === 'gemini' ? readPath(data, ['models']) : readPath(data, ['data'])
  if (!Array.isArray(items)) return []
  return items
    .map((entry) => {
      const record = entry as Record<string, unknown>
      const rawId = String(record.id ?? record.name ?? '')
      const id = config.provider === 'gemini' ? rawId.replace(/^models\//, '') : rawId
      const context = record.inputTokenLimit ?? record.context_length ?? record.context_window
      const architecture = (record.architecture && typeof record.architecture === 'object' ? record.architecture : {}) as Record<string, unknown>
      const pricing = formatPricing(record)
      const created = typeof record.created === 'number' ? record.created : null
      return {
        id,
        name: String(record.displayName ?? record.display_name ?? record.name ?? id),
        contextLength: typeof context === 'number' ? context : null,
        ...(pricing ? { pricing } : {}),
        ...(typeof record.description === 'string' ? { description: record.description.slice(0, 600) } : {}),
        ...(stringArray(architecture.input_modalities).length ? { inputModalities: stringArray(architecture.input_modalities) } : {}),
        ...(stringArray(architecture.output_modalities).length ? { outputModalities: stringArray(architecture.output_modalities) } : {}),
        ...(stringArray(record.supported_parameters).length ? { supportedParameters: stringArray(record.supported_parameters) } : {}),
        ...(created !== null ? { created } : {}),
      }
    })
    .filter((entry) => entry.id)
}
