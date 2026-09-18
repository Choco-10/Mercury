import { randomUUID } from 'node:crypto'
import { normalizeCsv, MAX_ISSUES } from './csv.js'
import { CsvError } from './csv-records.js'
import { createAnalysisSnapshot, AnalysisDataError } from '../services/analysis-run.js'

// Each invocation owns one UUID; no implicit cloud fallback, resume, or whole-upload retry.
export function createIngestion({ objectStore, ledger, forecastOptions }) {
  if (typeof objectStore !== 'function') throw new TypeError('An objectStore dependency is required')
  if (typeof ledger?.putRecordOutcome !== 'function') throw new TypeError('A ledger dependency is required')

  return async function ingestCsv(store, type, csv) {
    const rows = normalizeCsv(csv, type)
    // Validate all product IDs before even artifact/ledger writes.
    const catalog = await store.getProducts()
    const known = new Set(catalog.map((product) => product.product_id))
    const unknown = [...new Set(rows.map((row) => row.product_id))].filter((id) => !known.has(id))
    if (unknown.length) throw new CsvError('Unknown product IDs', 422,
      unknown.slice(0, MAX_ISSUES).map((id) => `Unknown product_id: ${id}`))
    const grouped = new Map()
    for (const row of rows) {
      if (!grouped.has(row.product_id)) grouped.set(row.product_id, [])
      grouped.get(row.product_id).push(row)
    }
    const uploadId = randomUUID()
    const record = {
      upload_id: uploadId, received_at: new Date().toISOString(), dataset_type: type,
      status: 'in_progress', stage: 'validated', rows: rows.length,
      acknowledged_rows: 0, uncertain_rows: 0, not_attempted_rows: rows.length,
      artifacts: { raw: 'not_attempted', normalized: 'not_attempted' },
      analysis: [], error: null,
    }
    let stage = 'ledger'
    let ledgerCreated = false
    let ledgerAcknowledged = false
    const checkpoint = async (create = false) => {
      stage = 'ledger'
      ledgerAcknowledged = false
      record.updated_at = new Date().toISOString()
      await ledger.putRecordOutcome(structuredClone(record), { create })
      ledgerAcknowledged = true
    }
    try {
      await checkpoint(true)
      ledgerCreated = true
      for (const [kind, body, contentType, extension] of [
        ['raw', csv, 'text/csv; charset=utf-8', 'csv'],
        ['normalized', JSON.stringify({ dataset_type: type, records: rows }), 'application/json', 'json'],
      ]) {
        record.stage = `${kind}_artifact`
        record.artifacts[kind] = 'uncertain'
        await checkpoint()
        stage = record.stage
        await objectStore(`uploads/${uploadId}/${kind}.${extension}`, body, contentType)
        record.artifacts[kind] = 'stored'
        await checkpoint()
      }
      for (const [productId, group] of grouped) {
        record.stage = 'dataset_write'
        record.failed_product_id = productId
        record.uncertain_rows = group.length
        record.not_attempted_rows -= group.length
        await checkpoint()
        stage = 'dataset_write'
        if (type === 'sales') await store.putSales(productId, group)
        else await store.putCompetitors(productId, group)
        record.acknowledged_rows += group.length
        record.uncertain_rows = 0
        delete record.failed_product_id
        await checkpoint()
      }
      record.stage = 'analysis'
      for (const productId of grouped.keys()) {
        const outcome = { product_id: productId, status: 'in_progress' }
        record.analysis.push(outcome)
        await checkpoint()
        try {
          stage = 'analysis_read'
          const product = catalog.find((item) => item.product_id === productId)
          // Base-table strong reads include acknowledged upload writes. Not a cross-query snapshot.
          const sales = await store.getSales(productId)
          const competitors = await store.getCompetitorsLatest(productId)
          const snapshot = await createAnalysisSnapshot(product, sales, competitors, forecastOptions)
          outcome.forecast_status = snapshot.forecast_summary.status
          outcome.forecast_reason = snapshot.forecast_summary.reason
          outcome.analysis_id = snapshot.analysis_id
          outcome.status = 'save_uncertain'
          await checkpoint()
          stage = 'analysis_write'
          await store.putAnalysis(snapshot)
          outcome.status = 'completed'
        } catch (err) {
          if (stage === 'ledger' && !ledgerAcknowledged) throw err
          if (err instanceof AnalysisDataError) {
            outcome.status = 'unavailable'
            outcome.issues = err.issues
          } else {
            console.error(`Upload ${uploadId}: analysis failed for ${productId}`, err)
            outcome.status = stage === 'analysis_write' ? 'save_uncertain' : 'failed'
          }
        }
        await checkpoint()
      }
      record.status = record.analysis.every((item) => item.status === 'completed')
        ? 'accepted' : 'accepted_with_analysis_warnings'
      record.stage = 'finished'
      await checkpoint()
      return { statusCode: 200, body: { ...record, ledger_acknowledged: true } }
    } catch (err) {
      console.error(`Upload ${uploadId}: ${stage} failed`, err)
      record.status = 'incomplete'
      record.failure_stage = stage
      record.error = stage === 'ledger'
        ? 'Upload outcome could not be confirmed. Review before retrying.'
        : 'Upload did not complete; artifacts or rows may remain. Review before retrying.'
      if (ledgerCreated && stage !== 'ledger') {
        try { await checkpoint() } catch (ledgerError) {
          console.error(`Upload ${uploadId}: failure outcome could not be saved`, ledgerError)
        }
      }
      return { statusCode: 500, body: {
        ...record, ledger_acknowledged: ledgerAcknowledged,
        partial_writes_possible: record.acknowledged_rows > 0 || record.uncertain_rows > 0,
      } }
    }
  }
}
