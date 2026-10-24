import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Languages, Palette, Plug, Sparkles } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { THEMES } from '@/data/themes'
import { cn } from '@/lib/utils'
import { Button, Modal } from '@/components/ui'

export function OnboardingWizard() {
  const { t, settings, updateSettings, completeOnboarding, setLanguage, setTheme } = useApp()
  const [step, setStep] = useState(0)
  const total = 3

  const finish = () => completeOnboarding()

  return (
    <Modal
      open={!settings.onboardingComplete}
      onClose={finish}
      title={t('onboarding.welcome')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={finish}>
            {t('onboarding.skip')}
          </Button>
          {step > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => setStep((current) => current - 1)}>
              {t('common.back')}
            </Button>
          ) : null}
          {step < total - 1 ? (
            <Button size="sm" onClick={() => setStep((current) => current + 1)} icon={<ArrowRight className="h-4 w-4" />}>
              {t('common.continue')}
            </Button>
          ) : (
            <Button size="sm" onClick={finish} icon={<Check className="h-4 w-4" />}>
              {t('onboarding.start')}
            </Button>
          )}
        </>
      }
    >
      <p className="mb-1 text-xs text-subtle">{t('onboarding.step', { current: step + 1, total })}</p>
      <p className="mb-5 text-sm text-muted">{t('onboarding.subtitle')}</p>

      {step === 0 ? (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Languages className="h-4 w-4 text-primary" />
            {t('onboarding.languageTitle')}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {([
              { id: 'en', label: 'English', sub: 'LTR' },
              { id: 'ar', label: 'العربية', sub: 'RTL' },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLanguage(option.id)}
                className={cn(
                  'flex items-center justify-between rounded-lg border p-4 text-start transition-colors',
                  settings.language === option.id ? 'border-primary bg-primary/10' : 'border-line hover:bg-surface-2',
                )}
                aria-pressed={settings.language === option.id}
              >
                <span>
                  <span className="block text-sm font-semibold">{option.label}</span>
                  <span className="block text-xs text-subtle">{option.sub}</span>
                </span>
                {settings.language === option.id ? <Check className="h-4 w-4 text-primary" /> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Palette className="h-4 w-4 text-primary" />
            {t('onboarding.themeTitle')}
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => setTheme(theme.id)}
                className={cn(
                  'overflow-hidden rounded-lg border text-start transition-colors',
                  settings.theme === theme.id ? 'border-primary ring-2 ring-primary/30' : 'border-line hover:border-line-strong',
                )}
                aria-pressed={settings.theme === theme.id}
              >
                <span className="flex h-14 items-end gap-1 p-2" style={{ background: theme.swatch[0] }}>
                  <span className="h-6 flex-1 rounded-sm" style={{ background: theme.swatch[1] }} />
                  <span className="h-6 w-4 rounded-sm" style={{ background: theme.swatch[2] }} />
                </span>
                <span className="block px-2 py-1.5 text-[11px] font-medium">{t(theme.labelKey)}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => updateSettings({ theme: 'auto' })}
            className={cn(
              'mt-2 w-full rounded-lg border px-3 py-2 text-start text-xs',
              settings.theme === 'auto' ? 'border-primary bg-primary/10' : 'border-line hover:bg-surface-2',
            )}
            aria-pressed={settings.theme === 'auto'}
          >
            {t('theme.auto')}
          </button>
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Plug className="h-4 w-4 text-primary" />
            {t('onboarding.aiTitle')}
          </h3>
          <div className="rounded-lg border border-line bg-surface-2 p-4 text-sm text-muted">
            <Sparkles className="mb-2 h-5 w-5 text-accent" />
            <p>{t('onboarding.aiBody')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/providers" onClick={finish} className="btn btn-primary text-sm">
                {t('onboarding.configureNow')}
              </Link>
              <button type="button" onClick={finish} className="btn btn-secondary text-sm">
                {t('onboarding.configureLater')}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </Modal>
  )
}
