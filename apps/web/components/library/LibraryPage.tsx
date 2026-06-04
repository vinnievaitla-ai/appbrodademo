'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { TopBar } from '../layout/TopBar'
import { Sidebar } from './Sidebar'
import { MediaCard } from './MediaCard'
import { GenerateModal } from '../variants/GenerateModal'
import { VariantCard } from '../variants/VariantCard'
import { FolderPickerModal } from '../folders/FolderPickerModal'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Search, Loader2, Sparkles, Upload, CalendarDays, SlidersHorizontal, ArrowUpDown } from 'lucide-react'
import type { Template, RenderJob, Folder } from '@/lib/types'
import { getFolders, getVariantFolder } from '@/lib/folders'

const CATEGORY_LABELS: Record<string, string> = {
  hook: 'Hook', body: 'Body', text: 'Text', audio: 'Audio', end_card: 'End Card',
}

interface SelectedTemplate { id: string; name: string; fileUrl: string }

function ShimmerCard({ jobId }: { jobId: string }) {
  const [status, setStatus] = useState('pending')

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`)
        const { job } = await res.json()
        if (job?.status) setStatus(job.status)
      } catch {}
    }
    check()
    const t = setInterval(check, 4000)
    return () => clearInterval(t)
  }, [jobId])

  return (
    <div className="w-[148px] rounded-xl border border-blue-100 bg-white overflow-hidden">
      <div className="relative bg-gradient-to-br from-blue-50 to-indigo-50 flex-shrink-0" style={{ aspectRatio: '9/16' }}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-400 animate-pulse" />
          <span className="text-[10px] font-semibold text-blue-500 uppercase tracking-widest">{status}</span>
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_2s_infinite]" />
      </div>
      <div className="px-2.5 py-2 space-y-1">
        <p className="text-[10px] text-gray-400 font-mono truncate">{jobId.slice(0, 8)}…</p>
      </div>
    </div>
  )
}

function SectionHeader({ label, count, extra }: { label: string; count?: number; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest">{label}</h2>
      {count !== undefined && count > 0 && (
        <span className="h-4 min-w-4 px-1 rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 flex items-center justify-center">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-gray-100" />
      {extra}
    </div>
  )
}

export function LibraryPage() {
  const [activeCategory, setActiveCategory] = useState('end_card')
  const [templates, setTemplates] = useState<Template[]>([])
  const [variants, setVariants] = useState<RenderJob[]>([])
  const [pendingJobIds, setPendingJobIds] = useState<string[]>([])
  const [failedJobs, setFailedJobs] = useState<{ id: string; error: string }[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Folder state
  const [folders, setFolders] = useState<Folder[]>([])
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [justCompletedIds, setJustCompletedIds] = useState<string[]>([])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const label = CATEGORY_LABELS[activeCategory] ?? 'End Card'

  // Load folders from localStorage on mount
  useEffect(() => { setFolders(getFolders()) }, [])

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

  const pendingJobIdsRef = useRef<string[]>([])
  useEffect(() => { pendingJobIdsRef.current = pendingJobIds }, [pendingJobIds])

  useEffect(() => {
    if (pendingJobIds.length === 0) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    if (pollRef.current) return

    pollRef.current = setInterval(async () => {
      const ids = pendingJobIdsRef.current
      if (ids.length === 0) return

      const results = await Promise.all(
        ids.map(id => fetch(`/api/jobs/${id}`).then(r => r.json()).catch(() => null))
      )

      const resolved: string[] = []
      const newVariants: RenderJob[] = []
      const newFailed: { id: string; error: string }[] = []

      results.forEach(res => {
        if (!res?.job) return
        const { job } = res
        if (job.status === 'done') {
          resolved.push(job.id)
          newVariants.push(job)
        } else if (job.status === 'failed') {
          resolved.push(job.id)
          newFailed.push({ id: job.id, error: job.error_message || 'Render failed' })
        }
      })

      if (resolved.length > 0) {
        setPendingJobIds(prev => prev.filter(id => !resolved.includes(id)))
        if (newVariants.length > 0) {
          setVariants(prev => [...newVariants, ...prev])
          // Trigger folder picker for newly completed variants
          setJustCompletedIds(newVariants.map(v => v.id))
          setShowFolderPicker(true)
        }
        if (newFailed.length > 0) setFailedJobs(prev => [...prev, ...newFailed])
      }
    }, 3000)

    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [pendingJobIds.length])

  const handleUpload = async (file: File) => {
    setIsUploading(true)
    setUploadError('')
    try {
      const ext = file.name.split('.').pop() || 'mp4'
      const urlRes = await fetch(`/api/templates/upload-url?ext=${ext}`)
      if (!urlRes.ok) throw new Error('Could not get upload URL')
      const { signedUrl, path } = await urlRes.json()
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)
      const metaRes = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, category: activeCategory, path, fileSizeBytes: file.size }),
      })
      const json = await metaRes.json()
      if (!metaRes.ok) throw new Error(json.error || 'Failed to save template')
      setTemplates(prev => [json.template, ...prev])
    } catch (e: any) {
      setUploadError(e.message || 'Upload failed')
    } finally {
      setIsUploading(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    setTemplates(prev => prev.filter(t => t.id !== id))
    await fetch(`/api/templates/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  const handleDeleteVariant = (id: string) => {
    setVariants(prev => prev.filter(v => v.id !== id))
  }

  const openGenerateModal = (templateId?: string, templateName?: string, templateUrl?: string) => {
    setSelectedTemplate(templateId && templateName && templateUrl
      ? { id: templateId, name: templateName, fileUrl: templateUrl }
      : null
    )
    setShowGenerateModal(true)
  }

  const q = searchQuery.toLowerCase()
  const filteredTemplates = templates.filter(t => t.name.toLowerCase().includes(q))

  // Apply both search and active-folder filters to variants
  const filteredVariants = variants
    .filter(v => (v.prompt ?? '').toLowerCase().includes(q))
    .filter(v => activeFolder ? getVariantFolder(v.id) === activeFolder : true)

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <TopBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          active={activeCategory}
          onChange={setActiveCategory}
          activeFolder={activeFolder}
          onFolderChange={setActiveFolder}
          folders={folders}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Page header */}
          <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-[17px] font-bold text-gray-900 leading-tight tracking-tight">
                  My Library
                  <span className="ml-2 text-gray-300 font-light">·</span>
                  <span className="ml-2 text-blue-600">
                    {activeFolder
                      ? (folders.find(f => f.id === activeFolder)?.name ?? 'Folder')
                      : label}
                  </span>
                </h1>
                <p className="text-[12px] text-gray-400 mt-0.5 font-medium">
                  Manage your creatives and generate AI-powered ad variants
                </p>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white h-9 px-4 text-sm font-semibold transition-colors shadow-sm shadow-blue-200">
                  {isUploading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                    : <><span>Add {label}</span> <ChevronDown className="h-3.5 w-3.5 opacity-70" /></>
                  }
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="cursor-pointer">
                    <Upload className="h-3.5 w-3.5 mr-2 text-gray-400" />
                    Upload Template
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openGenerateModal()} className="cursor-pointer">
                    <Sparkles className="h-3.5 w-3.5 mr-2 text-blue-500" />
                    Generate Variant
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Filter bar */}
          <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center gap-2 shrink-0">
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
              <SlidersHorizontal className="h-3 w-3" /> Owner
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors">
              <CalendarDays className="h-3 w-3" /> Date Range
            </button>
            <div className="flex-1" />
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                className="pl-7 pr-3 py-1.5 text-[11px] border border-gray-200 rounded-lg w-40 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white transition-all"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            <button className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
              <ArrowUpDown className="h-3 w-3" /> Latest
            </button>
          </div>

          {uploadError && (
            <div className="bg-red-50 border-b border-red-100 px-6 py-2 flex items-center justify-between shrink-0">
              <p className="text-xs text-red-600 font-medium">{uploadError}</p>
              <button onClick={() => setUploadError('')} className="text-red-300 hover:text-red-500 ml-4 text-xs">✕</button>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {isLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
                  <span className="text-xs text-gray-400 font-medium">Loading library…</span>
                </div>
              </div>
            ) : (
              <div className="space-y-10">

                {/* Templates — hidden when a folder is active */}
                {!activeFolder && (
                  <section>
                    <SectionHeader label="Templates" count={filteredTemplates.length} />
                    {filteredTemplates.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-200 rounded-2xl text-center bg-white/50">
                        <div className="h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
                          <Upload className="h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-sm font-semibold text-gray-700 mb-1">No templates yet</p>
                        <p className="text-xs text-gray-400 mb-4">Upload your first End Card template to get started</p>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                        >
                          Upload Template
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-4">
                        {filteredTemplates.map(t => (
                          <MediaCard key={t.id} id={t.id} name={t.name} fileUrl={t.file_url}
                            fileSizeBytes={t.file_size_bytes} onDelete={handleDeleteTemplate} onGenerate={openGenerateModal} />
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {/* HF Generated Variants */}
                <section>
                  <SectionHeader
                    label={activeFolder ? (folders.find(f => f.id === activeFolder)?.name ?? 'Folder') : 'HF Generated Variants'}
                    count={filteredVariants.length}
                    extra={pendingJobIds.length > 0 && (
                      <span className="flex items-center gap-1.5 text-[11px] text-blue-600 font-semibold bg-blue-50 px-2.5 py-1 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                        {pendingJobIds.length} rendering
                      </span>
                    )}
                  />

                  {filteredVariants.length === 0 && pendingJobIds.length === 0 && failedJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-blue-100 rounded-2xl text-center bg-blue-50/30">
                      <div className="h-10 w-10 rounded-xl bg-blue-100 flex items-center justify-center mb-3">
                        <Sparkles className="h-5 w-5 text-blue-500" />
                      </div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">
                        {activeFolder ? 'No variants in this folder' : 'No variants generated yet'}
                      </p>
                      <p className="text-xs text-gray-400 mb-4">
                        {activeFolder ? 'Generate a variant and save it here' : 'Hover a template card and click Generate Variant'}
                      </p>
                      <button
                        onClick={() => openGenerateModal()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm flex items-center gap-1.5"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Generate Variant
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4">
                      {pendingJobIds.map(id => <ShimmerCard key={id} jobId={id} />)}
                      {failedJobs.map(f => (
                        <div key={f.id} className="w-[148px] rounded-xl border border-red-200 bg-red-50 overflow-hidden">
                          <div className="flex flex-col items-center justify-center gap-1.5 text-red-300 bg-red-100/60" style={{ aspectRatio: '9/16' }}>
                            <span className="text-2xl">✕</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-red-400">Failed</span>
                          </div>
                          <div className="px-2.5 py-2 border-t border-red-100">
                            <p className="text-[10px] text-red-500 leading-snug line-clamp-2">{f.error}</p>
                            <button onClick={() => setFailedJobs(p => p.filter(j => j.id !== f.id))}
                              className="text-[10px] text-red-400 hover:text-red-600 mt-1 underline">Dismiss</button>
                          </div>
                        </div>
                      ))}
                      {filteredVariants.map(v => (
                        <VariantCard
                          key={v.id}
                          id={v.id}
                          prompt={v.prompt}
                          outputUrl={v.output_url!}
                          onDelete={handleDeleteVariant}
                          folders={folders}
                        />
                      ))}
                    </div>
                  )}
                </section>

              </div>
            )}
          </div>
        </div>
      </div>

      <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />

      <GenerateModal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        onJobsCreated={ids => setPendingJobIds(prev => [...prev, ...ids])}
        selectedTemplate={selectedTemplate}
      />

      <FolderPickerModal
        open={showFolderPicker}
        variantIds={justCompletedIds}
        onClose={() => { setShowFolderPicker(false); setJustCompletedIds([]) }}
        onAssigned={updatedFolders => setFolders(updatedFolders)}
      />
    </div>
  )
}
