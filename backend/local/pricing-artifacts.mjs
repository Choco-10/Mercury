/** Local model-mapping reader: reuses the repo's stored mappings verbatim. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const modelDir = join(here, '..', '..', 'data', 'model')

function readJson(name) {
  return JSON.parse(readFileSync(join(modelDir, name), 'utf8'))
}

export function createLocalPricingArtifacts() {
  let cache = null
  function all() {
    if (!cache) {
      cache = {
        productMapping: readJson('product_mapping.json'),
        categoryMapping: readJson('category_mapping.json'),
        productCategory: readJson('product_category.json'),
        evaluation: readJson('evaluation.json'),
        metadata: readJson('model_metadata.json'),
      }
    }
    return cache
  }
  const keyFile = (key) => key.split('/').pop()
  return {
    async readJson(key) {
      const file = keyFile(key)
      const map = {
        'product_mapping.json': 'productMapping',
        'category_mapping.json': 'categoryMapping',
        'product_category.json': 'productCategory',
        'evaluation.json': 'evaluation',
        'model_metadata.json': 'metadata',
      }
      const field = map[file]
      if (!field) throw new Error(`unknown local pricing key: ${key}`)
      return structuredClone(all()[field])
    },
    async readText() { return null },
    async writeJson() { return { key: null, offline: true } },
  }
}
