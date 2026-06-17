'use client'

import { useState } from 'react'
import { ChevronRight, AlertTriangle, RefreshCw, Download, Trash2, FolderInput, X, Check, LayoutGrid, List } from 'lucide-react'
import type { RenderJob, Folder } from '@/lib/types'
import { VariantCard } from '../variants/VariantCard'
import { ShimmerCard } from './ShimmerCard'

interface FolderWorkspaceProps {
  folderId: string | 'untagged'
  folderName: string
  variants: RenderJob[]
  pendingJobIds: string[]
  failedJobs: { id: string; error: string }[]
  folders: Folder[]
  onBack: () => void
  onDeleteVariant: (id: string) => void
  onDismissAllFailed: () => void
  onVariantClick: (id: string) => void
  selectedVariantId: string | null
}

export function FolderWorkspace({
  folderId, folderName, variants, pendingJobIds, failedJobs,
  folders, onBack, onDeleteVariant, onDismissAllFailed, onVariantClick, selectedVariantId
}: FolderWorkspaceProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const clearSelection = () => setSelectedIds(new Set())
  const selectAll = () => setSelectedIds(new Set(variants.map(v => v.id)))

  const isEmpty = variants.length === 0 && pendingJobIds.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb */}
      <div className="px-6 py-3.5 flex items-center gap-2 border-b border-gray-100 bg-white shrink-0">
        <button
          onClick={onBack}
          className="text-[13px] text-gray-500 hover:text-blue-600 font-medium transition-colors"
        >
          Generated Variants
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
        <span className="text-[13px] text-gray-900 font-semibold">{folderName}</span>
        {variants.length > 0 && (
          <span className="ml-1 text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
            {variants.length}
          </span>
        )}
      </div>

      {/* Failed banner — compact, not cards */}
      {failedJobs.length > 0 && (
        <div className="mx-6 mt-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 shrink-0">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-[13px] text-amber-800 font-medium flex-1">
            {failedJobs.length} variant{failedJobs.length !== 1 ? 's' : ''} failed to generate
          </p>
          <button
            onClick={onDismissAllFailed}
            className="text-[12px] text-amber-400 hover:text-amber-600 transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Multi-select action bar */}
      {selectedIds.size > 0 && (
        <div className="mx-6 mt-3 flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 shrink-0">
          <button onClick={clearSelection} className="text-blue-300 hover:text-blue-500 transition-colors">
            <X className="h-4 w-4" />
          </button>
          <span className="text-[13px] text-blue-700 font-semibold flex-1">
            {selectedIds.size} selected
          </span>
          <button className="flex items-center gap-1.5 text-[12px] font-medium text-blue-700 hover:text-blue-900 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
            <Download className="h-3 w-3" /> Download
          </button>
          <button className="flex items-center gap-1.5 text-[12px] font-medium text-blue-700 hover:text-blue-900 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
            <FolderInput className="h-3 w-3" /> Move
          </button>
          <button
            onClick={() => {
              selectedIds.forEach(id => onDeleteVariant(id))
              clearSelection()
            }}
            className="flex items-center gap-1.5 text-[12px] font-medium text-red-600 hover:text-red-800 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3 w-3" /> Delete
          </button>
        </div>
      )}

      {/* Toolbar row */}
      {!isEmpty && (
        <div className="px-6 py-3 flex items-center gap-2 shrink-0">
          <button
            onClick={selectedIds.size === variants.length && variants.length > 0 ? clearSelection : selectAll}
            className="flex items-center gap-1.5 text-[12px] font-medium text-gray-500 hover:text-gray-700 px-2.5 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Check className="h-3 w-3" />
            {selectedIds.size === variants.length && variants.length > 0 ? 'Deselect all' : 'Select all'}
          </button>
          <div className="flex-1" />
          <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 transition-colors ${viewMode === 'grid' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-50'}`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 transition-colors ${viewMode === 'list' ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-50'}`}
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-20 text-center">
            <div className="h-12 w-12 rounded-xl bg-gray-100 flex items-center justify-center mb-3">
              <FolderInput className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-semibold text-gray-700 mb-1">
              {folderId === 'untagged' ? 'All caught up' : 'This folder is empty'}
            </p>
            <p className="text-xs text-gray-400">
              {folderId === 'untagged' ? 'All generated videos are organized in folders' : 'Generate a variant and save it here'}
            </p>
          </div>
        ) : (
          <div className={
            viewMode === 'grid'
              ? 'grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-4 pt-2'
              : 'space-y-2 pt-2'
          }>
            {pendingJobIds.map(id => <ShimmerCard key={id} jobId={id} />)}
            {variants.map(v => (
              <VariantCard
                key={v.id}
                id={v.id}
                prompt={v.prompt}
                outputUrl={v.output_url!}
                createdAt={v.created_at}
                onDelete={onDeleteVariant}
                folders={folders}
                selectable
                selected={selectedIds.has(v.id)}
                onSelect={() => toggleSelect(v.id)}
                highlighted={v.id === selectedVariantId}
                onCardClick={() => onVariantClick(v.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
