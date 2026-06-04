'use client'

import { FolderOpen, Film, Sparkles } from 'lucide-react'
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
      className="group bg-white rounded-[28px] border border-[#EFEBE4] shadow-[0_6px_22px_rgba(40,28,18,0.06)] hover:shadow-[0_18px_50px_rgba(40,28,18,0.10)] hover:-translate-y-1 transition-all duration-200 cursor-pointer overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="p-5 flex-1">
        <div className="flex items-center gap-3">
          {/* Circular outlined icon badge */}
          <div className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 border ${
            isUntagged
              ? 'bg-white border-[#E7E2DB]'
              : 'bg-[#F8E5DD] border-transparent'
          }`}>
            <FolderOpen className={`h-5 w-5 ${isUntagged ? 'text-[#ABA49B]' : 'text-[#E2623F]'}`} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-[#1C1A18] text-[16px] leading-tight truncate">{name}</h3>
            {isUntagged && (
              <p className="text-[12px] text-[#ABA49B] mt-0.5">Unorganized assets</p>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-1">
          <div className="flex items-center gap-1.5">
            <Film className="h-3.5 w-3.5 text-[#ABA49B] shrink-0" />
            <span className="text-[13px] text-[#46413B] font-semibold">
              {count === 0 ? 'No videos' : `${count} video${count !== 1 ? 's' : ''}`}
            </span>
            {pendingCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-[#E2623F] font-medium">
                <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                {pendingCount} rendering
              </span>
            )}
          </div>
          {lastModified && (
            <p className="text-[12px] text-[#ABA49B] pl-5">
              Updated {formatRelativeDate(lastModified)}
            </p>
          )}
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="border-t border-[#EFEBE4]">
        {thumbnails.length > 0 ? (
          <div className="flex gap-px bg-[#F1EEE9]" style={{ height: '80px' }}>
            {thumbnails.map((url, i) => (
              <div key={i} className="flex-1 overflow-hidden bg-[#E7E3DC] relative">
                <video
                  src={url}
                  className="absolute inset-0 w-full h-full object-cover"
                  preload="metadata"
                  muted
                />
              </div>
            ))}
            {count > 4 && (
              <div className="w-12 bg-[#1C1A18] flex items-center justify-center shrink-0">
                <span className="text-[11px] font-bold text-white">+{count - 4}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center bg-[#F1EEE9]" style={{ height: '64px' }}>
            <p className="text-[11px] text-[#ABA49B]">No videos yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
