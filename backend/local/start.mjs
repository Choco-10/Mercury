import { createLocalServer } from './server.mjs'
import { getEmptyDataset } from '../../shared/emptyDataset.js'
import { createLocalBedrockClient, createLocalEndpointInvoker } from './pricing-doubles.mjs'
import { createPricingWorkflow } from '../src/services/pricing/workflow.js'
import { createLocalPricingArtifacts } from './pricing-artifacts.mjs'
import { createMemoryStore } from './memory-store.mjs'

const store = createMemoryStore(getEmptyDataset())
const workflow = createPricingWorkflow({
  store,
  artifacts: createLocalPricingArtifacts(),
  invokeEndpoint: createLocalEndpointInvoker(),
  bedrock: createLocalBedrockClient(),
  config: { bucket: 'local-offline' },
})
const server = createLocalServer(getEmptyDataset(), {
  store,
  // Offline pricing doubles only: deterministic endpoint math + a deterministic
  // Bedrock stand-in. Production (backend/src/handlers/api.mjs) never imports these.
  pricing: {
    recommend: (input) => workflow.recommend(input),
    simulate: (productId, objective) => workflow.simulate(productId, objective),
  },
})
try {
  const base = await server.listen(3001)
  console.log(`Mercury OFFLINE API: ${base}/api/products`)
  console.log('Catalog: empty. Add products via the UI (+ Add product) or POST /api/products, then upload CSVs.')
  console.log('Storage: memory only. No AWS fallback. Restart resets uploads, analyses and artifacts.')
  console.log('Allowed browser origins: http://localhost:5173 and http://127.0.0.1:5173')
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { server.close().catch(console.error) })
  }
} catch (err) {
  console.error('Could not start offline API:', err.message)
  process.exitCode = 1
}
