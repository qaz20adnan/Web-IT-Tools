import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database, Download, Languages, Monitor, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Alert, Button, Card, CardHeader, Field, Modal, PageHeader, Select, Switch } from '@/components/ui'
import { useApp } from '@/context/AppContext'
import { useLibrary } from '@/context/LibraryContext'
import { useProviders } from '@/context/ProvidersContext'
import { useToast } from '@/context/ToastContext'
import { THEMES } from '@/data/themes'
import { cn, downloadTextFile, formatBytes } from '@/lib/utils'
import { clearSessionKeys, localDataSize, STORAGE_KEYS } from '@/lib/storage'
import type { Density, FontScale, Language } from '@/types'

const EXPORT_KEYS = [STORAGE_KEYS.settings, STORAGE_KEYS.providers, STORAGE_KEYS.saved, STORAGE_KEYS.history, STORAGE_KEYS.scripts] as const

export function SettingsPage() {
  const { t, settings, updateSettings } = useApp()
  const { saved, history, localScripts, clearAll } = useLibrary()
  const { providers, clearKeys } = useProviders()
  const { notify } = useToast()
  const [confirmClear, setConfirmClear] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const usage = useMemo(() => localDataSize(), [saved, history, localScripts, providers, settings])

  const exportData = () => {
    const payload: Record<string, unknown> = { exportedAt: new Date().toISOString(), app: 'nexora-ai', version: 1 }
    for (const key of EXPORT_KEYS) {
      const raw = localStorage.getItem(key)
      if (raw) {
        try {
          payload[key] = JSON.parse(raw)
        } catch {
          /* skip malformed entries */
        }
      }
    }
    downloadTextFile('nexora-local-data.json', JSON.stringify(payload, null, 2), 'application/json')
    notify('success', t('settings.exportData'))
  }

  const importData = async (file: File) => {
    setImportError(null)
    try {
      const parsed = JSON.parse(await file.text()) as Record<string, unknown>
      let imported = 0
      for (const key of EXPORT_KEYS) {
        if (!(key in parsed)) continue
        const value = parsed[key]
        if (value === null || typeof value !== 'object') continue
        localStorage.setItem(key, JSON.stringify(value))
        imported += 1
      }
      if (imported === 0) throw new Error('empty')
      notify('success', t('settings.dataImported'))
      window.setTimeout(() => window.location.reload(), 600)
    } catch {
      setImportError(t('saved.importFailed'))
    }
  }

  const clearEverything = () => {
    clearAll()
    clearKeys()
    clearSessionKeys()
    for (const key of EXPORT_KEYS) localStorage.removeItem(key)
    setConfirmClear(false)
    notify('success', t('settings.clearAllDone'))
    window.setTimeout(() => window.location.reload(), 500)
  }

  return (
    <div className="animate-in">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('settings.appearance')} icon={<Monitor className="h-4 w-4" />} />
          <div className="space-y-5 p-5">
            <div>
              <p className="mb-2 text-xs font-semibold text-muted">{t('common.theme')}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    type="button"
                    onClick={() => updateSettings({ theme: theme.id })}
                    aria-pressed={settings.theme === theme.id}
                    className={cn(
                      'overflow-hidden rounded-lg border text-start transition-colors',
                      settings.theme === theme.id ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <span className="flex h-10 items-end gap-1 p-1.5" style={{ background: theme.swatch[0] }}>
                      <span className="h-4 flex-1 rounded-sm" style={{ background: theme.swatch[1] }} />
                      <span className="h-4 w-3 rounded-sm" style={{ background: theme.swatch[2] }} />
                    </span>
                    <span className="block px-2 py-1 text-[10px] font-medium">{t(theme.labelKey)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => updateSettings({ theme: 'auto' })}
                aria-pressed={settings.theme === 'auto'}
                className={cn(
                  'mt-2 w-full rounded-lg border px-3 py-2 text-start text-xs',
                  settings.theme === 'auto' ? 'border-primary bg-primary/10' : 'border-line hover:bg-surface-2',
                )}
              >
                {t('theme.auto')}
              </button>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Languages className="h-3.5 w-3.5" />
                {t('settings.language')}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'en', label: 'English', sub: 'LTR' },
                  { id: 'ar', label: 'العربية', sub: 'RTL' },
                ] as const).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => updateSettings({ language: option.id as Language })}
                    aria-pressed={settings.language === option.id}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-start text-xs',
                      settings.language === option.id ? 'border-primary bg-primary/10' : 'border-line hover:bg-surface-2',
                    )}
                  >
                    <span className="block font-semibold">{option.label}</span>
                    <span className="block text-[10px] text-subtle">{option.sub}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('settings.fontScale')} htmlFor="font-scale">
                <Select id="font-scale" value={settings.fontScale} onChange={(event) => updateSettings({ fontScale: event.target.value as FontScale })}>
                  {(['sm', 'md', 'lg', 'xl'] as FontScale[]).map((size) => (
                    <option key={size} value={size}>
                      {t(`settings.font.${size}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('settings.density')} htmlFor="density">
                <Select id="density" value={settings.density} onChange={(event) => updateSettings({ density: event.target.value as Density })}>
                  {(['compact', 'comfortable', 'spacious'] as Density[]).map((density) => (
                    <option key={density} value={density}>
                      {t(`settings.density.${density}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Switch
              checked={settings.reduceMotion}
              onChange={(value) => updateSettings({ reduceMotion: value })}
              label={t('settings.reduceMotion')}
              description={t('settings.reduceMotionHint')}
            />
            <Switch
              checked={settings.storeProviderKeysInSession}
              onChange={(value) => updateSettings({ storeProviderKeysInSession: value })}
              label={t('providers.keySessionToggle')}
              description={settings.storeProviderKeysInSession ? t('providers.keySession') : t('providers.keyMemoryOnly')}
            />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title={t('settings.aiConfig')} icon={<ShieldCheck className="h-4 w-4" />} />
            <div className="space-y-3 p-5 text-sm text-muted">
              <p>{t('settings.keysNote')}</p>
              <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
                <p>
                  <span className="font-semibold">{t('providers.title')}:</span> {providers.length} ·{' '}
                  <span className="font-semibold">{t('providers.default')}:</span>{' '}
                  {providers.find((provider) => provider.isDefault)?.model ?? t('common.notConfigured')}
                </p>
              </div>
              <Link to="/providers" className="btn btn-primary text-sm">
                {t('settings.goProviders')}
              </Link>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('settings.localData')} icon={<Database className="h-4 w-4" />} />
            <div className="space-y-3 p-5">
              <p className="text-xs text-muted">{t('settings.aboutLocalStorage')}</p>
              <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs">
                <p className="flex justify-between gap-2">
                  <span>{t('settings.storageUsage')}</span>
                  <span className="font-mono">{formatBytes(usage)}</span>
                </p>
                <p className="mt-1 flex justify-between gap-2 text-subtle">
                  <span>{t('nav.saved')}</span>
                  <span>{saved.length}</span>
                </p>
                <p className="flex justify-between gap-2 text-subtle">
                  <span>{t('nav.history')}</span>
                  <span>{history.length}</span>
                </p>
                <p className="flex justify-between gap-2 text-subtle">
                  <span>{t('saved.kind.script')}</span>
                  <span>{localScripts.length}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={exportData}>
                  {t('settings.exportData')}
                </Button>
                <Button variant="secondary" size="sm" icon={<Upload className="h-3.5 w-3.5" />} onClick={() => importRef.current?.click()}>
                  {t('settings.importData')}
                </Button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file) void importData(file)
                  }}
                />
                <Button variant="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => updateSettings({ onboardingComplete: false })}>
                  {t('settings.resetOnboarding')}
                </Button>
                <Button variant="danger" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setConfirmClear(true)}>
                  {t('settings.clearAll')}
                </Button>
              </div>
              {importError ? <p className="text-xs text-danger">{importError}</p> : null}
            </div>
          </Card>

          <Alert tone="info" title={t('settings.contentAdmin')}>
            {t('settings.contentAdminNote')}
          </Alert>
        </div>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('settings.clearAll')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={clearEverything} icon={<Trash2 className="h-3.5 w-3.5" />}>
              {t('settings.clearAll')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('settings.clearAllConfirm')}</p>
      </Modal>
    </div>
  )
}

export default SettingsPage
