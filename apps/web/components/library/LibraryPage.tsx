'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Sidebar } from './Sidebar'
import { MediaCard } from './MediaCard'
import { GenerateModal } from '../variants/GenerateModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Search, Loader2, Sparkles } from 'lucide-react'
import type { Template, RenderJob } from '@/lib/types'

const CATEGORY_LABELS: Record<string, string> = {
  hook: 'Hook',
  body: 'Body',
  text: 'Text',
  audio: 'Audio',
  end_card: 'End Card',
}

interface SelectedTemplate {
  id: string
  name: string
  fileUrl: string
}

export function LibraryPage() {
  const [activeCategory, setActiveCategory] = useState('end_card')
  const [templates, setTemplates] = useState<Template[]>([])
  const [variants, setVariants] = useState<RenderJob[]>([])
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const label = CATEGORY_LABELS[activeCategory] ?? 'End Card'

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [tplRes, varRes] = await Promise.all([
        fetch(`/api/templates?category=${activeCategory}`),
        fetch(`/api/variants?category=${activeCategory}`),
      ])
      const [tplData, varData] = await Promise.all([tplRes.json(), varRes.json()])
      setTemplates(tplData.templates ?? [])
      setVariants(varData.variants ?? [])
    } finally {
      setIsLoading(false)
    }
  }, [activeCategory])

  useEffect(() => { fetchData() }, [fetchData])

  // Poll for pending jobs every 3s
  useEffect(() => {
    if (pendingJobIds.length === 0) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }

    pollRef.current = setInterval(async () => {
      const results = await Promise.all(
        pendingJobIds.map((id) => fetch(`/api/jobs/${id}`).then((r) => r.json()).catch(() => null))
      )

      const resolved: string[] = []
      const newVariants: RenderJob[] = []

      results.forEach((res) => {
        if (!res?.job) return
        const { job } = res
        if (job.status === 'done' || job.status === 'failed') {
          resolved.push(job.id)
          if (job.status === 'done') newVariants.push(job)
        }
      })

      if (resolved.length > 0) {
        setPendingJobIds((prev) => prev.filter((id) => !resolved.includes(id)))
        if (newVariants.length > 0) setVariants((prev) => [...newVariants, ...prev])
      }
    }, 3000)

    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [pendingJobIds])

  const handleUpload = async (file: File) => {
    setIsUploading(true)
    setUploadError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('category', activeCategory)
      formData.append('name', file.name)

      const res = await fetch('/api/templates', { method: 'POST', body: formData })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      setTemplates((prev) => [json.template, ...prev])
    } catch (e: any) {
      setUploadError(e.message || 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id))
    await fetch(`/api/templates/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const openGenerateModal = (templateId?: string, templateName?: string, templateUrl?: string) => {
    if (templateId && templateName && templateUrl) {
      setSelectedTemplate({ id: templateId, name: templateName, fileUrl: templateUrl })
    } else {
      setSelectedTemplate(null)
    }
    setShowGenerateModal(true)
  }

  const filteredTemplates = templates.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const filteredVariants = variants.filter((v) =>
    (v.prompt ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar active={activeCategory} onChange={setActiveCategory} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Page header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
          <h1 className="text-[18px] font-semibold text-gray-900 leading-tight">
            My Library - {label}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Manage your creatives and create your own ads
          </p>
        </div>

        {/* Action bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-2.5 flex items-center gap-3 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center justify-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white h-8 px-3 text-sm font-medium transition-colors">
              {isUploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
              ) : (
                <>Add {label} <ChevronDown className="h-3.5 w-3.5" /></>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                Upload Template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openGenerateModal()}>
                <Sparkles className="h-3.5 w-3.5 mr-2 text-blue-500" />
                Generate Variant
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50">
            Owner <ChevronDown className="h-3 w-3" />
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-md text-gray-600 hover:bg-gray-50">
            Date Range <ChevronDown className="h-3 w-3" />
          </button>

          <div className="flex-1" />

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search"
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md w-44 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1 text-xs text-gray-500">
            Sort by{' '}
            <button className="font-medium text-gray-900 flex items-center gap-0.5 ml-1">
              Latest <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Upload error banner */}
        {uploadError && (
          <div className="bg-red-50 border-b border-red-200 px-6 py-2 flex items-center justify-between shrink-0">
            <p className="text-sm text-red-600">{uploadError}</p>
            <button onClick={() => setUploadError('')} className="text-red-400 hover:text-red-600 text-xs ml-4">✕</button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : (
            <div className="space-y-10">

              {/* Templates section */}
              <section>
                <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
                  Templates
                </h2>
                {filteredTemplates.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No templates yet.{' '}
                    <button className="text-blue-600 underline" onClick={() => fileInputRef.current?.click()}>
                      Upload one
                    </button>{' '}
                    to get started.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {filteredTemplates.map((t) => (
                      <MediaCard
                        key={t.id}
                        id={t.id}
                        name={t.name}
                        fileUrl={t.file_url}
                        fileSizeBytes={t.file_size_bytes}
                        onDelete={handleDeleteTemplate}
                        onGenerate={openGenerateModal}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* HF Generated Variants section */}
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    HF Generated Variants
                  </h2>
                  {pendingJobIds.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {pendingJobIds.length} rendering…
                    </span>
                  )}
                </div>

                {filteredVariants.length === 0 && pendingJobIds.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No variants yet. Hover over a template and click{' '}
                    <span className="font-medium text-gray-600">Generate Variant</span> to create one.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {/* Rendering skeleton cards */}
                    {pendingJobIds.map((id) => (
                      <div
                        key={id}
                        className="w-[196px] rounded-lg border border-blue-200 bg-blue-50 flex flex-col items-center justify-center gap-2 text-blue-500"
                        style={{ height: 160 }}
                      >
                        <div className="relative">
                          <Sparkles className="h-5 w-5" />
                          <div className="absolute inset-0 animate-ping opacity-40">
                            <Sparkles className="h-5 w-5" />
                          </div>
                        </div>
                        <span className="text-xs font-medium">Rendering…</span>
                      </div>
                    ))}

                    {/* Completed variants */}
                    {filteredVariants.map((v) => (
                      <MediaCard
                        key={v.id}
                        id={v.id}
                        name={v.prompt.slice(0, 40) + (v.prompt.length > 40 ? '…' : '')}
                        fileUrl={v.output_url!}
                        fileSizeBytes={0}
                      />
                    ))}
                  </div>
                )}
              </section>

            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleUpload(file)
          e.target.value = ''
        }}
      />

      <GenerateModal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onJobCreated={(id) => setPendingJobIds((prev) => [...prev, id])}
        selectedTemplate={selectedTemplate}
      />
    </div>
  )
}
