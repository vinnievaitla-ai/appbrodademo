'use client'

import { Anchor, User, Type, AudioWaveform, LayoutTemplate } from 'lucide-react'

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
}

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside className="w-[168px] shrink-0 bg-white border-r border-gray-200 flex flex-col">
      <div className="px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Library</p>
      </div>

      <nav className="flex-1 px-2 py-1 space-y-0.5">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className={`
                group flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-sm transition-all duration-150
                ${isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 font-medium'
                }
              `}
            >
              <Icon
                className={`h-[15px] w-[15px] shrink-0 transition-colors ${
                  isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
                }`}
              />
              {label}
              {isActive && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />
              )}
            </button>
          )
        })}
      </nav>

      <div className="p-3 border-t border-gray-100 mt-auto">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-gray-50">
          <div className="h-5 w-5 rounded-full bg-gradient-to-br from-orange-400 to-red-500 shrink-0" />
          <span className="text-xs font-medium text-gray-600 truncate">UI_UX_Workspace</span>
        </div>
      </div>
    </aside>
  )
}
