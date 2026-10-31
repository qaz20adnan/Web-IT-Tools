import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Vercel maps an open engines range to the *highest* runtime it offers, not to
 * its floor: `>=22.0.0` deploys on 26.x. So the pin has to be a single major,
 * and every host must name the same one — otherwise the code is written on one
 * runtime, built on another and served on a third.
 */
function declaredMajors(): Record<string, number> {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { engines: { node: string } }
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8')
  const esbuild = readFileSync(join(ROOT, 'scripts', 'build-vercel-api.mjs'), 'utf8')
  return {
    'package.json engines.node': Number(/\d+/.exec(pkg.engines.node)?.[0]),
    '.nvmrc': Number(/\d+/.exec(readFileSync(join(ROOT, '.nvmrc'), 'utf8'))?.[0]),
    'netlify.toml NODE_VERSION': Number(/NODE_VERSION = "(\d+)"/.exec(toml)?.[1]),
    'esbuild target': Number(/target: 'node(\d+)'/.exec(esbuild)?.[1]),
  }
}

describe('one Node runtime for every host', () => {
  it('names the same major in all four declarations', () => {
    const majors = declaredMajors()
    for (const [where, major] of Object.entries(majors)) expect(Number.isInteger(major), where).toBe(true)
    expect(new Set(Object.values(majors)).size, JSON.stringify(majors)).toBe(1)
  })

  it('pins a single major instead of a range', () => {
    const engines = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { engines: { node: string } }).engines.node
    expect(engines, engines).toMatch(/^\d+\.x$/)
    // Node 20 left Vercel's supported list on 2026-10-01; 22 is the oldest runtime left standing.
    expect(Number(/\d+/.exec(engines)?.[0])).toBeGreaterThanOrEqual(22)
  })

  it('does not let vercel.json claim a different runtime', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as Record<string, unknown>
    expect(config).not.toHaveProperty('nodeVersion')
  })
})
