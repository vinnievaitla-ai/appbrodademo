'use client'

import { FolderOpen, Film, MoreHorizontal, Sparkles } from 'lucide-react'
import type { RenderJob } from '@/lib/types'
import { formatRelativeDate } from '@/lib/utils'

interface FolderCardProps {
  id: string
  name: string
  createdAt?: string
  variants: RenderJob[]
  pendingCount?: number
  isUntagged?: boolean
  onClick: () => void
}

export function FolderCard({
  name, variants, pendingCount = 0, isUntagged = false, onClick
}: FolderCardProps) {
  const count = variants.length
  const thumbnails = variants
    .filter(v => v.output_url)
    .slice(0, 4)
    .map(v => v.output_url!)

  const lastModified = variants.length > 0
    ? variants.reduce((latest, v) => {
        const t = v.completed_at ?? v.created_at
        return t > latest ? t : latest
      }, variants[0].completed_at ?? variants[0].created_at)
    : null

  return (
    <div
      onClick={onClick}
      className="group bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="p-4 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
              isUntagged ? 'bg-gray-100' : 'bg-blue-50'
            }`}>
              <FolderOpen className={`h-4 w-4 ${isUntagged ? 'text-gray-400' : 'text-blue-500'}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">{name}</h3>
              {isUntagged && (
                <p className="text-[11px] text-gray-400 mt-0.5">Unorganized assets</p>
              )}
            </div>
          </div>
          <button
            onClick={e => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all shrink-0"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Film className="h-3 w-3 text-gray-400 shrink-0" />
            <span className="text-[12px] text-gray-600 font-medium">
              {count === 0 ? 'No videos' : `${count} video${count !== 1 ? 's' : ''}`}
            </span>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-blue-500 font-medium">
                <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                {pendingCount} rendering
              </span>
            )}
          </div>
          {lastModified && (
            <p className="text-[11px] text-gray-400 pl-[18px]">
              Updated {formatRelativeDate(lastModified)}
            </p>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="border-t border-gray-100">
        {thumbnails.length > 0 ? (
          <div className="flex gap-px bg-gray-100" style={{ height: '80px' }}>
            {thumbnails.map((url, i) => (
              <div key={i} className="flex-1 overflow-hidden bg-gray-200 relative">
                <video
                  src={url}
                  className="absolute inset-0 w-full h-full object-cover"
                  preload="metadata"
                  muted
                />
              </div>
            ))}
            {count > 4 && (
              <div className="w-12 bg-gray-800/70 flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-white">+{count - 4}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center bg-gray-50" style={{ height: '64px' }}>
            <p className="text-[11px] text-gray-400">No videos yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
