'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { TopBar } from '../layout/TopBar'
import { Sidebar, type ViewState } from './Sidebar'
import { MediaCard } from './MediaCard'
import { GenerateModal } from '../variants/GenerateModal'
import { FolderPickerModal } from '../folders/FolderPickerModal'
import { FolderCard } from './FolderCard'
import { FolderWorkspace } from './FolderWorkspace'
import { DetailsPanel } from './DetailsPanel'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ChevronDown, Search, Loader2, Sparkles, Upload, FolderPlus, Plus, ArrowRight,
} from 'lucide-react'
import type { Template, RenderJob, Folder } from '@/lib/types'
import {
  getFolders, getVariantFolder, assignVariantsToFolder, createFolder,
} from '@/lib/folders'

const CATEGORY_LABELS: Record<string, string> = {
  hook: 'Hook', body: 'Body', text: 'Text', audio: 'Audio', end_card: 'End Card',
}

interface SelectedTemplate { id: string; name: string; fileUrl: string }

// ─── New Folder inline input ─────────────────────────────────────────────────
function NewFolderInput({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="flex items-center gap-2 px-6 py-3 bg-[#F8E5DD] border-b border-[#E2623F]/20">
      <FolderPlus className="h-4 w-4 text-[#E2623F] shrink-0" />
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && name.trim()) onSave(name.trim())
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Folder name…"
        className="flex-1 bg-transparent text-sm text-[#1C1A18] placeholder:text-[#ABA49B] outline-none font-semibold"
      />
      <button
        onClick={() => name.trim() && onSave(name.trim())}
        disabled={!name.trim()}
        className="px-3 py-1 bg-[#E2623F] hover:bg-[#CF5331] disabled:opacity-40 text-white text-xs font-semibold rounded-full transition-colors"
      >
        Create
      </button>
      <button onClick={onCancel} className="text-[#ABA49B] hover:text-[#46413B] text-xs font-medium">Cancel</button>
    </div>
  )
}

// ─── LibraryPage ─────────────────────────────────────────────────────────────

export function LibraryPage() {
  const [view, setView] = useState<ViewState>({ type: 'templates', category: 'end_card' })
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
  const [folders, setFolders] = useState<Folder[]>([])
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [justCompletedIds, setJustCompletedIds] = useState<string[]>([])
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { setFolders(getFolders()) }, [])

  const activeCategory = view.type === 'templates' ? view.category : 'end_card'
  const categoryLabel = CATEGORY_LABELS[activeCategory] ?? 'End Card'

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [tplRes, varRes] = await Promise.all([
        fetch(`/api/templates?category=${activeCategory}`),
        fetch(`/api/variants`),
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
        if (job.status === 'done') { resolved.push(job.id); newVariants.push(job) }
        else if (job.status === 'failed') { resolved.push(job.id); newFailed.push({ id: job.id, error: job.error_message || 'Render failed' }) }
      })
      if (resolved.length > 0) {
        setPendingJobIds(prev => prev.filter(id => !resolved.includes(id)))
        if (newVariants.length > 0) {
          setVariants(prev => [...newVariants, ...prev])
          setJustCompletedIds(newVariants.map(v => v.id))
          setShowFolderPicker(true)
        }
        if (newFailed.length > 0) setFailedJobs(prev => [...prev, ...newFailed])
      }
    }, 3000)
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }
  }, [pendingJobIds.length])

  // ── Computed: variant counts per folder ────────────────────────────────────
  const variantCounts = useMemo(() => {
    const counts: Record<string, number> = { untagged: 0 }
    for (const v of variants) {
      const fid = getVariantFolder(v.id)
      if (fid) counts[fid] = (counts[fid] ?? 0) + 1
      else counts['untagged']++
    }
    return counts
  }, [variants])

  // ── Variants for current folder workspace ──────────────────────────────────
  const folderVariants = useMemo(() => {
    if (view.type !== 'folder-workspace') return []
    const { folderId } = view
    return variants.filter(v =>
      folderId === 'untagged'
        ? getVariantFolder(v.id) === null
        : getVariantFolder(v.id) === folderId
    )
  }, [view, variants])

  const selectedVariant = useMemo(
    () => variants.find(v => v.id === selectedVariantId) ?? null,
    [variants, selectedVariantId]
  )

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setIsUploading(true); setUploadError('')
    try {
      const ext = file.name.split('.').pop() || 'mp4'
      const urlRes = await fetch(`/api/templates/upload-url?ext=${ext}`)
      if (!urlRes.ok) throw new Error('Could not get upload URL')
      const { signedUrl, path } = await urlRes.json()
      const putRes = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)
      const metaRes = await fetch('/api/templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
    if (selectedVariantId === id) setSelectedVariantId(null)
  }

  const openGenerateModal = (templateId?: string, templateName?: string, templateUrl?: string) => {
    setSelectedTemplate(templateId && templateName && templateUrl
      ? { id: templateId, name: templateName, fileUrl: templateUrl } : null)
    setShowGenerateModal(true)
  }

  const handleNewFolder = () => setShowNewFolderInput(true)

  const handleCreateFolder = (name: string) => {
    const folder = createFolder(name)
    setFolders(getFolders())
    setShowNewFolderInput(false)
    setView({ type: 'folder-workspace', folderId: folder.id })
  }

  const q = searchQuery.toLowerCase()
  const filteredTemplates = templates.filter(t => t.name.toLowerCase().includes(q))

  // ── Current folder info ────────────────────────────────────────────────────
  const currentFolderName = useMemo(() => {
    if (view.type !== 'folder-workspace') return ''
    if (view.folderId === 'untagged') return 'Untagged'
    return folders.find(f => f.id === view.folderId)?.name ?? 'Folder'
  }, [view, folders])

  return (
    <div className="flex h-screen overflow-hidden bg-[#E9E6E1] p-[22px]">
      <div className="flex flex-1 min-w-0 overflow-hidden rounded-[28px] border border-[#EFEBE4] bg-[#FBFAF8] shadow-[0_18px_50px_rgba(40,28,18,0.10)]">
      {/* Left sidebar */}
      <Sidebar
        view={view}
        onViewChange={v => { setView(v); setSelectedVariantId(null) }}
        folders={folders}
        onFoldersChange={setFolders}
        onNewFolder={handleNewFolder}
        variantCounts={variantCounts}
      />

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar />

        {/* New folder inline input */}
        {showNewFolderInput && (
          <NewFolderInput
            onSave={handleCreateFolder}
            onCancel={() => setShowNewFolderInput(false)}
          />
        )}

        {/* Contextual page header */}
        {view.type !== 'folder-workspace' && (
          <div className="bg-[#FBFAF8] border-b border-[#E7E2DB] px-8 py-5 shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-[20px] font-bold text-[#1C1A18] leading-tight">
                  {view.type === 'templates'
                    ? <>My Library <span className="text-[#C7C1B8] mx-2 font-light">·</span> <span className="text-[#E2623F]">{categoryLabel}</span></>
                    : <span className="text-[#1C1A18]">Generated Variants</span>
                  }
                </h1>
                <p className="text-[13px] text-[#8B847C] mt-1 font-medium">
                  {view.type === 'templates'
                    ? 'Manage templates and generate AI-powered ad variants'
                    : 'Organize your AI-generated video variants in folders'
                  }
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {view.type === 'folder-grid' && (
                  <button
                    onClick={handleNewFolder}
                    className="flex items-center gap-1.5 h-10 px-4 text-sm font-semibold text-[#46413B] border border-[#E7E2DB] rounded-full hover:bg-[#F1EEE9] transition-colors"
                  >
                    <FolderPlus className="h-3.5 w-3.5" /> New Folder
                  </button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-full bg-[#E2623F] hover:bg-[#CF5331] text-white h-10 px-5 text-sm font-semibold transition-colors shadow-[0_4px_14px_rgba(226,98,63,0.30)]">
                    {isUploading
                      ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                      : <><Plus className="h-3.5 w-3.5" /> <span>Create</span> <ChevronDown className="h-3.5 w-3.5 opacity-70" /></>
                    }
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => fileInputRef.current?.click()} disabled={isUploading} className="cursor-pointer">
                      <Upload className="h-3.5 w-3.5 mr-2 text-[#ABA49B]" /> Upload Template
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openGenerateModal()} className="cursor-pointer">
                      <Sparkles className="h-3.5 w-3.5 mr-2 text-[#E2623F]" /> Generate Variant
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Search (templates view only) */}
            {view.type === 'templates' && (
              <div className="mt-4 relative w-64">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#ABA49B]" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search templates…"
                  className="pl-9 pr-4 py-2.5 text-[13px] border border-[#E7E2DB] rounded-full w-full focus:outline-none focus:ring-2 focus:ring-[#E2623F]/20 focus:border-[#E2623F] bg-white text-[#1C1A18] placeholder:text-[#ABA49B] font-medium"
                />
              </div>
            )}
          </div>
        )}

        {/* Upload error */}
        {uploadError && (
          <div className="bg-red-50 border-b border-red-100 px-6 py-2 flex items-center justify-between shrink-0">
            <p className="text-xs text-red-600 font-medium">{uploadError}</p>
            <button onClick={() => setUploadError('')} className="text-red-300 hover:text-red-500 ml-4 text-xs">✕</button>
          </div>
        )}

        {/* Main content area — shares horizontal space with details panel */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Centre content ─────────────────────────────────────────────── */}
          <div className="flex-1 overflow-hidden flex flex-col">

            {isLoading && view.type === 'templates' ? (
              <div className="flex items-center justify-center flex-1">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-[#E2623F]" />
                  <span className="text-xs text-[#ABA49B] font-medium">Loading…</span>
                </div>
              </div>

            ) : view.type === 'templates' ? (
              /* Template Gallery + Folders below */
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-10">

                {/* Templates section */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-[11px] font-bold text-[#ABA49B] uppercase tracking-wider">Templates</h2>
                    {filteredTemplates.length > 0 && (
                      <span className="h-5 min-w-5 px-1.5 rounded-full bg-[#E7E3DC] text-[11px] font-bold text-[#46413B] flex items-center justify-center">
                        {filteredTemplates.length}
                      </span>
                    )}
                    <div className="flex-1 h-px bg-[#E7E2DB]" />
                  </div>
                  {filteredTemplates.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 border-2 border-dashed border-[#E7E2DB] rounded-[22px] text-center bg-[#F1EEE9]/40">
                      <div className="h-10 w-10 rounded-full bg-white border border-[#E7E2DB] flex items-center justify-center mb-3">
                        <Upload className="h-5 w-5 text-[#ABA49B]" />
                      </div>
                      <p className="text-sm font-bold text-[#1C1A18] mb-1">No templates yet</p>
                      <p className="text-xs text-[#8B847C] mb-4">Upload your first {categoryLabel} template to get started</p>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-4 py-2 bg-[#E2623F] hover:bg-[#CF5331] text-white text-xs font-semibold rounded-full transition-colors shadow-[0_4px_14px_rgba(226,98,63,0.25)]"
                      >
                        Upload Template
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4">
                      {filteredTemplates.map(t => (
                        <MediaCard
                          key={t.id} id={t.id} name={t.name} fileUrl={t.file_url}
                          fileSizeBytes={t.file_size_bytes} onDelete={handleDeleteTemplate} onGenerate={openGenerateModal}
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* Generated Variants — folder grid inline below templates */}
                <section>
                  <div className="flex items-center gap-3 mb-4">
                    <h2 className="text-[11px] font-bold text-[#ABA49B] uppercase tracking-wider">Generated Variants</h2>
                    {(folders.length > 0 || variantCounts['untagged'] > 0) && (
                      <span className="h-5 min-w-5 px-1.5 rounded-full bg-[#E7E3DC] text-[11px] font-bold text-[#46413B] flex items-center justify-center">
                        {folders.length + (variantCounts['untagged'] > 0 ? 1 : 0)}
                      </span>
                    )}
                    <div className="flex-1 h-px bg-[#E7E2DB]" />
                    <button
                      onClick={() => setView({ type: 'folder-grid' })}
                      className="text-[12px] text-[#E2623F] hover:text-[#CF5331] font-semibold shrink-0 flex items-center gap-1"
                    >
                      View all <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Pending banner */}
                  {pendingJobIds.length > 0 && (
                    <div className="mb-4 flex items-center gap-3 bg-[#F8E5DD] border border-[#E2623F]/20 rounded-[14px] px-4 py-2.5">
                      <Sparkles className="h-4 w-4 text-[#E2623F] animate-pulse shrink-0" />
                      <p className="text-[13px] text-[#B8451F] font-semibold flex-1">
                        {pendingJobIds.length} variant{pendingJobIds.length !== 1 ? 's' : ''} rendering…
                      </p>
                    </div>
                  )}

                  {folders.length === 0 && variantCounts['untagged'] === 0 && pendingJobIds.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-[#E7E2DB] rounded-[22px] text-center bg-[#F8E5DD]/20">
                      <Sparkles className="h-6 w-6 text-[#E2623F] mb-2" />
                      <p className="text-sm font-bold text-[#1C1A18] mb-1">No generated variants yet</p>
                      <p className="text-xs text-[#8B847C] mb-3">Select a template and click Generate</p>
                      <button
                        onClick={() => openGenerateModal()}
                        className="px-3 py-1.5 bg-[#E2623F] hover:bg-[#CF5331] text-white text-xs font-semibold rounded-full transition-colors flex items-center gap-1.5 shadow-[0_4px_14px_rgba(226,98,63,0.25)]"
                      >
                        <Sparkles className="h-3 w-3" /> Generate Variant
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
                      {folders.map(folder => {
                        const fv = variants.filter(v => getVariantFolder(v.id) === folder.id)
                        return (
                          <FolderCard
                            key={folder.id}
                            id={folder.id}
                            name={folder.name}
                            createdAt={folder.createdAt}
                            variants={fv}
                            onClick={() => setView({ type: 'folder-workspace', folderId: folder.id })}
                          />
                        )
                      })}
                      {variantCounts['untagged'] > 0 && (
                        <FolderCard
                          id="untagged"
                          name="Untagged"
                          variants={variants.filter(v => getVariantFolder(v.id) === null)}
                          isUntagged
                          onClick={() => setView({ type: 'folder-workspace', folderId: 'untagged' })}
                        />
                      )}
                    </div>
                  )}
                </section>
              </div>

            ) : view.type === 'folder-grid' ? (
              /* Folder Grid — primary Generated Variants view */
              <div className="flex-1 overflow-y-auto px-6 py-6">
                {/* Pending rendering banner */}
                {pendingJobIds.length > 0 && (
                  <div className="mb-5 flex items-center gap-3 bg-[#F8E5DD] border border-[#E2623F]/20 rounded-[14px] px-4 py-3">
                    <Sparkles className="h-4 w-4 text-[#E2623F] animate-pulse shrink-0" />
                    <div className="flex-1">
                      <p className="text-[13px] text-[#B8451F] font-semibold">
                        {pendingJobIds.length} variant{pendingJobIds.length !== 1 ? 's' : ''} rendering
                      </p>
                      <p className="text-[11px] text-[#E2623F]/70 mt-0.5">
                        They'll be saved to a folder when complete
                      </p>
                    </div>
                    <div className="flex gap-px">
                      {pendingJobIds.slice(0, 3).map((_, i) => (
                        <div key={i} className="h-1.5 w-5 rounded-full bg-[#E2623F]/40 animate-pulse"
                          style={{ animationDelay: `${i * 200}ms` }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Folder grid */}
                {folders.length === 0 && variantCounts['untagged'] === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-[#E7E2DB] rounded-[22px] text-center bg-[#F8E5DD]/20">
                    <div className="h-12 w-12 rounded-full bg-[#F8E5DD] border border-transparent flex items-center justify-center mb-3">
                      <Sparkles className="h-6 w-6 text-[#E2623F]" />
                    </div>
                    <p className="text-sm font-bold text-[#1C1A18] mb-1">No variants generated yet</p>
                    <p className="text-xs text-[#8B847C] mb-5">Select a template and generate your first AI-powered variant</p>
                    <button
                      onClick={() => openGenerateModal()}
                      className="px-4 py-2 bg-[#E2623F] hover:bg-[#CF5331] text-white text-xs font-semibold rounded-full transition-colors shadow-[0_4px_14px_rgba(226,98,63,0.25)] flex items-center gap-1.5"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> Generate Variant
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                    {/* Named folders */}
                    {folders.map(folder => {
                      const folderVariants = variants.filter(v => getVariantFolder(v.id) === folder.id)
                      return (
                        <FolderCard
                          key={folder.id}
                          id={folder.id}
                          name={folder.name}
                          createdAt={folder.createdAt}
                          variants={folderVariants}
                          onClick={() => setView({ type: 'folder-workspace', folderId: folder.id })}
                        />
                      )
                    })}
                    {/* Untagged */}
                    {variantCounts['untagged'] > 0 && (
                      <FolderCard
                        id="untagged"
                        name="Untagged"
                        variants={variants.filter(v => getVariantFolder(v.id) === null)}
                        isUntagged
                        onClick={() => setView({ type: 'folder-workspace', folderId: 'untagged' })}
                      />
                    )}
                  </div>
                )}
              </div>

            ) : (
              /* Folder Workspace */
              <FolderWorkspace
                folderId={view.folderId}
                folderName={currentFolderName}
                variants={folderVariants}
                pendingJobIds={[]}
                failedJobs={failedJobs}
                folders={folders}
                onBack={() => setView({ type: 'folder-grid' })}
                onDeleteVariant={handleDeleteVariant}
                onDismissAllFailed={() => setFailedJobs([])}
                onVariantClick={id => setSelectedVariantId(prev => prev === id ? null : id)}
                selectedVariantId={selectedVariantId}
              />
            )}
          </div>

          {/* ── Right details panel ─────────────────────────────────────────── */}
          {selectedVariant && (
            <DetailsPanel
              variant={selectedVariant}
              folders={folders}
              onClose={() => setSelectedVariantId(null)}
              onDelete={id => { handleDeleteVariant(id); setSelectedVariantId(null) }}
            />
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" accept="video/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />

      {/* Modals */}
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
    </div>
  )
}
