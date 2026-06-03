import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = createServiceClient()

  // Fetch file_url so we can remove from storage too
  const { data: template } = await supabase
    .from('templates')
    .select('file_url')
    .eq('id', id)
    .single()

  if (template?.file_url) {
    const fileName = template.file_url.split('/').pop()
    if (fileName) {
      await supabase.storage.from('templates').remove([fileName])
    }
  }

  const { error } = await supabase.from('templates').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
