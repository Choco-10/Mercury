import { createLocalServer } from './server.mjs'
import { getDemoDataset } from '../../frontend/src/data/demoData.js'

const server = createLocalServer(getDemoDataset())
try {
  const base = await server.listen(3001)
  console.log(`Mercury OFFLINE API: ${base}/api/products`)
  console.log('Storage: memory only. No AWS fallback. Restart resets uploads, analyses and artifacts.')
  console.log('Allowed browser origins: http://localhost:5173 and http://127.0.0.1:5173')
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { server.close().catch(console.error) })
  }
} catch (err) {
  console.error('Could not start offline API:', err.message)
  process.exitCode = 1
}
