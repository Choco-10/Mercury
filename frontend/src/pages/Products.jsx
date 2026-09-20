import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadCatalogAnalyses } from '../services/views.js'
import { fetchProducts, fetchAnalysis, createProduct, updateProduct, deleteProduct } from '../services/api.js'
import { ApiError } from '../services/http.js'
import { formatINR, formatPct } from '../lib/format.js'
import { Badge, Alert, TrendBadge, Skeleton, LoadingState, ErrorState, EmptyState } from "../components/ui.jsx";

const EMPTY_FORM = {
  product_id: '', title: '', category: '', subcategory: '',
  price: '', discount: '', rating: '', inventory: '',
}

export default function Products() {
  const [products, setProducts] = useState(null)
  const [analyses, setAnalyses] = useState({})
  const [analysisErrors, setAnalysisErrors] = useState({})
  const [analysisDone, setAnalysisDone] = useState(false)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const list = await fetchProducts()
        if (cancelled) return
        setProducts(list)
        const results = await loadCatalogAnalyses(list, fetchAnalysis)
        if (!cancelled) {
          setAnalyses(results.analyses)
          setAnalysisErrors(results.errors)
          setAnalysisDone(true)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function cancelForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowForm(true)
  }

  function openEdit(product) {
    setEditingId(product.product_id)
    setForm({
      product_id: product.product_id,
      title: product.title ?? '',
      category: product.category ?? '',
      subcategory: product.subcategory ?? '',
      price: String(product.price ?? ''),
      discount: String(product.discount ?? ''),
      rating: String(product.rating ?? ''),
      inventory: String(product.inventory ?? ''),
    })
    setFormError(null)
    setShowForm(true)
  }

  async function submitProduct(e) {
    e.preventDefault()
    setFormError(null)
    // product_id is immutable on update, so it is only sent when creating.
    const payload = editingId ? {} : { product_id: form.product_id.trim() }
    payload.title = form.title.trim()
    payload.category = form.category.trim()
    // A blank subcategory clears the stored value on update; on create it is omitted.
    if (editingId || form.subcategory.trim()) payload.subcategory = form.subcategory.trim()
    if (form.price !== '') payload.price = Number(form.price)
    if (form.discount !== '') payload.discount = Number(form.discount)
    if (form.rating !== '') payload.rating = Number(form.rating)
    if (form.inventory !== '') payload.inventory = Number(form.inventory)
    setSaving(true)
    try {
      const saved = editingId ? await updateProduct(editingId, payload) : await createProduct(payload)
      const [fresh, results] = await Promise.all([fetchProducts(), loadCatalogAnalyses([saved], fetchAnalysis)])
      setProducts(fresh)
      setAnalyses((previous) => ({ ...previous, ...results.analyses }))
      setAnalysisErrors((previous) => ({ ...previous, ...results.errors }))
      cancelForm()
    } catch (err) {
      setFormError(err instanceof ApiError
        ? err.message
        : `Could not ${editingId ? 'update' : 'create'} the product. Check the backend connection.`)
    } finally {
      setSaving(false)
    }
  }

  function requestDelete(product) {
    setDeleteTarget({ productId: product.product_id, productTitle: product.title })
  }

  function cancelDelete() {
    if (deleteTarget && editingId === deleteTarget.productId) cancelForm()
    setDeleteTarget(null)
  }

  async function removeProduct(product) {
    setDeletingId(product.product_id)
    setDeleteError(null)
    try {
      await deleteProduct(product.product_id)
      const drop = (previous) => {
        const next = { ...previous }
        delete next[product.product_id]
        return next
      }
      setProducts((previous) => previous.filter((row) => row.product_id !== product.product_id))
      setAnalyses(drop)
      setAnalysisErrors(drop)
      if (editingId === product.product_id) cancelForm()
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof ApiError
        ? err.message
        : 'Could not delete the product. Check the backend connection.')
    } finally {
      setDeletingId(null)
    }
  }

  if (error) return <div className="p-8"><ErrorState message={error} onRetry={() => location.reload()} /></div>
  if (!products) return <div className="p-8"><h1 className="text-xl font-semibold">Products</h1><LoadingState /></div>

  const filtered = products.filter((p) => {
    const a = analyses[p.product_id]
    if (filter === 'attention') return a && a.recommendation.status === 'attention'
    if (filter === 'healthy') return a && a.recommendation.status === 'healthy'
    return true
  })

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Products</h1>
          <p className="text-sm text-slate-500 mt-0.5">{products.length} products monitored</p>
        </div>
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'All' },
            { key: 'attention', label: 'Needs attention' },
            { key: 'healthy', label: 'Healthy' },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-sm rounded-lg border ${
                filter === f.key
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div>
        <button
          onClick={() => (showForm ? cancelForm() : openCreate())}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-500"
        >
          {showForm ? 'Cancel' : '+ Add product'}
        </button>
        {showForm && (
          <form
            onSubmit={submitProduct}
            className="mt-4 bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl"
          >
            <p className="md:col-span-2 text-sm font-medium text-slate-700">
              {editingId ? `Editing ${editingId}` : 'New product'}
            </p>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-700">Product ID <span className="text-slate-400">(1-64: letters, digits, _ or -)</span></span>
              <input
                required value={form.product_id} onChange={setField('product_id')}
                placeholder="P006" disabled={saving || Boolean(editingId)}
                className="border border-slate-300 rounded-lg px-3 py-2 disabled:bg-slate-100"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-700">Title</span>
              <input
                required value={form.title} onChange={setField('title')}
                placeholder="Bluetooth Speaker Mini" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-700">Category</span>
              <input
                required value={form.category} onChange={setField('category')}
                placeholder="Electronics" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-600">Subcategory <span className="text-slate-400">(optional)</span></span>
              <input
                value={form.subcategory} onChange={setField('subcategory')}
                placeholder="Speakers" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-700">Price (₹)</span>
              <input
                required type="number" min="0.01" step="any" value={form.price}
                onChange={setField('price')} placeholder="1299" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-600">Discount % <span className="text-slate-400">(0-100, optional)</span></span>
              <input
                type="number" min="0" max="100" step="any" value={form.discount}
                onChange={setField('discount')} placeholder="0" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-600">Rating <span className="text-slate-400">(0-5, optional)</span></span>
              <input
                type="number" min="0" max="5" step="0.1" value={form.rating}
                onChange={setField('rating')} placeholder="4.2" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <label className="text-sm flex flex-col gap-1">
              <span className="text-slate-600">Inventory <span className="text-slate-400">(optional)</span></span>
              <input
                type="number" min="0" step="1" value={form.inventory}
                onChange={setField('inventory')} placeholder="100" disabled={saving}
                className="border border-slate-300 rounded-lg px-3 py-2"
              />
            </label>
            <div className="md:col-span-2 flex items-center gap-3">
              <button
                type="submit" disabled={saving}
                className="px-4 py-2 text-sm rounded-lg bg-slate-900 text-white disabled:opacity-50"
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create product'}
              </button>
              {formError && <Alert variant="rose">{formError}</Alert>}
            </div>
          </form>
        )}
      </div>

      {Object.keys(analysisErrors).length > 0 && <Alert variant="amber">Some products have unavailable analysis; they are not classified as healthy. Open a product for details.</Alert>}
      {deleteError && <Alert variant="rose">{deleteError}</Alert>}
      {filtered.length === 0 ? (
        <EmptyState
          title="No products match this filter"
          message="Try All, inspect uploaded data, or reload to retry analysis. Scheduled analysis is not enabled."
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-x-auto thin-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-5 py-3">Product</th>
                <th className="px-3 py-3">Price</th>
                <th className="px-3 py-3">Rating</th>
                <th className="px-3 py-3">Demand</th>
                <th className="px-3 py-3">14-day fcst</th>
                <th className="px-3 py-3">vs median</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const a = analyses[p.product_id]
                const isDeleting = deletingId === p.product_id
                const isConfirming = deleteTarget?.productId === p.product_id && !isDeleting
                return (
                  <Fragment key={p.product_id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link to={`/products/${p.product_id}`} className="font-medium text-indigo-700 hover:underline">
                        {p.title}
                      </Link>
                      <div className="text-xs text-slate-400">{p.category} · {p.subcategory}</div>
                    </td>
                    <td className="px-3 py-3">
                      {formatINR(p.price)}
                      {p.discount > 0 && <span className="text-xs text-slate-400 ml-1">−{p.discount}%</span>}
                    </td>
                    <td className="px-3 py-3">★ {p.rating}</td>
                    <td className="px-3 py-3">
                      {a ? <TrendBadge direction={a.demand.trend} changePct={a.demand.change_pct} /> : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-5 w-24" />}
                    </td>
                    <td className="px-3 py-3">
                      {a ? (
                        <Badge tone={a.forecast_summary.delta_vs_recent_pct >= 0 ? 'good' : 'warn'}>
                          {a.forecast_summary.delta_vs_recent_pct >= 0 ? '↑' : '↓'} {formatPct(a.forecast_summary.delta_vs_recent_pct)}
                        </Badge>
                      ) : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-5 w-16" />}
                    </td>
                    <td className="px-3 py-3">
                      {a ? (
                        <Badge tone={a.competitor_metrics.seller_vs_median_pct > 3 ? 'warn' : 'neutral'}>
                          {formatPct(a.competitor_metrics.seller_vs_median_pct)}
                        </Badge>
                      ) : analysisDone ? <span>Unavailable</span> : <Skeleton className="h-5 w-16" />}
                    </td>
                    <td className="px-3 py-3">
                      {a ? (
                        <Badge tone={a.recommendation.status === 'attention' ? 'warn' : 'good'}>
                          {a.recommendation.status === 'attention' ? '⚠ attention' : '✓ healthy'}
                        </Badge>
                      ) : analysisDone ? <span title={analysisErrors[p.product_id]}>Unavailable</span> : <Skeleton className="h-5 w-20" />}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <button
                        onClick={() => openEdit(p)}
                        disabled={isDeleting}
                        className="text-xs text-indigo-600 hover:underline disabled:opacity-40"
                      >
                        Edit
                      </button>
                      {isConfirming ? (
                        <button
                          onClick={cancelDelete}
                          className="text-xs text-slate-600 hover:underline ml-3"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => requestDelete(p)}
                          disabled={isDeleting}
                          className="text-xs text-rose-600 hover:underline ml-3 disabled:opacity-40"
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isConfirming && (
                    <tr className="border-b border-slate-100 bg-rose-50">
                      <td colSpan={8} className="px-5 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm text-slate-700">
                            Delete &quot;{deleteTarget.productTitle}&quot;? This also removes its sales history, competitor observations and saved analyses. This cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={cancelDelete}
                              className="px-3 py-1.5 text-xs rounded-lg border bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => removeProduct(p)}
                              className="px-3 py-1.5 text-xs rounded-lg bg-rose-600 text-white hover:bg-rose-500"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
