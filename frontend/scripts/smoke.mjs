/**
 * Node smoke test for the demo data + analytics layer (no React involved).
 * Run:  node scripts/smoke.mjs   (from frontend/)
 */
import { getDemoDataset } from '../src/data/demoData.js'
import { forecastSeries, classifyTrend } from '../../shared/analytics.js'

const ds = getDemoDataset()
let failures = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

console.log('Dataset shape:')
check('5 products', ds.products.length === 5, `got ${ds.products.length}`)
check('seller id set', ds.seller_id === 'SELLER001')

for (const p of ds.products) {
  const sales = ds.sales_history[p.product_id]
  const comps = ds.competitors[p.product_id]
  const distinctCompIds = new Set(comps.map((c) => c.competitor_id)).size
  console.log(`\n${p.product_id} — ${p.title}`)
  check('120 days of sales', sales.length === 120, `got ${sales.length}`)
  check('sales sorted by date', sales[0].date < sales[sales.length - 1].date)
  check('5 distinct competitors', distinctCompIds === 5, `got ${distinctCompIds}`)
  check('competitor rows = 5 × 120', comps.length === 600, `got ${comps.length}`)
  check('prices positive', sales.every((s) => s.price > 0 && s.units_sold >= 0))

  const units = sales.map((s) => s.units_sold)
  const trend = classifyTrend(units)
  const fc = forecastSeries(sales.map((s) => s.date), units, 14)
  check('forecast = 14 days', fc.length === 14)
  check(
    'lower ≤ expected ≤ upper',
    fc.every((f) => f.lower <= f.expected && f.expected <= f.upper)
  )
  const first = sales.slice(0, 30).reduce((s, x) => s + x.units_sold, 0) / 30
  const last = sales.slice(-30).reduce((s, x) => s + x.units_sold, 0) / 30
  console.log(
    `    trend=${trend.direction} (${trend.changePct}%) · avg first30=${first.toFixed(1)} last30=${last.toFixed(1)} · fc day1=${fc[0].expected} [${fc[0].lower}–${fc[0].upper}] · price ${sales[0].price}→${sales[sales.length - 1].price}`
  )
}

// Pattern variety sanity — products must NOT all behave the same
const trends = ds.products.map((p) => classifyTrend(ds.sales_history[p.product_id].map((s) => s.units_sold)).direction)
const variety = new Set(trends).size >= 3
console.log(`\nTrend variety: ${trends.join(', ')}`)
check('at least 3 distinct demand patterns across products', variety)

const totalRevenue = ds.products.reduce((s, p) => {
  const sales = ds.sales_history[p.product_id]
  return s + sales.slice(-14).reduce((t, x) => t + x.units_sold * x.price, 0)
}, 0)
console.log(`\nLast-14-day synthetic revenue across catalog: ₹${Math.round(totalRevenue).toLocaleString('en-IN')}`)

if (failures) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll smoke checks passed.')
