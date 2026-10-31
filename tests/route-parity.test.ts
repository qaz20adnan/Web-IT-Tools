import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { routes } from '../vercel/dispatcher'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Public path → flat function file name, exactly as netlify.toml declares it. */
function explicitRedirects(): Map<string, string> {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8')
  const map = new Map<string, string>()
  for (const block of toml.split('[[redirects]]').slice(1)) {
    const from = /from = "\/api\/([^"]+)"/.exec(block)?.[1]
    const to = /to = "\/\.netlify\/functions\/([^"]+)"/.exec(block)?.[1]
    if (from && to && from !== '*') map.set(from, to)
  }
  return map
}

function functionFiles(): string[] {
  return readdirSync(join(ROOT, 'netlify', 'functions'))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
}

/** The path a public route must be reachable at on every host. */
function expectedRoutes(): Map<string, string> {
  const explicit = explicitRedirects()
  const byFunction = new Map([...explicit].map(([path, file]) => [file, path]))
  const map = new Map<string, string>()
  for (const file of functionFiles()) {
    map.set(byFunction.get(file) ?? file, file)
  }
  return map
}

/** Every source file under src/, so a fetch added to a page is still seen. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

describe('the three hosts route the same /api tree', () => {
  it('keeps the generic Netlify wildcard that maps flat function files', () => {
    const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8')
    expect(toml).toContain('from = "/api/*"')
    expect(toml).toContain('to = "/.netlify/functions/:splat"')
    // Rules are evaluated in order, so the specific routes must precede the wildcard.
    const wildcardIndex = toml.indexOf('from = "/api/*"')
    for (const path of explicitRedirects().keys()) {
      expect(toml.indexOf(`from = "/api/${path}"`)).toBeLessThan(wildcardIndex)
    }
  })

  it('gives the Vercel dispatcher an entry for every Netlify route', () => {
    const expected = expectedRoutes()
    expect(Object.keys(routes).sort()).toEqual([...expected.keys()].sort())
    for (const path of expected.keys()) expect(routes[path], path).toBeDefined()
    expect(functionFiles().length).toBe(expected.size)
  })

  it('resolves every route through the dev plugin file lookup', () => {
    // scripts/dev-api-plugin.ts maps /api/<path> onto <path>.ts or <path with / → ->.ts.
    for (const [path, file] of expectedRoutes()) {
      const direct = join(ROOT, 'netlify', 'functions', `${path}.ts`)
      const flattened = join(ROOT, 'netlify', 'functions', `${path.replace(/\//g, '-')}.ts`)
      expect(existsSync(direct) || existsSync(flattened), path).toBe(true)
      expect(existsSync(join(ROOT, 'netlify', 'functions', `${file}.ts`)), file).toBe(true)
    }
  })

  it('never lets the frontend call a path no host serves', () => {
    const called = new Set<string>()
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/'\/api\/([a-z/]+)'/g)) called.add(match[1])
    }
    expect(called.size).toBeGreaterThan(0)
    for (const path of called) expect(routes[path], path).toBeDefined()
  })
})
