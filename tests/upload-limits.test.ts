import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MAX_BODY_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_DATA_URL_CHARS } from '../shared/upload-limits'
import { analyzeRequestSchema } from '../netlify/lib/schema'
import { ar } from '../src/i18n/ar'
import { en } from '../src/i18n/en'
import { validateImageFile } from '../src/lib/utils'

const BASE_FIELDS = {
  title: 'Printer share disappears after reboot',
  description: 'The shared queue vanishes every night and staff cannot print until it is re-added manually.',
}

/** A data URL whose base64 payload decodes to exactly `bytes` raw bytes. */
function dataUrlForBytes(bytes: number): string {
  const base64Length = Math.ceil(bytes / 3) * 4
  return `data:image/png;base64,${'A'.repeat(base64Length)}`
}

describe('upload caps agree on every host', () => {
  it('keeps the largest allowed image inside the body cap after base64 inflation', () => {
    const inflated = dataUrlForBytes(MAX_IMAGE_BYTES)
    expect(inflated.length).toBeLessThanOrEqual(MAX_IMAGE_DATA_URL_CHARS)
    // The request also carries the incident text, which the schema caps at 48 KB.
    expect(inflated.length + 48 * 1024).toBeLessThan(MAX_BODY_BYTES)
  })

  it('stays under the 6 MB edge limit both hosts enforce before the function runs', () => {
    expect(MAX_BODY_BYTES).toBeLessThan(6 * 1024 * 1024)
  })

  it('accepts an image at the client limit and rejects one past the schema limit', () => {
    expect(analyzeRequestSchema.safeParse({ input: { ...BASE_FIELDS, imageDataUrl: dataUrlForBytes(MAX_IMAGE_BYTES) } }).success).toBe(true)
    const oversized = analyzeRequestSchema.safeParse({ input: { ...BASE_FIELDS, imageDataUrl: dataUrlForBytes(MAX_IMAGE_BYTES + 1024) } })
    expect(oversized.success).toBe(false)
  })
})

describe('the limit the UI promises', () => {
  it('is the number the code enforces, in both languages', () => {
    const megabytes = MAX_IMAGE_BYTES / (1024 * 1024)
    expect(en['lab.imageHint']).toContain(`${megabytes} MB`)
    expect(ar['lab.imageHint']).toContain(`${megabytes} ميجابايت`)
  })
})

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A file whose first bytes pass the signature check, padded to `total` bytes. */
function pngFile(total: number, name = 'shot.png'): File {
  return new File([new Uint8Array([...PNG_HEADER, ...new Array(Math.max(0, total - PNG_HEADER.length)).fill(0)])], name, { type: 'image/png' })
}

describe('validateImageFile', () => {
  it('refuses an oversized PNG before the browser reads it', async () => {
    const result = await validateImageFile(pngFile(MAX_IMAGE_BYTES + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('size')
  })

  it('returns a data URL that still satisfies the server schema', async () => {
    const result = await validateImageFile(pngFile(1024))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
      expect(analyzeRequestSchema.safeParse({ input: { ...BASE_FIELDS, imageDataUrl: result.dataUrl } }).success).toBe(true)
    }
  })
})

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** `16 * 1024` as written at a call site, without evaluating anything. */
function literalBytes(expression: string): number {
  const parts = expression.split('*').map((part) => Number(part.trim()))
  if (parts.some((part) => !Number.isInteger(part))) throw new Error(`not a literal byte count: ${expression}`)
  return parts.reduce((left, right) => left * right)
}

describe('every request-body cap is one the platform can deliver', () => {
  const handlers = readdirSync(join(ROOT, 'netlify', 'functions'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => [name, readFileSync(join(ROOT, 'netlify', 'functions', name), 'utf8')] as const)

  it('passes an explicit cap at every call site — readJsonBody has no silent default', () => {
    const http = readFileSync(join(ROOT, 'netlify', 'lib', 'http.ts'), 'utf8')
    expect(http).toContain('maxBytes: number')
    expect(http).not.toMatch(/maxBytes\s*=\s*\d/)
    let seen = 0
    for (const [file, source] of handlers) {
      const calls = [...source.matchAll(/readJsonBody(?:<[^>]*>)?\(/g)]
      const explicit = [...source.matchAll(/readJsonBody(?:<[^>]*>)?\(event, ([^)]+)\)/g)]
      expect(explicit.length, `${file}: every readJsonBody needs its own cap`).toBe(calls.length)
      seen += explicit.length
      for (const [, cap] of explicit) {
        if (!/^\d/.test(cap.trim())) continue
        expect(literalBytes(cap), cap).toBeLessThanOrEqual(MAX_BODY_BYTES)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('refuses an oversized body in the dev adapter too, so local passes stop meaning "it will deploy"', () => {
    const plugin = readFileSync(join(ROOT, 'scripts', 'dev-api-plugin.ts'), 'utf8')
    expect(plugin).toContain("from '../shared/upload-limits'")
    expect(plugin).toContain('total > MAX_BODY_BYTES')
  })
})
