import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function BrandMark({ size = 34, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center rounded-xl border border-primary/25 bg-[#081a29] shadow-[0_0_24px_-8px_rgba(53,214,242,0.55)]',
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <img src="/icons/nexora-logo.svg" alt="" className="h-[86%] w-[86%]" width={size} height={size} />
      <span className="absolute -end-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-[#081a29]" />
    </span>
  )
}

export function BrandLogo({
  to = '/',
  compact = false,
  className,
  onClick,
}: {
  to?: string
  compact?: boolean
  className?: string
  onClick?: () => void
}) {
  return (
    <Link to={to} onClick={onClick} className={cn('nx-brand-lockup group min-w-0', className)} aria-label="NEXORA AI — home">
      <BrandMark size={compact ? 30 : 36} />
      {!compact ? (
        <span className="min-w-0">
          <span className="nx-brand-name block truncate">NEXORA <span className="text-primary">AI</span></span>
          <span className="nx-brand-sub block truncate">Technical Intelligence &amp; Diagnostics</span>
        </span>
      ) : null}
    </Link>
  )
}
