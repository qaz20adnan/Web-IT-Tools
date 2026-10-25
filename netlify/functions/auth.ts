import { z } from 'zod'
import { serverConfig } from '../lib/env'
import {
  accountForUser,
  accountPayload,
  assertAuthBackend,
  authenticate,
  bearer,
  canSignIn,
  emailHash,
  getPlatformSetting,
  publicProfile,
  localAuthAccount,
  recordUsage,
  requireVerified,
  writeAudit,
} from '../lib/auth'
import { HttpError, json, readJsonBody, requireMethod, wrap, clientIp, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import {
  changeLocalPassword,
  deleteLocalAccount,
  localAccountForAccessToken,
  localAuthEnabled,
  loginLocalAccount,
  logoutLocalSession,
  refreshLocalSession,
  registerLocalAccount,
  updateLocalProfile,
  LOCAL_PASSWORD_MAX_LENGTH,
  type LocalAccountRecord,
} from '../lib/local-auth'
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../src/lib/authValidation'
import {
  authAdminRequest,
  authRequest,
  authUser,
  authUserVerified,
  supabaseAdminConfigured,
  supabaseCount,
  supabasePublicConfigured,
  supabaseSelectAs,
  type SupabaseSession,
  type SupabaseAuthUser,
} from '../lib/supabase'

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const passwordSchema = z.string().refine(isValidPassword, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters.')
  .max(32, 'Use at most 32 characters.')
  .regex(/^[\p{L}\p{N}._-]+$/u, 'Use letters, numbers, dots, dashes or underscores only.')

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('config') }),
  z.object({ action: z.literal('register'), username: usernameSchema, email: emailSchema, password: passwordSchema }),
  z.object({ action: z.literal('login'), email: emailSchema, password: z.string().min(1).max(128) }),
  z.object({ action: z.literal('refresh'), refreshToken: z.string().min(10).max(4096) }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('me') }),
  z.object({ action: z.literal('recover'), email: emailSchema }),
  z.object({ action: z.literal('resend'), email: emailSchema }),
  z.object({ action: z.literal('verify'), tokenHash: z.string().min(10).max(4096), type: z.enum(['signup', 'recovery', 'invite', 'email_change']) }),
  z.object({ action: z.literal('update-profile'), fullName: z.string().trim().max(120) }),
  z.object({ action: z.literal('change-password'), currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }),
  z.object({ action: z.literal('reset-password'), newPassword: passwordSchema }),
  z.object({ action: z.literal('delete-account'), password: z.string().min(1).max(128) }),
  z.object({ action: z.literal('export') }),
])

type AuthBody = z.infer<typeof actionSchema>

const localPasswordSchema = z
  .string()
  .min(1, 'Enter a password.')
  .max(LOCAL_PASSWORD_MAX_LENGTH, `Local development passwords can be at most ${LOCAL_PASSWORD_MAX_LENGTH} characters.`)

const localActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('config') }),
  z.object({ action: z.literal('register'), username: usernameSchema, email: emailSchema, password: localPasswordSchema }),
  z.object({ action: z.literal('login'), email: emailSchema, password: localPasswordSchema }),
  z.object({ action: z.literal('refresh'), refreshToken: z.string().min(10).max(4096) }),
  z.object({ action: z.literal('logout') }),
  z.object({ action: z.literal('me') }),
  z.object({ action: z.literal('recover'), email: emailSchema }),
  z.object({ action: z.literal('resend'), email: emailSchema }),
  z.object({
    action: z.literal('verify'),
    tokenHash: z.string().min(10).max(4096),
    type: z.enum(['signup', 'recovery', 'invite', 'email_change']),
  }),
  z.object({ action: z.literal('update-profile'), fullName: z.string().trim().max(120) }),
  z.object({
    action: z.literal('change-password'),
    currentPassword: localPasswordSchema,
    newPassword: localPasswordSchema,
  }),
  z.object({ action: z.literal('reset-password'), newPassword: localPasswordSchema }),
  z.object({ action: z.literal('delete-account'), password: localPasswordSchema }),
  z.object({ action: z.literal('export') }),
])

function tokenPayload(session: SupabaseSession) {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ? session.expires_at * 1000 : Date.now() + (session.expires_in ?? 3600) * 1000,
  }
}

async function localSessionResponse(record: LocalAccountRecord, tokens: Awaited<ReturnType<typeof registerLocalAccount>>['tokens']) {
  return {
    ok: true as const,
    tokens,
    account: await accountPayload(localAuthAccount(record)),
  }
}

async function requireLocalAccount(event: Parameters<Handler>[0]): Promise<LocalAccountRecord> {
  const token = bearer(event)
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue.')
  const record = await localAccountForAccessToken(token)
  if (!record) throw new HttpError(401, 'unauthorized', 'The local session is invalid or has expired.')
  return record
}

function assertSession(value: unknown): SupabaseSession {
  const session = value as Partial<SupabaseSession> | null
  if (!session?.access_token || !session.refresh_token || !session.user?.id) {
    throw new HttpError(502, 'upstream_error', 'The authentication service returned an unexpected response.')
  }
  return session as SupabaseSession
}

async function sessionResponse(user: SupabaseAuthUser, session: SupabaseSession | null) {
  if (!authUserVerified(user)) {
    throw new HttpError(403, 'email_not_verified', 'Verify your email address before signing in.')
  }
  const account = await accountForUser(user)
  if (!canSignIn(account.status)) {
    throw new HttpError(
      403,
      'forbidden',
      account.status === 'suspended'
        ? 'This account is suspended. Contact an administrator.'
        : 'This account is pending activation. Contact an administrator.',
    )
  }
  return {
    ok: true,
    tokens: session ? tokenPayload(session) : null,
    account: await accountPayload(account),
  }
}

async function requireAccount(event: Parameters<Handler>[0]) {
  const account = await authenticate(event)
  return account
}

async function handleConfig() {
  if (localAuthEnabled()) {
    return {
      ok: true,
      configured: true,
      authConfigured: true,
      databaseConfigured: false,
      adminConfigured: false,
      ownerConfigured: false,
      trialDays: serverConfig.trialDays,
      siteUrl: serverConfig.authSiteUrl,
      provider: 'local',
      localMode: true,
      passwordMinLength: 1,
      passwordMaxLength: LOCAL_PASSWORD_MAX_LENGTH,
    }
  }
  return {
    ok: true,
    configured: supabasePublicConfigured() && supabaseAdminConfigured(),
    authConfigured: supabasePublicConfigured(),
    databaseConfigured: supabaseAdminConfigured(),
    adminConfigured: Boolean(serverConfig.adminEmail),
    ownerConfigured: Boolean(serverConfig.ownerEmail),
    trialDays: serverConfig.trialDays,
    siteUrl: serverConfig.authSiteUrl,
    provider: 'supabase',
    localMode: false,
    passwordMinLength: PASSWORD_MIN_LENGTH,
    passwordMaxLength: PASSWORD_MAX_LENGTH,
  }
}

async function handleLocalAuth(
  event: Parameters<Handler>[0],
  context: Parameters<Handler>[1],
  rawBody: unknown,
) {
  const parsed = localActionSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw new HttpError(
      400,
      'invalid_input',
      parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
        .join('; '),
    )
  }
  const body = parsed.data

  if (body.action === 'config') return json(200, await handleConfig())

  if (body.action === 'register') {
    enforceRateLimit(`auth:local:register:${clientIp(event, context)}`, 8, 10 * 60_000)
    const result = await registerLocalAccount(body)
    return json(200, await localSessionResponse(result.account, result.tokens))
  }

  if (body.action === 'login') {
    const key = emailHash(body.email).slice(0, 24)
    enforceRateLimit(`auth:local:login:${clientIp(event, context)}:${key}`, 10, 5 * 60_000)
    const result = await loginLocalAccount(body.email, body.password)
    return json(200, await localSessionResponse(result.account, result.tokens))
  }

  if (body.action === 'refresh') {
    const result = await refreshLocalSession(body.refreshToken)
    return json(200, await localSessionResponse(result.account, result.tokens))
  }

  if (body.action === 'logout') {
    const token = bearer(event)
    if (token) await logoutLocalSession(token)
    return json(200, { ok: true })
  }

  if (body.action === 'me') {
    const record = await requireLocalAccount(event)
    return json(200, { ok: true, account: await accountPayload(localAuthAccount(record)) })
  }

  if (body.action === 'update-profile') {
    const record = await requireLocalAccount(event)
    const updated = await updateLocalProfile(record.id, body.fullName)
    return json(200, { ok: true, user: { id: updated.id, email: updated.email }, fullName: updated.fullName ?? '' })
  }

  if (body.action === 'change-password') {
    const record = await requireLocalAccount(event)
    await changeLocalPassword(record.id, body.currentPassword, body.newPassword)
    return json(200, { ok: true })
  }

  if (body.action === 'delete-account') {
    const record = await requireLocalAccount(event)
    await deleteLocalAccount(record.id, body.password)
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'export') {
    const record = await requireLocalAccount(event)
    const account = localAuthAccount(record)
    return json(200, {
      ok: true,
      exportedAt: new Date().toISOString(),
      account: publicProfile(account),
      trial: account.trial,
      subscription: null,
      cases: [],
      notes: [],
      conversations: [],
      messages: [],
      trials: [],
      subscriptions: [],
      usage: [],
    })
  }

  throw new HttpError(400, 'invalid_input', 'Email verification and recovery are not available in local development mode.')
}

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['GET', 'POST'])

  if (event.httpMethod === 'GET') {
    return json(200, await handleConfig())
  }

  const rawBody = readJsonBody<unknown>(event, 256 * 1024)
  if (localAuthEnabled()) return handleLocalAuth(event, context, rawBody)

  const parsed = actionSchema.safeParse(rawBody)
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const body: AuthBody = parsed.data

  if (body.action === 'config') return json(200, await handleConfig())

  if (body.action === 'register') {
    assertAuthBackend()
    enforceRateLimit(`auth:register:${clientIp(event, context)}`, 8, 10 * 60_000)
    if (!(await getPlatformSetting<boolean>('signups_enabled', true))) {
      throw new HttpError(403, 'forbidden', 'New account registration is currently disabled.')
    }
    const response = await authRequest<Partial<SupabaseSession> & { user?: SupabaseAuthUser }>('/signup', {
      method: 'POST',
      body: {
        email: body.email,
        password: body.password,
        data: { username: body.username, full_name: body.username },
      },
    })
    const user = response.data.user
    if (!user?.id) throw new HttpError(502, 'upstream_error', 'The authentication service did not return a user.')
    if (Array.isArray(user.identities) && user.identities.length === 0) {
      throw new HttpError(409, 'already_exists', 'An account with this email already exists.')
    }
    await writeAudit({
      actorId: user.id,
      actorEmail: body.email,
      action: 'auth.register',
      targetType: 'account',
      targetId: user.id,
      outcome: 'success',
      detail: { needsVerification: !authUserVerified(user) },
    })
    if (!response.data.access_token || !response.data.refresh_token) {
      return json(200, { ok: true, needsVerification: true })
    }
    return json(200, await sessionResponse(user, assertSession(response.data)))
  }

  if (body.action === 'login') {
    assertAuthBackend()
    const key = emailHash(body.email).slice(0, 24)
    enforceRateLimit(`auth:login:${clientIp(event, context)}:${key}`, 10, 5 * 60_000)
    const response = await authRequest<SupabaseSession>(`/token?grant_type=password`, {
      method: 'POST',
      body: { email: body.email, password: body.password },
    })
    const session = assertSession(response.data)
    return json(200, await sessionResponse(session.user, session))
  }

  if (body.action === 'refresh') {
    assertAuthBackend()
    const response = await authRequest<SupabaseSession>(`/token?grant_type=refresh_token`, {
      method: 'POST',
      body: { refresh_token: body.refreshToken },
    })
    const session = assertSession(response.data)
    return json(200, await sessionResponse(session.user, session))
  }

  if (body.action === 'recover') {
    assertAuthBackend()
    enforceRateLimit(`auth:recover:${clientIp(event, context)}`, 5, 15 * 60_000)
    try {
      await authRequest('/recover', {
        method: 'POST',
        body: { email: body.email, redirect_to: `${serverConfig.authSiteUrl}/reset-password` },
      })
    } catch {
      // Do not reveal whether the address exists, but do not hide configuration errors.
      if (!supabasePublicConfigured()) throw new HttpError(503, 'not_configured', 'Authentication is not configured.')
    }
    return json(200, { ok: true, message: 'If an account exists for this address, a recovery email has been sent.' })
  }

  if (body.action === 'resend') {
    assertAuthBackend()
    enforceRateLimit(`auth:resend:${clientIp(event, context)}`, 3, 15 * 60_000)
    try {
      await authRequest('/resend', {
        method: 'POST',
        body: {
          type: 'signup',
          email: body.email,
          options: { email_redirect_to: `${serverConfig.authSiteUrl}/verify` },
        },
      })
    } catch {
      if (!supabasePublicConfigured()) throw new HttpError(503, 'not_configured', 'Authentication is not configured.')
    }
    return json(200, { ok: true, message: 'If the account needs verification, a new email has been sent.' })
  }

  if (body.action === 'verify') {
    assertAuthBackend()
    enforceRateLimit(`auth:verify:${clientIp(event, context)}`, 20, 10 * 60_000)
    const response = await authRequest<Partial<SupabaseSession> & { user?: SupabaseAuthUser }>('/verify', {
      method: 'POST',
      body: { type: body.type, token_hash: body.tokenHash },
    })
    const user = response.data.user
    if (!user?.id) throw new HttpError(400, 'invalid_input', 'This verification link is invalid or has expired.')
    if (body.type === 'signup' || body.type === 'invite') {
      if (!response.data.access_token || !response.data.refresh_token) {
        return json(200, { ok: true, verified: true })
      }
      return json(200, { ...(await sessionResponse(user, assertSession(response.data))), verified: true })
    }
    // Recovery: return a short-lived session so the client can set a new password.
    if (!response.data.access_token) throw new HttpError(400, 'invalid_input', 'This recovery link is invalid or has expired.')
    return json(200, { ok: true, tokens: tokenPayload(assertSession(response.data)), email: user.email ?? null })
  }

  if (body.action === 'logout') {
    const token = bearer(event)
    if (token) {
      try {
        await authRequest('/logout', { method: 'POST', accessToken: token })
      } catch {
        /* Session may already be gone; the client still clears local tokens. */
      }
    }
    return json(200, { ok: true })
  }

  if (body.action === 'me') {
    const account = await requireAccount(event)
    return json(200, { ok: true, account: await accountPayload(account) })
  }

  if (body.action === 'update-profile') {
    const account = await requireAccount(event)
    const updated = (await authRequest<SupabaseAuthUser>('/user', {
      method: 'PUT',
      accessToken: bearer(event) ?? undefined,
      body: { data: { full_name: body.fullName } },
    })).data
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'account.profile_update',
      targetType: 'account',
      targetId: account.profile.id,
      outcome: 'success',
    })
    return json(200, { ok: true, user: { id: updated.id, email: updated.email }, fullName: body.fullName })
  }

  if (body.action === 'change-password') {
    const account = await requireAccount(event)
    if (!account.profile.email) throw new HttpError(400, 'invalid_input', 'This account has no email address.')
    // Re-authenticate before allowing a password change.
    await authRequest('/token?grant_type=password', {
      method: 'POST',
      body: { email: account.profile.email, password: body.currentPassword },
    })
    await authRequest('/user', {
      method: 'PUT',
      accessToken: bearer(event) ?? undefined,
      body: { password: body.newPassword },
    })
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'account.password_change',
      targetType: 'account',
      targetId: account.profile.id,
      outcome: 'success',
    })
    return json(200, { ok: true })
  }

  if (body.action === 'reset-password') {
    const token = bearer(event)
    if (!token) throw new HttpError(401, 'unauthorized', 'A valid recovery session is required.')
    const user = await authUser(token)
    await authRequest('/user', {
      method: 'PUT',
      accessToken: token,
      body: { password: body.newPassword },
    })
    await writeAudit({
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: 'account.password_reset',
      targetType: 'account',
      targetId: user.id,
      outcome: 'success',
    })
    return json(200, { ok: true })
  }

  if (body.action === 'delete-account') {
    const account = await requireAccount(event)
    if (!account.profile.email) throw new HttpError(400, 'invalid_input', 'This account has no email address.')
    if (account.role === 'owner') {
      const owners = await supabaseCount('profiles', 'role=eq.owner&status=eq.active')
      if (owners <= 1) {
        throw new HttpError(422, 'invalid_input', 'The last active platform owner cannot delete their own account.')
      }
    }
    if (account.role === 'super_admin') {
      const admins = await supabaseCount('profiles', 'role=eq.super_admin&status=eq.active')
      if (admins <= 1) {
        throw new HttpError(422, 'invalid_input', 'The last active super administrator cannot delete their own account.')
      }
    }
    await authRequest('/token?grant_type=password', {
      method: 'POST',
      body: { email: account.profile.email, password: body.password },
    })
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'account.delete',
      targetType: 'account',
      targetId: account.profile.id,
      outcome: 'success',
      detail: { role: account.role },
    })
    await authAdminRequest(`/users/${encodeURIComponent(account.profile.id)}`, { method: 'DELETE' })
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'export') {
    const account = await requireAccount(event)
    requireVerified(account)
    if (!account.entitlements.features.exports) throw new HttpError(403, 'forbidden', 'Data export is not available on this plan.')
    const id = encodeURIComponent(account.profile.id)
    const [cases, notes, conversations, messages, trials, subscriptions, usage] = await Promise.all([
      supabaseSelectAs('cases', `select=*&user_id=eq.${id}&order=updated_at.desc`),
      supabaseSelectAs('notes', `select=*&user_id=eq.${id}&order=updated_at.desc`),
      supabaseSelectAs('conversations', `select=*&user_id=eq.${id}&order=updated_at.desc`),
      supabaseSelectAs('conversation_messages', `select=*&user_id=eq.${id}&order=created_at.asc`),
      supabaseSelectAs('trials', `select=*&user_id=eq.${id}`),
      supabaseSelectAs('subscriptions', `select=*&user_id=eq.${id}`),
      supabaseSelectAs('usage_events', `select=kind,provider,model,tokens_in,tokens_out,created_at&user_id=eq.${id}&order=created_at.desc&limit=1000`),
    ])
    const summary = publicProfile(account)
    await recordUsage({ userId: account.profile.id, kind: 'account.export', provider: 'nexora', model: 'internal' })
    return json(200, {
      ok: true,
      exportedAt: new Date().toISOString(),
      account: summary,
      trial: account.trial,
      subscription: account.subscription,
      cases,
      notes,
      conversations,
      messages,
      trials,
      subscriptions,
      usage,
    })
  }

  throw new HttpError(400, 'invalid_input', 'Unknown authentication action.')
})
