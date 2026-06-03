import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServiceClient()

  const { data: jobs } = await supabase
    .from('render_jobs')
    .select('id, status, error_message, created_at, completed_at, prompt')
    .order('created_at', { ascending: false })
    .limit(10)

  const rendererUrl = process.env.RENDERER_SERVICE_URL ?? 'NOT SET'
  const rendererSecretSet = !!process.env.RENDERER_SECRET

  // Ping the renderer health endpoint
  let rendererStatus = 'unreachable'
  try {
    const r = await fetch(`${rendererUrl}/health`, { signal: AbortSignal.timeout(5000) })
    rendererStatus = r.ok ? 'healthy' : `HTTP ${r.status}`
  } catch (e: any) {
    rendererStatus = e.message
  }

  return NextResponse.json({
    renderer: { url: rendererUrl, secretSet: rendererSecretSet, status: rendererStatus },
    recentJobs: jobs ?? [],
  })
}
