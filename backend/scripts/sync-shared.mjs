import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const files = ['analytics.js', 'series.js', 'forecast-service.js', 'local-forecast.js', 'backtest.js']
const canonical = (name) => new URL(`../../shared/${name}`, import.meta.url)
const packaged = (name) => new URL(`../src/shared/${name}`, import.meta.url)
for (const name of files) {
  const source = await readFile(canonical(name), 'utf8')
  if (process.argv.includes('--check')) {
    assert.equal(await readFile(packaged(name), 'utf8'), source,
      'Shared analytics drift: run sync-shared.mjs before tests/build')
  } else {
    await writeFile(packaged(name), source, 'utf8')
  }
}
if (process.argv.includes('--check')) {
  console.log('Shared analytics modules match canonical sources')
} else {
  console.log('Copied canonical shared analytics into Lambda source')
}
