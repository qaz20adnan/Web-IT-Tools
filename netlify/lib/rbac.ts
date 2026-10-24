export type Role =
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

export const STAFF_ROLES: Role[] = ['super_admin', 'content_manager', 'technical_editor', 'support_specialist']

export const ASSIGNABLE_ROLES: Role[] = [
  'super_admin',
  'content_manager',
  'technical_editor',
  'support_specialist',
  'premium_member',
  'standard_member',
  'trial_member',
  'suspended_member',
]

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

/** Returns the role after applying account status restrictions. */
export function effectiveRole(role: Role, status: 'active' | 'suspended' | 'pending'): Role {
  if (status === 'suspended') return 'suspended_member'
  return role
}

export function permissionsFor(role: Role, status: 'active' | 'suspended' | 'pending'): Permission[] {
  if (status === 'suspended') return []
  return permissionsForRole(role)
}
