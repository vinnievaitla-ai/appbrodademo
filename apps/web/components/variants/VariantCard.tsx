'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Download, Trash2, Play, Pause, X, Sparkles, Pencil,
  Volume2, VolumeX, Maximize2, Folder,
} from 'lucide-react'
import type { Folder as FolderType } from '@/lib/types'
import { getVariantFolder } from '@/lib/folders'

interface VariantCardProps {
  id: string
  prompt: string
  outputUrl: string
  onDelete: (id: string) => void
  folders?: FolderType[]
}

function formatTime(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ─── Enhanced Video Modal ─────────────────────────────────────────────────────

function VideoModal({
  outputUrl,
  prompt,
  onClose,
}: {
  outputUrl: string
  prompt: string
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [seekValue, setSeekValue] = useState(0)
  const isDraggingRef = useRef(false)

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return
    if (videoRef.current.paused) videoRef.current.play()
    else videoRef.current.pause()
  }, [])

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return
    videoRef.current.muted = !videoRef.current.muted
    setIsMuted(videoRef.current.muted)
  }, [])

  const handleDownload = useCallback(() => {
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
  }, [outputUrl])

  const handleFullscreen = useCallback(() => {
    videoRef.current?.requestFullscreen?.()
  }, [])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-black rounded-2xl overflow-hidden group/modal"
        style={{ height: 'min(85vh, 580px)', aspectRatio: '9/16' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-2.5 right-2.5 z-20 h-7 w-7 rounded-full bg-black/50 hover:bg-black/80 flex items-center justify-center transition-colors"
        >
          <X className="h-3.5 w-3.5 text-white" />
        </button>

        {/* Prompt chip */}
        <div className="absolute top-2.5 left-2.5 right-10 z-20 pointer-events-none">
          <span className="text-[10px] text-white/60 bg-black/40 px-2 py-0.5 rounded-md truncate block">
            {prompt}
          </span>
        </div>

        {/* Video — fills the container, click to toggle play */}
        <video
          ref={videoRef}
          src={outputUrl}
          className="absolute inset-0 w-full h-full object-contain cursor-pointer"
          playsInline
          autoPlay
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={() => {
            setDuration(videoRef.current?.duration ?? 0)
            setIsPlaying(true)
          }}
          onTimeUpdate={() => {
            if (!isDraggingRef.current) {
              const t = videoRef.current?.currentTime ?? 0
              setCurrentTime(t)
              setSeekValue(t)
            }
          }}
          onEnded={() => {
            setIsPlaying(false)
            setCurrentTime(0)
            setSeekValue(0)
          }}
          onClick={togglePlay}
        />

        {/* Centre play/pause flash (only visible when paused) */}
        {!isPlaying && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
            onClick={togglePlay}
          >
            <div className="h-14 w-14 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="h-6 w-6 text-white ml-1" fill="white" />
            </div>
          </div>
        )}

        {/* Controls bar — always visible, transitions out on hover-away */}
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-1.5 px-3 pb-3 pt-10
                        bg-gradient-to-t from-black/80 via-black/40 to-transparent rounded-b-2xl">

          {/* Seek bar */}
          <div className="relative w-full h-3 flex items-center">
            {/* Track background */}
            <div className="absolute inset-x-0 h-1 bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            {/* Invisible but interactive range input */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={seekValue}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
              onMouseDown={() => { isDraggingRef.current = true }}
              onChange={e => {
                const v = parseFloat(e.target.value)
                setSeekValue(v)
                setCurrentTime(v)
              }}
              onMouseUp={e => {
                const v = parseFloat((e.target as HTMLInputElement).value)
                if (videoRef.current) videoRef.current.currentTime = v
                isDraggingRef.current = false
              }}
              onTouchEnd={e => {
                isDraggingRef.current = false
                const v = parseFloat((e.target as HTMLInputElement).value)
                if (videoRef.current) videoRef.current.currentTime = v
              }}
            />
          </div>

          {/* Control row */}
          <div className="flex items-center gap-2.5">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="text-white hover:text-white/80 transition-colors flex-shrink-0"
            >
              {isPlaying
                ? <Pause className="h-4 w-4" fill="white" />
                : <Play className="h-4 w-4 ml-0.5" fill="white" />
              }
            </button>

            {/* Time */}
            <span className="text-[11px] text-white/70 tabular-nums flex-shrink-0">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            <div className="flex-1" />

            {/* Volume */}
            <button
              onClick={toggleMute}
              className="text-white hover:text-white/80 transition-colors flex-shrink-0"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted
                ? <VolumeX className="h-3.5 w-3.5" />
                : <Volume2 className="h-3.5 w-3.5" />
              }
            </button>

            {/* Download */}
            <button
              onClick={handleDownload}
              className="text-white hover:text-white/80 transition-colors flex-shrink-0"
              title="Download"
            >
              <Download className="h-3.5 w-3.5" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={handleFullscreen}
              className="text-white hover:text-white/80 transition-colors flex-shrink-0"
              title="Fullscreen"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── VariantCard ──────────────────────────────────────────────────────────────

const NAME_KEY = (id: string) => `variant-name-${id}`

export function VariantCard({ id, prompt, outputUrl, onDelete, folders = [] }: VariantCardProps) {
  const [showModal, setShowModal] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [name, setName] = useState('')
  const [isEditingName, setIsEditingName] = useState(false)
  const [folderName, setFolderName] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const stored = localStorage.getItem(NAME_KEY(id))
    if (stored) setName(stored)
  }, [id])

  // Resolve folder name for badge
  useEffect(() => {
    const fid = getVariantFolder(id)
    if (fid && folders.length > 0) {
      const folder = folders.find(f => f.id === fid)
      setFolderName(folder?.name ?? null)
    } else {
      setFolderName(null)
    }
  }, [id, folders])

  const saveName = (val: string) => {
    const trimmed = val.trim()
    setName(trimmed)
    if (trimmed) localStorage.setItem(NAME_KEY(id), trimmed)
    else localStorage.removeItem(NAME_KEY(id))
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
        {/* Thumbnail */}
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

          {/* HF badge */}
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-blue-600/90 backdrop-blur-sm rounded-full px-1.5 py-0.5">
            <Sparkles className="h-2.5 w-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">HF</span>
          </div>

          {/* Duration badge */}
          {duration !== null && (
            <div className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm rounded-md px-1.5 py-0.5">
              <span className="text-[10px] font-semibold text-white tabular-nums">
                {Math.floor(duration / 60) > 0
                  ? `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`
                  : `${Math.floor(duration)}s`}
              </span>
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
        <div className="px-2.5 py-2 flex flex-col gap-1.5">

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
              {name
                ? <span className="text-[11px] font-medium text-gray-900 leading-snug truncate">{name}</span>
                : <span className="text-[11px] text-gray-400 leading-snug">Add a name…</span>
              }
              <Pencil className="h-2.5 w-2.5 text-gray-300 group-hover/name:text-gray-500 shrink-0 transition-colors" />
            </button>
          )}

          {/* Prompt */}
          <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{label}</p>

          {/* Folder badge */}
          {folderName && (
            <div className="flex items-center gap-1">
              <Folder className="h-2.5 w-2.5 text-blue-400 shrink-0" />
              <span className="text-[10px] text-blue-500 font-medium truncate">{folderName}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-1.5 mt-0.5">
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
