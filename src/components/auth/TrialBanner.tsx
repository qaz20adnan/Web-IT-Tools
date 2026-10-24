import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock3, X } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'

export function TrialBanner() {
  const { t } = useApp()
  const { account } = useAuth()
  const [hidden, setHidden] = useState(false)
  const trial = account?.trial
  if (!trial || trial.expired || hidden) return null

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-center gap-2 border-b px-3 py-1.5 text-[11px]',
        trial.endingSoon ? 'border-warning/30 bg-warning/10 text-warning' : 'border-primary/20 bg-primary/10 text-primary',
      )}
      role="status"
    >
      <Clock3 className="h-3.5 w-3.5" aria-hidden />
      <span className="font-medium">
        {trial.endingSoon ? t('auth.trialEnding', { days: trial.daysRemaining }) : t('auth.trialActive', { days: trial.daysRemaining })}
      </span>
      <Link to="/account" className="font-semibold underline underline-offset-2">
        {t('auth.upgrade')}
      </Link>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="ms-1 rounded p-0.5 hover:bg-black/10"
        aria-label={t('common.close')}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
