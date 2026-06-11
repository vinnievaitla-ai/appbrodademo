// ─── Attachment types & utilities ────────────────────────────────────────────

export type AttachmentCategory =
  | 'image'
  | 'pdf'
  | 'html-css'
  | 'csv'
  | 'xlsx'
  | 'document'

/** In-browser, before upload */
export interface PendingAttachment {
  id: string
  file: File
  category: AttachmentCategory
  previewObjectUrl?: string              // image thumbnail
  parsedText?: string                    // html/css file contents
  parsedRows?: Record<string, string>[]  // csv/xlsx row data
  parsedHeaders?: string[]
}

/** Serialised for the API POST body */
export interface ProcessedAttachment {
  category: AttachmentCategory
  name: string
  storageUrl?: string                    // image / pdf / document — uploaded to Supabase
  textContent?: string                   // html/css — passed verbatim to renderer
  rows?: Record<string, string>[]        // csv/xlsx — one job per row
  headers?: string[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ACCEPTED_EXTENSIONS =
  '.png,.jpg,.jpeg,.webp,.pdf,.html,.css,.csv,.xlsx,.pptx,.docx,.json'

export const MAX_FILE_BYTES: Record<AttachmentCategory, number> = {
  image: 20 * 1024 * 1024,
  pdf: 20 * 1024 * 1024,
  'html-css': 5 * 1024 * 1024,
  csv: 5 * 1024 * 1024,
  xlsx: 5 * 1024 * 1024,
  document: 20 * 1024 * 1024,
}

// ─── categorizeFile ───────────────────────────────────────────────────────────

export function categorizeFile(file: File): AttachmentCategory {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const mime = file.type.toLowerCase()

  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext) || mime.startsWith('image/')) return 'image'
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (
    ext === 'html' || ext === 'css' ||
    mime === 'text/html' || mime === 'text/css'
  ) return 'html-css'
  if (ext === 'csv' || mime === 'text/csv' || mime === 'application/csv') return 'csv'
  if (
    ext === 'xlsx' ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) return 'xlsx'
  // pptx, docx, json — filename context only (Phase 2 parsing)
  return 'document'
}

// ─── parseCSV ─────────────────────────────────────────────────────────────────
// Handles quoted fields with embedded commas / newlines.

export function parseCSV(text: string): {
  headers: string[]
  rows: Record<string, string>[]
} {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(line => {
    const vals = parseLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })
    return obj
  })
  return { headers, rows }
}

// ─── rowToText ────────────────────────────────────────────────────────────────
// Converts a CSV/XLSX row into a readable string appended to the prompt.

export function rowToText(row: Record<string, string>): string {
  return Object.entries(row)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
}

// ─── formatAttachmentContext ──────────────────────────────────────────────────
// For document-type attachments (PPTX/DOCX/JSON) we can only hint by filename.

export function formatAttachmentContext(attachments: ProcessedAttachment[]): string {
  return attachments
    .filter(a => a.category === 'document')
    .map(a => `Reference file attached: ${a.name} (use context from prompt to interpret)`)
    .join('\n')
}
