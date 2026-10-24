import { HttpError } from './http'

export interface FetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
  maxBytes?: number
}

export interface FetchResult {
  status: number
  ok: boolean
  headers: Headers
  text: string
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000)
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'follow',
    })
    const length = Number(response.headers.get('content-length') ?? '0')
    if (length && length > (options.maxBytes ?? 10 * 1024 * 1024)) {
      throw new HttpError(502, 'upstream_error', 'The upstream response is too large.')
    }
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > (options.maxBytes ?? 10 * 1024 * 1024)) {
      throw new HttpError(502, 'upstream_error', 'The upstream response is too large.')
    }
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      text: new TextDecoder().decode(buffer),
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpError(504, 'timeout', 'The upstream request timed out.')
    }
    throw new HttpError(502, 'upstream_error', 'The upstream request failed.', error instanceof Error ? error.message : undefined)
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Extracts a short, sanitized explanation from an upstream error body.
 * Never returns headers, tokens or request payloads.
 */
export function sanitizeUpstreamDetail(raw?: string): string | undefined {
  if (!raw) return undefined
  const text = raw.trim()
  if (!text) return undefined
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const error = (parsed.error ?? parsed) as unknown
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>
      const message = record.message ?? record.msg ?? record.detail ?? record.error
      if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300)
    }
  } catch {
    /* not JSON, fall through to plain text */
  }
  return text.replace(/\s+/g, ' ').slice(0, 300)
}

export function mapUpstreamStatus(status: number, detail?: string): HttpError {
  const safe = sanitizeUpstreamDetail(detail)
  if (status === 400) return new HttpError(400, 'invalid_input', 'The provider rejected the request as invalid.', safe)
  if (status === 401) return new HttpError(401, 'invalid_key', 'The provider rejected the API key (HTTP 401).', safe)
  if (status === 402) return new HttpError(402, 'insufficient_credits', 'The provider account does not have enough credits (HTTP 402).', safe)
  if (status === 403) return new HttpError(403, 'forbidden', 'The provider refused the request (HTTP 403). The key may lack access to this model or region.', safe)
  if (status === 404) return new HttpError(404, 'not_found', 'The endpoint or model was not found (HTTP 404). Check the base URL and model ID.', safe)
  if (status === 408) return new HttpError(504, 'timeout', 'The provider timed out the request (HTTP 408).', safe)
  if (status === 422) return new HttpError(422, 'invalid_input', 'The provider could not process the request (HTTP 422). The model may not support this input.', safe)
  if (status === 429) return new HttpError(429, 'rate_limited', 'The provider rate-limited the request (HTTP 429).', safe)
  if (status >= 500) return new HttpError(502, 'upstream_error', `The provider reported a server error (HTTP ${status}).`, safe)
  return new HttpError(502, 'upstream_error', `The provider returned HTTP ${status}.`, safe)
}
