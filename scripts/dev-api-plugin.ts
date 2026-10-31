import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'
import { HttpError, type NetlifyContext, type NetlifyEvent, type NetlifyResponse } from '../netlify/lib/http'
// One ceiling for every host, so an oversized upload fails the same way locally
// as it will on Netlify or Vercel (finding L-3).
import { MAX_BODY_BYTES } from '../shared/upload-limits'

/**
 * Vite dev middleware that executes the Netlify Functions in-process.
 *
 * Why: the frontend calls relative `/api/*` URLs that only exist when the app
 * is served by Netlify (production) or `netlify dev`. Running plain `vite`
 * produced HTTP 404 for every POST (for example POST /api/ai/test), which is
 * the "Request failed with status 404" seen in the provider connection test.
 *
 * This middleware maps `/api/<path>` onto the matching flat function file in
 * `netlify/functions`, builds a Lambda-compatible event and invokes the
 * exported `handler`, so `npm run dev` behaves like the deployed site.
 */

interface FunctionModule {
  handler?: (event: NetlifyEvent, context: NetlifyContext) => Promise<NetlifyResponse>
}

function resolveFunctionFile(root: string, apiPath: string): string | null {
  const clean = apiPath.replace(/^\/+|\/+$/g, '')
  if (!clean) return null
  const candidates = [clean, clean.replace(/\//g, '-')]
  for (const candidate of candidates) {
    const file = resolve(root, 'netlify', 'functions', `${candidate}.ts`)
    if (existsSync(file)) return file
  }
  return null
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      // Reject as soon as the cap is crossed instead of buffering a payload the
      // hosts would refuse before the function ever starts.
      if (total > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'payload_too_large', 'The request body exceeds the 4.5 MB function payload limit.'))
        req.destroy()
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function flattenHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = Array.isArray(value) ? value.join(',') : value
  }
  return headers
}

async function handleApiRequest(server: ViteDevServer, req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
  const rawUrl = req.url ?? ''
  const url = new URL(rawUrl, 'http://localhost')
  const root = server.config.root
  const file = resolveFunctionFile(root, url.pathname.slice('/api/'.length))
  if (!file) {
    // Keep unknown API paths as JSON errors instead of falling through to the
    // SPA, which would return an HTML 200 and hide routing mistakes.
    res.statusCode = 404
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: { code: 'not_found', message: `No API function matches ${url.pathname}.` } }))
    return
  }

  try {
    const module = (await server.ssrLoadModule(file)) as FunctionModule
    if (typeof module.handler !== 'function') {
      res.statusCode = 501
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { code: 'unknown', message: 'Function has no exported handler.' } }))
      return
    }
    const body = await readRequestBody(req)
    const event: NetlifyEvent = {
      httpMethod: req.method ?? 'GET',
      headers: flattenHeaders(req),
      body: body.length > 0 ? body : null,
      isBase64Encoded: false,
      path: url.pathname,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    }
    const result = await module.handler(event, { ip: req.socket.remoteAddress })
    res.statusCode = result.statusCode
    for (const [key, value] of Object.entries(result.headers ?? {})) {
      res.setHeader(key, value)
    }
    res.end(result.body)
  } catch (error) {
    if (error instanceof HttpError) {
      // The adapter's own failures (a body over the cap) must reach the browser in
      // the same envelope the hosts use, or local testing teaches the wrong shape.
      res.statusCode = error.statusCode
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { code: error.code, message: error.message } }))
      return
    }
    const detail = error instanceof Error ? error.message : String(error)
    res.statusCode = 500
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: { code: 'unknown', message: 'Dev function error.', detail: detail.slice(0, 300) } }))
  }
}

export function netlifyDevApi(): Plugin {
  return {
    name: 'nexora-netlify-dev-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }
        void handleApiRequest(server, req, res)
      })
    },
  }
}
