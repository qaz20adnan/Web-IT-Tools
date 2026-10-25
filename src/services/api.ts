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
} from '@/types'

export interface AiCredentials {
  provider: ProviderConfig
  apiKey: string | null
}

export class ApiError extends Error {
  code: ApiErrorCode
  status: number
  detail?: string

  constructor(code: ApiErrorCode, message: string, status = 0, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.detail = detail
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

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    const envelope = payload as { error?: { code?: ApiErrorCode; message?: string; detail?: string } } | null
    const code = envelope?.error?.code ?? (response.status === 429 ? 'rate_limited' : 'unknown')
    const message = envelope?.error?.message ?? `Request failed with status ${response.status}.`
    throw new ApiError(code, message, response.status, envelope?.error?.detail)
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
}

export interface TestResponse {
  ok: boolean
  mode: 'connectivity' | 'chat'
  provider: string
  model: string | null
  models?: number
  modelAvailable?: boolean | null
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
  credentials: AiCredentials | null,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  return request<ChatResponse>('/api/ai/chat', {
    body: { messages, mode },
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
  type: number
  ttl: number
  data: string
}

export function lookupDns(host: string, type: string): Promise<{ answers: DnsAnswer[]; status: number }> {
  return request('/api/net/dns', { body: { host, type } })
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

export interface PublicIpInfo {
  ipv4: string | null
  ipv6: string | null
  country: string | null
  colo: string | null
  source: string
}

export interface DdnsInfo {
  host: string
  ipv4: string[]
  ipv6: string[]
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
  publicIp: PublicIpInfo
  target: { host: string; address: string }
  ddns: DdnsInfo | null
  ports: PortProbeInfo[]
  report: NetworkAnalysisReport
}

export function analyzeNetwork(input: {
  host?: string
  ddns?: string
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

export interface PingReply {
  sequence: number
  latencyMs: number | null
  ttl: number | null
  status: 'success' | 'timeout' | 'unreachable' | 'error'
}

export interface PingResponse {
  available: boolean
  target: string
  address: string
  location: 'server'
  attempts: number
  replies: PingReply[]
  summary: { sent: number; received: number; lossPercent: number; minMs: number | null; avgMs: number | null; maxMs: number | null }
  reason: string | null
  note: string
  raw: string
}

export function runPing(host: string, count = 4, timeoutMs = 1500): Promise<PingResponse> {
  return request<PingResponse>('/api/net/ping', { body: { host, count, timeoutMs } })
}

export interface TracerouteHop {
  hop: number
  address: string | null
  hostname: string | null
  probes: Array<number | null>
  timedOut: boolean
}

export interface TracerouteResponse {
  available: boolean
  target: string
  address: string
  location: 'server'
  maxHops: number
  hops: TracerouteHop[]
  totalHops: number
  reached: boolean
  reason: string | null
  note: string
  raw: string
}

export function runTraceroute(host: string, maxHops = 15, timeoutMs = 1500): Promise<TracerouteResponse> {
  return request<TracerouteResponse>('/api/net/traceroute', { body: { host, maxHops, timeoutMs } })
}

export interface PortCheckResponse {
  target: string
  address: string
  location: 'server'
  checkedAt: string
  ports: PortProbeInfo[]
  note: string
}

export function checkPublicPorts(host: string, ports: number[]): Promise<PortCheckResponse> {
  return request<PortCheckResponse>('/api/net/port', { body: { host, ports } })
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
