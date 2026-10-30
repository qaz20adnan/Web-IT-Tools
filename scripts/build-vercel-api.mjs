import { build } from 'esbuild'
import { rmSync, statSync } from 'node:fs'

/**
 * Vercel's Node builder copies each TypeScript file as-is, so the extensionless
 * relative imports used across netlify/ would fail to resolve at runtime under
 * Node ESM. Bundling the dispatcher into one self-contained module keeps every
 * handler untouched and costs a single function — Vercel's Hobby plan allows at
 * most 12 functions per deployment and the platform has 22 API routes.
 *
 * The result is generated into api/index.js (git-ignored) and served for every
 * /api/* path by the rewrite in vercel.json.
 */
rmSync('api', { recursive: true, force: true })

const result = await build({
  absWorkingDir: process.cwd(),
  bundle: true,
  entryPoints: ['vercel/dispatcher.ts'],
  external: ['node:*'],
  format: 'esm',
  outfile: 'api/index.js',
  platform: 'node',
  target: 'node22',
})

if (result.errors.length > 0) process.exit(1)
const bytes = statSync('api/index.js').size
console.log(`api/index.js ready (${Math.round(bytes / 1024)} kB)`)
