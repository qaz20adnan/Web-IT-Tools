export type HttpCode =
  | 'not_configured'
  | 'invalid_key'
  | 'forbidden'
  | 'insufficient_credits'
  | 'not_found'
  | 'rate_limited'
  | 'timeout'
  | 'upstream_error'
  | 'invalid_input'
  | 'payload_too_large'
  | 'blocked_host'
  | 'invalid_credentials'
  | 'email_not_verified'
  | 'already_exists'
  | 'unauthorized'
  | 'unknown'

export interface NetlifyEvent {
  httpMethod: string
  headers: Record<string, string | undefined>
  body: string | null
  isBase64Encoded?: boolean
  path: string
  queryStringParameters?: Record<string, string | null> | null
}

export interface NetlifyContext {
  ip?: string
  clientContext?: { identity?: { token?: string } }
}

export interface NetlifyResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

export type Handler = (event: NetlifyEvent, context: NetlifyContext) => Promise<NetlifyResponse>

export class HttpError extends Error {
  statusCode: number
  code: HttpCode
  detail?: string

  constructor(statusCode: number, code: HttpCode, message: string, detail?: string) {
    super(message)
    this.name = 'HttpError'
    this.statusCode = statusCode
    this.code = code
    this.detail = detail
  }
}

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export function json(statusCode: number, payload: unknown): NetlifyResponse {
  return {
    statusCode,
    headers: BASE_HEADERS,
    body: JSON.stringify(payload),
  }
}

export function errorResponse(error: unknown): NetlifyResponse {
  if (error instanceof HttpError) {
    return json(error.statusCode, {
      error: {
        code: error.code,
        message: error.message,
        ...(error.detail ? { detail: error.detail.slice(0, 500) } : {}),
      },
    })
  }
  // An unexpected throw can carry an internal message (paths, keys, upstream bodies).
  // It is logged by wrap(); it never travels to the browser.
  return json(500, { error: { code: 'unknown', message: 'Unexpected server error. The failure was logged; please try again shortly.' } })
}

export function header(event: NetlifyEvent, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === target) return value
  }
  return undefined
}

export function readJsonBody<T = unknown>(event: NetlifyEvent, maxBytes = 8 * 1024 * 1024): T {
  if (!event.body) throw new HttpError(400, 'invalid_input', 'A JSON request body is required.')
  let raw = event.body
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8')
  const bytes = Buffer.byteLength(raw, 'utf8')
  if (bytes > maxBytes) throw new HttpError(413, 'payload_too_large', 'The request body is too large.')
  try {
    return JSON.parse(raw) as T
  } catch {
    throw new HttpError(400, 'invalid_input', 'The request body is not valid JSON.')
  }
}

export function clientIp(event: NetlifyEvent, context: NetlifyContext): string {
  return header(event, 'x-nf-client-connection-ip') ?? header(event, 'x-forwarded-for')?.split(',')[0]?.trim() ?? context.ip ?? 'unknown'
}

export function requireMethod(event: NetlifyEvent, methods: string[]): void {
  if (!methods.includes(event.httpMethod.toUpperCase())) {
    throw new HttpError(405, 'invalid_input', `Method ${event.httpMethod} is not allowed.`)
  }
}

export function wrap(handler: Handler): Handler {
  return async (event, context) => {
    try {
      return await handler(event, context)
    } catch (error) {
      if (process.env.LOG_LEVEL !== 'silent') {
        const safe = error instanceof HttpError ? `${error.code}: ${error.message}` : error instanceof Error ? error.name : 'unknown'
        console.error(`[nexora] ${event.path} ${event.httpMethod} -> ${safe}`)
      }
      return errorResponse(error)
    }
  }
}
