import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, BarChart, Bar,
} from 'recharts'
import * as api from '../services/api.js'
import { loadProductView } from '../services/views.js'
const { simulatePrice } = api
import { formatINR, formatPct, formatDate } from '../lib/format.js'
import { Card, Badge, TrendBadge, LoadingState, ErrorState } from '../components/ui.jsx'

export default function ProductDetail() {
  const { id } = useParams()
  return <ProductView key={id} id={id} />
}

function ProductView({ id }) {
  const [retry, setRetry] = useState(0)
  const [simError, setSimError] = useState('')
  const [state, setState] = useState({ status: 'loading' })
  const [scenario, setScenario] = useState(null)
  const [simLoading, setSimLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const view = await loadProductView(api, id)
        if (!cancelled) setState({ status: 'ready', ...view })
      } catch (e) {
        if (!cancelled) setState({ status: 'error', message: e.message })
      }
    })()
    return () => { cancelled = true }
  }, [id, retry])

  async function runSimulation() {
    setSimLoading(true)
    setSimError('')
    setScenario(null)
    try {
      const p = state.product.price
      const result = await simulatePrice(id, [p - 100, p - 50, p, p + 50, p + 100])
      setScenario(result)
    } catch (err) {
      setSimError(err.message)
    } finally {
      setSimLoading(false)
    }
  }

  if (state.status === 'loading') return <div className="p-8"><LoadingState label="Loading product analytics…" /></div>
  if (state.status === 'error') return <div className="p-8"><ErrorState message={state.message} onRetry={() => { setState({ status: 'loading' }); setRetry((n) => n + 1) }} /></div>

  const { product, sales, competitors, forecast, analysis, errors } = state
  const metrics = analysis?.competitor_metrics
  const rec = analysis?.recommendation

  const salesChartData = sales.map((s) => ({
    date: formatDate(s.date),
    units: s.units_sold,
    price: s.price,
    fullDate: s.date,
  }))
  const last30 = salesChartData.slice(-30)
  const forecastReady = forecast && forecast.forecast?.length > 0
  const forecastChartData = forecastReady
    ? forecast.forecast.map((f) => ({ date: formatDate(f.date), expected: f.expected, band: [f.lower, f.upper] }))
    : []

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link to="/products" className="hover:underline">Products</Link> <span>/</span> <span>{product.subcategory}</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-900 mt-1">{product.title}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-lg font-semibold">{formatINR(product.price)}</span>
            <span className="text-sm text-slate-500">★ {product.rating}</span>
            {product.discount > 0 && <Badge tone="info">{product.discount}% off</Badge>}
            {!rec ? <Badge>analysis unavailable</Badge> : rec.status === 'attention' ? <Badge tone="warn">⚠ needs attention</Badge> : <Badge tone="good">✓ healthy</Badge>}
          </div>
        </div>
        <div className="text-right text-xs text-slate-400">
          {analysis ? `Analysis generated ${new Date(analysis.generated_at).toLocaleString('en-IN')}` : 'No analysis available'}
        </div>
      </div>

      {Object.keys(errors).length > 0 && <Card title="Some data is unavailable">
        <ul className="text-sm text-amber-700">{Object.entries(errors).map(([name, message]) => <li key={name}>{name}: {message}</li>)}</ul>
        <button className="text-sm text-indigo-600 underline mt-2" onClick={() => { setState({ status: 'loading' }); setRetry((n) => n + 1) }}>Reload data</button>
      </Card>}
      {/* Summary tiles */}
      {analysis && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs uppercase text-slate-500 font-medium">Demand trend</div>
          <div className="mt-2"><TrendBadge direction={analysis.demand.trend} changePct={analysis.demand.change_pct} /></div>
          <div className="text-xs text-slate-400 mt-2">30-day slope: {analysis.demand.slope_30d} units/day</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs uppercase text-slate-500 font-medium">14-day forecast</div>
          {analysis.forecast_summary.status === 'available' ? (
            <>
              <div className="text-2xl font-semibold mt-1">{analysis.forecast_summary.expected_mean_daily ?? '—'} <span className="text-sm font-normal text-slate-400">units/day avg</span></div>
              <div className="text-xs text-slate-400 mt-1">
                {analysis.forecast_summary.delta_vs_recent_pct != null
                  ? `${formatPct(analysis.forecast_summary.delta_vs_recent_pct)} vs last 2 weeks (estimate)`
                  : 'forecast unavailable'}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                <div>Model: {analysis.forecast_summary.model}</div>
                <div>Training: {analysis.forecast_summary.training_summary?.observed_days} days observed · {analysis.forecast_summary.training_summary?.span_days}-day span</div>
                <div>Origin: {analysis.forecast_summary.forecast_origin}</div>
              </div>
            </>
          ) : (
            <div className="mt-2 text-sm text-amber-600">
              Forecast unavailable: {analysis.forecast_summary.reason}
              <div className="text-xs text-slate-500 mt-1">Historical and competitor analysis below is unaffected.</div>
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs uppercase text-slate-500 font-medium">Price vs competitor median</div>
          <div className="text-2xl font-semibold mt-1">{formatPct(metrics.seller_vs_median_pct)}</div>
          <div className="text-xs text-slate-400 mt-1">median {formatINR(metrics.competitor_median_price)} · seller {formatINR(metrics.seller_price)}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs uppercase text-slate-500 font-medium">Expected 14-day revenue</div>
          <div className="text-2xl font-semibold mt-1">{formatINR(analysis.forecast_summary.total_expected_14d * product.price)}</div>
          <div className="text-xs text-slate-400 mt-1">forecast × current price (estimate)</div>
        </div>
      </div>}
      {/* Demand chart */}
      <Card title="Demand trend" subtitle="Units sold — last 30 days with price overlay">
        {sales.length === 0 && <p className="text-sm text-amber-700">No sales history available.</p>}
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={last30}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
            <YAxis yAxisId="units" tick={{ fontSize: 11 }} />
            <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 11 }} domain={['dataMin - 50', 'dataMax + 50']} hide />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="units" type="monotone" dataKey="units" name="Units sold" stroke="#4f46e5" strokeWidth={2} dot={false} />
            <Line yAxisId="price" type="monotone" dataKey="price" name="Price (₹)" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-400 mt-2">
          The data suggests correlation between price and demand over this window; the forecast is a statistical estimate, not a guarantee.
        </p>
      </Card>

      {/* Forecast chart */}
      <Card
        title="14-day demand forecast"
        subtitle="Statistical estimate with 80% uncertainty interval"
      >
        {forecastReady ? (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={forecastChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="band" name="80% interval" stroke="#c7d2fe" fill="#e0e7ff" fillOpacity={0.6} />
                <Line type="monotone" dataKey="expected" name="Expected demand" stroke="#4f46e5" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              {forecast.forecast.slice(0, 4).map((f) => (
                <div key={f.date} className="border border-slate-200 rounded-lg px-3 py-2">
                  <div className="text-slate-500">{formatDate(f.date)}</div>
                  <div className="font-medium text-slate-800">{f.expected} units</div>
                  <div className="text-slate-400">{f.lower}–{f.upper} (80% band)</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="p-6 text-center">
            <div className="text-amber-600 font-medium">Forecast temporarily unavailable</div>
            <p className="text-sm text-slate-500 mt-1">Historical and competitor analysis below is unaffected.</p>
          </div>
        )}
      </Card>
      {/* Competitor landscape */}
      <Card title="Competitor landscape" subtitle="Latest observed competitor prices">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Competitor</th>
                <th className="py-2 pr-4">Price</th>
                <th className="py-2 pr-4">Discount</th>
                <th className="py-2 pr-4">Rating</th>
                <th className="py-2">vs your price</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100 bg-indigo-50/50">
                <td className="py-2 pr-4 font-medium text-indigo-800">Your product</td>
                <td className="py-2 pr-4 font-medium">{formatINR(product.price)}</td>
                <td className="py-2 pr-4">{product.discount}%</td>
                <td className="py-2 pr-4">★ {product.rating}</td>
                <td className="py-2">—</td>
              </tr>
              {competitors.map((c) => {
                const diffPct = Math.round(((c.price - product.price) / product.price) * 1000) / 10
                return (
                  <tr key={c.competitor_id} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{c.title}</td>
                    <td className="py-2 pr-4">{formatINR(c.price)}</td>
                    <td className="py-2 pr-4">{c.discount}%</td>
                    <td className="py-2 pr-4">★ {c.rating}</td>
                    <td className="py-2">
                      <Badge tone={diffPct > 3 ? 'good' : diffPct < -3 ? 'warn' : 'neutral'}>
                        {diffPct > 0 ? '+' : ''}{diffPct}%
                      </Badge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {competitors.length === 0 && <p className="text-sm text-amber-700">No competitor observations available.</p>}
        {metrics && <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
          <span>Min {formatINR(metrics.competitor_min_price)}</span>
          <span>Median {formatINR(metrics.competitor_median_price)}</span>
          <span>Avg {formatINR(metrics.competitor_avg_price)}</span>
          <span>Max {formatINR(metrics.competitor_max_price)}</span>
          <span className="font-medium">Position: {metrics.seller_position.replace('_', ' ')}</span>
        </div>}
      </Card>
      {/* Pricing simulator */}
      <Card
        title="Pricing what-if simulator"
        subtitle="Deterministic estimates from your recent demand — the decision is yours"
        actions={
          <button
            onClick={runSimulation}
            disabled={simLoading}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {simLoading ? 'Simulating…' : 'Run scenarios'}
          </button>
        }
      >
        {simError && <p role="alert" className="text-sm text-rose-700">{simError}</p>}
        {!scenario && !simLoading && (
          <p className="text-sm text-slate-500 py-4">
            Run the simulator to compare price points ±₹100 around your current price. Estimates use recent demand and a fixed elasticity assumption — actual results may differ.
          </p>
        )}
        {simLoading && <p className="text-sm text-slate-400 py-4">Calculating scenarios…</p>}
        {scenario && !simLoading && (
          <>
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">Change</th>
                    <th className="py-2 pr-4">Expected demand/day</th>
                    <th className="py-2 pr-4">Est. revenue/day</th>
                    <th className="py-2">Position</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.scenarios.map((s) => {
                    const isCurrent = s.price === scenario.baseline_price
                    return (
                      <tr key={s.price} className={`border-b border-slate-100 ${isCurrent ? 'bg-indigo-50/50' : ''}`}>
                        <td className={`py-2 pr-4 ${isCurrent ? 'font-semibold text-indigo-800' : 'font-medium'}`}>
                          {formatINR(s.price)}{isCurrent && ' (current)'}
                        </td>
                        <td className="py-2 pr-4">{formatPct(s.price_change_pct)}</td>
                        <td className="py-2 pr-4">{s.expected_daily_demand} units</td>
                        <td className="py-2 pr-4">{formatINR(s.estimated_daily_revenue)}</td>
                        <td className="py-2"><Badge tone={s.competitor_position === 'undercutting' ? 'warn' : s.competitor_position === 'premium' ? 'bad' : 'good'}>{s.competitor_position.replace('_', ' ')}</Badge></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={scenario.scenarios.map((s) => ({ name: formatINR(s.price), revenue: s.estimated_daily_revenue, demand: s.expected_daily_demand }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Est. daily revenue (₹)" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
        <p className="text-xs text-slate-400 mt-3">
          These are model-based estimates, not guarantees. Mercury does not change prices automatically.
        </p>
      </Card>

      {/* Recommendation / AI insights */}
      {rec && <Card title="Why this status?" subtitle="Evidence behind the current recommendation">
        <div className="space-y-2">
          {rec.status === 'attention' && (
            <Badge tone="warn">Suggested action: {rec.suggested_action.replace('_', ' ')}{rec.candidate_price ? ` — consider testing ${formatINR(rec.candidate_price)}` : ''}</Badge>
          )}
          <ul className="text-sm text-slate-700 space-y-1.5 list-disc list-inside">
            {rec.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <p className="text-xs text-slate-400 pt-1">Confidence: {rec.confidence}. Based on deterministic analysis of your data — verify with your own judgment before acting.</p>
        </div>
      </Card>}
    </div>
  )
}
