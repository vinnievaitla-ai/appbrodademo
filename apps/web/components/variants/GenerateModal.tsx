'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import {
  Sparkles, X, ArrowRight, Wand2, CheckCircle2, AlertCircle, RotateCcw,
} from 'lucide-react'
import { AttachmentPicker } from './AttachmentPicker'
import type { PendingAttachment, ProcessedAttachment } from '@/lib/attachments'

interface SelectedTemplate {
  id: string
  name: string
  fileUrl: string
}

interface GenerateModalProps {
  open: boolean
  onClose: () => void
  onJobsCreated: (jobIds: string[]) => void
  selectedTemplate?: SelectedTemplate | null
}

const STEPS = [
  { label: 'Sending to Claude AI',     sub: 'Crafting your HyperFrames composition…' },
  { label: 'Building composition',     sub: 'Structuring timings, layers and animations…' },
  { label: 'Dispatching to renderer',  sub: 'Spinning up the HyperFrames engine…' },
  { label: 'Rendering in progress',    sub: 'Sit tight — this takes 30–90 seconds' },
]

type Screen = 'compose' | 'generating' | 'done' | 'failed'

export function GenerateModal({ open, onClose, onJobsCreated, selectedTemplate }: GenerateModalProps) {
  const [screen, setScreen] = useState<Screen>('compose')
  const [prompt, setPrompt] = useState('')
  const [dispatchError, setDispatchError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [stepIndex, setStepIndex] = useState(0)
  const [templateDuration, setTemplateDuration] = useState<number | null>(null)
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([])
  const [statusLines, setStatusLines] = useState<string[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const templateVideoRef = useRef<HTMLVideoElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingRef = useRef<string[]>([])

  useEffect(() => {
    if (open) {
      setScreen('compose')
      setPrompt('')
      setDispatchError('')
      setRenderError('')
      setStepIndex(0)
      setTemplateDuration(null)
      setPendingJobIds([])
      setStatusLines([])
      setPendingAttachments([])
    }
  }, [open])

  // Step ticker while generating
  useEffect(() => {
    if (screen !== 'generating') return
    const t = setInterval(() => setStepIndex(i => Math.min(i + 1, STEPS.length - 1)), 3500)
    return () => clearInterval(t)
  }, [screen])

  // Keep ref in sync for polling closure
  useEffect(() => { pendingRef.current = pendingJobIds }, [pendingJobIds])

  // Poll job status while generating
  useEffect(() => {
    if (screen !== 'generating' || pendingJobIds.length === 0) return
    if (pollRef.current) return

    pollRef.current = setInterval(async () => {
      const ids = pendingRef.current
      if (ids.length === 0) return

      const results = await Promise.all(
        ids.map(id => fetch(`/api/jobs/${id}`).then(r => r.json()).catch(() => null))
      )

      for (const res of results) {
        if (!res?.job) continue
        const { job } = res

        if (job.status === 'done') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          setScreen('done')
          setStatusLines(prev => [...prev, 'Render complete — video is ready.'])
          return
        }

        if (job.status === 'failed') {
          clearInterval(pollRef.current!)
          pollRef.current = null
          const msg = job.error_message || 'Render failed with an unknown error.'
          setRenderError(msg)
          setStatusLines(prev => [...prev, `Failed: ${msg}`])
          setScreen('failed')
          return
        }
      }
    }, 3000)

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [screen, pendingJobIds])

  const handleProceed = async () => {
    if (!prompt.trim()) return
    setDispatchError('')
    setStatusLines(['Sending request to Claude AI…'])
    setScreen('generating')
    setStepIndex(0)

    try {
      // ── Upload binary attachments (image / pdf / document) to Supabase ──────
      const processedAttachments: ProcessedAttachment[] = []

      for (const att of pendingAttachments) {
        if (att.category === 'html-css') {
          processedAttachments.push({
            category: 'html-css',
            name: att.file.name,
            textContent: att.parsedText,
          })
        } else if (att.category === 'csv' || att.category === 'xlsx') {
          processedAttachments.push({
            category: att.category,
            name: att.file.name,
            rows: att.parsedRows,
            headers: att.parsedHeaders,
          })
        } else {
          // image / pdf / document — upload to Supabase
          setStatusLines(prev => [...prev, `Uploading ${att.file.name}…`])
          const ext = att.file.name.split('.').pop() || 'bin'
          const urlRes = await fetch(`/api/attachments/upload-url?ext=${ext}`)
          if (!urlRes.ok) throw new Error(`Could not get upload URL for ${att.file.name}`)
          const { signedUrl, publicUrl } = await urlRes.json()

          const uploadRes = await fetch(signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': att.file.type || 'application/octet-stream' },
            body: att.file,
          })
          if (!uploadRes.ok) throw new Error(`Upload failed for ${att.file.name}`)

          processedAttachments.push({
            category: att.category,
            name: att.file.name,
            storageUrl: publicUrl,
          })
        }
      }

      if (processedAttachments.length > 0) {
        setStatusLines(prev => [...prev, `${processedAttachments.length} attachment(s) ready — dispatching…`])
      }

      const res = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          templateId: selectedTemplate?.id,
          templateDuration: templateDuration ? Math.round(templateDuration) : undefined,
          attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')

      const ids: string[] = data.jobIds ?? (data.jobId ? [data.jobId] : [])
      setStatusLines(prev => [...prev, `Job dispatched — waiting for renderer…`])
      setPendingJobIds(ids)
      onJobsCreated(ids)
    } catch (e: any) {
      const msg = e.message || 'Something went wrong'
      setDispatchError(msg)
      setStatusLines(prev => [...prev, `Error: ${msg}`])
      setScreen('failed')
    }
  }

  const handleRetry = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setPendingJobIds([])
    setStatusLines([])
    setRenderError('')
    setDispatchError('')
    setScreen('compose')
  }

  const handleDone = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    onClose()
  }

  // Prevent accidental close while rendering
  const handleOpenChange = (o: boolean) => {
    if (!o && (screen === 'compose' || screen === 'done' || screen === 'failed')) onClose()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-0 shadow-2xl rounded-2xl gap-0">

        {/* ── Compose ──────────────────────────────────────────── */}
        {screen === 'compose' && (
          <div className="flex flex-col bg-white rounded-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-lg bg-blue-600 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-white" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 leading-tight">Generate Variant</h2>
                  <p className="text-[11px] text-gray-400">Powered by Claude + HyperFrames</p>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-300 hover:text-gray-600 transition-colors p-1 rounded-md hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-4">
              {selectedTemplate && (
                <div className="rounded-xl overflow-hidden border border-gray-100 bg-gray-950 shadow-sm">
                  <video
                    ref={templateVideoRef}
                    src={selectedTemplate.fileUrl}
                    className="w-full max-h-40 object-contain"
                    controls
                    preload="metadata"
                    onLoadedMetadata={() => {
                      const dur = templateVideoRef.current?.duration
                      if (dur && isFinite(dur)) setTemplateDuration(dur)
                    }}
                  />
                  <div className="px-3 py-2 flex items-center gap-2 border-t border-white/5">
                    <Sparkles className="h-3 w-3 text-blue-400" />
                    <span className="text-[11px] text-gray-400 truncate">{selectedTemplate.name}</span>
                    {templateDuration && (
                      <span className="ml-auto shrink-0 text-[10px] text-blue-400 font-semibold bg-blue-900/30 px-1.5 py-0.5 rounded">
                        {Math.round(templateDuration)}s
                      </span>
                    )}
                  </div>
                </div>
              )}

              <AttachmentPicker
                attachments={pendingAttachments}
                onChange={setPendingAttachments}
              />

              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Describe your end card
                </label>
                <textarea
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition-all"
                  rows={4}
                  placeholder='e.g. overlay text "Play this game to relax" in Hindi'
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  autoFocus
                />
                {/* Mode hint chips */}
                <div className="mt-2 flex gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider self-center">Examples:</span>
                  <button
                    type="button"
                    onClick={() => setPrompt('overlay text "Play this game to relax" in Hindi')}
                    className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11px] font-medium rounded-full transition-colors"
                  >
                    Text only
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrompt('overlay text "Play this game to relax" in Hindi with a download button "Download Free"')}
                    className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11px] font-medium rounded-full transition-colors"
                  >
                    Text + CTA button
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrompt('overlay text "Play this game to relax" in 3 languages - English, Hindi, Telugu')}
                    className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 text-[11px] font-medium rounded-full transition-colors"
                  >
                    Multi-language
                  </button>
                </div>
              </div>

              {dispatchError && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                  <p className="text-sm text-red-600">{dispatchError}</p>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onClose}
                  className="flex-1 h-10 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProceed}
                  disabled={!prompt.trim()}
                  className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                >
                  Proceed <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Generating ───────────────────────────────────────── */}
        {screen === 'generating' && (
          <div className="flex flex-col bg-white rounded-2xl px-8 py-10 min-h-[400px] relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-white pointer-events-none" />

            <div className="relative flex flex-col items-center gap-6 w-full">
              <div className="relative">
                <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                  <Wand2 className="h-7 w-7 text-white" />
                </div>
                <div className="absolute -inset-1.5 rounded-2xl border-2 border-blue-400/30 animate-ping" />
                <div className="absolute -inset-3 rounded-2xl border border-blue-300/20 animate-pulse" />
              </div>

              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-gray-900">{STEPS[stepIndex].label}</h3>
                <p className="text-sm text-gray-500">{STEPS[stepIndex].sub}</p>
              </div>

              <div className="flex gap-1.5 items-center">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-500 ease-out ${
                      i < stepIndex ? 'w-5 h-1.5 bg-blue-500'
                      : i === stepIndex ? 'w-8 h-1.5 bg-blue-600'
                      : 'w-1.5 h-1.5 bg-gray-200'
                    }`}
                  />
                ))}
              </div>

              {/* Live status log */}
              {statusLines.length > 0 && (
                <div className="w-full rounded-xl bg-gray-950 border border-gray-800 px-4 py-3 space-y-1.5 font-mono">
                  {statusLines.map((line, i) => (
                    <p key={i} className="text-[11px] text-gray-400 leading-relaxed">{line}</p>
                  ))}
                  <span className="inline-block h-3 w-1.5 bg-blue-400 animate-pulse rounded-sm" />
                </div>
              )}

              <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <p className="text-[11px] text-gray-500 font-medium">
                  Do not close — tracking render status
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Done ─────────────────────────────────────────────── */}
        {screen === 'done' && (
          <div className="flex flex-col bg-white rounded-2xl px-8 py-12 min-h-[360px] items-center justify-center gap-6">
            <div className="h-16 w-16 rounded-2xl bg-green-500 flex items-center justify-center shadow-lg shadow-green-200">
              <CheckCircle2 className="h-8 w-8 text-white" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-base font-semibold text-gray-900">Render complete!</h3>
              <p className="text-sm text-gray-500">Your variant is ready in Generated Variants.</p>
            </div>

            {statusLines.length > 0 && (
              <div className="w-full rounded-xl bg-gray-950 border border-gray-800 px-4 py-3 space-y-1.5 font-mono">
                {statusLines.map((line, i) => (
                  <p key={i} className={`text-[11px] leading-relaxed ${line.startsWith('Render complete') ? 'text-green-400' : 'text-gray-400'}`}>{line}</p>
                ))}
              </div>
            )}

            <button
              onClick={handleDone}
              className="w-full h-10 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              View Variants
            </button>
          </div>
        )}

        {/* ── Failed ───────────────────────────────────────────── */}
        {screen === 'failed' && (
          <div className="flex flex-col bg-white rounded-2xl px-8 py-12 min-h-[360px] items-center justify-center gap-6">
            <div className="h-16 w-16 rounded-2xl bg-red-500 flex items-center justify-center shadow-lg shadow-red-200">
              <AlertCircle className="h-8 w-8 text-white" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-base font-semibold text-gray-900">Generation failed</h3>
              <p className="text-sm text-gray-500">Something went wrong during rendering.</p>
            </div>

            {statusLines.length > 0 && (
              <div className="w-full rounded-xl bg-gray-950 border border-gray-800 px-4 py-3 space-y-1.5 font-mono">
                {statusLines.map((line, i) => (
                  <p key={i} className={`text-[11px] leading-relaxed ${line.startsWith('Failed') || line.startsWith('Error') ? 'text-red-400' : 'text-gray-400'}`}>{line}</p>
                ))}
              </div>
            )}

            {renderError && (
              <div className="w-full bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <p className="text-sm text-red-700 font-medium">{renderError}</p>
              </div>
            )}

            <div className="flex items-center gap-2 w-full">
              <button
                onClick={handleDone}
                className="flex-1 h-10 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={handleRetry}
                className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Try Again
              </button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  )
}
