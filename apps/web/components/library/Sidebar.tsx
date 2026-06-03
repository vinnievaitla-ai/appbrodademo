'use client'

import { Anchor, User, Type, Volume2, LayoutTemplate } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'hook',     label: 'Hook',     Icon: Anchor },
  { id: 'body',     label: 'Body',     Icon: User },
  { id: 'text',     label: 'Text',     Icon: Type },
  { id: 'audio',    label: 'Audio',    Icon: Volume2 },
  { id: 'end_card', label: 'End Card', Icon: LayoutTemplate },
]

interface SidebarProps {
  active: string
  onChange: (id: string) => void
}

export function Sidebar({ active, onChange }: SidebarProps) {
  return (
    <aside className="w-40 shrink-0 bg-white border-r border-gray-200 flex flex-col py-2">
      {NAV_ITEMS.map(({ id, label, Icon }) => {
        const isActive = active === id
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors w-full text-left ${
              isActive
                ? 'border-l-[3px] border-blue-600 bg-white font-medium text-gray-900'
                : 'border-l-[3px] border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-blue-600' : ''}`} />
            {label}
          </button>
        )
      })}
    </aside>
  )
}
