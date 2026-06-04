'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { FolderOpen, FolderPlus, Check, X } from 'lucide-react'
import type { Folder } from '@/lib/types'
import { getFolders, createFolder, assignVariantsToFolder } from '@/lib/folders'

interface FolderPickerModalProps {
  open: boolean
  variantIds: string[]        // IDs of the just-completed variants
  onClose: () => void
  onAssigned: (folders: Folder[]) => void  // called after assignment so parent can refresh
}

export function FolderPickerModal({ open, variantIds, onClose, onAssigned }: FolderPickerModalProps) {
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    if (open) {
      setFolders(getFolders())
      setSelectedId(null)
      setIsCreating(false)
      setNewName('')
    }
  }, [open])

  const handleCreateFolder = () => {
    const name = newName.trim()
    if (!name) return
    const folder = createFolder(name)
    const updated = [...folders, folder]
    setFolders(updated)
    setSelectedId(folder.id)
    setIsCreating(false)
    setNewName('')
  }

  const handleSave = () => {
    if (!selectedId) { onClose(); return }
    assignVariantsToFolder(variantIds, selectedId)
    onAssigned(getFolders())
    onClose()
  }

  const count = variantIds.length

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-[360px] p-0 overflow-hidden border-0 shadow-2xl rounded-2xl gap-0">
        <div className="flex flex-col bg-white rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-blue-50 flex items-center justify-center">
                <FolderOpen className="h-3.5 w-3.5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900 leading-tight">Save to Folder</h2>
                <p className="text-[11px] text-gray-400">
                  {count === 1 ? '1 new variant' : `${count} new variants`} ready
                </p>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-300 hover:text-gray-600 transition-colors p-1 rounded-md hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 pb-5 space-y-3">
            {/* Folder list */}
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {folders.length === 0 && !isCreating && (
                <p className="text-[12px] text-gray-400 text-center py-4">No folders yet — create one below</p>
              )}
              {folders.map(folder => (
                <button
                  key={folder.id}
                  onClick={() => setSelectedId(folder.id === selectedId ? null : folder.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors ${
                    selectedId === folder.id
                      ? 'bg-blue-50 border border-blue-200 text-blue-700'
                      : 'bg-gray-50 border border-transparent text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <FolderOpen className={`h-3.5 w-3.5 shrink-0 ${selectedId === folder.id ? 'text-blue-500' : 'text-gray-400'}`} />
                  <span className="text-[12px] font-medium truncate flex-1">{folder.name}</span>
                  {selectedId === folder.id && <Check className="h-3 w-3 text-blue-500 shrink-0" />}
                </button>
              ))}
            </div>

            {/* New folder input */}
            {isCreating ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleCreateFolder()
                    if (e.key === 'Escape') { setIsCreating(false); setNewName('') }
                  }}
                  placeholder="Folder name…"
                  className="flex-1 px-3 py-2 text-[12px] rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
                />
                <button
                  onClick={handleCreateFolder}
                  disabled={!newName.trim()}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-[12px] font-medium rounded-lg transition-colors"
                >
                  Create
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-dashed border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
              >
                <FolderPlus className="h-3.5 w-3.5" />
                <span className="text-[12px] font-medium">New folder</span>
              </button>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 h-9 rounded-xl border border-gray-200 text-[12px] font-medium text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleSave}
                disabled={!selectedId}
                className="flex-1 h-9 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-semibold transition-colors"
              >
                Save to Folder
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
