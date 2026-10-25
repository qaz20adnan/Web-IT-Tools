import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, Download, KeyRound, LogOut, ShieldCheck, Trash2, UserRound } from 'lucide-react'
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
  PasswordInput,
} from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { ApiError } from '@/services/api'
import { downloadTextFile } from '@/lib/utils'
import { isValidPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/authValidation'
import { formatDate } from '@/i18n'

function label(value: string): string {
  return value.replaceAll('_', ' ')
}

export function AccountPage() {
  const { t, settings } = useApp()
  const { account, config, updateProfile, changePassword, deleteAccount, exportData, refreshAccount, signOut } = useAuth()
  const { notify } = useToast()
  const navigate = useNavigate()
  const localMode = config?.localMode === true
  const passwordMinLength = config?.passwordMinLength ?? PASSWORD_MIN_LENGTH
  const passwordMaxLength = config?.passwordMaxLength ?? PASSWORD_MAX_LENGTH
  const [fullName, setFullName] = useState(account?.profile?.fullName ?? '')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [exportBusy, setExportBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    setFullName(account?.profile?.fullName ?? '')
  }, [account?.profile?.fullName])

  if (!account?.profile || !account.entitlements) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <Alert tone="warning" title={t('auth.notConfigured')}>
          {t('auth.notConfiguredBody')}
        </Alert>
      </div>
    )
  }

  const profile = account.profile
  const entitlements = account.entitlements
  const trial = account.trial
  const usagePercent = entitlements.dailyAiLimit > 0 ? Math.min(100, Math.round((account.usageToday / entitlements.dailyAiLimit) * 100)) : 0

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setProfileError(null)
    setProfileBusy(true)
    try {
      await updateProfile(fullName.trim())
      notify('success', t('common.saved'))
    } catch (caught) {
      setProfileError(caught instanceof ApiError ? caught.message : t('auth.genericError'))
    } finally {
      setProfileBusy(false)
    }
  }

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setPasswordError(null)
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError(t('auth.requiredFields'))
      return
    }
    if (localMode ? newPassword.length > passwordMaxLength : !isValidPassword(newPassword)) {
      setPasswordError(localMode ? t('auth.localPasswordTooLong') : t('auth.passwordHint'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('auth.passwordsMismatch'))
      return
    }
    setPasswordBusy(true)
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify('success', t('auth.passwordUpdated'))
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : t('auth.genericError'))
    } finally {
      setPasswordBusy(false)
    }
  }

  const doExport = async () => {
    setExportBusy(true)
    try {
      const data = await exportData()
      downloadTextFile(`nexora-account-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json')
      notify('success', t('auth.exportReady'))
    } catch (caught) {
      notify('error', caught instanceof ApiError ? caught.message : t('auth.genericError'))
    } finally {
      setExportBusy(false)
    }
  }

  const confirmDelete = async () => {
    setDeleteError(null)
    if (deleteConfirm !== 'DELETE') {
      setDeleteError(t('auth.deleteConfirm'))
      return
    }
    if (!deletePassword) {
      setDeleteError(t('auth.requiredFields'))
      return
    }
    setDeleteBusy(true)
    try {
      await deleteAccount(deletePassword)
      navigate('/', { replace: true })
    } catch (caught) {
      setDeleteError(caught instanceof ApiError ? caught.message : t('auth.genericError'))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="animate-in">
      <PageHeader
        title={t('auth.accountTitle')}
        subtitle={t('auth.accountSubtitle')}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="h-4 w-4" />}
              loading={exportBusy}
              onClick={doExport}
            >
              {t('auth.exportData')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<LogOut className="h-4 w-4" />}
              onClick={() => {
                void signOut().then(() => navigate('/', { replace: true }))
              }}
            >
              {t('auth.signOut')}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t('auth.profile')} icon={<UserRound className="h-4 w-4" />} />
            <CardBody>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
                <Badge tone={profile.emailVerified ? 'success' : 'warning'} icon={<ShieldCheck className="h-3.5 w-3.5" />}>
                  {profile.emailVerified ? t('auth.emailVerified') : t('auth.emailUnverified')}
                </Badge>
                <Badge>{label(profile.role)}</Badge>
                <Badge tone={profile.status === 'active' ? 'success' : 'danger'}>{label(profile.status)}</Badge>
              </div>
              <form className="space-y-4" onSubmit={saveProfile} noValidate>
                {profileError ? <Alert tone="danger">{profileError}</Alert> : null}
                <Field label={t('auth.email')} htmlFor="account-email">
                  <Input id="account-email" value={profile.email} readOnly disabled />
                </Field>
                <Field label={t('auth.fullName')} htmlFor="account-name">
                  <Input
                    id="account-name"
                    value={fullName}
                    maxLength={120}
                    onChange={(event) => setFullName(event.target.value)}
                    disabled={profileBusy}
                  />
                </Field>
                <Button type="submit" size="sm" loading={profileBusy}>
                  {t('common.save')}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('auth.security')} icon={<KeyRound className="h-4 w-4" />} />
            <CardBody>
              <form className="space-y-4" onSubmit={savePassword} noValidate>
                {passwordError ? <Alert tone="danger">{passwordError}</Alert> : null}
                <Field label={t('auth.currentPassword')} htmlFor="current-password" required>
                  <PasswordInput
                    id="current-password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    disabled={passwordBusy}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={t('auth.newPassword')}
                    htmlFor="new-password"
                    hint={localMode ? t('auth.localPasswordHint') : t('auth.passwordHint')}
                    required
                  >
                    <PasswordInput
                      id="new-password"
                      autoComplete="new-password"
                      minLength={localMode ? 1 : passwordMinLength}
                      maxLength={passwordMaxLength}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={passwordBusy}
                    />
                  </Field>
                  <Field label={t('auth.confirmPassword')} htmlFor="new-password-confirm" required>
                    <PasswordInput
                      id="new-password-confirm"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={passwordBusy}
                    />
                  </Field>
                </div>
                <Button type="submit" size="sm" loading={passwordBusy}>
                  {t('auth.changePassword')}
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('auth.deleteAccount')} icon={<Trash2 className="h-4 w-4 text-danger" />} />
            <CardBody>
              <Alert tone="danger">{t('auth.deleteWarning')}</Alert>
              <Button variant="danger" size="sm" className="mt-3" onClick={() => setDeleteOpen(true)}>
                {t('auth.deleteAccount')}
              </Button>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('auth.plan')} icon={<CalendarClock className="h-4 w-4" />} />
            <CardBody className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted">{t('auth.plan')}</span>
                <Badge tone={entitlements.plan === 'premium' ? 'success' : entitlements.plan === 'trial' ? 'primary' : 'default'}>
                  {label(entitlements.plan)}
                </Badge>
              </div>
              {trial ? (
                <div className="rounded-lg border border-line bg-surface-2 p-3">
                  <p className="text-xs font-semibold">{t('auth.trial')}</p>
                  <p className="mt-1 text-xs text-muted">
                    {trial.expired ? t('auth.trialExpired') : trial.endingSoon ? t('auth.trialEnding', { days: trial.daysRemaining }) : t('auth.trialActive', { days: trial.daysRemaining })}
                  </p>
                  <p className="mt-1 text-[11px] text-subtle">
                    {formatDate(trial.startedAt, settings.language)} → {formatDate(trial.endsAt, settings.language)}
                  </p>
                </div>
              ) : null}
              <div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">{t('auth.dailyUsage', { used: account.usageToday, limit: entitlements.dailyAiLimit })}</span>
                  <span className="text-subtle">{usagePercent}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usagePercent}%` }} />
                </div>
              </div>
              <p className="text-xs text-muted">{t('auth.workspaceLimit', { limit: entitlements.workspaceItemLimit })}</p>
              <Button variant="secondary" size="sm" className="w-full" onClick={() => notify('info', t('auth.upgradeSoon'))}>
                {t('auth.upgrade')}
              </Button>
              <p className="text-[11px] leading-relaxed text-subtle">{t('auth.serverKeyNote')}</p>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2 text-xs text-muted">
              <p>{t('auth.memberSince')}: {formatDate(profile.createdAt, settings.language)}</p>
              <p>{t('auth.protectedNote')}</p>
              <Button variant="ghost" size="sm" className="mt-1" onClick={() => void refreshAccount()}>
                {t('common.retry')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('auth.deleteAccount')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" loading={deleteBusy} onClick={confirmDelete}>
              {t('common.delete')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Alert tone="danger">{t('auth.deleteWarning')}</Alert>
          {deleteError ? <Alert tone="danger">{deleteError}</Alert> : null}
          <Field label={t('auth.password')} htmlFor="delete-password" required>
            <PasswordInput
              id="delete-password"
              autoComplete="current-password"
              value={deletePassword}
              onChange={(event) => setDeletePassword(event.target.value)}
              disabled={deleteBusy}
            />
          </Field>
          <Field label={t('auth.deleteConfirm')} htmlFor="delete-confirm" required>
            <Input
              id="delete-confirm"
              value={deleteConfirm}
              onChange={(event) => setDeleteConfirm(event.target.value)}
              placeholder="DELETE"
              disabled={deleteBusy}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}
