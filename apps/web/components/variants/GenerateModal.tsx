'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Sparkles, X, ArrowRight } from 'lucide-react'

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

const GENERATING_STEPS = [
  'Sending prompt to Claude AI…',
  'Crafting HyperFrames composition…',
  'Dispatching to render service…',
  'Sit tight — rendering takes 30–90 seconds',
]

export function GenerateModal({ open, onClose, onJobCreated, selectedTemplate }: GenerateModalProps) {
  const [screen, setScreen] = useState<'compose' | 'generating'>('compose')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [stepIndex, setStepIndex] = useState(0)

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setScreen('compose')
      setPrompt('')
      setError('')
      setStepIndex(0)
    }
  }, [open])

  // Cycle through status messages during generation
  useEffect(() => {
    if (screen !== 'generating') return
    const interval = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, GENERATING_STEPS.length - 1))
    }, 3000)
    return () => clearInterval(interval)
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
        body: JSON.stringify({
          prompt,
          templateId: selectedTemplate?.id,
        }),
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
    <Dialog open={open} onOpenChange={(o) => !o && screen === 'compose' && onClose()}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0">

        {/* ── Compose screen ───────────────────────────────────── */}
        {screen === 'compose' && (
          <div className="flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-blue-600" />
                <h2 className="text-base font-semibold text-gray-900">Generate Variant</h2>
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Video preview */}
              {selectedTemplate && (
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">Template</p>
                  <div className="rounded-lg overflow-hidden bg-gray-900 border border-gray-200">
                    <video
                      src={selectedTemplate.fileUrl}
                      className="w-full max-h-44 object-cover"
                      controls
                      preload="metadata"
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1.5 truncate">{selectedTemplate.name}</p>
                </div>
              )}

              {/* Prompt */}
              <div>
                <label className="text-xs font-medium text-gray-500 block mb-2">
                  Describe your end card variant
                </label>
                <textarea
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-3 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                  placeholder="e.g. Bold end card with dark background, yellow CTA button saying 'Download Now', game logo at top, 6 seconds long."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>

            {/* Footer CTAs */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50">
              <Button variant="outline" onClick={onClose} className="text-sm">
                Cancel
              </Button>
              <Button
                onClick={handleProceed}
                disabled={!prompt.trim()}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm gap-1.5"
              >
                Proceed
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── Generating screen ─────────────────────────────────── */}
        {screen === 'generating' && (
          <div className="flex flex-col items-center justify-center px-8 py-14 text-center min-h-[320px] bg-gradient-to-b from-white to-blue-50">
            {/* Animated orb */}
            <div className="relative mb-8">
              <div className="h-16 w-16 rounded-full bg-blue-600 flex items-center justify-center animate-pulse">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              <div className="absolute inset-0 rounded-full bg-blue-400 opacity-20 animate-ping" />
            </div>

            <h3 className="text-lg font-semibold text-gray-900 mb-2">Generating your variant</h3>

            {/* Cycling status message */}
            <p className="text-sm text-blue-600 font-medium min-h-[20px] transition-all duration-500">
              {GENERATING_STEPS[stepIndex]}
            </p>

            {/* Step dots */}
            <div className="flex gap-1.5 mt-5">
              {GENERATING_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full transition-all duration-500 ${
                    i <= stepIndex ? 'bg-blue-600 w-4' : 'bg-gray-200 w-1.5'
                  }`}
                />
              ))}
            </div>

            <p className="text-xs text-gray-400 mt-6 max-w-xs">
              The rendered video will appear in the <span className="font-medium text-gray-600">HF Generated Variants</span> section once ready.
            </p>
          </div>
        )}

      </DialogContent>
    </Dialog>
  )
}
