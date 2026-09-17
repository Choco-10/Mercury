/** Compatibility for historical seed data; CSV input remains strictly YYYY-MM-DD. */
export function normalizeStoredDate(row, field) {
  const value = row[field]
  return {
    ...row,
    [field]: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)
      ? value.slice(0, 10) : value,
  }
}
