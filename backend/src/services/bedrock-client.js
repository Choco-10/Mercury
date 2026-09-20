/**
 * Bedrock Runtime client for every agent call in Mercury.
 *
 * There is no mock path: the deployed system always calls
 * `@aws-sdk/client-bedrock-runtime` on demand (token billing, no provisioning). The
 * offline development server injects its own double from backend/local/, which is dev
 * tooling and is never imported by the Lambda bundle.
 *
 * Numbers are never produced here — the model interprets values that deterministic
 * code supplied (ai.md §22).
 */
import { readFileSync } from 'node:fs'

const DEFAULT_MODEL_ID = 'anthropic.claude-3-haiku-20240307-v1:0'

const DEFAULT_SYSTEM_PROMPT = `You are an AI Analyst Agent for Amazon Seller Intelligence. Interpret product data and explain to sellers.

CRITICAL RULES:
1. ONLY interpret data provided in context. Do NOT calculate anything.
2. When mentioning a number, it MUST come from context fields.
3. Cite specific field names when referencing values.
4. If context lacks needed data, say so clearly.
5. Do NOT claim causation unless data clearly supports it.
6. Return valid JSON with findings, summary, confidence, data_sources.
Do NOT invent numbers. Cite data_sources for every value used.`

function parseJsonObject(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const candidates = [trimmed]
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1))
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value
    } catch {
      // try the next candidate
    }
  }
  return null
}

export class ProductionBedrockClient {
  constructor(config = {}) {
    this.config = config
    this.modelId = config.modelId || process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT
    this.client = null
    this.ConverseCommand = null
  }

  async connect() {
    if (this.client) return
    // Imported lazily so cold starts that never reach Bedrock stay cheap.
    const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
    this.ConverseCommand = ConverseCommand
    this.client = new BedrockRuntimeClient({
      region: this.config.region || process.env.AWS_REGION || 'ap-south-1',
      maxAttempts: 3,
    })
  }

  /** Low-level call returning the assistant text. */
  async converseText({ system, user, modelId, maxTokens = 2000, temperature = 0.1 } = {}) {
    if (!user) throw new Error('A user message is required')
    await this.connect()
    const command = new this.ConverseCommand({
      modelId: modelId || this.modelId,
      messages: [{ role: 'user', content: [{ text: user }] }],
      system: [{ text: system || this.systemPrompt }],
      inferenceConfig: { maxTokens, temperature },
    })
    const response = await this.client.send(command)
    const text = response.output?.message?.content?.[0]?.text
    if (!text) throw new Error('Empty response from Bedrock')
    return text
  }

  /**
   * Call Bedrock and parse the JSON object the prompts demand.
   *
   * A model that wraps the JSON in prose or fences is retried once with an explicit
   * instruction; a second failure is surfaced as an error so the caller can fall back
   * deterministically instead of accepting unparseable output.
   */
  async converseJson(options = {}) {
    const { retryOnParseError = true } = options
    const first = await this.converseText(options)
    const parsed = parseJsonObject(first)
    if (parsed) return parsed
    if (!retryOnParseError) throw new Error('Bedrock did not return a JSON object')
    const second = await this.converseText({
      ...options,
      user: `${options.user}\n\nYour previous answer was not valid JSON. Reply with the JSON object only.`,
    })
    const retried = parseJsonObject(second)
    if (!retried) throw new Error('Bedrock did not return a JSON object')
    return retried
  }

  /** Legacy entry point used by the /api/ai/chat multi-agent system. */
  async converse(input) {
    const { agent, product_id, question, context } = input
    const userContent = JSON.stringify({ agent, product_id, question, context })
    const text = await this.converseText({ user: userContent, maxTokens: 4000 })
    const parsed = parseJsonObject(text)
    if (parsed) return parsed
    console.error('Failed to parse Bedrock response as JSON')
    return { agent, product_id, findings: [], summary: text, confidence: 'low', data_sources: [] }
  }
}

/**
 * Read a Bedrock prompt template from bedrock/*.txt (ai.md §28).
 *
 * The packaged copies live in backend/src/bedrock/ and are kept byte-identical to the
 * canonical files by backend/scripts/sync-shared.mjs (`npm run check-shared`).
 */
export function readPrompt(name) {
  if (!/^[a-z_]+\.txt$/.test(name)) throw new Error(`Invalid prompt name: ${name}`)
  // Resolves to backend/src/bedrock/<name>.txt inside the Lambda bundle.
  return readFileSync(new URL(`../bedrock/${name}`, import.meta.url), 'utf8')
}

/**
 * The only way the backend obtains a Bedrock client: the real runtime client.
 * A missing region is a configuration error, never a reason to fall back to a mock.
 */
export function createBedrockClient(config = {}) {
  const region = config.region || process.env.AWS_REGION
  if (!region) {
    throw new Error('AWS_REGION is required to create the Bedrock client')
  }
  return new ProductionBedrockClient({ ...config, region })
}
