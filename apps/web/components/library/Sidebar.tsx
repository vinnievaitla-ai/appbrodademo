'use client'

import { useState } from 'react'
import { Anchor, User, Type, AudioWaveform, LayoutTemplate, FolderOpen, Folder, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Folder as FolderType } from '@/lib/types'
import { renameFolder, deleteFolder, getFolders } from '@/lib/folders'

const NAV_ITEMS = [
  { id: 'hook',     label: 'Hook',     Icon: Anchor },
  { id: 'body',     label: 'Body',     Icon: User },
  { id: 'text',     label: 'Text',     Icon: Type },
  { id: 'audio',    label: 'Audio',    Icon: AudioWaveform },
  { id: 'end_card', label: 'End Card', Icon: LayoutTemplate },
]

interface SidebarProps {
  active: string
  onChange: (id: string) => void
  activeFolder: string | null
  onFolderChange: (id: string | null) => void
  folders: FolderType[]
}

export function Sidebar({ active, onChange, activeFolder, onFolderChange, folders }: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const handleRename = (id: string, currentName: string) => {
    setEditingId(id)
    setEditName(currentName)
  }

  const commitRename = (id: string) => {
    const trimmed = editName.trim()
    if (trimmed) renameFolder(id, trimmed)
    setEditingId(null)
    setEditName('')
  }

  const handleDelete = (id: string) => {
    deleteFolder(id)
    if (activeFolder === id) onFolderChange(null)
  }

  return (
    <aside className="w-[168px] shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
      {/* Library section */}
      <div className="px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Library</p>
      </div>

      <nav className="px-2 py-1 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = active === id && !activeFolder
          return (
            <button
              key={id}
              onClick={() => { onChange(id); onFolderChange(null) }}
              className={`
                group flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-all duration-150
                ${isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 font-medium'
                }
              `}
            >
              <Icon className={`h-[15px] w-[15px] shrink-0 transition-colors ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
              {label}
              {isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />}
            </button>
          )
        })}
      </nav>

      {/* Divider */}
      <div className="mx-3 my-2 h-px bg-gray-100" />

      {/* Folders section */}
      <div className="px-4 pb-1">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Folders</p>
      </div>

      <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
        {/* All Variants */}
        <button
          onClick={() => onFolderChange(null)}
          className={`
            group flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-all duration-150
            ${activeFolder === null
              ? 'bg-blue-50 text-blue-700 font-semibold'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 font-medium'
            }
          `}
        >
          <FolderOpen className={`h-[15px] w-[15px] shrink-0 ${activeFolder === null ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
          All Variants
          {activeFolder === null && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />}
        </button>

        {/* Individual folders */}
        {folders.map(folder => {
          const isActive = activeFolder === folder.id
          return (
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
                    if (e.key === 'Escape') { setEditingId(null); setEditName('') }
                  }}
                  className="w-full px-3 py-2 text-sm rounded-md border border-blue-300 bg-blue-50 text-blue-800 outline-none"
                />
              ) : (
                <button
                  onClick={() => onFolderChange(folder.id)}
                  className={`
                    group flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-all duration-150
                    ${isActive
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 font-medium'
                    }
                  `}
                >
                  <Folder className={`h-[15px] w-[15px] shrink-0 ${isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
                  <span className="truncate flex-1 text-left">{folder.name}</span>
                  {isActive && !hoveredId && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />}
                </button>
              )}

              {/* Hover actions */}
              {hoveredId === folder.id && editingId !== folder.id && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 bg-white rounded-md shadow-sm border border-gray-100 px-0.5 py-0.5 z-10">
                  <button
                    onClick={e => { e.stopPropagation(); handleRename(folder.id, folder.name) }}
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
          )
        })}
      </nav>

      {/* User / workspace */}
      <div className="p-3 border-t border-gray-100 mt-auto shrink-0">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50">
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-400 to-red-500 shrink-0" />
          <span className="text-xs font-medium text-gray-600 truncate">UI_UX_Workspace</span>
        </div>
      </div>
    </aside>
  )
}
