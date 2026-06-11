'use client'

import { useRef, useState, DragEvent } from 'react'
import { Paperclip, X, FileText, Image, Table2, Code2, File } from 'lucide-react'
import {
  categorizeFile,
  AttachmentCategory,
  PendingAttachment,
  ACCEPTED_EXTENSIONS,
  MAX_FILE_BYTES,
  parseCSV,
} from '@/lib/attachments'

const MAX_FILES = 5

const CATEGORY_ICON: Record<AttachmentCategory, React.ReactNode> = {
  image:      <Image   className="h-3 w-3" />,
  pdf:        <FileText className="h-3 w-3" />,
  'html-css': <Code2   className="h-3 w-3" />,
  csv:        <Table2  className="h-3 w-3" />,
  xlsx:       <Table2  className="h-3 w-3" />,
  document:   <File    className="h-3 w-3" />,
}

const CATEGORY_COLOR: Record<AttachmentCategory, string> = {
  image:      'bg-purple-100 text-purple-700',
  pdf:        'bg-red-100 text-red-700',
  'html-css': 'bg-orange-100 text-orange-700',
  csv:        'bg-emerald-100 text-emerald-700',
  xlsx:       'bg-emerald-100 text-emerald-700',
  document:   'bg-gray-100 text-gray-600',
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n}B`
  if (n < 1_048_576) return `${(n / 1024).toFixed(0)}KB`
  return `${(n / 1_048_576).toFixed(1)}MB`
}

interface AttachmentPickerProps {
  attachments: PendingAttachment[]
  onChange: (next: PendingAttachment[]) => void
}

export function AttachmentPicker({ attachments, onChange }: AttachmentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  async function processFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    const newErrors: string[] = []
    const next: PendingAttachment[] = []

    for (const file of files) {
      if (attachments.length + next.length >= MAX_FILES) {
        newErrors.push(`Max ${MAX_FILES} files allowed`)
        break
      }

      const category = categorizeFile(file)
      const limit = MAX_FILE_BYTES[category]
      if (file.size > limit) {
        newErrors.push(`${file.name} is too large (max ${fmtBytes(limit)})`)
        continue
      }

      const id = crypto.randomUUID()
      const pending: PendingAttachment = { id, file, category }

      if (category === 'image') {
        pending.previewObjectUrl = URL.createObjectURL(file)
      }

      if (category === 'html-css') {
        pending.parsedText = await file.text()
      }

      if (category === 'csv') {
        const text = await file.text()
        const { headers, rows } = parseCSV(text)
        pending.parsedHeaders = headers
        pending.parsedRows = rows
      }

      if (category === 'xlsx') {
        try {
          // Dynamic import keeps xlsx out of the initial bundle
          const XLSX = await import('xlsx')
          const buffer = await file.arrayBuffer()
          const wb = XLSX.read(buffer)
          const sheet = wb.Sheets[wb.SheetNames[0]]
          const raw = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
          pending.parsedRows = raw
          pending.parsedHeaders = raw.length > 0 ? Object.keys(raw[0]) : []
        } catch {
          newErrors.push(`Could not parse ${file.name}`)
          continue
        }
      }

      next.push(pending)
    }

    setErrors(newErrors)
    if (next.length > 0) onChange([...attachments, ...next])
  }

  function remove(id: string) {
    const att = attachments.find(a => a.id === id)
    if (att?.previewObjectUrl) URL.revokeObjectURL(att.previewObjectUrl)
    onChange(attachments.filter(a => a.id !== id))
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files)
  }

  const atMax = attachments.length >= MAX_FILES

  return (
    <div className="space-y-2">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={atMax ? -1 : 0}
        aria-label="Attach files"
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !atMax && inputRef.current?.click()}
        onKeyDown={e => e.key === 'Enter' && !atMax && inputRef.current?.click()}
        className={[
          'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-dashed transition-colors select-none',
          dragOver
            ? 'border-blue-400 bg-blue-50 cursor-copy'
            : atMax
            ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed'
            : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100 cursor-pointer',
        ].join(' ')}
      >
        <Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        <span className="text-[11px] text-gray-400 leading-none">
          {atMax
            ? 'Max files reached'
            : dragOver
            ? 'Drop files here'
            : 'Attach files — images, PDFs, HTML, CSV, XLSX'}
        </span>
        <span className="ml-auto text-[10px] text-gray-300 tabular-nums">
          {attachments.length}/{MAX_FILES}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={e => e.target.files && processFiles(e.target.files)}
      />

      {/* Validation errors */}
      {errors.length > 0 && (
        <ul className="space-y-0.5">
          {errors.map((err, i) => (
            <li key={i} className="text-[10px] text-red-500">{err}</li>
          ))}
        </ul>
      )}

      {/* File chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map(att => (
            <div
              key={att.id}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium max-w-full ${CATEGORY_COLOR[att.category]}`}
            >
              {att.previewObjectUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={att.previewObjectUrl}
                  className="h-4 w-4 rounded object-cover shrink-0"
                  alt=""
                />
              ) : (
                <span className="shrink-0">{CATEGORY_ICON[att.category]}</span>
              )}

              <span className="truncate max-w-[110px]">{att.file.name}</span>

              {att.parsedRows !== undefined && (
                <span className="opacity-60 shrink-0">{att.parsedRows.length} rows</span>
              )}

              <button
                type="button"
                onClick={e => { e.stopPropagation(); remove(att.id) }}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-0.5"
                aria-label={`Remove ${att.file.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
