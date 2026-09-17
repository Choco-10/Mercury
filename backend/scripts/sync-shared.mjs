import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const canonical = new URL('../../shared/analytics.js', import.meta.url)
const packaged = new URL('../src/shared/analytics.js', import.meta.url)
const source = await readFile(canonical, 'utf8')
if (process.argv.includes('--check')) {
  assert.equal(await readFile(packaged, 'utf8'), source, 'Shared analytics drift: run sync-shared.mjs before tests/build')
  console.log('Shared analytics matches canonical source')
} else {
  await writeFile(packaged, source, 'utf8')
  console.log('Copied canonical shared analytics into Lambda source')
}
