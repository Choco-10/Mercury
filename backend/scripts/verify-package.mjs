import assert from 'node:assert/strict'
import { mkdtemp, cp, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

assert.equal(process.versions.node.split('.')[0], '22', 'Run packaging verification with Node 22')
const sharedCheck = spawnSync(process.execPath, [fileURLToPath(new URL('./sync-shared.mjs', import.meta.url)), '--check'], { stdio: 'inherit' })
assert.equal(sharedCheck.status, 0, 'Shared module drift check failed')
const directory = await mkdtemp(join(tmpdir(), 'mercury-package-'))
try {
  await cp(fileURLToPath(new URL('../src/', import.meta.url)), directory, {
    recursive: true, filter: (source) => basename(source) !== 'node_modules',
  })
  await copyFile(new URL('./package-probe.mjs', import.meta.url), join(directory, 'package-probe.mjs'))
  const npmCli = process.env.npm_execpath
  assert.ok(npmCli, 'Run through npm exec or npm run so npm_execpath is available')
  const install = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit' })
  assert.equal(install.status, 0, 'Isolated npm ci failed')
  const probe = spawnSync(process.execPath, [join(directory, 'package-probe.mjs')], {
    cwd: directory, stdio: 'inherit', env: {
      ...process.env, NODE_PATH: '', AWS_EC2_METADATA_DISABLED: 'true', AWS_REGION: 'ap-south-1',
      AWS_ACCESS_KEY_ID: 'offline', AWS_SECRET_ACCESS_KEY: 'offline', AWS_SESSION_TOKEN: '',
      TABLE_NAME: 'offline-table', BUCKET_NAME: 'offline-bucket',
    },
  })
  assert.equal(probe.status, 0, 'Packaged production handler probe failed')
  console.log('PASS: isolated Node 22 package, locked SDK dependencies, shared analytics and production handler')
} finally {
  // Only the fresh temp directory owned by this invocation is removed.
  await rm(directory, { recursive: true, force: true })
}
