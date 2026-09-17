import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const files = (await readdir(new URL('./', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => fileURLToPath(new URL(name, import.meta.url)))
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })
process.exit(result.status ?? 1)
