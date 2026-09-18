import { API_MODE } from '../services/api.js'
import { Card, Badge } from '../components/ui.jsx'

/** Status page (§5: Settings stays mostly placeholder for the MVP) — read-only
 * runtime status plus where each mode is configured. No editable state. */
const API_MODE_INFO = {
  local: {
    tone: 'neutral',
    label: 'Browser demo data',
    detail: 'The UI serves the preloaded synthetic dataset directly in the browser — no backend required.',
  },
  localhost: {
    tone: 'info',
    label: 'Local backend HTTP',
    detail: 'The UI calls the local backend API (VITE_API_BASE_URL) using the same contracts as AWS mode.',
  },
  aws: {
    tone: 'good',
    label: 'AWS API mode',
    detail: 'The UI calls the deployed API Gateway endpoints.',
  },
}

const CONFIG_ROWS = [
  {
    name: 'VITE_API_MODE',
    where: 'frontend (build-time env)',
    values: 'local | localhost | aws',
    effect: "Selects the API adapter. 'local' uses browser demo data; 'localhost' and 'aws' use the HTTP client against VITE_API_BASE_URL. Default: local.",
  },
  {
    name: 'VITE_API_BASE_URL',
    where: 'frontend (build-time env)',
    values: 'e.g. http://127.0.0.1:3001',
    effect: 'Base URL for API calls when VITE_API_MODE is localhost or aws.',
  },
  {
    name: 'MOCK_BEDROCK',
    where: 'backend (runtime env)',
    values: 'unset or true (default) | false',
    effect: "Mock Bedrock is the default and makes no AWS calls or credits. 'false' opts into the production Bedrock client, which requires AWS credentials.",
  },
]

function StatusRow({ label, badge, badgeTone, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1.5 flex flex-wrap items-start gap-2">
        <Badge tone={badgeTone}>{badge}</Badge>
        <span className="text-sm text-slate-600 flex-1 min-w-[16rem]">{children}</span>
      </dd>
    </div>
  )
}

export default function Settings() {
  const mode = API_MODE_INFO[API_MODE] || API_MODE_INFO.local
  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Runtime status for this deployment — editable settings are intentionally minimal in the MVP.
        </p>
      </header>

      <Card title="Runtime status">
        <dl className="space-y-5">
          <StatusRow label="API mode" badge={mode.label} badgeTone={mode.tone}>
            {mode.detail} Detected from <code className="text-xs bg-slate-100 rounded px-1">VITE_API_MODE</code>.
          </StatusRow>
          <StatusRow label="AI mode" badge="Mock Bedrock (default)" badgeTone="info">
            No AWS calls or credits — the SDK loads lazily and the production client activates only with{' '}
            <code className="text-xs bg-slate-100 rounded px-1">MOCK_BEDROCK=false</code>. AI replies interpret
            deterministic analysis results; the LLM never produces prices, demand, forecasts or competitor statistics.
          </StatusRow>
          <StatusRow label="Analysis mode" badge="On-demand only" badgeTone="neutral">
            Analysis runs when you open a product or call the API — there are no scheduled triggers (no EventBridge
            rule or Step Functions workflow). Snapshots are keyed{' '}
            <code className="text-xs bg-slate-100 rounded px-1">product_id + analysis_date</code>, so same-day repeats
            return the cached analysis instead of recomputing.
          </StatusRow>
          <StatusRow label="Demo data" badge="Preloaded" badgeTone="good">
            The synthetic demo dataset works immediately after startup — no external APIs or configuration needed.
          </StatusRow>
        </dl>
      </Card>

      <Card title="Configuration" subtitle="Environment variables that control the modes shown above">
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4">Variable</th>
                <th className="py-2 pr-4">Configured in</th>
                <th className="py-2 pr-4">Values</th>
                <th className="py-2">Effect</th>
              </tr>
            </thead>
            <tbody>
              {CONFIG_ROWS.map((row) => (
                <tr key={row.name} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4 font-medium text-slate-800 whitespace-nowrap">{row.name}</td>
                  <td className="py-2 pr-4 text-slate-600">{row.where}</td>
                  <td className="py-2 pr-4 text-slate-600">{row.values}</td>
                  <td className="py-2 text-slate-600">{row.effect}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Frontend variables are read when Vite starts or builds — restart the dev server after changing them. In AWS
          mode, credentials stay in Lambda IAM roles and never appear in frontend code.
        </p>
      </Card>
    </div>
  )
}

