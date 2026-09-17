/** Explicit in-memory adapters for offline tests/dev. Nothing persists across restarts. */
export function createMemoryUploadStorage() {
  const objects = new Map()
  const outcomes = new Map()
  return {
    objects, outcomes,
    objectStore: async (key, body, contentType) => {
      if (typeof body !== 'string') throw new TypeError('Artifact body must be text')
      objects.set(key, { body, contentType })
      return { key, etag: null }
    },
    ledger: {
      putRecordOutcome: async (record, { create = false } = {}) => {
        if (outcomes.has(record.upload_id) === create) throw new Error('Ledger create/update condition failed')
        outcomes.set(record.upload_id, structuredClone(record))
      },
      getUpload: async (id) => structuredClone(outcomes.get(id) ?? null),
    },
  }
}
