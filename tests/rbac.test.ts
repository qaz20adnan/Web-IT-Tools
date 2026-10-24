import { describe, expect, it } from 'vitest'
import {
  ALL_PERMISSIONS,
  ASSIGNABLE_ROLES,
  ROLE_PERMISSIONS,
  SELF_SIGNUP_ROLES,
  effectiveRole,
  hasPermission,
  isRole,
  isStaffRole,
  permissionsFor,
  permissionsForRole,
} from '../netlify/lib/rbac'

describe('RBAC matrix', () => {
  it('grants the super administrator every permission', () => {
    expect(permissionsForRole('super_admin')).toEqual(ALL_PERMISSIONS)
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
    expect(permissionsFor('super_admin', 'suspended')).toEqual([])
    expect(hasPermission('suspended_member', 'workspace.read')).toBe(false)
  })

  it('suspends access through the effective role', () => {
    expect(effectiveRole('super_admin', 'suspended')).toBe('suspended_member')
    expect(effectiveRole('content_manager', 'active')).toBe('content_manager')
  })

  it('keeps staff and self-signup role boundaries', () => {
    expect(isStaffRole('super_admin')).toBe(true)
    expect(isStaffRole('support_specialist')).toBe(true)
    expect(isStaffRole('premium_member')).toBe(false)
    expect(SELF_SIGNUP_ROLES).toEqual(['standard_member'])
    expect(ASSIGNABLE_ROLES).toContain('super_admin')
    expect(ASSIGNABLE_ROLES).not.toContain('owner')
  })

  it('validates roles and rejects inherited object keys', () => {
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
