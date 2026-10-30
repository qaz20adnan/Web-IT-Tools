import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { useToast } from '@/context/ToastContext'
import { cn } from '@/lib/utils'

export function Toaster() {
  const { t } = useApp()
  const { toasts, dismiss } = useToast()
  if (toasts.length === 0) return null

  const icons = {
    success: <CheckCircle2 className="h-4 w-4 text-success" />,
    error: <XCircle className="h-4 w-4 text-danger" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    info: <Info className="h-4 w-4 text-info" />,
  }
  const borders = {
    success: 'border-success/50',
    error: 'border-danger/50',
    warning: 'border-warning/50',
    info: 'border-info/50',
  }

  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn('pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface p-3 shadow-lg animate-pop', borders[toast.type])}
        >
          <div className="mt-0.5">{icons[toast.type]}</div>
          <div className="min-w-0 flex-1">
            {toast.title ? <p className="text-sm font-semibold">{toast.title}</p> : null}
            <p className="break-words text-xs text-muted">{toast.message}</p>
          </div>
          <button type="button" onClick={() => dismiss(toast.id)} aria-label={t('common.close')} className="rounded p-0.5 text-subtle transition-colors hover:text-text">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
