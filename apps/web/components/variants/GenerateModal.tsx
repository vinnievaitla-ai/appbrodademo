'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Sparkles } from 'lucide-react'
import type { Template } from '@/lib/types'

interface GenerateModalProps {
  open: boolean
  onClose: () => void
  onJobCreated: (jobId: string) => void
  templates: Template[]
}

export function GenerateModal({ open, onClose, onJobCreated, templates }: GenerateModalProps) {
  const [prompt, setPrompt] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setIsGenerating(true)
    setError('')

    try {
      const res = await fetch('/api/variants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, templateId: templateId || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Generation failed')
      }

      const { jobId } = await res.json()
      onJobCreated(jobId)
      setPrompt('')
      setTemplateId('')
      onClose()
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !isGenerating && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-600" />
            Generate End Card Variant
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {templates.length > 0 && (
            <div>
              <Label className="text-sm font-medium text-gray-700">
                Base template <span className="text-gray-400 font-normal">(optional)</span>
              </Label>
              <select
                className="mt-1.5 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={isGenerating}
              >
                <option value="">Generate from scratch</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <Label className="text-sm font-medium text-gray-700">
              Describe your end card <span className="text-red-500">*</span>
            </Label>
            <textarea
              className="mt-1.5 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              rows={4}
              placeholder="e.g. A bold end card for a crossword game. Dark background, yellow accent color, large 'Download Now' CTA button, game logo at top, 6 seconds long."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={!prompt.trim() || isGenerating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Sending to renderer…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-gray-400 text-center">
            Claude generates a HyperFrames composition · Railway renders the MP4 · appears in your library when ready
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
