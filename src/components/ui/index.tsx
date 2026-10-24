import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react'
import { cn, copyToClipboard } from '@/lib/utils'
import { useToast } from '@/context/ToastContext'

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon'

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1.5 rounded-md',
  md: 'text-sm',
  lg: 'text-base px-5 py-2.5',
  icon: 'h-9 w-9 p-0 rounded-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
}

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cn(
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'secondary' && 'btn-secondary',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    buttonSizes[size],
    extra,
  )
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

/* -------------------------------- Card -------------------------------- */

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <div className="mt-0.5 text-primary">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('p-5', className)}>{children}</div>
}

/* ------------------------------- Badge -------------------------------- */

export function Badge({
  children,
  tone = 'default',
  className,
  icon,
}: {
  children: ReactNode
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'accent'
  className?: string
  icon?: ReactNode
}) {
  return (
    <span className={cn('badge', tone !== 'default' && `badge-${tone}`, className)}>
      {icon}
      {children}
    </span>
  )
}

export function StatusDot({ tone = 'success', label }: { tone?: 'success' | 'warning' | 'danger' | 'muted'; label?: string }) {
  const colors: Record<string, string> = {
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    muted: 'bg-subtle',
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={cn('h-2 w-2 rounded-full', colors[tone])} aria-hidden />
      {label}
    </span>
  )
}

export function RiskBadge({ risk }: { risk: 'none' | 'low' | 'medium' | 'high' | 'critical' }) {
  const map = {
    none: { tone: 'default' as const, label: '—' },
    low: { tone: 'success' as const, label: 'Low' },
    medium: { tone: 'warning' as const, label: 'Medium' },
    high: { tone: 'danger' as const, label: 'High' },
    critical: { tone: 'danger' as const, label: 'Critical' },
  }
  const entry = map[risk]
  return <Badge tone={entry.tone}>{entry.label}</Badge>
}

/* ------------------------------- Inputs ------------------------------- */

export interface FieldProps {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactNode
  className?: string
}

export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-semibold text-muted">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('input-base', className)} {...rest} />
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('input-base min-h-24 resize-y', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('input-base cursor-pointer', className)} {...rest}>
      {children}
    </select>
  )
}

export function Checkbox({
  label,
  description,
  className,
  ...rest
}: { label: ReactNode; description?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <input
        id={rest.id ?? id}
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-[var(--primary)]"
        {...rest}
      />
      <label htmlFor={rest.id ?? id} className="cursor-pointer text-sm">
        <span className="font-medium">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-subtle">{description}</span> : null}
      </label>
    </div>
  )
}

export function Switch({ checked, onChange, label, description, id }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; id?: string }) {
  const generated = useId()
  const switchId = id ?? generated
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={switchId} className="cursor-pointer text-sm font-medium">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs text-subtle">{description}</p> : null}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
          checked ? 'border-primary bg-primary' : 'border-line-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all',
            checked ? 'start-[1.35rem]' : 'start-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  )
}

export function PasswordInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input type={visible ? 'text' : 'password'} className={cn('input-base pe-10', className)} {...rest} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute end-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-text"
        aria-label={visible ? 'Hide value' : 'Show value'}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}

/* -------------------------------- Alert ------------------------------- */

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger'
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const icons = {
    info: <Info className="h-4 w-4 text-info" />,
    success: <CheckCircle2 className="h-4 w-4 text-success" />,
    warning: <AlertTriangle className="h-4 w-4 text-warning" />,
    danger: <XCircle className="h-4 w-4 text-danger" />,
  }
  const borders = {
    info: 'border-info/40',
    success: 'border-success/40',
    warning: 'border-warning/40',
    danger: 'border-danger/40',
  }
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('rounded-lg border bg-surface-2 p-3.5 text-sm', borders[tone], className)}>
      <div className="flex gap-2.5">
        <div className="mt-0.5 shrink-0">{icons[tone]}</div>
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          {children ? <div className={cn('text-xs text-muted', title && 'mt-1')}>{children}</div> : null}
        </div>
      </div>
    </div>
  )
}

/* ----------------------------- Empty/Error ---------------------------- */

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center', className)}>
      {icon ? <div className="mb-3 text-subtle">{icon}</div> : null}
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-md text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ title, description, onRetry, retryLabel = 'Retry' }: { title: string; description?: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-danger/40 bg-danger/5 px-6 py-8 text-center">
      <ShieldAlert className="mb-2 h-6 w-6 text-danger" />
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-lg text-xs text-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-3" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-xs text-muted', className)} role="status">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      {label}
    </span>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface-3', className)} aria-hidden />
}

/* -------------------------------- Modal ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      window.clearTimeout(timer)
    }
  }, [open, onClose])

  if (!open) return null

  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm animate-fade" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn('card w-full animate-in', widths[size])}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

/* --------------------------------- Tabs -------------------------------- */

interface TabsContextValue {
  value: string
  onChange: (value: string) => void
}
const TabsContext = createContext<TabsContextValue | null>(null)

export function Tabs({ value, onChange, children, className }: { value: string; onChange: (value: string) => void; children: ReactNode; className?: string }) {
  return (
    <TabsContext.Provider value={{ value, onChange }}>
      <div className={cn('flex gap-1 overflow-x-auto border-b border-line no-scrollbar', className)} role="tablist">
        {children}
      </div>
    </TabsContext.Provider>
  )
}

export function Tab({ id, children, icon }: { id: string; children: ReactNode; icon?: ReactNode }) {
  const ctx = useContext(TabsContext)
  if (!ctx) return null
  const selected = ctx.value === id
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => ctx.onChange(id)}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        selected ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

/* ------------------------------ PageHeader ----------------------------- */

export function PageHeader({ title, subtitle, actions, badge }: { title: string; subtitle?: string; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {subtitle ? <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function SectionTitle({ title, actions, description }: { title: string; actions?: ReactNode; description?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="text-xs text-subtle">{description}</p> : null}
      </div>
      {actions}
    </div>
  )
}

/* ------------------------------- Copy ---------------------------------- */

export function CopyButton({ value, label, size = 'sm', variant = 'secondary', className }: { value: string; label?: string; size?: ButtonSize; variant?: ButtonVariant; className?: string }) {
  const { notify } = useToast()
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      icon={copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      onClick={async () => {
        try {
          await copyToClipboard(value)
          setCopied(true)
          notify('success', 'Copied to clipboard')
          window.setTimeout(() => setCopied(false), 1600)
        } catch {
          notify('error', 'Copy failed')
        }
      }}
    >
      {label}
    </Button>
  )
}

export function CodeBlock({ code, language, title, maxHeight = '26rem' }: { code: string; language?: string; title?: string; maxHeight?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-[var(--code-bg)]">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{title ?? language ?? 'code'}</span>
        <CopyButton value={code} size="sm" variant="ghost" />
      </div>
      <pre className="force-ltr overflow-auto p-3 text-xs leading-relaxed" style={{ maxHeight }} dir="ltr">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/* ------------------------------ Accordion ------------------------------ */

export function Accordion({ items }: { items: Array<{ id: string; title: ReactNode; content: ReactNode; defaultOpen?: boolean }> }) {
  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {items.map((item) => (
        <details key={item.id} open={item.defaultOpen} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium hover:bg-surface-2">
            {item.title}
            <span className="text-subtle transition-transform group-open:rotate-180" aria-hidden>
              ▾
            </span>
          </summary>
          <div className="px-4 pb-4 text-sm text-muted">{item.content}</div>
        </details>
      ))}
    </div>
  )
}

export function Stat({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: 'primary' | 'accent' | 'success' | 'warning' }) {
  const tones: Record<string, string> = {
    primary: 'text-primary',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
  }
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {icon ? <span className={cn(tone ? tones[tone] : 'text-subtle')}>{icon}</span> : null}
      </div>
      <p className="stat-value mt-1.5">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-subtle">{hint}</p> : null}
    </div>
  )
}

export function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded border border-line bg-[var(--code-bg)] px-1 py-0.5 text-[0.85em]" dir="ltr">{children}</code>
}
