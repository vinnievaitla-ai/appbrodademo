import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category') || 'end_card'
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('category', category)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data })
}

// Accepts JSON { name, category, path, fileSizeBytes } after browser has uploaded
// directly to Supabase Storage via signed URL — no file bytes pass through Vercel.
export async function POST(request: NextRequest) {
  const supabase = createServiceClient()

  let body: { name: string; category: string; path: string; fileSizeBytes: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, category = 'end_card', path, fileSizeBytes } = body
  if (!path) return NextResponse.json({ error: 'path is required' }, { status: 400 })

  const { data: { publicUrl } } = supabase.storage.from('templates').getPublicUrl(path)

  const { data, error } = await supabase
    .from('templates')
    .insert({ name: name || path, file_url: publicUrl, file_size_bytes: fileSizeBytes ?? 0, category })
    .select()
    .single()

  if (error) {
    console.error('DB insert error:', error)
    return NextResponse.json({ error: 'DB error: ' + error.message }, { status: 500 })
  }
  return NextResponse.json({ template: data })
}
