import { useState } from 'react'
import { API_MODE, uploadCsv, fetchUploadOutcome } from '../services/api.js'
import { UploadOutcome } from '../components/UploadOutcome.jsx'
import { Card, Badge } from '../components/ui.jsx'

/**
 * CSV schemas enforced by backend ingestion:
 *   sales.csv:     date,product_id,units_sold,price
 *   competitors.csv: observation_date,product_id,competitor_id,title,price,rating,discount
 */
const SALES_COLUMNS = ['date', 'product_id', 'units_sold', 'price']
const COMPETITOR_COLUMNS = ['observation_date', 'product_id', 'competitor_id', 'title', 'price', 'rating', 'discount']

export default function DataPage() {
  const [issues, setIssues] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lookupId, setLookupId] = useState('')
  const enabled = API_MODE !== 'local'

  function downloadTemplate(type) {
    const dates = [new Date().toISOString().slice(0, 10)]
    let header, rows
    if (type === 'sales') {
      header = SALES_COLUMNS.join(',')
      rows = dates.map((d) => `${d},P001,10,1599`)
    } else {
      header = COMPETITOR_COLUMNS.join(',')
      rows = dates.slice(0, 3).map((d) => `${d},P001,C001,Example Competitor,1549,4.1,10`)
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
    setLookupId('')
    if (file.size > 256 * 1024) { setError('CSV exceeds the 256 KiB limit.'); return }
    setBusy(true)
    try {
      const outcome = await uploadCsv(type, await file.text())
      setResult(outcome)
      setLookupId(outcome.upload_id || '')
    } catch (err) {
      setError(err.message)
      setIssues(Array.isArray(err.details?.issues) ? err.details.issues : [])
      if (err.details?.upload_id) {
        setResult(err.details)
        setLookupId(err.details.upload_id)
      }
    } finally { setBusy(false) }
  }

  async function checkOutcome() {
    setBusy(true)
    setError('')
    setIssues([])
    setResult(null)
    try { setResult(await fetchUploadOutcome(lookupId.trim())) }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Data</h1>
        <p className="text-sm text-slate-500 mt-0.5">Upload your sales and competitor data, or use the built-in demo dataset.</p>
      </header>

      <Card title="Data source">
        <Badge tone={API_MODE === 'aws' ? 'warn' : 'info'}>{API_MODE}</Badge>
        <p className="text-sm text-slate-600 mt-3">
          {API_MODE === 'local'
            ? 'Browser demo only. Uploads are disabled. Start the local backend and use VITE_API_MODE=localhost for ingestion.'
            : API_MODE === 'localhost'
              ? 'Local HTTP backend. Data, artifacts and upload outcomes reset on backend restart. No AWS fallback.'
              : 'AWS HTTP backend selected. API, storage, compute and log usage can consume credits.'}
        </p>
        <p className="text-xs text-slate-500 mt-2">Maximum 256 KiB / 2,000 records. Duplicate keys within a file are rejected; existing dataset keys are replaced. All rows are validated on the backend before writes.</p>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Sales CSV" subtitle="Columns: date, product_id, units_sold, price">
          <div className="space-y-3">
            <button onClick={() => downloadTemplate('sales')} className="text-xs text-indigo-600 hover:underline">⬇ Download template</button>
            <input
              type="file"
              accept=".csv"
              disabled={!enabled || busy}
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
        <Card title="Competitors CSV" subtitle="Columns: observation_date, product_id, competitor_id, title, price, rating, discount">
          <div className="space-y-3">
            <button onClick={() => downloadTemplate('competitors')} className="text-xs text-indigo-600 hover:underline">⬇ Download template</button>
            <input
              type="file"
              accept=".csv"
              disabled={!enabled || busy}
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
      <Card title="Check upload outcome" subtitle="Read-only lookup; never retries ingestion. Local IDs disappear on backend restart.">
        <label htmlFor="upload-id" className="text-sm">Upload ID</label>
        <input id="upload-id" value={lookupId} onChange={(e) => setLookupId(e.target.value)} disabled={!enabled || busy}
          className="block border border-slate-300 rounded p-2 my-2 w-full text-sm" />
        <button onClick={checkOutcome} disabled={!enabled || busy || !lookupId.trim()}
          className="px-4 py-2 text-sm rounded bg-indigo-600 text-white disabled:opacity-50">Check outcome</button>
      </Card>
    </div>
  )
}
