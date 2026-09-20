import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
// Every canonical file that must also exist inside the deployed Lambda bundle
// (CodeUri ../backend/src). Keep this list in sync with aws-plan.md Phase 4.
const files = [
  { from: '../../shared/analytics.js', to: '../src/shared/analytics.js' },
  { from: '../../shared/series.js', to: '../src/shared/series.js' },
  { from: '../../shared/forecast-service.js', to: '../src/shared/forecast-service.js' },
  { from: '../../shared/local-forecast.js', to: '../src/shared/local-forecast.js' },
  { from: '../../shared/pricing-contract.json', to: '../src/shared/pricing-contract.json' },
  { from: '../../bedrock/supervisor_agent_prompt.txt', to: '../src/bedrock/supervisor_agent_prompt.txt' },
  { from: '../../bedrock/market_analyst_agent_prompt.txt', to: '../src/bedrock/market_analyst_agent_prompt.txt' },
  { from: '../../bedrock/competitor_analyst_agent_prompt.txt', to: '../src/bedrock/competitor_analyst_agent_prompt.txt' },
  { from: '../../bedrock/pricing_analyst_agent_prompt.txt', to: '../src/bedrock/pricing_analyst_agent_prompt.txt' },
]
const resolve = (path) => new URL(path, import.meta.url)
for (const { from, to } of files) {
  const source = await readFile(resolve(from), 'utf8')
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(resolve(to), 'utf8'), source,
      `Packaged copy out of date: run sync-shared.mjs before tests/build (${to})`)
  } else {
    await mkdir(new URL(to.replace(/\/[^/]+$/, '/'), import.meta.url), { recursive: true })
    await writeFile(resolve(to), source, 'utf8')
  }
}
if (process.argv.includes('--check')) {
  console.log('Shared analytics, pricing contract and Bedrock prompts match canonical sources')
} else {
  console.log('Copied canonical shared modules, pricing contract and Bedrock prompts into Lambda source')
}
