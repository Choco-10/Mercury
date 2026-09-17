/** Small shared UI primitives: cards, badges, loading/empty/error states. */

export function Card({ title, subtitle, children, className = '', actions = null }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-start justify-between px-5 pt-4 pb-2">
          <div>
            {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={title ? 'px-5 pb-5' : 'p-5'}>{children}</div>
    </div>
  )
}

export function StatTile({ label, value, hint, tone = 'default' }) {
  const tones = {
    default: 'text-slate-900',
    good: 'text-emerald-600',
    warn: 'text-amber-600',
    bad: 'text-rose-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${tones[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </div>
  )
}

const BADGE_STYLES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-700 ring-amber-200',
  bad: 'bg-rose-50 text-rose-700 ring-rose-200',
  info: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
}

export function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  )
}

export function TrendBadge({ direction, changePct }) {
  if (direction === 'insufficient_data') return <Badge>insufficient data</Badge>
  const map = {
    increasing: { tone: 'good', arrow: '▲' },
    decreasing: { tone: 'bad', arrow: '▼' },
    stable: { tone: 'neutral', arrow: '▬' },
  }
  const { tone, arrow } = map[direction] || map.stable
  return (
    <Badge tone={tone}>
      {arrow} {direction} {changePct != null && `(${changePct > 0 ? '+' : ''}${changePct}%)`}
    </Badge>
  )
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />
}

export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="space-y-3 p-5">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-40 w-full" />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="p-8 text-center">
      <div className="text-rose-600 font-medium">Something went wrong</div>
      <p className="text-sm text-slate-500 mt-1">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-4 py-2 text-sm rounded-lg bg-slate-900 text-white hover:bg-slate-700"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, message, action }) {
  return (
    <div className="p-8 text-center">
      <div className="text-slate-700 font-medium">{title}</div>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{message}</p>
      {action}
    </div>
  )
}
