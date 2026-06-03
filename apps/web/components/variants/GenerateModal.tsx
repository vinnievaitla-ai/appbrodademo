'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Sparkles, X, ArrowRight, Wand2 } from 'lucide-react'

interface SelectedTemplate {
  id: string
  name: string
  fileUrl: string
}

interface GenerateModalProps {
  open: boolean
  onClose: () => void
  onJobCreated: (jobId: string) => void
  selectedTemplate?: SelectedTemplate | null
}

const STEPS = [
  { label: 'Sending to Claude AI', sub: 'Crafting your HyperFrames composition…' },
  { label: 'Building composition', sub: 'Structuring timings, layers and animations…' },
  { label: 'Dispatching to renderer', sub: 'Spinning up the HyperFrames engine…' },
  { label: 'Rendering in progress', sub: 'Sit tight — this takes 30–90 seconds' },
]

export function GenerateModal({ open, onClose, onJobCreated, selectedTemplate }: GenerateModalProps) {
  const [screen, setScreen] = useState<'compose' | 'generating'>('compose')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [stepIndex, setStepIndex] = useState(0)

  useEffect(() => {
    if (open) { setScreen('compose'); setPrompt(''); setError(''); setStepIndex(0) }
  }, [open])

  useEffect(() => {
    if (screen !== 'generating') return
    const t = setInterval(() => setStepIndex(i => Math.min(i + 1, STEPS.length - 1)), 3500)
    return () => clearInterval(t)
  }, [screen])

  const handleProceed = async () => {
    if (!prompt.trim()) return
    setError('')
    setScreen('generating')
    setStepIndex(0)
    try {
      const res = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, templateId: selectedTemplate?.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      onJobCreated(data.jobId)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
      setScreen('compose')
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && screen === 'compose' && onClose()}>
      <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-0 shadow-2xl rounded-2xl gap-0">

        {/* ── Compose ──────────────────────────────────────────── */}
        {screen === 'compose' && (
          <div className="flex flex-col bg-white rounded-2xl">
            {/* Header */}
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
              {/* Video preview */}
              {selectedTemplate && (
                <div className="rounded-xl overflow-hidden border border-gray-100 bg-gray-950 shadow-sm">
                  <video
                    src={selectedTemplate.fileUrl}
                    className="w-full max-h-40 object-cover"
                    controls
                    preload="metadata"
                  />
                  <div className="px-3 py-2 flex items-center gap-2 border-t border-white/5">
                    <Sparkles className="h-3 w-3 text-blue-400" />
                    <span className="text-[11px] text-gray-400 truncate">{selectedTemplate.name}</span>
                  </div>
                </div>
              )}

              {/* Prompt */}
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Describe your end card
                </label>
                <textarea
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white focus:border-transparent transition-all"
                  rows={4}
                  placeholder="e.g. Bold end card for a crossword game. Dark navy background, bright yellow 'Download Free' button, game logo centered at top, subtle particle animation, 6 seconds."
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  autoFocus
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {/* CTAs */}
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
                  Proceed
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Generating ───────────────────────────────────────── */}
        {screen === 'generating' && (
          <div className="flex flex-col items-center bg-white rounded-2xl px-8 py-12 min-h-[360px] relative overflow-hidden">
            {/* Subtle radial bg */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-white pointer-events-none" />

            <div className="relative flex flex-col items-center gap-6 w-full">
              {/* Animated icon */}
              <div className="relative">
                <div className="h-16 w-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-200">
                  <Wand2 className="h-7 w-7 text-white" />
                </div>
                <div className="absolute -inset-1.5 rounded-2xl border-2 border-blue-400/30 animate-ping" />
                <div className="absolute -inset-3 rounded-2xl border border-blue-300/20 animate-pulse" />
              </div>

              <div className="text-center space-y-1">
                <h3 className="text-base font-semibold text-gray-900">{STEPS[stepIndex].label}</h3>
                <p className="text-sm text-gray-500 transition-all duration-500">{STEPS[stepIndex].sub}</p>
              </div>

              {/* Step progress */}
              <div className="flex gap-1.5 items-center">
                {STEPS.map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-full transition-all duration-500 ease-out ${
                      i < stepIndex
                        ? 'w-5 h-1.5 bg-blue-500'
                        : i === stepIndex
                        ? 'w-8 h-1.5 bg-blue-600'
                        : 'w-1.5 h-1.5 bg-gray-200'
                    }`}
                  />
                ))}
              </div>

              {/* Info pill */}
              <div className="mt-2 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-full px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                <p className="text-[11px] text-gray-500 font-medium">
                  Video will appear in <span className="text-gray-800">HF Generated Variants</span> when ready
                </p>
              </div>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  )
}
