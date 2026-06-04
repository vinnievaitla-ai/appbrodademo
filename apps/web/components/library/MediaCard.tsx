'use client'

import { useState, useRef } from 'react'
import { MoreHorizontal, FileVideo, Sparkles, Play, Download, X, Pause } from 'lucide-react'
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
  isGenerated?: boolean
  onDelete?: (id: string) => void
  onGenerate?: (id: string, name: string, fileUrl: string) => void
}

function formatSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function VideoModal({ fileUrl, name, onClose }: { fileUrl: string; name: string; onClose: () => void }) {
  const [isPlaying, setIsPlaying] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  const togglePlay = () => {
    if (!videoRef.current) return
    if (videoRef.current.paused) {
      videoRef.current.play()
      setIsPlaying(true)
    } else {
      videoRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleDownload = () => {
    // Fetch as blob so the browser shows Save-As instead of navigating away
    fetch(fileUrl)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = (name || 'variant') + '.mp4'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      })
      .catch(() => {
        // Fallback: open in new tab
        window.open(fileUrl, '_blank')
      })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-3 max-h-[95vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 h-7 w-7 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors"
        >
          <X className="h-3.5 w-3.5 text-white" />
        </button>

        {/* Video — portrait 9:16 */}
        <div className="relative" style={{ height: 'min(75vh, 540px)', aspectRatio: '9/16' }}>
          <video
            ref={videoRef}
            src={fileUrl}
            autoPlay
            loop
            playsInline
            className="h-full w-full rounded-xl object-contain bg-black"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
          {/* Click-to-toggle overlay */}
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-xl"
          >
            <div className="h-12 w-12 rounded-full bg-black/50 flex items-center justify-center">
              {isPlaying
                ? <Pause className="h-5 w-5 text-white" fill="white" />
                : <Play className="h-5 w-5 text-white ml-0.5" fill="white" />}
            </div>
          </button>
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2">
          <span className="text-white/60 text-xs truncate max-w-[180px]">{name}</span>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-900 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>
      </div>
    </div>
  )
}

export function MediaCard({ id, name, fileUrl, fileSizeBytes, isGenerated, onDelete, onGenerate }: MediaCardProps) {
  const [videoError, setVideoError] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const size = formatSize(fileSizeBytes)

  const handleVideoLoad = () => {
    if (videoRef.current) videoRef.current.currentTime = 0.001
  }

  const handleDownload = () => {
    fetch(fileUrl)
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = (name || 'variant') + '.mp4'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
      })
      .catch(() => window.open(fileUrl, '_blank'))
  }

  const showMenu = !!(onDelete || onGenerate || isGenerated)

  return (
    <>
      <div
        className="group w-[196px] rounded-[22px] border border-[#EFEBE4] bg-white overflow-hidden transition-all duration-200 shadow-[0_2px_8px_rgba(40,28,18,0.05)] hover:shadow-[0_12px_32px_rgba(40,28,18,0.10)] hover:-translate-y-1 cursor-default"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Thumbnail */}
        <div className="relative overflow-hidden" style={{ aspectRatio: '16/10' }}>
          <div className="absolute inset-0 bg-gray-950" />

          {!videoError ? (
            <video
              ref={videoRef}
              src={fileUrl}
              className="absolute inset-0 w-full h-full object-contain"
              preload="metadata"
              muted
              playsInline
              onLoadedMetadata={handleVideoLoad}
              onError={() => setVideoError(true)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
              <FileVideo className="h-7 w-7 text-gray-500" />
            </div>
          )}

          {/* Bottom gradient */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />

          {/* Generated badge */}
          {isGenerated && (
            <div className="absolute top-2 left-2 flex items-center gap-1 bg-[#E2623F]/90 backdrop-blur-sm rounded-full px-2 py-0.5">
              <Sparkles className="h-2.5 w-2.5 text-white" />
              <span className="text-[9px] font-semibold text-white uppercase tracking-wide">HF</span>
            </div>
          )}

          {/* Hover overlays */}
          <div className={`absolute inset-0 transition-opacity duration-200 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            {onGenerate ? (
              /* Generate overlay for templates */
              <button
                onClick={() => onGenerate(id, name, fileUrl)}
                className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 backdrop-blur-[1px]"
              >
                <div className="h-9 w-9 rounded-full bg-white/15 border border-white/30 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="text-white text-[11px] font-semibold tracking-wide">Generate Variant</span>
              </button>
            ) : isGenerated ? (
              /* Play overlay for generated variants — opens modal */
              <button
                onClick={() => setShowModal(true)}
                className="absolute inset-0 bg-black/30 flex items-center justify-center"
              >
                <div className="h-9 w-9 rounded-full bg-white/20 border border-white/40 flex items-center justify-center">
                  <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
                </div>
              </button>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="px-3 py-2.5">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <FileVideo className="h-3 w-3 text-[#ABA49B] shrink-0 mt-px" />
                <span className="text-[12px] font-semibold text-[#1C1A18] truncate leading-tight">{name}</span>
              </div>
              {size && (
                <p className="text-[11px] text-[#ABA49B] mt-0.5 pl-[18px]" style={{fontFamily:"'DM Mono',monospace"}}>MP4 · {size}</p>
              )}
            </div>

            {showMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger className="shrink-0 text-gray-300 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-all duration-150 mt-0.5 p-0.5 rounded hover:bg-gray-100">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[140px]">
                  {isGenerated && (
                    <>
                      <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => setShowModal(true)}>
                        <Play className="h-3.5 w-3.5 mr-2 text-gray-400" />
                        Play
                      </DropdownMenuItem>
                      <DropdownMenuItem className="cursor-pointer text-sm" onClick={handleDownload}>
                        <Download className="h-3.5 w-3.5 mr-2 text-gray-400" />
                        Download
                      </DropdownMenuItem>
                    </>
                  )}
                  {onGenerate && (
                    <DropdownMenuItem className="cursor-pointer text-sm" onClick={() => onGenerate(id, name, fileUrl)}>
                      <Sparkles className="h-3.5 w-3.5 mr-2 text-[#E2623F]" />
                      Generate Variant
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem className="text-red-500 cursor-pointer text-sm focus:text-red-600" onClick={() => onDelete(id)}>
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

      {/* Playback modal */}
      {showModal && (
        <VideoModal
          fileUrl={fileUrl}
          name={name}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
