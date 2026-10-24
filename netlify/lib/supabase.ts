import { serverConfig } from './env'
import { fetchText } from './fetch'
import { HttpError } from './http'

export function supabasePublicConfigured(): boolean {
  return Boolean(serverConfig.supabaseUrl && serverConfig.supabaseAnonKey)
}

export function supabaseAdminConfigured(): boolean {
  return Boolean(serverConfig.supabaseUrl && serverConfig.supabaseServiceRoleKey)
}

function projectUrl(): string {
  if (!serverConfig.supabaseUrl) throw new HttpError(503, 'not_configured', 'Supabase is not configured on this deployment.')
  return serverConfig.supabaseUrl
}

function adminHeaders(): Record<string, string> {
  return {
    apikey: serverConfig.supabaseServiceRoleKey,
    Authorization: `Bearer ${serverConfig.supabaseServiceRoleKey}`,
    'Content-Type': 'application/json',
  }
}

export interface RestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Use the service-role key (server only). Never expose this to the browser. */
  service?: boolean
  /** Authenticated end-user token (Supabase access token). */
  accessToken?: string
  prefer?: string
  timeoutMs?: number
  maxBytes?: number
}

export interface RestResult<T> {
  data: T
  headers: Headers
  status: number
}

function extractMessage(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const candidate = parsed.msg ?? parsed.message ?? parsed.error_description ?? parsed.error
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 300)
    if (candidate && typeof candidate === 'object') {
      const nested = (candidate as Record<string, unknown>).message
      if (typeof nested === 'string') return nested.slice(0, 300)
    }
  } catch {
    /* plain text */
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 300) || undefined
}

function restError(status: number, text: string, area: string): HttpError {
  const detail = extractMessage(text)
  const lower = (detail ?? '').toLowerCase()
  if (status === 401) return new HttpError(401, 'unauthorized', 'The session is invalid or has expired.', detail)
  if (status === 404) return new HttpError(404, 'not_found', `${area} was not found.`, detail)
  if (status === 409) return new HttpError(409, 'already_exists', `${area} already exists.`, detail)
  if (status === 429) return new HttpError(429, 'rate_limited', 'Too many requests. Try again shortly.', detail)
  if (status === 400 && (lower.includes('invalid login') || lower.includes('invalid credentials') || lower.includes('invalid_grant'))) {
    return new HttpError(401, 'invalid_credentials', 'The email or password is incorrect.', detail)
  }
  if (status === 400 && lower.includes('email not confirmed')) {
    return new HttpError(403, 'email_not_verified', 'Verify your email address before signing in.', detail)
  }
  if (status === 400 && (lower.includes('already registered') || lower.includes('already exists') || lower.includes('user already'))) {
    return new HttpError(409, 'already_exists', 'An account with this email already exists.', detail)
  }
  if (status === 422) return new HttpError(422, 'invalid_input', 'The submitted data was rejected.', detail)
  if (status >= 500) return new HttpError(502, 'upstream_error', `${area} is temporarily unavailable.`, detail)
  return new HttpError(status >= 400 ? status : 502, 'upstream_error', `${area} request failed.`, detail)
}

async function rest<T>(base: string, path: string, options: RestOptions = {}, area = 'Supabase'): Promise<RestResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.service) {
    Object.assign(headers, adminHeaders())
  } else {
    headers.apikey = serverConfig.supabaseAnonKey
    headers.Authorization = `Bearer ${options.accessToken ?? serverConfig.supabaseAnonKey}`
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.prefer) headers.Prefer = options.prefer

  const response = await fetchText(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    timeoutMs: options.timeoutMs ?? 15000,
    maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
  })
  if (!response.ok) {
    // Never include request headers or bodies in the error detail.
    throw restError(response.status, response.text, area)
  }
  const data = response.text.trim() ? (JSON.parse(response.text) as T) : (null as T)
  return { data, headers: response.headers, status: response.status }
}

export async function supabaseSelect<T>(table: string, query: string): Promise<T[]> {
  if (!supabasePublicConfigured()) throw new HttpError(503, 'not_configured', 'Supabase is not configured on this deployment.')
  const { data } = await rest<T[]>(projectUrl(), `/rest/v1/${table}?${query}`, {}, 'Database')
  return Array.isArray(data) ? data : []
}

export async function supabaseSelectAs<T>(table: string, query: string): Promise<T[]> {
  const { data } = await rest<T[]>(projectUrl(), `/rest/v1/${table}?${query}`, { service: true }, 'Database')
  return Array.isArray(data) ? data : []
}

export async function supabaseUpsert<T>(table: string, rows: T[], onConflict = 'id'): Promise<T[]> {
  if (!supabaseAdminConfigured()) throw new HttpError(503, 'not_configured', 'Supabase admin access is not configured.')
  const { data } = await rest<T[]>(projectUrl(), `/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST',
    service: true,
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation',
    timeoutMs: 20000,
  }, 'Database')
  return Array.isArray(data) ? data : []
}

export async function supabaseInsert<T>(table: string, rows: T[], onConflict?: string, ignoreDuplicates = false): Promise<T[]> {
  if (!supabaseAdminConfigured()) throw new HttpError(503, 'not_configured', 'Supabase admin access is not configured.')
  const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''
  const resolution = ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates'
  const { data } = await rest<T[]>(projectUrl(), `/rest/v1/${table}${query}`, {
    method: 'POST',
    service: true,
    body: rows,
    prefer: `resolution=${resolution},return=representation`,
    timeoutMs: 20000,
  }, 'Database')
  return Array.isArray(data) ? data : []
}

export async function supabaseUpdate<T>(table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
  const { data } = await rest<T[]>(projectUrl(), `/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    service: true,
    body: patch,
    prefer: 'return=representation',
  }, 'Database')
  return Array.isArray(data) ? data : []
}

export async function supabaseDeleteWhere(table: string, filter: string): Promise<void> {
  await rest(projectUrl(), `/rest/v1/${table}?${filter}`, { method: 'DELETE', service: true }, 'Database')
}

export async function supabaseDelete(table: string, id: string): Promise<void> {
  await supabaseDeleteWhere(table, `id=eq.${encodeURIComponent(id)}`)
}

export async function supabaseCount(table: string, filter = ''): Promise<number> {
  const query = `select=id${filter ? `&${filter}` : ''}`
  const { headers } = await rest<unknown[]>(projectUrl(), `/rest/v1/${table}?${query}`, {
    service: true,
    prefer: 'count=exact',
    maxBytes: 1024 * 1024,
  }, 'Database')
  const range = headers.get('content-range') ?? ''
  const total = Number(range.split('/')[1] ?? '0')
  return Number.isFinite(total) ? total : 0
}

/* --------------------------- Supabase Auth --------------------------- */

export interface SupabaseAuthUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
  created_at?: string
  updated_at?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

export interface SupabaseSession {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at?: number
  token_type: string
  user: SupabaseAuthUser
}

export async function authRequest<T>(
  path: string,
  options: Omit<RestOptions, 'service'> = {},
  area = 'Authentication service',
): Promise<RestResult<T>> {
  if (!supabasePublicConfigured()) {
    throw new HttpError(503, 'not_configured', 'Authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.')
  }
  return rest<T>(projectUrl(), `/auth/v1${path}`, options, area)
}

/** Administrative auth operations (create/delete users). Service role only. */
export async function authAdminRequest<T>(path: string, options: Omit<RestOptions, 'service'> = {}): Promise<T> {
  if (!supabaseAdminConfigured()) throw new HttpError(503, 'not_configured', 'Supabase service credentials are not configured.')
  const { data } = await rest<T>(projectUrl(), `/auth/v1/admin${path}`, { ...options, service: true }, 'Authentication service')
  return data
}

export async function authUser(accessToken: string): Promise<SupabaseAuthUser> {
  const { data } = await authRequest<SupabaseAuthUser>('/user', { accessToken })
  return data
}

export function authUserVerified(user: SupabaseAuthUser): boolean {
  return Boolean(user.email_confirmed_at ?? user.confirmed_at)
}
