/** Indian Rupee and date formatting helpers. */

export function formatINR(value, opts = {}) {
  if (value == null || isNaN(value)) return '-'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
    ...opts,
  }).format(value)
}

/** Units are always whole; predictions are rounded down (never oversell). */
export function formatUnits(value) {
  if (value == null || isNaN(value)) return '-'
  return new Intl.NumberFormat('en-IN').format(Math.floor(value))
}

export function floorUnits(value) {
  if (value == null || isNaN(value)) return 0
  return Math.floor(value)
}

export function formatCompactINR(value) {
  if (value == null || isNaN(value)) return '-'
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)}K`
  return formatINR(value)
}

export function formatNumber(value) {
  if (value == null || isNaN(value)) return '-'
  return new Intl.NumberFormat('en-IN').format(value)
}

export function formatDate(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function formatDateTime(iso) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatPct(value) {
  if (value == null || isNaN(value)) return '-'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value}%`
}

/** Human labels for AI data source entries, which may be strings or objects. */
export function formatSource(source) {
  if (source == null) return null
  if (typeof source === 'string') return source
  return source.name || source.source || source.table || source.type || JSON.stringify(source)
}
