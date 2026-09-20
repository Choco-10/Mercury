/**
 * The Lambda pricing workflow (ai.md §26, in order) shared by
 * `POST /pricing/recommend` and `POST /api/products/{id}/simulate-price`.
 *
 *   1 validate product_id            10 invoke SageMaker per candidate (§18)
 *   2 validate objective             11 store predicted units
 *   3 load seller history from S3    12 (yes, all seven — one call each)
 *   4 load competitor data           13 compute predicted revenue in app code (§19)
 *   5 filter for the product         14 build the scenario JSON (§20)
 *   6 compute latest features (§7)   15 send scenarios + competitors + objective to Bedrock
 *   7 identify the current price     16 receive the recommendation
 *   8 build seven candidates (§17)   17 validate recommended_price ∈ candidates (§27)
 *   9 build candidate rows (§18)     18 return the response (§24)
 *
 * Injection points keep this testable and keep the AWS SDK out of the pure logic:
 *   store            getProduct/getSales/getCompetitorsLatest
 *   artifacts        { readJson(key), readText(key), writeJson(key, value) } | null
 *   invokeEndpoint   async (payload) => predicted units | null when unconfigured
 *   bedrock          Bedrock client (real runtime client in production)
 */
import { CONTRACT, PricingError } from './contract.js'
import { readPrompt } from '../bedrock-client.js'
import { AGENT_PROMPTS, reaskSupervisor, runPricingAgents } from './bedrock-agents.js'
import { endpointPayload, latestCompetitors, latestInferenceFeatures,
  normalizeStoreSales, parseCompetitorsCsv, parseSalesCsv } from './feature-engineering.js'
import { objectiveOptimal, simulateCandidates } from './price-simulator.js'

const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

export function createPricingWorkflow(deps) {
  const {
    store,
    artifacts = null,
    invokeEndpoint = null,
    bedrock = null,
    config = {},
    now = () => new Date(),
  } = deps
  const {
    bucket = process.env.S3_BUCKET,
    endpointName = process.env.SAGEMAKER_ENDPOINT_NAME,
    modelPrefix = 'pricing-ai/model/xgboost',
    sellerUploadPrefix = 'pricing-ai/seller/uploads',
    sellerSalesKey = `${sellerUploadPrefix}/seller_sales.csv`,
    sellerCompetitorsKey = `${sellerUploadPrefix}/competitors.csv`,
    predictionsPrefix = 'pricing-ai/predictions',
  } = config

  let prompts = null
  let modelArtifacts = null
  const readJson = artifacts?.readJson
  const readText = artifacts?.readText

  async function loadPrompts() {
    if (!prompts) {
      prompts = Object.fromEntries(Object.entries(AGENT_PROMPTS).map(
        ([agent, file]) => [agent, readPrompt(file)]))
    }
    return prompts
  }

  /** Model evaluation + metadata, read once per container (they only change on retrain).
   * The product-agnostic model has no per-product mappings — any product with enough
   * history is supported, so nothing else is required for inference. */
  async function loadModelArtifacts() {
    if (modelArtifacts) return modelArtifacts
    if (typeof readJson !== 'function') {
      throw new PricingError('the S3 artifact reader is not configured', 'aws_not_configured')
    }
    const [evaluation, metadata] = await Promise.all([
      readJson(`${modelPrefix}/evaluation.json`).catch(() => null),
      readJson(`${modelPrefix}/model_metadata.json`).catch(() => null),
    ])
    modelArtifacts = { evaluation, metadata }
    return modelArtifacts
  }

  /**
   * Seller history + competitors (ai.md §16 steps 3-5).
   *
   * The S3 upload is the documented source; the DynamoDB store rows written by the
   * upload pipeline use the identical schema, so they are the fallback (and the only
   * source in the offline/dev server). Whichever source actually has the requested
   * product wins, preferring the one with more history; competitors are read from the
   * same source, falling back to the store's latest observations when the upload has
   * no competitor file.
   */
  async function loadSellerData(productId) {
    const sources = []
    if (typeof readText === 'function' && bucket) {
      const [salesText, competitorsText] = await Promise.all([
        readText(sellerSalesKey).catch(() => null),
        readText(sellerCompetitorsKey).catch(() => null),
      ])
      if (salesText) {
        sources.push({
          source: 's3',
          key: sellerSalesKey,
          sales: parseSalesCsv(salesText),
          competitors: competitorsText ? parseCompetitorsCsv(competitorsText) : [],
        })
      }
    }
    const storeSales = normalizeStoreSales(await store.getSales(productId), productId)
    const storeCompetitors = await store.getCompetitorsLatest(productId)
    sources.push({ source: 'store', key: `PRODUCT#${productId}/SALES#`, sales: storeSales,
      competitors: storeCompetitors })

    const ranked = sources
      .map((entry) => ({ ...entry,
        rows: entry.sales.filter((row) => String(row.product_id) === String(productId)).length }))
      .sort((a, b) => b.rows - a.rows)
    const chosen = ranked[0]
    if (!chosen || chosen.rows === 0) {
      throw new PricingError(`no seller history for product ${productId}`, 'no_seller_history')
    }
    let competitors = latestCompetitors(chosen.competitors, productId)
    if (!competitors.length) {
      const alternatives = ranked.filter((entry) => entry.source !== chosen.source)
      for (const entry of alternatives) {
        competitors = latestCompetitors(entry.competitors, productId)
        if (competitors.length) break
      }
    }
    return { ...chosen, competitors }
  }

  function validateRecommendInput(productId, objective) {
    if (typeof productId !== 'string' || !PRODUCT_ID_PATTERN.test(productId)) {
      throw new PricingError(
        'product_id is required: 1-64 letters, digits, underscore or hyphen', 'invalid_input')
    }
    if (!CONTRACT.objectives.includes(objective)) {
      throw new PricingError(
        `objective must be one of ${CONTRACT.objectives.join(' | ')}`, 'invalid_input')
    }
  }

  /**
   * Steps 6-18 (ai.md S26): features -> current price -> 7 candidates ->
   * 7x InvokeEndpoint -> revenue in app code -> agents -> hard validation ->
   * persist the recommendation under predictions/ -> response (S24).
   */
  async function recommend({ product_id: productId, objective }) {
    validateRecommendInput(productId, objective) // steps 1-2
    if (typeof bedrock?.converseJson !== 'function') {
      throw new PricingError('the Bedrock client is not configured', 'bedrock_unavailable')
    }
    if (typeof invokeEndpoint !== 'function') {
      throw new PricingError('the SageMaker endpoint is not configured', 'aws_not_configured')
    }

    let product = null
    if (typeof store.getProduct === 'function') {
      product = await store.getProduct(productId)
      if (!product) {
        throw Object.assign(
          new PricingError(`product ${productId} not found`, 'invalid_input'),
          { statusCode: 404 })
      }
    }

    const sellerData = await loadSellerData(productId) // steps 3-5
    const inference = latestInferenceFeatures(sellerData.sales.filter(
      (row) => String(row.product_id) === String(productId)), productId) // steps 6-7
    const { features: baseFeatures, current_price: currentPrice } = inference

    const simulation = await simulateCandidates({ // steps 8-13
      baseFeatures, currentPrice, invoke: invokeEndpoint, endpointName,
    })
    const candidatePrices = simulation.scenarios.map((scenario) => scenario.price)
    const optimal = objectiveOptimal(simulation.scenarios, objective)

    const prompts = await loadPrompts()
    const { recommendation, agents } = await runPricingAgents({ // steps 14-16
      bedrock, prompts, productId, objective, currentPrice, product,
      historySummary: inference.history_summary,
      competitors: sellerData.competitors, simulation,
    })

    // Step 17 - hard validation: the price MUST be one of the 7 candidates.
    let final = recommendation
    let corrected = false
    if (!candidatePrices.includes(final?.recommended_price)) {
      const retry = await reaskSupervisor({ bedrock, prompts, objective,
        candidatePrices, previous: final ?? null })
      if (candidatePrices.includes(retry?.recommended_price)) {
        final = retry
        corrected = true
      } else {
        // Deterministic fallback: the objective-optimal scenario. Units and
        // revenue are copied from the scenario row, never invented by the LLM.
        final = {
          recommended_price: optimal.price,
          objective,
          reasoning: 'Bedrock returned a price outside the seven evaluated '
            + 'candidates, so the objective-optimal candidate was selected '
            + 'deterministically.',
          confidence: 'low',
          missing_data: ['bedrock_recommendation_rejected'],
        }
        corrected = true
      }
    }
    const scenario = simulation.scenarios.find(
      (entry) => entry.price === final.recommended_price)
    const response = { // step 18 (S24)
      product_id: productId,
      objective,
      current_price: currentPrice,
      inference_date: inference.inference_date,
      recommended_price: scenario.price,
      predicted_units: scenario.predicted_units,
      predicted_revenue: scenario.predicted_revenue,
      reasoning: final.reasoning ?? final.summary ?? '',
      competitor_comparison: final.competitor_comparison ?? null,
      confidence: final.confidence ?? null,
      candidates: simulation.scenarios,
      agents,
      ...(corrected ? { corrected_out_of_range: true } : {}),
    }

    // Best-effort audit trail under predictions/ (ai.md S5); a failed write
    // must never fail the recommendation itself.
    if (typeof artifacts?.writeJson === 'function' && bucket) {
      const stamp = now().toISOString().replace(/[:.]/g, '-')
      const key = `${predictionsPrefix}/${productId}/${inference.inference_date}-${stamp}.json`
      try {
        await artifacts.writeJson(key, { ...response, saved_at: now().toISOString() })
        response.prediction_key = key
      } catch (err) {
        console.error(`pricing workflow: could not persist ${key}`, err)
      }
    }
    return response
  }

  async function simulate(productId, objective = 'maximize_revenue') {
    // Same core as recommend minus Bedrock agents, full validation, persistence.
    if (typeof productId !== 'string' || !PRODUCT_ID_PATTERN.test(productId)) {
      throw new PricingError('product_id must be 1-64 alphanumeric/_- characters', 'invalid_input')
    }
    if (!CONTRACT.objectives.includes(objective)) {
      throw new PricingError(
        `objective must be one of ${CONTRACT.objectives.join(' | ')}`,
        'invalid_input',
      )
    }

    const product = await store.getProduct(productId)
    if (!product) {
      throw new PricingError(`no product found for ${productId}`, 'unsupported_product')
    }

    const sellerData = await loadSellerData(productId) // steps 3-5
    const inference = latestInferenceFeatures(
      sellerData.sales.filter((row) => String(row.product_id) === String(productId)),
      productId,
    ) // steps 6-7
    const { features: baseFeatures, current_price: currentPrice } = inference

    const simulation = await simulateCandidates({ // steps 8-13, 7x invokeEndpoint, app-side revenue
      baseFeatures,
      currentPrice,
      invoke: invokeEndpoint,
      endpointName,
    })
    const candidatePrices = simulation.scenarios.map((scenario) => scenario.price)
    const optimal = objectiveOptimal(simulation.scenarios, objective)

    // No Bedrock: deterministic objective-optimal pick, with a low-confidence marker.
    const scenario = simulation.scenarios.find(
      (entry) => entry.price === optimal.price,
    )
    return {
      product_id: productId,
      objective,
      current_price: currentPrice,
      inference_date: inference.inference_date,
      recommended_price: scenario.price,
      predicted_units: scenario.predicted_units,
      predicted_revenue: scenario.predicted_revenue,
      reasoning: 'Pricing simulation ran the seven candidate prices through the SageMaker model and selected the objective-optimal candidate deterministically; no Bedrock agent review was performed.',
      competitor_comparison: null,
      confidence: 'low',
      candidates: simulation.scenarios,
      missing_data: ['no_bedrock_agent_review'],
    }
  }

  return { recommend, simulate }
}

