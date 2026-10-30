export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama' | 'custom'

const DEFAULT_BASE_URLS: Record<Exclude<ProviderKind, 'custom'>, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434',
}

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

export function envBool(name: string): boolean {
  return (process.env[name] ?? '').toLowerCase() === 'true'
}

export function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function providerKind(raw: string | undefined): ProviderKind | null {
  if (raw === 'openai' || raw === 'anthropic' || raw === 'gemini' || raw === 'openrouter' || raw === 'ollama' || raw === 'custom') return raw
  return null
}

export function defaultBaseUrl(kind: ProviderKind): string | null {
  return kind === 'custom' ? null : DEFAULT_BASE_URLS[kind]
}

export function allowedHosts(): string[] {
  const configured = envList('AI_ALLOWED_HOSTS').map((entry) => entry.toLowerCase())
  return configured
}

const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase()
// Used only for explicit, local owner promotion. It never grants a role on its
// own: no request path reads this value to elevate an account.
const ownerEmail = (process.env.OWNER_EMAIL ?? process.env.NEXORA_OWNER_EMAIL ?? '').trim().toLowerCase()

export const serverConfig = {
  appName: (process.env.APP_NAME ?? 'Adnan Tech').trim(),
  adminEmail,
  ownerEmail,
  trialDays: envInt('NEXORA_TRIAL_DAYS', 30),
  authSiteUrl: (process.env.NEXORA_SITE_URL ?? process.env.URL ?? 'http://localhost:5173').trim().replace(/\/+$/, ''),
  hashPepper: (process.env.NEXORA_HASH_PEPPER ?? '').trim(),
  maintenanceMode: envBool('NEXORA_MAINTENANCE_MODE'),
  timeoutMs: envInt('AI_TIMEOUT_MS', 60000),
  maxOutputTokens: envInt('AI_MAX_OUTPUT_TOKENS', 2500),
  rateWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 60000),
  rateMax: envInt('RATE_LIMIT_MAX', 20),
  allowLocalAi: envBool('ALLOW_LOCAL_AI'),
  netProbeAllowPrivate: envBool('NET_PROBE_ALLOW_PRIVATE'),
  printerAllowPrivate: envBool('PRINTER_ALLOW_PRIVATE'),
  // Probing a printer published on the public internet is the normal use of this
  // tool, so the flag reads as an opt-out rather than an opt-in.
  printerAllowPublic: (process.env.PRINTER_ALLOW_PUBLIC ?? 'true').toLowerCase() === 'true',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  appReferer: (process.env.AI_APP_REFERER ?? 'https://adnan-tech.netlify.app').trim(),
  appTitle: (process.env.AI_APP_TITLE ?? 'Adnan Tech').trim(),
  contentAdminToken: process.env.CONTENT_ADMIN_TOKEN ?? '',
  supabaseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
}

export function aiDefaults(): { provider: ProviderKind | null; baseUrl: string | null; model: string; apiKey: string } {
  const provider = providerKind(process.env.AI_PROVIDER)
  return {
    provider,
    baseUrl: (process.env.AI_BASE_URL ?? (provider ? defaultBaseUrl(provider) : '') ?? '').trim() || null,
    model: (process.env.AI_MODEL ?? '').trim(),
    apiKey: (process.env.AI_API_KEY ?? '').trim(),
  }
}

/**
 * Live web research uses the Gemini Interactions API. Every value falls back to
 * the existing `AI_*` provider settings so an already-configured Gemini account
 * works without duplicating a secret. The key is only ever read here, server side.
 */
export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest'

export function geminiSettings(): {
  apiKey: string
  model: string
  baseUrl: string
  webSearchEnabled: boolean
  timeoutMs: number
  maxOutputTokens: number
  cacheTtlMs: number
} {
  const defaults = aiDefaults()
  const providerKey = defaults.provider === 'gemini' ? defaults.apiKey : ''
  const providerModel = defaults.provider === 'gemini' ? defaults.model : ''
  const providerBase = defaults.provider === 'gemini' ? defaults.baseUrl : null
  const baseUrl = (process.env.GEMINI_BASE_URL ?? '').trim() || providerBase || defaultBaseUrl('gemini') || ''
  return {
    apiKey: (process.env.GEMINI_API_KEY ?? '').trim() || providerKey,
    model: (process.env.GEMINI_MODEL ?? '').trim() || providerModel || GEMINI_DEFAULT_MODEL,
    baseUrl: normalizeGeminiBase(baseUrl),
    webSearchEnabled: envBool('GEMINI_WEB_SEARCH_ENABLED'),
    timeoutMs: envInt('GEMINI_TIMEOUT_MS', 45000),
    maxOutputTokens: envInt('GEMINI_MAX_OUTPUT_TOKENS', 3000),
    cacheTtlMs: envInt('GEMINI_CACHE_TTL_SECONDS', 0) * 1000,
  }
}

/** The Interactions endpoint sits directly on the versioned API root. */
export function normalizeGeminiBase(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '')
  if (!value) return ''
  const withoutSuffix = value
    .replace(/\/interactions$/i, '')
    .replace(/\/models\/[^/]+(?::(?:stream)?generateContent)?$/i, '')
    .replace(/\/v1(?:beta|alpha)$/i, '')
  const versioned = /\/v1(?:beta|alpha)$/i.test(withoutSuffix) ? withoutSuffix : `${withoutSuffix}/v1beta`
  return versioned.replace(/\/+$/, '')
}

export function visionDefaults(): { provider: ProviderKind | null; baseUrl: string | null; model: string; apiKey: string } {
  const provider = providerKind(process.env.AI_VISION_PROVIDER)
  const fallback = aiDefaults()
  return {
    provider: provider ?? fallback.provider,
    baseUrl: (process.env.AI_VISION_BASE_URL ?? '').trim() || fallback.baseUrl,
    model: (process.env.AI_VISION_MODEL ?? '').trim() || fallback.model,
    apiKey: (process.env.AI_VISION_API_KEY ?? '').trim() || fallback.apiKey,
  }
}
