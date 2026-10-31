import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  ClipboardList,
  HeartPulse,
  MessageSquareWarning,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { useHealth } from '@/hooks/useHealth'
import { adminRequest } from '@/services/api'
import { describeError } from '@/services/apiError'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/i18n'
import type { AccountRole, Permission } from '@/types'

type Tab = 'overview' | 'monitoring' | 'users' | 'audit' | 'feedback' | 'settings'

interface AdminUser {
  id: string
  email: string
  full_name: string | null
  role: AccountRole
  status: 'active' | 'suspended' | 'pending'
  created_at: string
  last_sign_in_at: string | null
  manageable?: boolean
}

interface AuditRow {
  id: string
  actor_email?: string | null
  action: string
  target_type: string
  target_id?: string | null
  outcome: string
  created_at: string
}

interface FeedbackRow {
  id: string
  content_type: string
  content_id: string
  reason: string
  message: string
  created_at: string
}

interface Overview {
  ok: true
  users: number
  staff: number
  suspended: number
  openFeedback: number
  auditTotal: number
  planCounts: Record<string, number>
  usageSeries: Array<{ date: string; requests: number }>
  recentAudit: AuditRow[]
}

const ROLES: AccountRole[] = [
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

const PAGE_SIZE = 25

function label(value: string): string {
  return value.replaceAll('_', ' ')
}

export function AdminPage() {
  const { t, settings } = useApp()
  const { account, hasPermission } = useAuth()
  const { notify } = useToast()
  const { data: health, loading: healthLoading, error: healthError, refresh: refreshHealth } = useHealth()
  const [tab, setTab] = useState<Tab>('overview')
  const [overview, setOverview] = useState<Overview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [assignableRoles, setAssignableRoles] = useState<AccountRole[]>(ROLES)
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [feedback, setFeedback] = useState<FeedbackRow[]>([])
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [planUser, setPlanUser] = useState<AdminUser | null>(null)
  const [planId, setPlanId] = useState<'premium' | 'standard'>('premium')
  const [periodEnd, setPeriodEnd] = useState('')
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)

  const [trialDays, setTrialDays] = useState(30)
  const [signupsEnabled, setSignupsEnabled] = useState(true)
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [settingsBusy, setSettingsBusy] = useState(false)

  const can = useCallback((permission: Permission) => hasPermission(permission), [hasPermission])
  const tabs = useMemo(
    () =>
      [
        { id: 'overview' as const, label: t('admin.overview'), icon: Activity, show: can('reports.read') },
        { id: 'monitoring' as const, label: t('admin.monitoring'), icon: HeartPulse, show: can('reports.read') },
        { id: 'users' as const, label: t('admin.users'), icon: Users, show: can('users.read') },
        { id: 'audit' as const, label: t('admin.audit'), icon: ClipboardList, show: can('audit_logs.read') },
        { id: 'feedback' as const, label: t('admin.feedback'), icon: MessageSquareWarning, show: can('content.read') },
        { id: 'settings' as const, label: t('admin.settings'), icon: Settings2, show: can('settings.manage') },
      ].filter((entry) => entry.show),
    [t, can],
  )

  const loadOverview = useCallback(async () => {
    const response = await adminRequest<Overview>({ action: 'overview' })
    setOverview(response)
  }, [])

  const loadUsers = useCallback(async () => {
    const response = await adminRequest<{ ok: true; items: AdminUser[]; total: number; assignableRoles?: AccountRole[] }>({
      action: 'users.list',
      q: query.trim() || undefined,
      role: roleFilter || undefined,
      status: statusFilter || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    })
    setUsers(response.items)
    setTotalUsers(response.total)
    if (response.assignableRoles?.length) setAssignableRoles(response.assignableRoles)
  }, [query, roleFilter, statusFilter, page])

  const loadAudit = useCallback(async () => {
    const response = await adminRequest<{ ok: true; items: AuditRow[] }>({ action: 'audit.list', limit: 100 })
    setAudit(response.items)
  }, [])

  const loadFeedback = useCallback(async () => {
    const response = await adminRequest<{ ok: true; items: FeedbackRow[] }>({ action: 'feedback.list' })
    setFeedback(response.items)
  }, [])

  const loadSettings = useCallback(async () => {
    const response = await adminRequest<{ ok: true; items: Array<{ key: string; value: unknown }>; trialDays: number }>({ action: 'settings.get' })
    setTrialDays(response.trialDays)
    const byKey = new Map(response.items.map((item) => [item.key, item.value]))
    setSignupsEnabled(byKey.get('signups_enabled') !== false)
    setMaintenanceMode(byKey.get('maintenance_mode') === true)
    const nextAnnouncement = byKey.get('announcement')
    setAnnouncement(typeof nextAnnouncement === 'string' ? nextAnnouncement : '')
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      if (tab === 'overview') await loadOverview()
      else if (tab === 'monitoring') {
        refreshHealth()
        await loadOverview()
      }
      else if (tab === 'users') await loadUsers()
      else if (tab === 'audit') await loadAudit()
      else if (tab === 'feedback') await loadFeedback()
      else if (tab === 'settings') await loadSettings()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setLoading(false)
    }
  }, [tab, loadOverview, loadUsers, loadAudit, loadFeedback, loadSettings, refreshHealth, t, settings.language])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const updateUser = async (user: AdminUser, patch: { role?: AccountRole; status?: 'active' | 'suspended' }) => {
    const confirmed = window.confirm(
      patch.role
        ? t('admin.confirmRoleChange')
        : patch.status === 'suspended'
          ? t('admin.confirmSuspend')
          : t('admin.confirmActivate'),
    )
    if (!confirmed) return
    setError(null)
    try {
      await adminRequest({ action: 'users.update', userId: user.id, ...patch })
      notify('success', t('admin.userUpdated'))
      await loadUsers()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    }
  }

  const deleteUser = async (user: AdminUser) => {
    if (!window.confirm(t('admin.confirmDeleteUser'))) return
    try {
      await adminRequest({ action: 'users.delete', userId: user.id })
      notify('success', t('workspace.deleted'))
      await loadUsers()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    }
  }

  const applyPlan = async (event: FormEvent) => {
    event.preventDefault()
    if (!planUser) return
    setPlanError(null)
    setPlanBusy(true)
    try {
      const iso = periodEnd ? new Date(periodEnd).toISOString() : null
      await adminRequest({ action: 'subscriptions.set', userId: planUser.id, planId, periodEnd: iso })
      setPlanUser(null)
      setPeriodEnd('')
      notify('success', t('admin.planUpdated'))
      await loadUsers()
    } catch (caught) {
      setPlanError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setPlanBusy(false)
    }
  }

  const resolveFeedback = async (id: string) => {
    try {
      await adminRequest({ action: 'feedback.resolve', id })
      await loadFeedback()
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    }
  }

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault()
    setSettingsBusy(true)
    try {
      await adminRequest({
        action: 'settings.update',
        trialDays,
        signupsEnabled,
        maintenanceMode,
        announcement,
      })
      notify('success', t('admin.settingsSaved'))
    } catch (caught) {
      setError(describeError(caught, settings.language, t('auth.genericError')))
    } finally {
      setSettingsBusy(false)
    }
  }

  if (!account || tabs.length === 0) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <Alert tone="warning" title={t('admin.noPermission')} />
      </div>
    )
  }

  const maxUsage = Math.max(1, ...(overview?.usageSeries.map((entry) => entry.requests) ?? [0]))
  const monitoringServices = health
    ? [
        { id: 'ai', label: t('admin.ai'), configured: health.services.ai.configured, detail: [health.services.ai.provider, health.services.ai.model].filter(Boolean).join(' · ') },
        { id: 'vision', label: t('admin.vision'), configured: health.services.vision.configured, detail: '' },
        { id: 'research', label: t('admin.research'), configured: health.services.research.configured, detail: health.services.research.providers.join(', ') },
        { id: 'news', label: t('admin.news'), configured: health.services.news.configured, detail: health.services.news.customFeeds ? t('admin.customFeeds') : '' },
        { id: 'database', label: t('admin.database'), configured: health.services.database.configured, detail: '' },
        { id: 'contentAdmin', label: t('admin.contentAdmin'), configured: health.services.contentAdmin.configured, detail: '' },
      ]
    : []

  return (
    <div className="animate-in">
      <PageHeader
        title={t('admin.title')}
        subtitle={t('admin.subtitle')}
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />} onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label={t('admin.title')}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === entry.id ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:border-line-strong hover:text-text',
            )}
          >
            <entry.icon className="h-3.5 w-3.5" />
            {entry.label}
          </button>
        ))}
      </div>

      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {[
              [t('admin.totalUsers'), overview?.users ?? 0],
              [t('admin.staff'), overview?.staff ?? 0],
              [t('admin.suspended'), overview?.suspended ?? 0],
              [t('admin.openFeedback'), overview?.openFeedback ?? 0],
              [t('admin.auditEvents'), overview?.auditTotal ?? 0],
            ].map(([labelText, value]) => (
              <Card key={String(labelText)}>
                <CardBody>
                  <p className="text-[11px] uppercase tracking-wide text-subtle">{labelText}</p>
                  <p className="mt-1 text-2xl font-bold">{value}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('admin.planCounts')} />
              <CardBody className="space-y-2">
                {Object.entries(overview?.planCounts ?? {}).map(([plan, count]) => (
                  <div key={plan} className="flex items-center justify-between text-sm">
                    <span className="capitalize text-muted">{plan}</span>
                    <Badge tone={plan === 'premium' ? 'success' : plan === 'trial' ? 'primary' : 'default'}>{count}</Badge>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title={t('admin.usage7d')} />
              <CardBody>
                <div className="flex h-32 items-end gap-2">
                  {(overview?.usageSeries ?? []).map((entry) => (
                    <div key={entry.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t bg-primary/70"
                        style={{ height: `${Math.max(4, Math.round((entry.requests / maxUsage) * 100))}%` }}
                        title={`${entry.date}: ${entry.requests}`}
                      />
                      <span className="truncate text-[9px] text-subtle">{entry.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t('admin.auditLog')} />
            <CardBody className="space-y-2">
              {(overview?.recentAudit ?? []).length === 0 ? <p className="text-xs text-subtle">{t('admin.noAudit')}</p> : null}
              {(overview?.recentAudit ?? []).map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-xs last:border-0 last:pb-0">
                  <span className="font-mono text-[11px]">{entry.action}</span>
                  <span className="text-subtle">{entry.actor_email ?? '—'} · {formatDateTime(entry.created_at, settings.language)}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'monitoring' ? (
        <div className="space-y-4">
          <Alert tone="info" title={t('admin.monitoringHint')}>{t('admin.monitoringNote')}</Alert>
          {healthError ? <Alert tone="danger" title={t('admin.healthError')}>{t('admin.healthRetry')}</Alert> : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {monitoringServices.map((service) => (
              <Card key={service.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-medium text-muted">{service.label}</p>
                    <Badge tone={service.configured ? 'success' : 'warning'}>
                      {service.configured ? t('admin.configured') : t('admin.notConfigured')}
                    </Badge>
                  </div>
                  {service.detail ? <p className="mt-2 break-words text-[11px] text-subtle" dir="ltr">{service.detail}</p> : null}
                </CardBody>
              </Card>
            ))}
            {healthLoading && !health ? (
              <Card><CardBody><p className="text-xs text-subtle">{t('common.loading')}</p></CardBody></Card>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('admin.platformStatus')} icon={<HeartPulse className="h-4 w-4" />} />
              <CardBody className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">{t('admin.healthResult')}</span>
                  <Badge tone={health?.ok ? 'success' : healthError ? 'danger' : 'warning'}>
                    {healthLoading ? t('common.loading') : health?.ok ? t('admin.healthy') : t('admin.unhealthy')}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">{t('admin.version')}</span>
                  <span className="font-mono text-xs">{health?.version ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">{t('admin.lastChecked')}</span>
                  <span className="text-xs">{health?.time ? formatDateTime(health.time, settings.language) : '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                  <span className="text-muted">{t('admin.totalUsers')}</span>
                  <span className="font-mono text-xs">{overview?.users ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">{t('admin.staff')}</span>
                  <span className="font-mono text-xs">{overview?.staff ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">{t('admin.suspended')}</span>
                  <span className="font-mono text-xs">{overview?.suspended ?? '—'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted">{t('admin.openFeedback')}</span>
                  <span className="font-mono text-xs">{overview?.openFeedback ?? '—'}</span>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t('admin.recentAudit')} icon={<ClipboardList className="h-4 w-4" />} />
              <CardBody className="space-y-2">
                {(overview?.recentAudit ?? []).length === 0 ? <p className="text-xs text-subtle">{t('admin.noAudit')}</p> : null}
                {(overview?.recentAudit ?? []).slice(0, 6).map((entry) => (
                  <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-xs last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-mono text-[11px]">{entry.action}</p>
                      <p className="truncate text-[10px] text-subtle">{entry.actor_email ?? '—'} · {entry.outcome}</p>
                    </div>
                    <span className="text-[10px] text-subtle">{formatDateTime(entry.created_at, settings.language)}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title={t('admin.planCounts')} />
            <CardBody className="flex flex-wrap gap-2">
              {Object.entries(overview?.planCounts ?? {}).map(([plan, count]) => (
                <Badge key={plan} tone={plan === 'premium' ? 'success' : plan === 'trial' ? 'primary' : 'default'}>
                  {plan}: {count}
                </Badge>
              ))}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'users' ? (
        <Card>
          <CardHeader title={`${t('admin.users')} (${totalUsers})`} />
          <CardBody className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_180px_160px]">
              <Input
                placeholder={t('admin.searchUsers')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(0)
                }}
              />
              <Select
                value={roleFilter}
                onChange={(event) => {
                  setRoleFilter(event.target.value)
                  setPage(0)
                }}
              >
                <option value="">{t('admin.allRoles')}</option>
                {ROLES.map((role) => <option key={role} value={role}>{label(role)}</option>)}
              </Select>
              <Select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value)
                  setPage(0)
                }}
              >
                <option value="">{t('admin.allStatuses')}</option>
                <option value="active">active</option>
                <option value="suspended">suspended</option>
                <option value="pending">pending</option>
              </Select>
            </div>
            <div className="space-y-2">
              {users.map((user) => {
                const self = user.id === account.profile?.id
                const manageable = user.manageable !== false && !self
                const roleOptions = assignableRoles.includes(user.role)
                  ? assignableRoles
                  : [user.role, ...assignableRoles]
                return (
                  <div key={user.id} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{user.full_name || user.email}</p>
                        <p className="truncate text-xs text-subtle">{user.email}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge tone={user.status === 'active' ? 'success' : user.status === 'suspended' ? 'danger' : 'warning'}>{user.status}</Badge>
                          <Badge>{label(user.role)}</Badge>
                        </div>
                        <p className="mt-1.5 text-[11px] text-subtle">
                          {t('admin.created')}: {user.created_at ? formatDateTime(user.created_at, settings.language) : '—'}
                          {' · '}
                          {t('admin.lastLogin')}: {user.last_sign_in_at ? formatDateTime(user.last_sign_in_at, settings.language) : '—'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {can('roles.assign') ? (
                          <Select
                            aria-label={t('admin.role')}
                            value={user.role}
                            disabled={!manageable}
                            onChange={(event) => void updateUser(user, { role: event.target.value as AccountRole })}
                            className="h-8 w-40 text-xs"
                          >
                            {roleOptions.map((role) => <option key={role} value={role}>{label(role)}</option>)}
                          </Select>
                        ) : null}
                        {can('users.suspend') ? (
                          <Button
                            size="sm"
                            variant={user.status === 'suspended' ? 'secondary' : 'danger'}
                            disabled={!manageable}
                            onClick={() => void updateUser(user, { status: user.status === 'suspended' ? 'active' : 'suspended' })}
                          >
                            {user.status === 'suspended' ? t('admin.activate') : t('admin.suspend')}
                          </Button>
                        ) : null}
                        {can('subscriptions.manage') ? (
                          <Button size="sm" variant="secondary" onClick={() => { setPlanUser(user); setPlanId('premium'); setPlanError(null); setPeriodEnd('') }}>
                            {t('admin.setPlan')}
                          </Button>
                        ) : null}
                        {can('users.delete') ? (
                          <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} disabled={!manageable} onClick={() => void deleteUser(user)} aria-label={t('admin.deleteUser')} />
                        ) : null}
                      </div>
                    </div>
                    {self ? <p className="mt-2 text-[11px] text-warning">{t('admin.selfProtected')}</p> : null}
                  </div>
                )
              })}
              {!loading && users.length === 0 ? <p className="text-xs text-subtle">{t('common.noResults')}</p> : null}
            </div>
            {totalUsers > PAGE_SIZE ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
                <span>
                  {t('admin.page')} {page + 1} / {Math.max(1, Math.ceil(totalUsers / PAGE_SIZE))}
                </span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                    {t('admin.previous')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={(page + 1) * PAGE_SIZE >= totalUsers}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t('admin.next')}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'audit' ? (
        <Card>
          <CardHeader title={t('admin.auditLog')} />
          <CardBody className="space-y-2">
            {audit.length === 0 ? <p className="text-xs text-subtle">{t('admin.noAudit')}</p> : null}
            {audit.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-line p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono font-semibold">{entry.action}</span>
                  <Badge tone={entry.outcome === 'success' ? 'success' : 'danger'}>{entry.outcome}</Badge>
                </div>
                <p className="mt-1 text-subtle">
                  {entry.actor_email ?? '—'} · {entry.target_type} {entry.target_id ?? ''} · {formatDateTime(entry.created_at, settings.language)}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'feedback' ? (
        <Card>
          <CardHeader title={t('admin.feedback')} />
          <CardBody className="space-y-2">
            {feedback.length === 0 ? <p className="text-xs text-subtle">{t('admin.feedbackEmpty')}</p> : null}
            {feedback.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{entry.reason} · {entry.content_type}</p>
                  <Button size="sm" variant="secondary" onClick={() => void resolveFeedback(entry.id)}>{t('admin.resolve')}</Button>
                </div>
                <p className="mt-1 text-xs text-muted">{entry.message || entry.content_id}</p>
                <p className="mt-1 text-[11px] text-subtle">{formatDateTime(entry.created_at, settings.language)}</p>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'settings' ? (
        <Card>
          <CardHeader title={t('admin.settings')} icon={<ShieldCheck className="h-4 w-4" />} />
          <CardBody>
            <form className="max-w-xl space-y-4" onSubmit={saveSettings}>
              <Field label={t('admin.trialDays')} htmlFor="trial-days">
                <Input id="trial-days" type="number" min={1} max={365} value={trialDays} onChange={(event) => setTrialDays(Number(event.target.value))} />
              </Field>
              <Switch checked={signupsEnabled} onChange={setSignupsEnabled} label={t('admin.signupsEnabled')} />
              <Switch checked={maintenanceMode} onChange={setMaintenanceMode} label={t('admin.maintenanceMode')} />
              <Field label={t('admin.announcement')} htmlFor="announcement">
                <Textarea id="announcement" maxLength={500} value={announcement} onChange={(event) => setAnnouncement(event.target.value)} />
              </Field>
              <Alert tone="info">{t('admin.manualBilling')}</Alert>
              <Button type="submit" size="sm" loading={settingsBusy}>{t('common.save')}</Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        open={Boolean(planUser)}
        onClose={() => setPlanUser(null)}
        title={t('admin.setPlan')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPlanUser(null)}>{t('common.cancel')}</Button>
            <Button type="submit" form="plan-form" size="sm" loading={planBusy}>{t('admin.savePlan')}</Button>
          </div>
        }
      >
        <form id="plan-form" className="space-y-4" onSubmit={applyPlan}>
          {planError ? <Alert tone="danger">{planError}</Alert> : null}
          <p className="text-xs text-muted">{planUser?.email}</p>
          <Field label={t('admin.plan')} htmlFor="plan-id">
            <Select id="plan-id" value={planId} onChange={(event) => setPlanId(event.target.value as 'premium' | 'standard')}>
              <option value="premium">premium</option>
              <option value="standard">standard</option>
            </Select>
          </Field>
          <Field label={t('admin.periodEnd')} htmlFor="plan-period">
            <Input id="plan-period" type="datetime-local" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </Field>
          <Alert tone="warning">{t('admin.manualBilling')}</Alert>
        </form>
      </Modal>
    </div>
  )
}
