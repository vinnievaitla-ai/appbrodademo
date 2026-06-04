import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

function buildSystemPrompt(durationSecs: number): string {
  return `You are a HyperFrames video composition generator.

HyperFrames converts HTML files into MP4 videos by driving headless Chrome frame-by-frame and encoding with FFmpeg.
The renderer has a built-in CSS animation frame adapter — do NOT add any custom window.__hf or window.__player scripts.

════════════════════════════════════════
COMPOSITION RULES
════════════════════════════════════════
1. Root element (exact format required — ONE only):
   <div id="stage" data-composition-id="variant" data-width="1080" data-height="1920"
        data-start="0" data-duration="${durationSecs}">
   - Always 1080×1920 (vertical format for end cards / mobile)
   ⚠ CRITICAL: data-composition-id MUST be exactly "variant" — any other value breaks the renderer.
   ⚠ CRITICAL: data-duration MUST be exactly "${durationSecs}" — the renderer enforces this value.
   - Body must be exactly 1080px × 1920px with overflow:hidden; margin:0; padding:0
   ⚠ ONLY the root <div id="stage"> may have data-composition-id.
     NEVER put data-composition-id on any child element — it creates broken sub-compositions.

2. Animated elements — use CSS @keyframes for ALL motion:
   - Add data-start="N" on each element to tell the renderer when (in seconds) that element begins
   - Every animated element MUST have: animation-play-state: paused; animation-fill-mode: both
     (paused = renderer controls time, not the wall clock)
   - Use @keyframes for fade, scale, slide, glow, etc.

3. Clip visibility — use data-start and data-duration on each visible element:
   <div data-start="1" data-duration="5" data-track-index="1" class="overlay">
   data-track-index controls layering (0 = base, higher = on top)
   ⚠ Do NOT add data-composition-id here — clips use data-start/data-duration only.

4. Total composition: exactly ${durationSecs} seconds. Design all animations to fill the full ${durationSecs} s.
   The last animation's (delay + duration) must equal ${durationSecs} s.
   Example for ${durationSecs} s: fade-in over first 1 s, hold for ${Math.max(1, durationSecs - 2)} s, fade-out over last 1 s.

5. Supported CSS: @keyframes, gradients, flexbox, transforms, opacity, text-shadow, box-shadow.
   Avoid CSS filter (blur/drop-shadow filter) — it requires expensive per-frame render passes.
   Include all CSS inside a <style> block in <head>.

6. NEVER include <video>, <audio>, or <img> elements. The template video is composited as a
   separate layer in post — your HTML is the overlay only. Even if a video URL is provided for
   context, do NOT embed it as a <video> element.

════════════════════════════════════════
FONTS — CRITICAL
════════════════════════════════════════
- DO NOT use Georgia, Times New Roman, Palatino, Garamond, or any system serif font.
  They are not installed in the render container.
- Load ALL custom fonts via Google Fonts @import as the FIRST line of your <style>:
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400;700&display=swap');
- Use the imported family name: font-family: 'Playfair Display', serif;
- Safe system fallbacks (always available): Arial, Helvetica, sans-serif, monospace.

════════════════════════════════════════
OUTPUT
════════════════════════════════════════
Return ONLY the complete HTML file. No markdown fences, no explanation, no comments outside the HTML.`
}

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
  const { prompt, templateId, templateDuration } = body

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  // Use provided template duration, clamped to a sane range
  const durationSecs = typeof templateDuration === 'number' && templateDuration > 0
    ? Math.min(60, Math.round(templateDuration))
    : 3

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
      templateContext = `\n\nBase template: "${template.name}" — duration ${durationSecs} seconds.\nDo NOT include the video as a <video> element. Your HTML is the overlay layer only; the template video is composited separately. Match the ${durationSecs} s duration exactly.`
    }
  }

  // Call Claude to generate HyperFrames HTML
  let htmlContent: string
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(durationSecs),
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

  // Fire-and-forget to renderer
  const rendererUrl = process.env.RENDERER_SERVICE_URL
  const rendererSecret = process.env.RENDERER_SECRET

  if (!rendererUrl) {
    await supabase.from('render_jobs').update({ status: 'failed', error_message: 'Renderer not configured' }).eq('id', job.id)
    return NextResponse.json({ error: 'Renderer service URL not set' }, { status: 500 })
  }

  try {
    const rendererRes = await fetch(`${rendererUrl}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rendererSecret}` },
      body: JSON.stringify({ jobId: job.id, htmlContent, duration: durationSecs }),
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
