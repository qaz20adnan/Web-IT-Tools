import type {
  AccountPayload,
  AnalysisResult,
  ApiErrorCode,
  AuthConfig,
  AuthTokens,
  ChatMessage,
  CopilotMode,
  HealthStatus,
  NewsItem,
  ProblemInput,
  ProviderConfig,
  ResearchResult,
  ResearchSource,
  WebSearchMode,
} from '@/types'

export interface AiCredentials {
  provider: ProviderConfig
  apiKey: string | null
}

export class ApiError extends Error {
  code: ApiErrorCode
  status: number
  detail?: string
  /** Seconds from the `Retry-After` header, when the server sent one. */
  retryAfterSeconds: number | null

  constructor(code: ApiErrorCode, message: string, status = 0, detail?: string, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
    this.retryAfterSeconds = retryAfterSeconds
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  credentials?: AiCredentials | null
  signal?: AbortSignal
  adminToken?: string
  accessToken?: string
}

let authTokenProvider: (() => string | null) | null = null

/** Registered by AuthProvider so authenticated requests carry the session token. */
export function setAuthTokenProvider(provider: (() => string | null) | null): void {
  authTokenProvider = provider
}

let unauthorizedHandler: (() => Promise<string | null>) | null = null

/**
 * Registered by AuthProvider. Called when a request carrying the ambient session
 * token is rejected with 401, and expected to return a fresh access token or null.
 */
export function setUnauthorizedHandler(handler: (() => Promise<string | null>) | null): void {
  unauthorizedHandler = handler
}

/** Both `Retry-After` forms from RFC 9110 §10.2.3: delta-seconds or an HTTP-date. */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds), 86_400)
  const at = Date.parse(value)
  if (Number.isNaN(at)) return null
  return Math.min(Math.max(0, Math.round((at - Date.now()) / 1000)), 86_400)
}

async function request<T>(path: string, options: RequestOptions = {}, replayed = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.credentials) {
    const { provider, apiKey } = options.credentials
    headers['x-tn-provider'] = provider.kind
    headers['x-tn-model'] = provider.model
    if (provider.baseUrl) headers['x-tn-base-url'] = provider.baseUrl
    if (provider.fallbackModel) headers['x-tn-fallback-model'] = provider.fallbackModel
    if (provider.visionModel) headers['x-tn-vision-model'] = provider.visionModel
    if (apiKey) headers['x-tn-key'] = apiKey
  }
  // An explicit token means the caller already refreshed it on purpose, so a 401
  // there is a real rejection rather than a stale session — and replaying a
  // mutation the caller drove by hand is not this layer's decision to make.
  const usedSessionToken = options.adminToken === undefined && options.accessToken === undefined
  const accessToken = options.adminToken ?? options.accessToken ?? authTokenProvider?.() ?? null
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new ApiError('timeout', 'The request was aborted.', 0)
    }
    throw new ApiError('unknown', 'Network request failed.', 0, (error as Error).message)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const payload: unknown = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text()

  if (!response.ok) {
    // The scheduled refresh only fires while the tab is awake, so an access token
    // can lapse mid-session. Every handler authenticates before it reads the body
    // or touches data, which means a 401 applied nothing and is safe to replay once.
    if (
      response.status === 401 &&
      !replayed &&
      usedSessionToken &&
      accessToken !== null &&
      unauthorizedHandler !== null &&
      !path.startsWith('/api/auth')
    ) {
      const fresh = await unauthorizedHandler()
      if (fresh) return request<T>(path, options, true)
    }

    const envelope = payload as { error?: { code?: ApiErrorCode; message?: string; detail?: string } } | null
    const code = envelope?.error?.code ?? (response.status === 429 ? 'rate_limited' : 'unknown')
    const message = envelope?.error?.message ?? `Request failed with status ${response.status}.`
    throw new ApiError(code, message, response.status, envelope?.error?.detail, parseRetryAfter(response.headers.get('retry-after')))
  }

  return payload as T
}

export function getHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/api/health')
}

export interface ChatResponse {
  content: string
  provider: string
  model: string
  engine?: string
  searchUsed?: boolean
  searchQueries?: string[]
  searchRequests?: number
  sources?: ResearchSource[]
  elapsedMs?: number
  incomplete?: boolean
}

export interface TestResponse {
  ok: boolean
  mode: 'connectivity' | 'chat'
  provider: string
  model: string | null
  models?: number
  modelAvailable?: boolean | null
  keyVerified?: boolean
  unverifiedReason?: 'public_catalog' | 'no_key_provider'
  note?: string
  reply?: string
  latencyMs: number
  detail?: string
}

export function testProvider(
  credentials: AiCredentials | null,
  mode: 'connectivity' | 'chat' = 'connectivity',
): Promise<TestResponse> {
  return request<TestResponse>('/api/ai/test', { body: { mode }, credentials })
}

export function sendChat(
  messages: Array<Pick<ChatMessage, 'role' | 'content'>>,
  mode: CopilotMode,
  webSearch: WebSearchMode,
  credentials: AiCredentials | null,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return request<ChatResponse>('/api/ai/chat', {
    body: { messages, mode, webSearch },
    credentials,
    signal,
  })
}

export function analyzeProblem(
  input: ProblemInput,
  credentials: AiCredentials | null,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  return request<AnalysisResult>('/api/ai/analyze', {
    body: { input },
    credentials,
    signal,
  })
}

export interface ScriptResponse {
  code: string
  language: string
  feedback: string
  provider: string
  model: string
}

export function generateScript(
  prompt: string,
  language: string,
  credentials: AiCredentials | null,
  signal?: AbortSignal,
): Promise<ScriptResponse> {
  return request<ScriptResponse>('/api/ai/script', {
    body: { action: 'generate', prompt, language },
    credentials,
    signal,
  })
}

export function reviewScript(
  code: string,
  language: string,
  credentials: AiCredentials | null,
  signal?: AbortSignal,
): Promise<ScriptResponse> {
  return request<ScriptResponse>('/api/ai/script', {
    body: { action: 'review', code, language },
    credentials,
    signal,
  })
}

export interface ResearchResponse {
  results: ResearchResult[]
  providers: string[]
  note?: string
}

export function searchResearch(
  query: string,
  officialOnly: boolean,
  signal?: AbortSignal,
): Promise<ResearchResponse> {
  return request<ResearchResponse>('/api/research', {
    body: { query, officialOnly },
    signal,
  })
}

export interface NewsResponse {
  items: NewsItem[]
  fetchedAt: string
  stale: boolean
  sources: string[]
  errors?: string[]
}

export function fetchNews(force = false): Promise<NewsResponse> {
  return request<NewsResponse>(`/api/news${force ? '?refresh=1' : ''}`)
}

export interface LiveModel {
  id: string
  name: string
  contextLength: number | null
  pricing?: string
  description?: string
  inputModalities?: string[]
  outputModalities?: string[]
  supportedParameters?: string[]
  created?: number | null
}

export interface LiveModelsResponse {
  models: LiveModel[]
  provider: string
  count?: number
  fetchedAt?: string
}

export function fetchLiveModels(credentials: AiCredentials | null): Promise<LiveModelsResponse> {
  return request<LiveModelsResponse>('/api/ai/models', { credentials })
}

export interface ContentResponse<T> {
  items: T[]
  source: 'supabase' | 'none'
}

export function fetchArticles<T>(): Promise<ContentResponse<T>> {
  return request<ContentResponse<T>>('/api/content?type=articles')
}

export interface DnsAnswer {
  name: string
  type: string
  ttl: number
  data: string
}

export interface DnsResolverResult {
  resolver: string
  outcome: string
  rcode: number | null
  elapsedMs: number
  errorCode: string | null
  answers: DnsAnswer[]
}

export interface DnsLookupResponse {
  name: string
  askedAs: string
  type: string
  checkedAt: string
  outcome: string
  outcomeLabel: string
  rcode: number | null
  answers: DnsAnswer[]
  resolvers: DnsResolverResult[]
  agreement: boolean
  note: string
}

export function lookupDns(host: string, type: string): Promise<DnsLookupResponse> {
  return request<DnsLookupResponse>('/api/net/dns', { body: { host, type } })
}

export interface TlsInfo {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  daysRemaining: number
  serialNumber: string
  subjectAltNames: string[]
  protocol: string | null
}

export function inspectTls(host: string, port: number): Promise<TlsInfo> {
  return request('/api/net/tls', { body: { host, port } })
}

export type PortProbeState = 'open' | 'closed' | 'filtered' | 'timeout' | 'error'

export interface PortProbeInfo {
  port: number
  state: PortProbeState
  latencyMs: number | null
  service: string | null
  banner: string | null
  errorCode: string | null
}

/** The deployment's own egress address — shown as where the probe ran from, never as the visitor's IP. */
export interface ProbeSourceInfo {
  ipv4: string | null
  ipv6: string | null
  country: string | null
  colo: string | null
  source: string
}

export interface NameResolutionInfo {
  host: string
  ipv4: string[]
  ipv6: string[]
  lowestTtl: number | null
  error: string | null
}

export interface AnalysisObservation {
  label: string
  value: string
  tone: 'default' | 'success' | 'warning' | 'danger'
}

export interface AnalysisCause {
  id: string
  likelihood: 'high' | 'medium' | 'low'
  title: string
  explanation: string
  evidence: string[]
}

export interface NetworkAnalysisReport {
  headline: string
  riskLevel: 'low' | 'medium' | 'high'
  summary: string
  observations: AnalysisObservation[]
  causes: AnalysisCause[]
  recommendations: string[]
  limitations: string[]
  markdown: string
}

export interface NetworkAnalyzerResponse {
  checkedAt: string
  probeSource: ProbeSourceInfo
  name: NameResolutionInfo
  expectedIp: string | null
  target: { host: string; address: string }
  ports: PortProbeInfo[]
  report: NetworkAnalysisReport
}

export function analyzeNetwork(input: {
  host: string
  expectedIp?: string
  ports?: number[]
  lang: 'en' | 'ar'
}): Promise<NetworkAnalyzerResponse> {
  return request<NetworkAnalyzerResponse>('/api/net/analyzer', { body: input })
}

export interface IppPrinterInfo {
  ok: boolean
  path: string | null
  statusCode: number | null
  statusName: string | null
  name: string | null
  model: string | null
  state: string | null
  stateReasons: string[]
  queuedJobs: number | null
  acceptingJobs: boolean | null
}

export interface PrinterProbeResponse {
  checkedAt: string
  connectionType: 'network'
  target: { host: string; address: string }
  reachable: boolean
  likelyProtocol: string
  ports: PortProbeInfo[]
  ipp: IppPrinterInfo | null
  queue: {
    name: string | null
    model: string | null
    state: string | null
    stateReasons: string[]
    queuedJobs: number | null
    acceptingJobs: boolean | null
  } | null
  localAgentAvailable: boolean
  notes: string[]
}

export function probeNetworkPrinter(host: string, lang: 'en' | 'ar'): Promise<PrinterProbeResponse> {
  return request<PrinterProbeResponse>('/api/net/printer', { body: { host, lang } })
}

export interface LatencySample {
  sequence: number
  address: string
  ok: boolean
  latencyMs: number | null
  errorCode: string | null
  /** `platform` = this runtime could not originate the attempt; excluded from the loss figure. */
  failureKind: 'target' | 'platform' | null
}

export interface LatencyResponse {
  target: string
  address: string
  addresses: string[]
  port: number
  protocol: 'tcp'
  samples: LatencySample[]
  summary: {
    sent: number
    connected: number
    failed: number
    platformFailures: number
    lossPercent: number
    minMs: number | null
    maxMs: number | null
    avgMs: number | null
    jitterMs: number | null
  }
  truncated: boolean
  elapsedMs: number
  checkedAt: string
  note: string | null
}

export function runLatencyProbe(host: string, port = 443, samples = 5, timeoutMs = 1500): Promise<LatencyResponse> {
  return request<LatencyResponse>('/api/net/latency', { body: { host, port, samples, timeoutMs } })
}

export interface PathResolution {
  resolver: string
  outcome: string
  answers: number
  lowestTtl: number | null
}

export interface PathResponse {
  target: string
  resolvedAt: string
  addresses: { v4: string[]; v6: string[] }
  canonicalName: string[]
  reverse: Array<{ address: string; names: string[]; outcome: string }>
  authority: { zone: string | null; nameservers: string[]; soaSerial: string | null; soaRefresh: number | null }
  crossResolver: PathResolution[]
  disagreement: boolean
  ownership: {
    ip: string | null
    asn: string | null
    organisation: string | null
    internetServiceProvider: string | null
    domain: string | null
    country: string | null
    region: string | null
    city: string | null
    errorCode: string | null
  } | null
  probeOrigin: { ip: string | null; pointOfPresence: string | null; location: string | null; tls: string | null }
  note: string
}

export function runPathProbe(host: string): Promise<PathResponse> {
  return request<PathResponse>('/api/net/path', { body: { host } })
}

export interface PortCheckResponse {
  target: string
  address: string
  location: 'server'
  checkedAt: string
  ports: PortProbeInfo[]
  scope: 'public' | 'private'
  timeoutMs: number
  note: string
}

export function checkPublicPorts(
  host: string,
  ports: number[],
  options: { timeoutMs?: number } = {},
): Promise<PortCheckResponse> {
  return request<PortCheckResponse>('/api/net/port', {
    body: { host, ports, protocol: 'tcp', timeoutMs: options.timeoutMs ?? 2400 },
  })
}

export interface HttpCheckHop {
  url: string
  status: number
  location: string | null
  latencyMs: number
}

export interface HttpCheckResponse {
  requestedUrl: string
  finalUrl: string
  status: number
  statusText: string
  ok: boolean
  latencyMs: number
  method: string
  contentType: string | null
  contentLength: number | null
  redirects: HttpCheckHop[]
  headers: Record<string, string>
  tls: TlsInfo | null
  tlsError: string | null
  note: string
}

export function checkHttpEndpoint(
  url: string,
  options: { method?: 'HEAD' | 'GET'; followRedirects?: boolean; timeoutMs?: number } = {},
): Promise<HttpCheckResponse> {
  return request<HttpCheckResponse>('/api/net/http', {
    body: { url, method: options.method ?? 'HEAD', followRedirects: options.followRedirects ?? true, timeoutMs: options.timeoutMs ?? 8000 },
  })
}

export type UrlSignalSeverity = 'info' | 'low' | 'medium' | 'high'

export interface UrlSignal {
  id: string
  severity: UrlSignalSeverity
  title: string
  detail: string
}

export interface UrlAnalysisResponse {
  checkedAt: string
  input: string
  url: string
  host: string
  domain: string
  protocol: string
  signals: UrlSignal[]
  verdict: 'no-obvious-indicators' | 'suspicious-indicators-found' | 'analysis-inconclusive' | 'external-reputation-unavailable'
  dns: { addresses: string[] } | null
  dnsError: string | null
  http: HttpCheckResponse | null
  httpError: string | null
  tls: { issuer: string; validTo: string; daysRemaining: number } | null
  tlsError: string | null
  externalReputation: { status: 'unavailable'; provider: null; reason: string }
  limitations: string[]
}

export function analyzeUrlSafety(url: string): Promise<UrlAnalysisResponse> {
  return request<UrlAnalysisResponse>('/api/net/url', { body: { url } })
}

export interface AuthSessionResponse {
  ok: true
  tokens?: AuthTokens | null
  account?: AccountPayload
  needsVerification?: boolean
  verified?: boolean
  email?: string | null
  message?: string
}

export interface AuthMeResponse {
  ok: true
  account: AccountPayload
}

export function getAuthConfig(): Promise<AuthConfig> {
  return request<AuthConfig>('/api/auth')
}

export function authRegister(input: { username: string; email: string; password: string }): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>('/api/auth', { body: { action: 'register', ...input } })
}

export function authLogin(input: { email: string; password: string }): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>('/api/auth', { body: { action: 'login', ...input } })
}

export function authRefresh(refreshToken: string): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>('/api/auth', { body: { action: 'refresh', refreshToken } })
}

export function authLogout(accessToken?: string): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/auth', { body: { action: 'logout' }, accessToken })
}

export function authMe(accessToken?: string): Promise<AuthMeResponse> {
  return request<AuthMeResponse>('/api/auth', { body: { action: 'me' }, accessToken })
}

export function authRecover(email: string): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>('/api/auth', { body: { action: 'recover', email } })
}

export function authResendVerification(email: string): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>('/api/auth', { body: { action: 'resend', email } })
}

export function authVerify(tokenHash: string, type: 'signup' | 'recovery' | 'invite' | 'email_change'): Promise<AuthSessionResponse> {
  return request<AuthSessionResponse>('/api/auth', { body: { action: 'verify', tokenHash, type } })
}

export function authUpdateProfile(fullName: string, accessToken?: string): Promise<{ ok: true; fullName: string }> {
  return request('/api/auth', { body: { action: 'update-profile', fullName }, accessToken })
}

export function authChangePassword(currentPassword: string, newPassword: string, accessToken?: string): Promise<{ ok: true }> {
  return request('/api/auth', { body: { action: 'change-password', currentPassword, newPassword }, accessToken })
}

export function authResetPassword(newPassword: string, accessToken?: string): Promise<{ ok: true }> {
  return request('/api/auth', { body: { action: 'reset-password', newPassword }, accessToken })
}

export function authDeleteAccount(password: string, accessToken?: string): Promise<{ ok: true; deleted: true }> {
  return request('/api/auth', { body: { action: 'delete-account', password }, accessToken })
}

export function authExportData(accessToken?: string): Promise<Record<string, unknown> & { ok: true; exportedAt: string }> {
  return request('/api/auth', { body: { action: 'export' }, accessToken })
}

export function workspaceRequest<T>(body: Record<string, unknown>): Promise<T> {
  return request<T>('/api/workspace', { body })
}

export function adminRequest<T>(body: Record<string, unknown>): Promise<T> {
  return request<T>('/api/admin', { body })
}
