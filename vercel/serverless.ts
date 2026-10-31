import { Buffer } from 'node:buffer'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  errorResponse,
  HttpError,
  json,
  type Handler,
  type NetlifyContext,
  type NetlifyEvent,
  type NetlifyResponse,
} from '../netlify/lib/http'
// Vercel rejects larger payloads at the edge with 413 FUNCTION_PAYLOAD_TOO_LARGE before the
// function runs; the same cap is what every handler may assume, so it lives in one file.
import { MAX_BODY_BYTES } from '../shared/upload-limits'

/**
 * Vercel Functions receive a Node (req, res) pair while every handler in
 * netlify/functions speaks the Lambda-style (event, context) signature. This
 * adapter is the only place that knows about Vercel's shape, so the handlers
 * stay untouched and keep running on Netlify and under `npm run dev`.
 *
 * One function serves the whole /api tree: Vercel's Hobby plan allows at most
 * 12 functions per deployment and the platform has 22 routes.
 */

/** Public path after `/api/`, as declared in api/index.ts. */
export type RouteTable = Record<string, Handler>

const ROUTE_QUERY_KEY = '_fn'
const API_PREFIX = '/api/'

function flattenHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const piece of req) {
    const chunk = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece))
    total += chunk.length
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, 'payload_too_large', 'The request body exceeds the 4.5 MB function payload limit.')
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw.length > 0 ? raw : null
}

function buildContext(req: IncomingMessage): NetlifyContext {
  const forwarded = req.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return { ip: first?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown' }
}

export interface ResolvedRoute {
  route: string | null
  path: string
  query: Record<string, string | null>
}

/**
 * The rewrite in vercel.json hands the public path over in `_fn`; a request that
 * reaches the function directly still carries it in the URL pathname, so both
 * shapes resolve to the same route.
 */
export function resolveRoute(url: URL): ResolvedRoute {
  const forwarded = url.searchParams.get(ROUTE_QUERY_KEY)
  const candidates = [forwarded, url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : null]
  for (const candidate of candidates) {
    const route = candidate?.replace(/^\/+|\/+$/g, '')
    if (route) {
      const query = Object.fromEntries(url.searchParams.entries())
      delete query[ROUTE_QUERY_KEY]
      return { route, path: `${API_PREFIX}${route}`, query }
    }
  }
  return { route: null, path: url.pathname, query: Object.fromEntries(url.searchParams.entries()) }
}

export async function toVercelEvent(req: IncomingMessage, resolved = resolveRoute(new URL(req.url ?? '/', 'http://localhost'))): Promise<NetlifyEvent> {
  return {
    httpMethod: req.method ?? 'GET',
    headers: flattenHeaders(req),
    body: await readBody(req),
    isBase64Encoded: false,
    path: resolved.path,
    queryStringParameters: resolved.query,
  }
}

function respond(res: ServerResponse, result: NetlifyResponse): void {
  res.statusCode = result.statusCode
  for (const [key, value] of Object.entries(result.headers ?? {})) {
    res.setHeader(key, value)
  }
  res.end(result.body ?? '')
}

export function createVercelDispatcher(routes: RouteTable) {
  return async function vercelFunction(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let event: NetlifyEvent
    let context: NetlifyContext
    const resolved = resolveRoute(new URL(req.url ?? '/', 'http://localhost'))
    const handler = resolved.route ? routes[resolved.route] : undefined
    if (!handler) {
      // A miss must stay a JSON error: falling through to index.html would hide
      // routing mistakes behind an HTTP 200.
      respond(res, json(404, { error: { code: 'not_found', message: `No API function matches ${resolved.path}.` } }))
      return
    }
    try {
      event = await toVercelEvent(req, resolved)
      context = buildContext(req)
    } catch (error) {
      // The request never reached the handler, so this is the only stage where
      // the adapter produces an error response itself.
      respond(res, errorResponse(error))
      return
    }
    await handler(event, context).then((result) => respond(res, result), (error) => respond(res, errorResponse(error)))
  }
}
