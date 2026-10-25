#!/usr/bin/env node
/**
 * Explicitly promotes an existing, verified account to an administrative role.
 *
 * This is intentionally a local, operator-run command. No public endpoint and no
 * sign-in path performs this promotion, and OWNER_EMAIL/ADMIN_EMAIL alone never
 * grant a role automatically.
 *
 * Usage (Node 20+ loads variables from .env):
 *   node --env-file=.env scripts/promote-admin.mjs --role=owner --confirm
 *   node --env-file=.env scripts/promote-admin.mjs --role=admin --confirm
 *   node --env-file=.env scripts/promote-admin.mjs --confirm            # legacy super_admin
 *
 * Required environment variables:
 *   --role=owner      OWNER_EMAIL
 *   --role=admin      ADMIN_EMAIL
 *   --role=super_admin ADMIN_EMAIL
 *   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for every role.
 */

const args = process.argv.slice(2)
const roleArg = args.find((arg) => arg.startsWith('--role='))?.slice('--role='.length)
const role = roleArg ?? (args.includes('--owner') ? 'owner' : 'super_admin')
const supportedRoles = new Set(['owner', 'admin', 'super_admin'])
const emailVariable = role === 'owner' ? 'OWNER_EMAIL' : 'ADMIN_EMAIL'
const email = (process.env[emailVariable] ?? '').trim().toLowerCase()
const url = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '')
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()

function fail(message) {
  console.error(`[nexora] ${message}`)
  process.exit(1)
}

if (!args.includes('--confirm')) {
  fail('Refusing to run without --confirm. This command grants administrative access.')
}
if (!supportedRoles.has(role)) fail('--role must be one of: owner, admin, super_admin.')
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`${emailVariable} must be a valid email address.`)
if (!url || !serviceKey) fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  'Content-Type': 'application/json',
}

async function call(path, options = {}) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(`Supabase request failed (${response.status}): ${data?.message ?? data?.error ?? 'unknown error'}`)
  return data
}

async function findAuthUser() {
  for (let page = 1; page <= 50; page += 1) {
    const data = await call(`/auth/v1/admin/users?page=${page}&per_page=200`)
    const users = Array.isArray(data?.users) ? data.users : []
    const match = users.find((user) => String(user.email ?? '').toLowerCase() === email)
    if (match) return match
    if (users.length < 200) return null
  }
  return null
}

const user = await findAuthUser()
if (!user) fail(`No account exists for ${email}. Register that address first, verify it, then run this command again.`)
if (!(user.email_confirmed_at ?? user.confirmed_at)) {
  fail(`The account for ${email} is not verified. Verify the email before granting administrative access.`)
}

const profiles = await call(`/rest/v1/profiles?select=id,email,role,status&id=eq.${encodeURIComponent(user.id)}&limit=1`)
const profile = Array.isArray(profiles) ? profiles[0] : null
if (!profile) fail(`The profile row for ${email} does not exist. Sign in once so it can be created, then retry.`)
if (profile.role === role && profile.status === 'active') {
  console.log(`[nexora] ${email} already has the active ${role} role.`)
  process.exit(0)
}

await call(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
  method: 'PATCH',
  body: JSON.stringify({ role, status: 'active', updated_at: new Date().toISOString() }),
  headers: { Prefer: 'return=representation' },
})

await call('/rest/v1/audit_events', {
  method: 'POST',
  body: JSON.stringify([
    {
      actor_id: null,
      actor_email: email,
      action: 'admin.promote_cli',
      target_type: 'profile',
      target_id: user.id,
      outcome: 'success',
      detail: { method: 'promote-admin.mjs', role, fromRole: profile.role, fromStatus: profile.status },
      created_at: new Date().toISOString(),
    },
  ]),
  headers: { Prefer: 'return=minimal' },
})

console.log(`[nexora] ${email} is now an active ${role}. Sign out and back in to refresh the session.`)
