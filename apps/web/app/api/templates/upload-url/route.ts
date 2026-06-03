import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const ext = request.nextUrl.searchParams.get('ext') || 'mp4'
  const supabase = createServiceClient()

  const path = `${crypto.randomUUID()}.${ext}`
  const { data, error } = await supabase.storage
    .from('templates')
    .createSignedUploadUrl(path)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path })
}
