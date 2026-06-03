'use client'

import { ChevronDown, Layers } from 'lucide-react'

export function TopBar() {
  return (
    <header className="h-11 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0 z-10">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-gray-400">
          <Layers className="h-3.5 w-3.5" />
          <span className="text-xs font-medium tracking-wide">Game</span>
        </div>
        <div className="h-3.5 w-px bg-gray-200" />
        <button className="flex items-center gap-1 text-sm font-semibold text-gray-900 hover:text-blue-600 transition-colors">
          UI_UX_Workspace
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 mt-px" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-sm">
          <span className="text-white text-[10px] font-bold tracking-wide">KS</span>
        </div>
      </div>
    </header>
  )
}
