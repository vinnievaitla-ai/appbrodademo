import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function uploadGeneratedVariant(filePath: string, jobId: string): Promise<string> {
  const supabase = getSupabase()
  const fileName = `${jobId}.mp4`
  const buffer = fs.readFileSync(filePath)

  // Retry once on transient network failures (fetch failed, connection reset)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await supabase.storage
      .from('generated-variants')
      .upload(fileName, buffer, { contentType: 'video/mp4', upsert: true })

    if (!error) {
      const { data } = supabase.storage.from('generated-variants').getPublicUrl(fileName)
      return data.publicUrl
    }

    if (attempt === 1) {
      console.warn(`Upload attempt 1 failed (${error.message}), retrying in 3 s…`)
      await new Promise(r => setTimeout(r, 3000))
    } else {
      throw new Error(`Storage upload failed: ${error.message}`)
    }
  }

  // TypeScript requires a return — unreachable
  throw new Error('Storage upload failed: exhausted retries')
}

export async function updateJobStatus(
  jobId: string,
  update: { status: string; output_url?: string; error_message?: string; completed_at?: string }
) {
  const supabase = getSupabase()
  const { error } = await supabase.from('render_jobs').update(update).eq('id', jobId)
  if (error) console.error('DB update failed:', error.message)
}
