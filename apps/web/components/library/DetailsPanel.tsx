'use client'

import { useRef } from 'react'
import { X, Download, Trash2, FolderInput, RefreshCw } from 'lucide-react'
import type { RenderJob, Folder } from '@/lib/types'
import { getVariantFolder } from '@/lib/folders'
import { formatRelativeDate } from '@/lib/utils'

interface DetailsPanelProps {
  variant: RenderJob
  folders: Folder[]
  onClose: () => void
  onDelete: (id: string) => void
}

export function DetailsPanel({ variant, folders, onClose, onDelete }: DetailsPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const folderId = getVariantFolder(variant.id)
  const folderName = folderId
    ? (folders.find(f => f.id === folderId)?.name ?? 'Unknown folder')
    : 'Untagged'

  const handleDownload = () => {
    fetch(variant.output_url!)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = 'variant.mp4'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      })
      .catch(() => window.open(variant.output_url!, '_blank'))
  }

  return (
    <aside className="w-[272px] shrink-0 border-l border-gray-100 bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <h3 className="text-[13px] font-semibold text-gray-900">Details</h3>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Video preview */}
        <div className="p-4 shrink-0">
          <div
            className="rounded-xl overflow-hidden bg-gray-900 cursor-pointer"
            style={{ aspectRatio: '9/16', maxHeight: '200px', margin: '0 auto' }}
            onClick={() => {
              if (videoRef.current?.paused) videoRef.current.play()
              else videoRef.current?.pause()
            }}
          >
            <video
              ref={videoRef}
              src={variant.output_url!}
              className="w-full h-full object-contain"
              preload="metadata"
              muted
              loop
              playsInline
              autoPlay
            />
          </div>
        </div>

        <div className="px-4 pb-4 space-y-4">
          {/* Prompt */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Prompt</p>
            <p className="text-[12px] text-gray-700 leading-relaxed">{variant.prompt}</p>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Generated</p>
              <p className="text-[12px] text-gray-700">
                {formatRelativeDate(variant.completed_at ?? variant.created_at)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Folder</p>
              <p className="text-[12px] text-gray-700 truncate">{folderName}</p>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px bg-gray-100" />

          {/* Actions */}
          <div className="space-y-2">
            <button
              onClick={handleDownload}
              className="w-full flex items-center justify-center gap-2 h-9 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-semibold rounded-xl transition-colors"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="h-9 border border-gray-200 text-gray-600 hover:bg-gray-50 text-[12px] font-medium rounded-xl transition-colors flex items-center justify-center gap-1.5">
                <FolderInput className="h-3 w-3" /> Move
              </button>
              <button
                onClick={() => onDelete(variant.id)}
                className="h-9 border border-red-100 text-red-500 hover:bg-red-50 text-[12px] font-medium rounded-xl transition-colors flex items-center justify-center gap-1.5"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
