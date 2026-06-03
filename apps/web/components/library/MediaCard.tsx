'use client'

import { useState } from 'react'
import { MoreHorizontal, FileVideo } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface MediaCardProps {
  id: string
  name: string
  fileUrl: string
  fileSizeBytes: number
  onDelete?: (id: string) => void
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function MediaCard({ id, name, fileUrl, fileSizeBytes, onDelete }: MediaCardProps) {
  const [videoError, setVideoError] = useState(false)
  const size = formatSize(fileSizeBytes)

  return (
    <div className="group w-[196px] rounded-lg border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-shadow cursor-default">
      {/* Thumbnail */}
      <div className="relative bg-gray-900" style={{ aspectRatio: '196/120' }}>
        {!videoError ? (
          <video
            src={fileUrl}
            className="w-full h-full object-cover"
            preload="metadata"
            muted
            onError={() => setVideoError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <FileVideo className="h-8 w-8 text-gray-500" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-2.5 py-2">
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <FileVideo className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-px" />
            <span className="text-xs text-gray-900 truncate leading-tight">{name}</span>
          </div>
          {onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger className="shrink-0 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-red-600 cursor-pointer"
                  onClick={() => onDelete(id)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {size && (
          <p className="text-[11px] text-gray-400 mt-0.5 pl-5">MP4 • {size}</p>
        )}
      </div>
    </div>
  )
}
