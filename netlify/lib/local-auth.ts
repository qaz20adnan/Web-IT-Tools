import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { HttpError } from './http'
import type { Role } from './rbac'

/**
 * Temporary development-only authentication.
 *
 * This module is never reachable in a production deployment: `localAuthEnabled`
 * requires an explicit development flag and refuses production/Lambda runtimes.
 * Accounts and sessions live in `.local-auth/store.json` (or
 * NEXORA_LOCAL_AUTH_DIR), which is git-ignored.
 */

export const LOCAL_PASSWORD_MAX_LENGTH = 1024

const STORE_VERSION = 1
const PASSWORD_KEY_LENGTH = 64
const ACCESS_TTL_MS = 60 * 60 * 1000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_SESSIONS_PER_ACCOUNT = 20

interface LocalPasswordHash {
  algorithm: 'scrypt'
  salt: string
  hash: string
  keyLength: number
}

export type LocalAccountStatus = 'active' | 'suspended' | 'pending'

export interface LocalAccountRecord {
  id: string
  username: string
  fullName: string | null
  email: string
  role: Role
  status: LocalAccountStatus
  password: LocalPasswordHash
  createdAt: string
  updatedAt: string
}

export interface LocalAccountSummary {
  id: string
  username: string
  fullName: string | null
  email: string
  role: Role
  status: LocalAccountStatus
  createdAt: string
  updatedAt: string
  activeSessions: number
}

export interface LocalAuditRecord {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string
  targetType: string | null
  targetId: string | null
  outcome: 'success' | 'failure'
  detail: Record<string, unknown> | null
  createdAt: string
}

export const LOCAL_ROLES: Role[] = [
  'owner',
  'admin',
  'super_admin',
  'content_manager',
  'technical_editor',
  'support_specialist',
  'premium_member',
  'standard_member',
  'trial_member',
  'suspended_member',
]

const LOCAL_STATUSES: LocalAccountStatus[] = ['active', 'suspended', 'pending']
const MAX_AUDIT_RECORDS = 1000

export function isLocalRole(value: unknown): value is Role {
  return typeof value === 'string' && LOCAL_ROLES.includes(value as Role)
}

export function isLocalStatus(value: unknown): value is LocalAccountStatus {
  return typeof value === 'string' && LOCAL_STATUSES.includes(value as LocalAccountStatus)
}

interface LocalSessionRecord {
  id: string
  accountId: string
  accessHash: string
  refreshHash: string
  accessExpiresAt: number
  refreshExpiresAt: number
  createdAt: number
}

interface LocalAuthStore {
  version: number
  accounts: LocalAccountRecord[]
  sessions: LocalSessionRecord[]
  audits: LocalAuditRecord[]
}

export interface LocalAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface LocalAuthResult {
  account: LocalAccountRecord
  tokens: LocalAuthTokens
}

export function localAuthEnabled(): boolean {
  if ((process.env.NEXORA_LOCAL_AUTH ?? '').trim() !== '1') return false
  if ((process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production') return false
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT || process.env.NETLIFY === 'true') {
    return false
  }
  return true
}

export function localAuthDir(): string {
  const configured = (process.env.NEXORA_LOCAL_AUTH_DIR ?? '').trim()
  return configured ? resolve(configured) : resolve(process.cwd(), '.local-auth')
}

function storePath(): string {
  return join(localAuthDir(), 'store.json')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function randomToken(): string {
  return randomBytes(32).toString('base64url')
}

function assertPassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HttpError(400, 'invalid_input', 'Enter a password.')
  }
  if (value.length > LOCAL_PASSWORD_MAX_LENGTH) {
    throw new HttpError(
      400,
      'invalid_input',
      `Local development passwords can be at most ${LOCAL_PASSWORD_MAX_LENGTH} characters.`,
    )
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error)
      else resolvePromise(key)
    })
  })
}

async function hashPassword(password: string): Promise<LocalPasswordHash> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt)
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    keyLength: PASSWORD_KEY_LENGTH,
  }
}

async function verifyPassword(password: string, stored: LocalPasswordHash): Promise<boolean> {
  if (stored.algorithm !== 'scrypt' || stored.keyLength !== PASSWORD_KEY_LENGTH) return false
  try {
    const salt = Buffer.from(stored.salt, 'base64')
    const expected = Buffer.from(stored.hash, 'base64')
    const actual = await derive(password, salt)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

function emptyStore(): LocalAuthStore {
  return { version: STORE_VERSION, accounts: [], sessions: [], audits: [] }
}

function isAccount(value: unknown): value is LocalAccountRecord {
  const account = value as Partial<LocalAccountRecord> | null
  return Boolean(
    account &&
      typeof account.id === 'string' &&
      typeof account.username === 'string' &&
      typeof account.email === 'string' &&
      isLocalRole(account.role) &&
      isLocalStatus(account.status) &&
      typeof account.createdAt === 'string' &&
      typeof account.updatedAt === 'string' &&
      account.password &&
      account.password.algorithm === 'scrypt' &&
      typeof account.password.salt === 'string' &&
      typeof account.password.hash === 'string' &&
      account.password.keyLength === PASSWORD_KEY_LENGTH,
  )
}

function isAudit(value: unknown): value is LocalAuditRecord {
  const audit = value as Partial<LocalAuditRecord> | null
  return Boolean(
    audit &&
      typeof audit.id === 'string' &&
      typeof audit.action === 'string' &&
      (audit.outcome === 'success' || audit.outcome === 'failure') &&
      typeof audit.createdAt === 'string',
  )
}

function isSession(value: unknown): value is LocalSessionRecord {
  const session = value as Partial<LocalSessionRecord> | null
  return Boolean(
    session &&
      typeof session.id === 'string' &&
      typeof session.accountId === 'string' &&
      typeof session.accessHash === 'string' &&
      typeof session.refreshHash === 'string' &&
      typeof session.accessExpiresAt === 'number' &&
      typeof session.refreshExpiresAt === 'number' &&
      typeof session.createdAt === 'number',
  )
}

async function readStore(): Promise<LocalAuthStore> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LocalAuthStore> | null
    if (
      !parsed ||
      parsed.version !== STORE_VERSION ||
      !Array.isArray(parsed.accounts) ||
      !Array.isArray(parsed.sessions) ||
      !parsed.accounts.every(isAccount) ||
      !parsed.sessions.every(isSession) ||
      (parsed.audits !== undefined && (!Array.isArray(parsed.audits) || !parsed.audits.every(isAudit)))
    ) {
      throw new HttpError(500, 'unknown', 'The local authentication store is corrupted. Move it aside and retry.')
    }
    return { ...(parsed as LocalAuthStore), audits: parsed.audits ?? [] }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStore()
    throw error
  }
}

async function writeStore(store: LocalAuthStore): Promise<void> {
  const dir = localAuthDir()
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const target = storePath()
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.rename(temp, target)
  } catch {
    await fs.rm(target, { force: true })
    await fs.rename(temp, target)
  }
  await fs.chmod(target, 0o600).catch(() => undefined)
  await fs.chmod(dir, 0o700).catch(() => undefined)
}

let queue: Promise<void> = Promise.resolve()

function withStoreLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function addSession(store: LocalAuthStore, accountId: string, now = Date.now()): LocalAuthTokens {
  const accessToken = randomToken()
  const refreshToken = randomToken()
  store.sessions = store.sessions.filter((session) => session.refreshExpiresAt > now)
  const existing = store.sessions
    .filter((session) => session.accountId === accountId)
    .sort((left, right) => left.createdAt - right.createdAt)
  const overflow = existing.length - (MAX_SESSIONS_PER_ACCOUNT - 1)
  if (overflow > 0) {
    const remove = new Set(existing.slice(0, overflow).map((session) => session.id))
    store.sessions = store.sessions.filter((session) => !remove.has(session.id))
  }
  store.sessions.push({
    id: randomUUID(),
    accountId,
    accessHash: hashToken(accessToken),
    refreshHash: hashToken(refreshToken),
    accessExpiresAt: now + ACCESS_TTL_MS,
    refreshExpiresAt: now + REFRESH_TTL_MS,
    createdAt: now,
  })
  return { accessToken, refreshToken, expiresAt: now + ACCESS_TTL_MS }
}

function accountByEmail(store: LocalAuthStore, email: string): LocalAccountRecord | undefined {
  return store.accounts.find((account) => account.email === email)
}

function accountById(store: LocalAuthStore, id: string): LocalAccountRecord | undefined {
  return store.accounts.find((account) => account.id === id)
}

function activeSessionCount(store: LocalAuthStore, accountId: string, now = Date.now()): number {
  return store.sessions.filter(
    (session) => session.accountId === accountId && session.refreshExpiresAt > now,
  ).length
}

function summarize(account: LocalAccountRecord, store: LocalAuthStore): LocalAccountSummary {
  return {
    id: account.id,
    username: account.username,
    fullName: account.fullName,
    email: account.email,
    role: account.role,
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    activeSessions: activeSessionCount(store, account.id),
  }
}

function assertSignInAllowed(account: LocalAccountRecord): void {
  if (account.status === 'active') return
  throw new HttpError(
    403,
    'forbidden',
    account.status === 'suspended'
      ? 'This account is suspended. Contact an administrator.'
      : 'This account is pending activation. Contact an administrator.',
  )
}

export async function listLocalAccounts(): Promise<LocalAccountSummary[]> {
  const store = await readStore()
  return store.accounts.map((account) => summarize(account, store))
}

export async function countActiveLocalAccounts(role: Role): Promise<number> {
  const store = await readStore()
  return store.accounts.filter((account) => account.role === role && account.status === 'active').length
}

export async function recordLocalAudit(input: {
  actorId: string | null
  actorEmail: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  outcome: 'success' | 'failure'
  detail?: Record<string, unknown> | null
}): Promise<void> {
  await withStoreLock(async () => {
    const store = await readStore()
    store.audits.push({
      id: randomUUID(),
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome,
      detail: input.detail ?? null,
      createdAt: new Date().toISOString(),
    })
    if (store.audits.length > MAX_AUDIT_RECORDS) {
      store.audits = store.audits.slice(-MAX_AUDIT_RECORDS)
    }
    await writeStore(store)
  })
}

export async function listLocalAudits(limit = 50, offset = 0): Promise<LocalAuditRecord[]> {
  const store = await readStore()
  return store.audits
    .slice()
    .reverse()
    .slice(offset, offset + limit)
}

export async function countLocalAudits(): Promise<number> {
  const store = await readStore()
  return store.audits.length
}

export async function registerLocalAccount(input: {
  username: string
  email: string
  password: string
}): Promise<LocalAuthResult> {
  assertPassword(input.password)
  const email = normalizeEmail(input.email)
  const username = input.username.trim()
  const password = await hashPassword(input.password)
  return withStoreLock(async () => {
    const store = await readStore()
    if (accountByEmail(store, email)) {
      throw new HttpError(409, 'already_exists', 'An account with this email already exists.')
    }
    const now = new Date().toISOString()
    const account: LocalAccountRecord = {
      id: `local_${randomUUID()}`,
      username,
      fullName: username,
      email,
      role: 'standard_member',
      status: 'active',
      password,
      createdAt: now,
      updatedAt: now,
    }
    store.accounts.push(account)
    const tokens = addSession(store, account.id)
    await writeStore(store)
    return { account, tokens }
  })
}

export async function loginLocalAccount(email: string, password: string): Promise<LocalAuthResult> {
  assertPassword(password)
  const normalized = normalizeEmail(email)
  const store = await readStore()
  const account = accountByEmail(store, normalized)
  if (!account || !(await verifyPassword(password, account.password))) {
    throw new HttpError(401, 'invalid_credentials', 'The email or password is incorrect.')
  }
  assertSignInAllowed(account)
  return withStoreLock(async () => {
    const fresh = await readStore()
    const current = accountById(fresh, account.id)
    if (!current) throw new HttpError(401, 'invalid_credentials', 'The email or password is incorrect.')
    assertSignInAllowed(current)
    const tokens = addSession(fresh, current.id)
    await writeStore(fresh)
    return { account: current, tokens }
  })
}

export async function refreshLocalSession(refreshToken: string): Promise<LocalAuthResult> {
  const hash = hashToken(refreshToken)
  return withStoreLock(async () => {
    const store = await readStore()
    const now = Date.now()
    const session = store.sessions.find((entry) => entry.refreshHash === hash)
    if (!session || session.refreshExpiresAt <= now) {
      throw new HttpError(401, 'unauthorized', 'The local session is invalid or has expired.')
    }
    const account = accountById(store, session.accountId)
    if (!account) {
      store.sessions = store.sessions.filter((entry) => entry.id !== session.id)
      await writeStore(store)
      throw new HttpError(401, 'unauthorized', 'The local session is invalid or has expired.')
    }
    if (account.status !== 'active') {
      store.sessions = store.sessions.filter((entry) => entry.id !== session.id)
      await writeStore(store)
      assertSignInAllowed(account)
    }
    const accessToken = randomToken()
    const nextRefreshToken = randomToken()
    session.accessHash = hashToken(accessToken)
    session.refreshHash = hashToken(nextRefreshToken)
    session.accessExpiresAt = now + ACCESS_TTL_MS
    session.refreshExpiresAt = now + REFRESH_TTL_MS
    session.createdAt = now
    await writeStore(store)
    return {
      account,
      tokens: { accessToken, refreshToken: nextRefreshToken, expiresAt: session.accessExpiresAt },
    }
  })
}

export async function logoutLocalSession(accessToken: string): Promise<void> {
  const hash = hashToken(accessToken)
  await withStoreLock(async () => {
    const store = await readStore()
    const next = store.sessions.filter((session) => session.accessHash !== hash)
    if (next.length !== store.sessions.length) {
      store.sessions = next
      await writeStore(store)
    }
  })
}

export async function localAccountForAccessToken(accessToken: string): Promise<LocalAccountRecord | null> {
  if (!accessToken) return null
  const store = await readStore()
  const now = Date.now()
  const session = store.sessions.find(
    (entry) => entry.accessHash === hashToken(accessToken) && entry.accessExpiresAt > now,
  )
  if (!session) return null
  const account = accountById(store, session.accountId)
  if (!account || account.status !== 'active') return null
  return account
}

export async function updateLocalProfile(accountId: string, fullName: string): Promise<LocalAccountRecord> {
  return withStoreLock(async () => {
    const store = await readStore()
    const account = accountById(store, accountId)
    if (!account) throw new HttpError(404, 'not_found', 'The local account no longer exists.')
    account.fullName = fullName.trim() ? fullName.trim().slice(0, 120) : null
    account.updatedAt = new Date().toISOString()
    await writeStore(store)
    return account
  })
}

export async function changeLocalPassword(accountId: string, currentPassword: string, newPassword: string): Promise<void> {
  assertPassword(currentPassword)
  assertPassword(newPassword)
  const store = await readStore()
  const account = accountById(store, accountId)
  if (!account || !(await verifyPassword(currentPassword, account.password))) {
    throw new HttpError(401, 'invalid_credentials', 'The current password is incorrect.')
  }
  const password = await hashPassword(newPassword)
  await withStoreLock(async () => {
    const fresh = await readStore()
    const current = accountById(fresh, accountId)
    if (!current) throw new HttpError(404, 'not_found', 'The local account no longer exists.')
    current.password = password
    current.updatedAt = new Date().toISOString()
    await writeStore(fresh)
  })
}

export async function deleteLocalAccount(accountId: string, password: string): Promise<void> {
  assertPassword(password)
  const store = await readStore()
  const account = accountById(store, accountId)
  if (!account || !(await verifyPassword(password, account.password))) {
    throw new HttpError(401, 'invalid_credentials', 'The password is incorrect.')
  }
  await withStoreLock(async () => {
    const fresh = await readStore()
    fresh.accounts = fresh.accounts.filter((entry) => entry.id !== accountId)
    fresh.sessions = fresh.sessions.filter((entry) => entry.accountId !== accountId)
    await writeStore(fresh)
  })
}

export interface LocalAccountGuard {
  protectActiveRoles?: Role[]
}

function assertProtectedRoleRemains(
  store: LocalAuthStore,
  target: LocalAccountRecord,
  nextRole: Role,
  nextStatus: LocalAccountStatus,
  protect: Role[],
): void {
  if (target.status !== 'active' || !protect.includes(target.role)) return
  if (nextRole === target.role && nextStatus === 'active') return
  const remaining = store.accounts.filter(
    (account) =>
      account.id !== target.id && account.role === target.role && account.status === 'active',
  ).length
  if (remaining > 0) return
  throw new HttpError(
    422,
    'invalid_input',
    target.role === 'owner'
      ? 'The last active platform owner cannot be demoted or suspended.'
      : 'The last active super administrator cannot be demoted or suspended.',
  )
}

export async function getLocalAccount(accountId: string): Promise<LocalAccountSummary | null> {
  const store = await readStore()
  const account = accountById(store, accountId)
  return account ? summarize(account, store) : null
}

export async function createLocalAccountByAdmin(input: {
  username: string
  email: string
  password: string
  fullName?: string | null
  role: Role
}): Promise<LocalAccountSummary> {
  assertPassword(input.password)
  if (!isLocalRole(input.role)) throw new HttpError(400, 'invalid_input', 'Unknown account role.')
  const email = normalizeEmail(input.email)
  const username = input.username.trim()
  const fullName = (input.fullName ?? username).trim().slice(0, 120) || null
  const password = await hashPassword(input.password)
  return withStoreLock(async () => {
    const store = await readStore()
    if (accountByEmail(store, email)) {
      throw new HttpError(409, 'already_exists', 'An account with this email already exists.')
    }
    const now = new Date().toISOString()
    const account: LocalAccountRecord = {
      id: `local_${randomUUID()}`,
      username,
      fullName,
      email,
      role: input.role,
      status: 'active',
      password,
      createdAt: now,
      updatedAt: now,
    }
    store.accounts.push(account)
    await writeStore(store)
    return summarize(account, store)
  })
}

export async function updateLocalAccount(
  accountId: string,
  patch: { role?: Role; status?: LocalAccountStatus },
  guard: LocalAccountGuard = {},
): Promise<LocalAccountSummary> {
  if (patch.role === undefined && patch.status === undefined) {
    throw new HttpError(400, 'invalid_input', 'Nothing to update.')
  }
  if (patch.role !== undefined && !isLocalRole(patch.role)) {
    throw new HttpError(400, 'invalid_input', 'Unknown account role.')
  }
  if (patch.status !== undefined && !isLocalStatus(patch.status)) {
    throw new HttpError(400, 'invalid_input', 'Unknown account status.')
  }
  return withStoreLock(async () => {
    const store = await readStore()
    const account = accountById(store, accountId)
    if (!account) throw new HttpError(404, 'not_found', 'The local account no longer exists.')
    const nextRole = patch.role ?? account.role
    const nextStatus = patch.status ?? account.status
    assertProtectedRoleRemains(store, account, nextRole, nextStatus, guard.protectActiveRoles ?? [])
    account.role = nextRole
    account.status = nextStatus
    account.updatedAt = new Date().toISOString()
    if (nextStatus !== 'active') {
      store.sessions = store.sessions.filter((session) => session.accountId !== accountId)
    }
    await writeStore(store)
    return summarize(account, store)
  })
}

export async function revokeLocalSessions(accountId: string): Promise<number> {
  return withStoreLock(async () => {
    const store = await readStore()
    if (!accountById(store, accountId)) {
      throw new HttpError(404, 'not_found', 'The local account no longer exists.')
    }
    const before = store.sessions.length
    store.sessions = store.sessions.filter((session) => session.accountId !== accountId)
    const removed = before - store.sessions.length
    if (removed > 0) await writeStore(store)
    return removed
  })
}

export async function resetLocalPasswordByAdmin(accountId: string, newPassword: string): Promise<void> {
  assertPassword(newPassword)
  const password = await hashPassword(newPassword)
  await withStoreLock(async () => {
    const store = await readStore()
    const account = accountById(store, accountId)
    if (!account) throw new HttpError(404, 'not_found', 'The local account no longer exists.')
    account.password = password
    account.updatedAt = new Date().toISOString()
    store.sessions = store.sessions.filter((session) => session.accountId !== accountId)
    await writeStore(store)
  })
}

export async function deleteLocalAccountByAdmin(
  accountId: string,
  guard: LocalAccountGuard = {},
): Promise<void> {
  await withStoreLock(async () => {
    const store = await readStore()
    const account = accountById(store, accountId)
    if (!account) throw new HttpError(404, 'not_found', 'The local account no longer exists.')
    assertProtectedRoleRemains(store, account, 'suspended_member', 'suspended', guard.protectActiveRoles ?? [])
    if (guard.protectActiveRoles?.includes(account.role) && account.status === 'active') {
      const remaining = store.accounts.filter(
        (entry) => entry.id !== account.id && entry.role === account.role && entry.status === 'active',
      ).length
      if (remaining === 0) {
        throw new HttpError(
          422,
          'invalid_input',
          account.role === 'owner'
            ? 'The last active platform owner cannot be deleted.'
            : 'The last active super administrator cannot be deleted.',
        )
      }
    }
    store.accounts = store.accounts.filter((entry) => entry.id !== accountId)
    store.sessions = store.sessions.filter((session) => session.accountId !== accountId)
    await writeStore(store)
  })
}
