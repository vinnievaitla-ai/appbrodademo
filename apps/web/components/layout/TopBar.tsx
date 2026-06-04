'use client'

import { ChevronDown, Layers } from 'lucide-react'

export function TopBar() {
  return (
    <header className="h-14 bg-[#FBFAF8] border-b border-[#E7E2DB] flex items-center justify-between px-8 shrink-0 z-10">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-[#8B847C]">
          <Layers className="h-4 w-4" />
          <span className="text-[13px] font-semibold tracking-wide">Game</span>
        </div>
        <div className="h-4 w-px bg-[#DAD3C9]" />
        <button className="flex items-center gap-1.5 text-[14px] font-bold text-[#1C1A18] hover:text-[#E2623F] transition-colors">
          UI_UX_Workspace
          <ChevronDown className="h-4 w-4 text-[#ABA49B] mt-px" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#E2623F] to-[#ef8a5f] flex items-center justify-center shadow-[0_4px_12px_rgba(226,98,63,0.32)]">
          <span className="text-white text-[12px] font-bold tracking-wide">KS</span>
        </div>
      </div>
    </header>
  )
}
