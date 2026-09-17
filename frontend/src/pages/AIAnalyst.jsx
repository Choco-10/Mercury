import { useEffect, useState } from 'react'
import { askAnalyst, fetchProducts } from '../services/api.js'
import { Card, Badge, EmptyState } from '../components/ui.jsx'

const SUGGESTED_QUESTIONS = [
  'Why should I investigate my current pricing?',
  'What are my main competitive risks?',
  'What happens if I reduce my price?',
  'Explain the 14-day forecast.',
  'What changed recently?',
]

const AGENT_STAGES = [
  { id: 'market', label: 'Market analysis' },
  { id: 'competitor', label: 'Competitor analysis' },
  { id: 'forecast', label: 'Demand forecast' },
  { id: 'pricing', label: 'Pricing analysis' },
  { id: 'synthesis', label: 'AI synthesis' },
]

export default function AIAnalyst() {
  const [products, setProducts] = useState([])
  const [productId, setProductId] = useState('')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState(-1)

  useEffect(() => {
    fetchProducts().then((list) => {
      setProducts(list)
      if (list.length) setProductId(list[0].product_id)
    })
  }, [])

  async function ask(q) {
    if (!q.trim() || !productId || busy) return
    setBusy(true)
    setStage(0)
    setMessages((m) => [...m, { role: 'user', text: q }])
    setQuestion('')
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, AGENT_STAGES.length - 1)), 350)
    try {
      const res = await askAnalyst(productId, q)
      clearInterval(timer)
      setStage(AGENT_STAGES.length)
      setMessages((m) => [...m, { role: 'analyst', text: res.answer, agents: res.agents_used }])
    } catch (e) {
      clearInterval(timer)
      setStage(-1)
      setMessages((m) => [...m, { role: 'analyst', text: `I could not complete the analysis: ${e.message}. Please try again.`, agents: [] }])
    } finally {
      setBusy(false)
      setTimeout(() => setStage(-1), 1500)
    }
  }
  return (
    <div className="p-8 max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">AI Analyst</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Grounded in your actual product data — the AI reasons over computed metrics, it does not invent numbers.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-600">Product:</label>
        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
        >
          {products.map((p) => (
            <option key={p.product_id} value={p.product_id}>{p.title}</option>
          ))}
        </select>
      </div>

      <Card className="min-h-[420px] flex flex-col !p-0">
        <div className="flex-1 space-y-4 p-5 overflow-y-auto max-h-[480px]">
          {messages.length === 0 && (
            <EmptyState
              title="Ask about your product"
              message="Try a suggested question below. Answers reference the same metrics shown on your dashboard."
            />
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm whitespace-pre-line ${m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                {m.text}
                {m.role === 'analyst' && m.agents?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.agents.map((a) => <Badge key={a} tone="info">{a.replace('_', ' ')}</Badge>)}
                    <Badge tone="neutral">grounded on computed metrics</Badge>
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="space-y-2 bg-slate-50 rounded-xl p-4 text-sm">
              <div className="text-slate-600 font-medium">Analyzing…</div>
              {AGENT_STAGES.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className={i < stage ? 'text-emerald-600' : i === stage ? 'text-indigo-600' : 'text-slate-300'}>
                    {i < stage ? '✓' : i === stage ? '⟳' : '○'}
                  </span>
                  <span className={i <= stage ? 'text-slate-700' : 'text-slate-400'}>{s.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-slate-200 p-4 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                disabled={busy}
                className="text-xs px-2.5 py-1 rounded-full border border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); ask(question) }} className="flex gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about pricing, competition, demand…"
              className="flex-1 text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              disabled={busy || !productId}
            />
            <button
              type="submit"
              disabled={busy || !question.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Ask
            </button>
          </form>
        </div>
      </Card>
    </div>
  )
}
