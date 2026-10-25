import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  ASSIGNABLE_ROLES,
  ROLE_PERMISSIONS,
  SELF_SIGNUP_ROLES,
  assignableRolesFor,
  canAssignRole,
  canManageRole,
  effectiveRole,
  hasPermission,
  isOwnerRole,
  isPrivilegedRole,
  isRole,
  isStaffRole,
  permissionsFor,
  permissionsForRole,
} from '../netlify/lib/rbac'

describe('RBAC matrix', () => {
  it('grants the owner and the legacy super administrator every permission', () => {
    expect(permissionsForRole('owner')).toEqual(ALL_PERMISSIONS)
    expect(permissionsForRole('super_admin')).toEqual(ALL_PERMISSIONS)
  })

  it('keeps platform administration separate from owner-only destructive actions', () => {
    expect(hasPermission('admin', 'users.read')).toBe(true)
    expect(hasPermission('admin', 'roles.assign')).toBe(true)
    expect(hasPermission('admin', 'settings.manage')).toBe(true)
    expect(hasPermission('admin', 'users.delete')).toBe(false)
    expect(hasPermission('admin', 'content.delete')).toBe(false)
    expect(hasPermission('admin', 'providers.manage')).toBe(false)
    expect(hasPermission('owner', 'users.delete')).toBe(true)
  })

  it('does not grant members administrative permissions', () => {
    for (const role of ['premium_member', 'standard_member', 'trial_member'] as const) {
      expect(hasPermission(role, 'users.read')).toBe(false)
      expect(hasPermission(role, 'settings.manage')).toBe(false)
      expect(hasPermission(role, 'roles.assign')).toBe(false)
      expect(hasPermission(role, 'ai.use')).toBe(true)
    }
  })

  it('grants no permissions to a suspended account', () => {
    expect(permissionsFor('owner', 'suspended')).toEqual([])
    expect(permissionsFor('super_admin', 'suspended')).toEqual([])
    expect(hasPermission('suspended_member', 'workspace.read')).toBe(false)
  })

  it('suspends access through the effective role', () => {
    expect(effectiveRole('owner', 'suspended')).toBe('suspended_member')
    expect(effectiveRole('super_admin', 'suspended')).toBe('suspended_member')
    expect(effectiveRole('content_manager', 'active')).toBe('content_manager')
  })

  it('keeps staff and self-signup role boundaries', () => {
    expect(isStaffRole('owner')).toBe(true)
    expect(isStaffRole('admin')).toBe(true)
    expect(isStaffRole('super_admin')).toBe(true)
    expect(isStaffRole('support_specialist')).toBe(true)
    expect(isStaffRole('premium_member')).toBe(false)
    expect(SELF_SIGNUP_ROLES).toEqual(['standard_member'])
    expect(ASSIGNABLE_ROLES).toContain('owner')
    expect(ASSIGNABLE_ROLES).toContain('admin')
  })

  it('enforces the role hierarchy for assignment and management', () => {
    expect(isOwnerRole('owner')).toBe(true)
    expect(isPrivilegedRole('admin')).toBe(true)
    expect(isPrivilegedRole('content_manager')).toBe(false)

    expect(canAssignRole('owner', 'owner')).toBe(true)
    expect(canAssignRole('owner', 'admin')).toBe(true)
    expect(canAssignRole('super_admin', 'owner')).toBe(false)
    expect(canAssignRole('super_admin', 'admin')).toBe(true)
    expect(canAssignRole('admin', 'super_admin')).toBe(false)
    expect(canAssignRole('admin', 'admin')).toBe(false)
    expect(canAssignRole('admin', 'content_manager')).toBe(true)
    expect(canAssignRole('content_manager', 'technical_editor')).toBe(false)

    expect(canManageRole('owner', 'owner')).toBe(true)
    expect(canManageRole('super_admin', 'owner')).toBe(false)
    expect(canManageRole('admin', 'owner')).toBe(false)
    expect(canManageRole('admin', 'super_admin')).toBe(false)
    expect(canManageRole('admin', 'content_manager')).toBe(true)
    expect(canManageRole('content_manager', 'standard_member')).toBe(false)
  })

  it('returns a filtered assignment list for each administrative role', () => {
    expect(assignableRolesFor('owner')).toEqual(ASSIGNABLE_ROLES)
    expect(assignableRolesFor('super_admin')).not.toContain('owner')
    expect(assignableRolesFor('admin')).not.toContain('owner')
    expect(assignableRolesFor('admin')).not.toContain('admin')
    expect(assignableRolesFor('admin')).not.toContain('super_admin')
    expect(assignableRolesFor('admin')).toContain('content_manager')
    expect(assignableRolesFor('standard_member')).toEqual([])
  })

  it('validates roles and rejects inherited object keys', () => {
    expect(isRole('owner')).toBe(true)
    expect(isRole('admin')).toBe(true)
    expect(isRole('content_manager')).toBe(true)
    expect(isRole('constructor')).toBe(false)
    expect(isRole('toString')).toBe(false)
    expect(isRole(null)).toBe(false)
  })

  it('defines a non-empty matrix for every assignable role', () => {
    for (const role of ASSIGNABLE_ROLES) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined()
    }
  })
})
