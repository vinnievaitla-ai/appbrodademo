import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const HYPERFRAMES_SYSTEM_PROMPT = `You are a HyperFrames video composition generator.

HyperFrames converts HTML files into MP4 videos by driving headless Chrome frame-by-frame and encoding with FFmpeg.

COMPOSITION RULES:
1. Root element: <div id="stage" data-composition-id="variant" data-width="1080" data-height="1920" data-start="0">
   - Always 1080x1920 (vertical/mobile format for end cards)
2. Timing data attributes on every visible element:
   - data-start: seconds when element appears (number)
   - data-duration: seconds element is visible (number)
   - data-track-index: layer order (0 = base, higher = on top)
3. Total composition length: 5–8 seconds (keep it short)
4. Supported: any HTML/CSS including animations, gradients, flexbox
5. Animations: use CSS @keyframes — they play when the element's data-start time is reached
6. Include <style> in <head> for all styling
7. Do NOT reference external files (no src= for video/img unless given a URL)
8. Background fills and text overlays only — no external media dependencies

FONTS — CRITICAL:
- The renderer runs in a Linux Docker container with limited fonts. DO NOT use Georgia, Times New Roman, Palatino, Garamond, or any serif font by name.
- For custom fonts, ALWAYS load via Google Fonts @import at the very top of your <style> block:
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400;700&display=swap');
- Use the imported font-family name in your CSS (e.g. font-family: 'Playfair Display', serif).
- Safe fallbacks: Arial, Helvetica, sans-serif, monospace — these are always available.
- Always pick at least one Google Font import so custom font families resolve correctly.

OUTPUT: Return ONLY the complete HTML file content. No markdown, no explanation, no code fences.`

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get('category') || 'end_card'
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('render_jobs')
    .select('*')
    .eq('status', 'done')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ variants: data })
}

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()
  const body = await request.json()
  const { prompt, templateId } = body

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  // Create job record
  const { data: job, error: jobError } = await supabase
    .from('render_jobs')
    .insert({ prompt, template_id: templateId || null, status: 'pending' })
    .select()
    .single()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

  // Get template URL for context if provided
  let templateContext = ''
  if (templateId) {
    const { data: template } = await supabase
      .from('templates')
      .select('name, file_url')
      .eq('id', templateId)
      .single()
    if (template) {
      templateContext = `\n\nBase template: "${template.name}" (${template.file_url})\nIf the template is a video, you may reference it as src="${template.file_url}" on a <video> element with appropriate data attributes.`
    }
  }

  // Call Claude to generate HyperFrames HTML
  let htmlContent: string
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: HYPERFRAMES_SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate a HyperFrames end card composition for: ${prompt}${templateContext}`
      }]
    })
    htmlContent = (message.content[0] as { text: string }).text.trim()
  } catch (err: any) {
    await supabase.from('render_jobs').update({ status: 'failed', error_message: err.message }).eq('id', job.id)
    return NextResponse.json({ error: 'Claude API failed: ' + err.message }, { status: 500 })
  }

  // Fire-and-forget to renderer — update job to failed if renderer is unreachable
  const rendererUrl = process.env.RENDERER_SERVICE_URL
  const rendererSecret = process.env.RENDERER_SECRET

  if (!rendererUrl) {
    await supabase.from('render_jobs').update({ status: 'failed', error_message: 'Renderer not configured' }).eq('id', job.id)
    return NextResponse.json({ error: 'Renderer service URL not set' }, { status: 500 })
  }

  // Await Railway — it responds immediately with { status: 'accepted' } then renders async.
  // Must be awaited: Vercel freezes the process the moment we return, so a fire-and-forget
  // fetch would never actually be sent.
  try {
    const rendererRes = await fetch(`${rendererUrl}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rendererSecret}` },
      body: JSON.stringify({ jobId: job.id, htmlContent }),
    })
    if (!rendererRes.ok) {
      const text = await rendererRes.text().catch(() => rendererRes.status.toString())
      await supabase.from('render_jobs')
        .update({ status: 'failed', error_message: `Renderer ${rendererRes.status}: ${text}` })
        .eq('id', job.id)
    }
  } catch (err: any) {
    await supabase.from('render_jobs')
      .update({ status: 'failed', error_message: 'Renderer unreachable: ' + err.message })
      .eq('id', job.id)
  }

  return NextResponse.json({ jobId: job.id })
}
