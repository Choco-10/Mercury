import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const tests = (await readdir(new URL('../tests/', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))
  .map((name) => fileURLToPath(new URL(`../tests/${name}`, import.meta.url)))
const check = spawnSync(process.execPath, [fileURLToPath(new URL('./sync-shared.mjs', import.meta.url)), '--check'], { stdio: 'inherit' })
if (check.status !== 0) process.exit(check.status || 1)
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' })
process.exit(result.status ?? 1)
