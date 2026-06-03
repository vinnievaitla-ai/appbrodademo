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

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to parse form data: ' + e.message }, { status: 400 })
  }

  const file = formData.get('file') as File
  const category = (formData.get('category') as string) || 'end_card'
  const name = (formData.get('name') as string) || file?.name

  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  const ext = file.name.split('.').pop()
  const fileName = `${crypto.randomUUID()}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from('templates')
    .upload(fileName, buffer, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('Storage upload error:', uploadError)
    return NextResponse.json({ error: 'Storage error: ' + uploadError.message }, { status: 500 })
  }

  const { data: { publicUrl } } = supabase.storage.from('templates').getPublicUrl(fileName)

  const { data, error } = await supabase
    .from('templates')
    .insert({ name, file_url: publicUrl, file_size_bytes: file.size, category })
    .select()
    .single()

  if (error) {
    console.error('DB insert error:', error)
    return NextResponse.json({ error: 'DB error: ' + error.message }, { status: 500 })
  }
  return NextResponse.json({ template: data })
}
