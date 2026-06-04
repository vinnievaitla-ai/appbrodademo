'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, Trash2, Play, Pause, X, Sparkles, Pencil } from 'lucide-react'

interface VariantCardProps {
  id: string
  prompt: string
  outputUrl: string
  onDelete: (id: string) => void
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return ''
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
}

function VideoModal({ outputUrl, prompt, onClose }: { outputUrl: string; prompt: string; onClose: () => void }) {
  const [isPlaying, setIsPlaying] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  const togglePlay = () => {
    if (!videoRef.current) return
    videoRef.current.paused ? videoRef.current.play() : videoRef.current.pause()
  }

  const handleDownload = () => {
    fetch(outputUrl)
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
      .catch(() => window.open(outputUrl, '_blank'))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative flex flex-col items-center gap-3 max-h-[95vh]" onClick={e => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 h-7 w-7 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors"
        >
          <X className="h-3.5 w-3.5 text-white" />
        </button>

        <div className="relative" style={{ height: 'min(75vh, 540px)', aspectRatio: '9/16' }}>
          <video
            ref={videoRef}
            src={outputUrl}
            autoPlay
            loop
            playsInline
            className="h-full w-full rounded-xl object-contain bg-black"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
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

        <div className="flex items-center gap-2">
          <span className="text-white/60 text-xs truncate max-w-[200px]">{prompt}</span>
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

const STORAGE_KEY = (id: string) => `variant-name-${id}`

export function VariantCard({ id, prompt, outputUrl, onDelete }: VariantCardProps) {
  const [showModal, setShowModal] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [name, setName] = useState('')
  const [isEditingName, setIsEditingName] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY(id))
    if (stored) setName(stored)
  }, [id])

  const saveName = (val: string) => {
    const trimmed = val.trim()
    setName(trimmed)
    if (trimmed) localStorage.setItem(STORAGE_KEY(id), trimmed)
    else localStorage.removeItem(STORAGE_KEY(id))
    setIsEditingName(false)
  }

  const handleLoadedMetadata = () => {
    const dur = videoRef.current?.duration
    if (dur && isFinite(dur)) setDuration(dur)
    if (videoRef.current) videoRef.current.currentTime = 0.001
  }

  const handleDownload = () => {
    fetch(outputUrl)
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
      .catch(() => window.open(outputUrl, '_blank'))
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      onDelete(id)
    } catch {
      setIsDeleting(false)
    }
  }

  const label = prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt

  return (
    <>
      <div
        className="group w-[148px] rounded-xl border border-gray-200 bg-white overflow-hidden transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 cursor-default flex flex-col"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Thumbnail — portrait 9:16 */}
        <div className="relative overflow-hidden bg-gray-950 flex-shrink-0" style={{ aspectRatio: '9/16' }}>
          <video
            ref={videoRef}
            src={outputUrl}
            className="absolute inset-0 w-full h-full object-cover"
            preload="metadata"
            muted
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
          />

          {/* Bottom gradient */}
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />

          {/* HF badge — top left */}
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-blue-600/90 backdrop-blur-sm rounded-full px-1.5 py-0.5">
            <Sparkles className="h-2.5 w-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">HF</span>
          </div>

          {/* Duration badge — top right */}
          {duration !== null && (
            <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm rounded-md px-1.5 py-0.5">
              <span className="text-[10px] font-semibold text-white tabular-nums">{formatDuration(duration)}</span>
            </div>
          )}

          {/* Play overlay on hover */}
          <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            <button
              onClick={() => setShowModal(true)}
              className="h-10 w-10 rounded-full bg-white/20 border border-white/40 flex items-center justify-center hover:bg-white/35 transition-colors"
            >
              <Play className="h-4 w-4 text-white ml-0.5" fill="white" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-2.5 py-2 flex flex-col gap-2">
          {/* Name (editable) */}
          {isEditingName ? (
            <input
              ref={nameInputRef}
              defaultValue={name}
              autoFocus
              placeholder="Enter a name…"
              className="text-[11px] font-medium text-gray-900 leading-snug w-full border-b border-blue-400 bg-transparent outline-none pb-0.5 placeholder:text-gray-400"
              onBlur={e => saveName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') saveName((e.target as HTMLInputElement).value)
                if (e.key === 'Escape') setIsEditingName(false)
              }}
            />
          ) : (
            <button
              onClick={() => setIsEditingName(true)}
              className="group/name flex items-center gap-1 text-left w-full"
            >
              {name ? (
                <span className="text-[11px] font-medium text-gray-900 leading-snug truncate">{name}</span>
              ) : (
                <span className="text-[11px] text-gray-400 leading-snug">Add a name…</span>
              )}
              <Pencil className="h-2.5 w-2.5 text-gray-300 group-hover/name:text-gray-500 shrink-0 transition-colors" />
            </button>
          )}

          {/* Prompt */}
          <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{label}</p>

          {/* Action buttons */}
          <div className="flex gap-1.5">
            <button
              onClick={handleDownload}
              className="flex-1 flex items-center justify-center gap-1 h-7 rounded-lg bg-gray-50 hover:bg-gray-100 border border-gray-200 text-[11px] font-medium text-gray-600 hover:text-gray-800 transition-colors"
              title="Download"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-gray-50 hover:bg-red-50 border border-gray-200 hover:border-red-200 text-red-500 hover:text-red-600 transition-colors disabled:opacity-40"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <VideoModal
          outputUrl={outputUrl}
          prompt={prompt}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  )
}
