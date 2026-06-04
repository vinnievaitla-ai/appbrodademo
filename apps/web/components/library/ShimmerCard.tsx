'use client'

import { useState, useEffect } from 'react'
import { Sparkles } from 'lucide-react'

export function ShimmerCard({ jobId }: { jobId: string }) {
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
      <div className="px-2.5 py-2">
        <p className="text-[10px] text-gray-400 font-mono truncate">{jobId.slice(0, 8)}…</p>
      </div>
    </div>
  )
}
