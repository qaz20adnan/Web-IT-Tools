export type Role =
  | 'owner'
  | 'admin'
  | 'super_admin'
  | 'content_manager'
  | 'technical_editor'
  | 'support_specialist'
  | 'premium_member'
  | 'standard_member'
  | 'trial_member'
  | 'suspended_member'

export type Permission =
  | 'users.read'
  | 'users.update'
  | 'users.suspend'
  | 'users.delete'
  | 'roles.assign'
  | 'content.read'
  | 'content.create'
  | 'content.update'
  | 'content.archive'
  | 'content.restore'
  | 'content.delete'
  | 'news.manage'
  | 'providers.manage'
  | 'settings.manage'
  | 'subscriptions.manage'
  | 'reports.read'
  | 'audit_logs.read'
  | 'workspace.read'
  | 'workspace.write'
  | 'ai.use'
  | 'research.read'
  | 'support.cases.read'
  | 'support.cases.update'

export const ALL_PERMISSIONS: Permission[] = [
  'users.read',
  'users.update',
  'users.suspend',
  'users.delete',
  'roles.assign',
  'content.read',
  'content.create',
  'content.update',
  'content.archive',
  'content.restore',
  'content.delete',
  'news.manage',
  'providers.manage',
  'settings.manage',
  'subscriptions.manage',
  'reports.read',
  'audit_logs.read',
  'workspace.read',
  'workspace.write',
  'ai.use',
  'research.read',
  'support.cases.read',
  'support.cases.update',
]

const MEMBER_PERMISSIONS: Permission[] = ['workspace.read', 'workspace.write', 'ai.use', 'research.read']

/**
 * Role → permission matrix. This is the single source of truth for server-side
 * authorization. The UI uses it to hide actions, but every privileged endpoint
 * re-checks it against the database-backed profile.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...ALL_PERMISSIONS],
  /**
   * Platform administrator. Operational administration is allowed, while
   * destructive account/content deletion and provider configuration remain
   * owner-only. Privileged role assignment is additionally limited by rank in
   * `canAssignRole` below.
   */
  admin: [
    'users.read',
    'users.update',
    'users.suspend',
    'roles.assign',
    'content.read',
    'content.create',
    'content.update',
    'content.archive',
    'content.restore',
    'news.manage',
    'settings.manage',
    'subscriptions.manage',
    'reports.read',
    'audit_logs.read',
    'workspace.read',
    'workspace.write',
    'ai.use',
    'research.read',
    'support.cases.read',
    'support.cases.update',
  ],
  /** Legacy role retained unchanged for existing deployments. */
  super_admin: [...ALL_PERMISSIONS],
  content_manager: [
    'content.read',
    'content.create',
    'content.update',
    'content.archive',
    'content.restore',
    'content.delete',
    'news.manage',
    'reports.read',
    'workspace.read',
    'workspace.write',
    'ai.use',
    'research.read',
  ],
  technical_editor: [
    'content.read',
    'content.create',
    'content.update',
    'content.archive',
    'workspace.read',
    'workspace.write',
    'ai.use',
    'research.read',
  ],
  support_specialist: [
    'content.read',
    'support.cases.read',
    'support.cases.update',
    'workspace.read',
    'workspace.write',
    'ai.use',
    'research.read',
    'reports.read',
  ],
  premium_member: MEMBER_PERMISSIONS,
  standard_member: MEMBER_PERMISSIONS,
  trial_member: MEMBER_PERMISSIONS,
  suspended_member: [],
}

export const STAFF_ROLES: Role[] = [
  'owner',
  'admin',
  'super_admin',
  'content_manager',
  'technical_editor',
  'support_specialist',
]

/**
 * Roles that an owner may grant through the admin API. All roles are listed
 * because the owner is the highest authority. Every other role receives a
 * filtered list from `assignableRolesFor` and the server re-checks each change.
 */
export const ASSIGNABLE_ROLES: Role[] = [
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

/**
 * Explicit hierarchy used for two decisions that permissions alone cannot
 * express: who may change an account, and who may grant a role. Higher numbers
 * are more privileged. `super_admin` remains above `admin` so existing
 * deployments keep their current behaviour, but only an owner may grant or
 * revoke `owner`.
 */
export const ROLE_RANK: Record<Role, number> = {
  owner: 100,
  super_admin: 90,
  admin: 80,
  content_manager: 60,
  technical_editor: 50,
  support_specialist: 40,
  premium_member: 30,
  standard_member: 20,
  trial_member: 10,
  suspended_member: 0,
}

/** Roles that may be granted through the self-service registration flow. */
export const SELF_SIGNUP_ROLES: Role[] = ['standard_member']

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value)
}

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission)
}

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role)
}

export function roleRank(role: Role): number {
  return ROLE_RANK[role] ?? 0
}

export function isOwnerRole(role: Role): boolean {
  return role === 'owner'
}

/** Owner, platform administrator and the retained legacy super administrator. */
export function isPrivilegedRole(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'super_admin'
}

/**
 * Whether `actor` may change the role/status of an account that currently has
 * `target`. Self-management is rejected separately by the admin endpoint.
 */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === 'owner') return true
  if (actor === 'super_admin') return target !== 'owner'
  if (actor === 'admin') return roleRank(target) < roleRank('admin')
  return false
}

/** Whether `actor` may grant `target` (includes promotion and demotion). */
export function canAssignRole(actor: Role, target: Role): boolean {
  return canManageRole(actor, target)
}

/** Roles the actor may select in the admin UI; the server enforces the same list. */
export function assignableRolesFor(actor: Role): Role[] {
  return ASSIGNABLE_ROLES.filter((role) => canAssignRole(actor, role))
}

/** Returns the role after applying account status restrictions. */
export function effectiveRole(role: Role, status: 'active' | 'suspended' | 'pending'): Role {
  if (status === 'suspended') return 'suspended_member'
  return role
}

export function permissionsFor(role: Role, status: 'active' | 'suspended' | 'pending'): Permission[] {
  if (status === 'suspended') return []
  return permissionsForRole(role)
}
