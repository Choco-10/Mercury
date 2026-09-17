export const MAX_CSV_BYTES = 256 * 1024
export const MAX_CSV_ROWS = 2000

export class CsvError extends Error {
  constructor(message, statusCode = 422, issues = [message]) {
    super(message)
    this.statusCode = statusCode
    this.issues = issues
  }
}

// Strict comma-delimited CSV: escaped quotes and embedded newlines are supported.
export function csvRecords(text) {
  if (typeof text !== 'string' || !text.trim()) throw new CsvError('csv must be a nonempty string', 400)
  if (new TextEncoder().encode(text).length > MAX_CSV_BYTES) throw new CsvError('CSV exceeds 256 KiB limit', 413)
  const source = text.replace(/^\uFEFF/, '')
  const records = []
  let row = []
  let field = ''
  let quoted = false
  let closed = false
  let touched = false
  function cell() {
    row.push(field.trim())
    field = ''
    closed = false
  }
  function record() {
    if (touched || row.length || field.length) {
      cell()
      records.push(row)
      if (records.length > MAX_CSV_ROWS + 1) throw new CsvError('CSV exceeds 2000 data-row limit', 413)
    }
    row = []
    touched = false
  }
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { field += '"'; i++ }
        else { quoted = false; closed = true }
      } else field += ch
      continue
    }
    if (ch === ',') { cell(); touched = true; continue }
    if (ch === '\r' || ch === '\n') {
      record()
      if (ch === '\r' && source[i + 1] === '\n') i++
      continue
    }
    if (closed) throw new CsvError('Unexpected character after closing CSV quote')
    touched = true
    if (ch === '"') {
      if (field.length) throw new CsvError('Unexpected quote inside unquoted CSV field')
      quoted = true
    } else field += ch
  }
  if (quoted) throw new CsvError('Unclosed CSV quote')
  record()
  return records
}
