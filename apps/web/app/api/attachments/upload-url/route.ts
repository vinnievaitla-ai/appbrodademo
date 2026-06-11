import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

// Returns a signed upload URL for the `attachments` Supabase bucket.
// Auto-creates the bucket (public, 50 MB limit) on first use via the service role.

export async function GET(request: NextRequest) {
  const ext = request.nextUrl.searchParams.get('ext') || 'bin'
  const supabase = createServiceClient()

  // Best-effort bucket creation — silently ignores "already exists" errors
  await supabase.storage
    .createBucket('attachments', { public: true, fileSizeLimit: 52_428_800 })
    .catch(() => {})

  const filePath = `${crypto.randomUUID()}.${ext}`

  const { data, error } = await supabase.storage
    .from('attachments')
    .createSignedUploadUrl(filePath)

  if (error) {
    const isMissingBucket = error.message?.toLowerCase().includes('not found') ||
      error.message?.toLowerCase().includes('does not exist') ||
      error.message?.toLowerCase().includes('bucket')
    const hint = isMissingBucket
      ? ' — create an "attachments" bucket (public, 50MB) in your Supabase Storage dashboard'
      : ''
    return NextResponse.json({ error: error.message + hint }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage
    .from('attachments')
    .getPublicUrl(filePath)

  return NextResponse.json({ signedUrl: data.signedUrl, path: filePath, publicUrl })
}
