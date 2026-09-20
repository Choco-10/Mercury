import { Link } from 'react-router-dom'
import { Card, Badge } from './ui.jsx'

export function UploadOutcome({ result }) {
  const complete = result.status === 'accepted' || result.status === 'accepted_with_analysis_warnings'
  return (
    <Card title="Upload outcome">
      <Badge tone={result.status === 'accepted' ? 'good' : 'warn'}>{result.status}</Badge>
      <p className="text-xs text-slate-500 break-all mt-2">Upload ID: {result.upload_id}</p>
      <p className="text-sm mt-2">{result.rows} records · {result.acknowledged_rows} acknowledged · {result.uncertain_rows} uncertain · {result.not_attempted_rows} not attempted</p>
      <p className="text-xs text-slate-500 mt-2">Raw artifact: {result.artifacts?.raw} · Normalized artifact: {result.artifacts?.normalized}</p>
      {result.ledger_acknowledged === false && <p className="text-sm text-amber-700">The latest outcome was not confirmed in the ledger. The stored checkpoint may be older than what you see here.</p>}
      {!complete && <p className="text-sm text-amber-700 mt-2">Completion is not confirmed. Partial writes or artifacts may remain. Review the data before retrying; re-uploading does not resume this upload.</p>}
      {result.error && <p className="text-sm text-amber-700 mt-2">{result.error}</p>}
      <ul className="text-sm mt-3 space-y-2">
        {(result.analysis || []).map((item) => (
          <li key={item.product_id}>
            <Link to={`/products/${item.product_id}`} className="text-indigo-600 underline">{item.product_id}</Link>
            {' : analysis: '}{item.status}
            {item.issues?.length > 0 && <p className="text-xs text-amber-700">{item.issues.join('; ')}</p>}
          </li>
        ))}
      </ul>
      {complete && <p className="text-xs text-slate-500 mt-3">Dataset writes were acknowledged. Open a product to fetch updated analytics. Analysis warnings do not roll back uploaded data.</p>}
    </Card>
  )
}
