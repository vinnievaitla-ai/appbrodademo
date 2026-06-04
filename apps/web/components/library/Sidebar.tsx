'use client'

import { useState } from 'react'
import {
  Anchor, User, Type, AudioWaveform, LayoutTemplate,
  FolderOpen, Folder, FolderPlus, LayoutGrid, Clock,
  ChevronDown, ChevronRight, Pencil, Trash2,
} from 'lucide-react'
import type { Folder as FolderType } from '@/lib/types'
import { renameFolder as renameFolderStore, deleteFolder as deleteFolderStore, getFolders } from '@/lib/folders'

export type ViewState =
  | { type: 'templates'; category: string }
  | { type: 'folder-grid' }
  | { type: 'folder-workspace'; folderId: string | 'untagged' }

const LIBRARY_ITEMS = [
  { id: 'hook',     label: 'Hook',     Icon: Anchor },
  { id: 'body',     label: 'Body',     Icon: User },
  { id: 'text',     label: 'Text',     Icon: Type },
  { id: 'audio',    label: 'Audio',    Icon: AudioWaveform },
  { id: 'end_card', label: 'End Card', Icon: LayoutTemplate },
]

interface SidebarProps {
  view: ViewState
  onViewChange: (v: ViewState) => void
  folders: FolderType[]
  onFoldersChange: (f: FolderType[]) => void
  onNewFolder: () => void
  variantCounts: Record<string, number>   // folderId → count; 'untagged' → count
}

function SectionLabel({ label, action }: { label: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-1.5">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{label}</p>
      {action}
    </div>
  )
}

function NavBtn({
  active, onClick, Icon, label, count, dimmed,
}: {
  active: boolean; onClick: () => void; Icon: React.FC<any>
  label: string; count?: number; dimmed?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`
        group flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] transition-all duration-150 text-left
        ${active
          ? 'bg-blue-50 text-blue-700 font-semibold'
          : dimmed
          ? 'text-gray-400 hover:bg-gray-50 hover:text-gray-600 font-medium'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
        }
      `}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 transition-colors ${
        active ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-500'
      }`} />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${
          active ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

export function Sidebar({
  view, onViewChange, folders, onFoldersChange, onNewFolder, variantCounts,
}: SidebarProps) {
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const activeCategory = view.type === 'templates' ? view.category : null
  const activeFolderId = view.type === 'folder-workspace' ? view.folderId : null

  const commitRename = (id: string) => {
    const t = editName.trim()
    if (t) { renameFolderStore(id, t); onFoldersChange(getFolders()) }
    setEditingId(null)
  }

  const handleDelete = (id: string) => {
    deleteFolderStore(id)
    if (activeFolderId === id) onViewChange({ type: 'folder-grid' })
    onFoldersChange(getFolders())
  }

  return (
    <aside className="w-[200px] shrink-0 bg-white border-r border-gray-100 flex flex-col overflow-hidden">

      {/* ── LIBRARY ─────────────────────────────────────── */}
      <SectionLabel label="Library" />
      <nav className="px-2 space-y-0.5">
        {LIBRARY_ITEMS.map(({ id, label, Icon }) => (
          <NavBtn
            key={id}
            active={activeCategory === id}
            onClick={() => onViewChange({ type: 'templates', category: id })}
            Icon={Icon}
            label={label}
          />
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-4 my-3 h-px bg-gray-100" />

      {/* ── GENERATED CONTENT ───────────────────────────── */}
      <SectionLabel label="Generated" />
      <nav className="px-2 space-y-0.5">
        <NavBtn
          active={view.type === 'folder-grid'}
          onClick={() => onViewChange({ type: 'folder-grid' })}
          Icon={LayoutGrid}
          label="All Variants"
        />
        <NavBtn
          active={false}
          onClick={() => {}}
          Icon={Clock}
          label="Recent"
          dimmed
        />
      </nav>

      {/* Divider */}
      <div className="mx-4 my-3 h-px bg-gray-100" />

      {/* ── FOLDERS ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pt-1 pb-1.5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Folders</p>
        <button
          onClick={() => setFoldersOpen(o => !o)}
          className="text-gray-300 hover:text-gray-500 transition-colors"
        >
          {foldersOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </button>
      </div>

      {foldersOpen && (
        <nav className="flex-1 px-2 overflow-y-auto space-y-0.5 pb-2">

          {/* Untagged pseudo-folder */}
          {(variantCounts['untagged'] ?? 0) > 0 && (
            <NavBtn
              active={activeFolderId === 'untagged'}
              onClick={() => onViewChange({ type: 'folder-workspace', folderId: 'untagged' })}
              Icon={Folder}
              label="Untagged"
              count={variantCounts['untagged']}
            />
          )}

          {/* Named folders */}
          {folders.map(folder => (
            <div
              key={folder.id}
              className="relative"
              onMouseEnter={() => setHoveredId(folder.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {editingId === folder.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => commitRename(folder.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(folder.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="w-full px-3 py-2 text-[13px] rounded-lg border border-blue-300 bg-blue-50 text-blue-800 outline-none"
                />
              ) : (
                <NavBtn
                  active={activeFolderId === folder.id}
                  onClick={() => onViewChange({ type: 'folder-workspace', folderId: folder.id })}
                  Icon={Folder}
                  label={folder.name}
                  count={variantCounts[folder.id]}
                />
              )}

              {/* Hover edit/delete actions */}
              {hoveredId === folder.id && editingId !== folder.id && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-white rounded-lg border border-gray-100 shadow-sm px-0.5 py-0.5 z-10">
                  <button
                    onClick={e => { e.stopPropagation(); setEditingId(folder.id); setEditName(folder.name) }}
                    className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="Rename"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(folder.id) }}
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* New Folder */}
          <button
            onClick={onNewFolder}
            className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-gray-400 hover:text-blue-600 hover:bg-blue-50/60 rounded-lg transition-colors font-medium"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New Folder
          </button>
        </nav>
      )}

      {/* User chip */}
      <div className="p-3 border-t border-gray-100 shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-50">
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-400 to-red-500 shrink-0" />
          <span className="text-[12px] font-medium text-gray-600 truncate">UI_UX_Workspace</span>
        </div>
      </div>
    </aside>
  )
}
