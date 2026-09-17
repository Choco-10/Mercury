import { useState } from 'react'
import { getDemoDataset, buildDates } from '../data/demoData.js'
import { Card, Badge } from '../components/ui.jsx'

/**
 * Expected CSV schemas (also used by the future backend validation):
 *   sales.csv:     date,product_id,units_sold,price
 *   competitors.csv: observation_date,product_id,competitor_id,title,price,rating,discount
 */
const SALES_COLUMNS = ['date', 'product_id', 'units_sold', 'price']
const COMPETITOR_COLUMNS = ['observation_date', 'product_id', 'competitor_id', 'title', 'price', 'rating', 'discount']

export default function DataPage() {
  const [issues, setIssues] = useState([])
  const [result, setResult] = useState(null)

  function downloadTemplate(type) {
    const dates = buildDates(14).map((d) => d.toISOString().slice(0, 10))
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

  function validateCsv(text, columns, type) {
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return { rows: 0, issues: ['File is empty (no data rows).'] }
    const header = lines[0].split(',').map((h) => h.trim())
    const missing = columns.filter((c) => !header.includes(c))
    if (missing.length) return { rows: 0, issues: [`Missing columns: ${missing.join(', ')}`] }
    const issues = []
    let rows = 0
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',')
      const record = Object.fromEntries(header.map((h, j) => [h, cells[j]?.trim()]))
      const rowNum = i + 1
      const dateVal = record.date || record.observation_date
      if (!dateVal || isNaN(new Date(dateVal))) { issues.push(`Row ${rowNum}: invalid date "${dateVal}"`); continue }
      const numeric = type === 'sales'
        ? { units_sold: record.units_sold, price: record.price }
        : { price: record.price, rating: record.rating, discount: record.discount }
      for (const [field, raw] of Object.entries(numeric)) {
        if (raw == null || raw === '' || isNaN(Number(raw))) issues.push(`Row ${rowNum}: invalid ${field} "${raw}"`)
      }
      if (!record.product_id) issues.push(`Row ${rowNum}: missing product_id`)
      rows++
    }
    return { rows, issues }
  }

  async function handleUpload(file, columns, type) {
    if (!file) return
    const text = await file.text()
    const { rows, issues: found } = validateCsv(text, columns, type)
    setIssues(found)
    if (found.length === 0) {
      setResult({ type, name: file.name, rows })
    } else {
      setResult(null)
    }
  }

  const ds = getDemoDataset()

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Data</h1>
        <p className="text-sm text-slate-500 mt-0.5">Upload your sales and competitor data, or use the built-in demo dataset.</p>
      </header>

      <Card title="Demo dataset" subtitle="Works instantly — synthetic data for 5 products, 120 days, 25 competitors">
        <div className="flex items-center gap-4 text-sm">
          <Badge tone="good">✓ loaded</Badge>
          <span className="text-slate-600">{ds.products.length} products</span>
          <span className="text-slate-600">{ds.days} days of history</span>
          <span className="text-slate-600">{ds.products.length * 5} competitors</span>
        </div>
      </Card>
      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Sales CSV" subtitle="Columns: date, product_id, units_sold, price">
          <div className="space-y-3">
            <button onClick={() => downloadTemplate('sales')} className="text-xs text-indigo-600 hover:underline">⬇ Download template</button>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => { handleUpload(e.target.files[0], SALES_COLUMNS, 'sales') }}
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
              onChange={(e) => { handleUpload(e.target.files[0], COMPETITOR_COLUMNS, 'competitors') }}
              className="block w-full text-sm border border-slate-300 rounded-lg p-2 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-slate-100 file:text-slate-700"
            />
          </div>
        </Card>
      </div>

      {issues.length > 0 && (
        <Card title="Validation errors" subtitle="Fix these and re-upload">
          <ul className="text-sm text-rose-600 space-y-1 list-disc list-inside max-h-40 overflow-y-auto thin-scroll">
            {issues.slice(0, 20).map((msg, i) => <li key={i}>{msg}</li>)}
          </ul>
          {issues.length > 20 && <p className="text-xs text-slate-400 mt-2">…and {issues.length - 20} more issues</p>}
        </Card>
      )}

      {result && issues.length === 0 && (
        <Card>
          <div className="flex items-center gap-3 text-sm">
            <Badge tone="good">✓ {result.type} file valid</Badge>
            <span className="text-slate-600">{result.name}</span>
            <span className="text-slate-500">{result.rows} data rows validated</span>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            In AWS mode this file would upload to S3, trigger validation + normalization, then land in DynamoDB and start an analysis run.
          </p>
        </Card>
      )}
    </div>
  )
}
