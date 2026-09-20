import { useEffect, useState } from 'react'
import { API_MODE, fetchProducts, uploadCsv } from '../services/api.js'
import { UploadOutcome } from '../components/UploadOutcome.jsx'
import { Card, Badge } from '../components/ui.jsx'

/**
 * CSV schemas enforced by backend ingestion:
 *   sales.csv:     date,product_id,price,units_sold,discount
 *   competitors.csv: date,competitor_id,product_id,competitor_product_id,competitor_price,competitor_discount
 */
const SALES_COLUMNS = ['date', 'product_id', 'price', 'units_sold', 'discount']
const COMPETITOR_COLUMNS = ['date', 'competitor_id', 'product_id', 'competitor_product_id', 'competitor_price', 'competitor_discount']

export default function DataPage() {
  const [issues, setIssues] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [products, setProducts] = useState([])
  const [templateNote, setTemplateNote] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchProducts()
      .then((list) => { if (!cancelled) setProducts(Array.isArray(list) ? list : []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  function downloadTemplate(type) {
    // Templates must reference a product that exists in the seller's catalog;
    // a hardcoded example ID would be rejected by ingestion (unknown product).
    const productId = products[0]?.product_id
    const dates = [new Date().toISOString().slice(0, 10)]
    let header, rows
    if (!productId) {
      header = (type === 'sales' ? SALES_COLUMNS : COMPETITOR_COLUMNS).join(',')
      rows = []
      setTemplateNote('No products yet. The template is header-only. Create a product on the Products page, then re-download for example rows with your product ID.')
    } else if (type === 'sales') {
      header = SALES_COLUMNS.join(',')
      rows = dates.map((d) => `${d},${productId},999,10,5`)
      setTemplateNote(`Example rows use your product ${productId}.`)
    } else {
      header = COMPETITOR_COLUMNS.join(',')
      rows = [1, 2, 3].map((n) => `${dates[0]},C0${n},${productId},CP10${n},949,10`)
      setTemplateNote(`Example rows use your product ${productId}.`)
    }
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type}_template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleUpload(file, type) {
    if (!file || busy) return
    setIssues([])
    setError('')
    setResult(null)
    if (file.size > 256 * 1024) { setError('CSV exceeds the 256 KiB limit.'); return }
    setBusy(true)
    try {
      const outcome = await uploadCsv(type, await file.text())
      setResult(outcome)
    } catch (err) {
      setError(err.message)
      setIssues(Array.isArray(err.details?.issues) ? err.details.issues : [])
      if (err.details?.upload_id) setResult(err.details)
    } finally { setBusy(false) }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Data</h1>
        <p className="text-sm text-slate-500 mt-0.5">Upload your sales and competitor data for on-demand analysis.</p>
      </header>

      <Card title="Data source">
        <Badge tone={API_MODE === 'aws' ? 'warn' : 'info'}>{API_MODE}</Badge>
        <p className="text-sm text-slate-600 mt-3">
          {API_MODE === 'localhost'
            ? 'Local HTTP backend. Data, artifacts and upload outcomes reset on backend restart. No AWS fallback.'
            : 'AWS HTTP backend selected. API, storage, compute and log usage can consume credits.'}
        </p>
        <p className="text-xs text-slate-500 mt-2">Maximum 256 KiB / 2,000 records. Duplicate keys within a file are rejected; existing dataset keys are replaced. All rows are validated on the backend before writes.</p>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Sales CSV" subtitle="Columns: date, product_id, price, units_sold, discount">
          <div className="space-y-3">
            <button onClick={() => downloadTemplate('sales')} className="text-xs text-indigo-600 hover:underline">⬇ Download template</button>
            <input
              type="file"
              accept=".csv"
              disabled={busy}
              aria-label="Sales CSV"
              onChange={(e) => {
                const file = e.target.files[0]
                e.target.value = ''
                handleUpload(file, 'sales')
              }}
              className="block w-full text-sm border border-slate-300 rounded-lg p-2 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700"
            />
          </div>
        </Card>
        <Card title="Competitors CSV" subtitle="Columns: date, competitor_id, product_id, competitor_product_id, competitor_price, competitor_discount">
          <div className="space-y-3">
            <button onClick={() => downloadTemplate('competitors')} className="text-xs text-indigo-600 hover:underline">⬇ Download template</button>
            <input
              type="file"
              accept=".csv"
              disabled={busy}
              aria-label="Competitors CSV"
              onChange={(e) => {
                const file = e.target.files[0]
                e.target.value = ''
                handleUpload(file, 'competitors')
              }}
              className="block w-full text-sm border border-slate-300 rounded-lg p-2 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700"
            />
          </div>
        </Card>
      </div>

      {templateNote && <p className="text-xs text-slate-500">{templateNote}</p>}

      <div aria-live="polite">
        {busy && <p className="text-sm text-indigo-600">Waiting for backend confirmation… Do not submit again.</p>}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
      {issues.length > 0 && (
        <Card title="Validation errors" subtitle="Fix these and re-upload">
          <ul className="text-sm text-rose-600 space-y-1 list-disc list-inside max-h-40 overflow-y-auto thin-scroll">
            {issues.slice(0, 20).map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
          {issues.length > 20 && <p className="text-xs text-slate-400 mt-2">…and {issues.length - 20} more issues</p>}
        </Card>
      )}

      {result && <UploadOutcome result={result} />}
    </div>
  )
}
