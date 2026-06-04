import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'
import { detectLanguages, buildLanguagePrompt } from '@/lib/language-detection'

// Allow up to 60 s so parallel Claude calls don't time out on Vercel Pro/Hobby.
export const maxDuration = 60

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

5. Supported CSS: @keyframes, simple linear-gradient, flexbox, transforms, opacity, text-shadow, box-shadow.
   STRICTLY AVOID these — they cause Chrome headless to crash mid-render:
   • CSS filter or backdrop-filter (blur, drop-shadow, brightness, etc.)
   • radial-gradient or conic-gradient used as tiled backgrounds (halftone, dot patterns)
   • background-size smaller than 100px (tiled repeating patterns)
   • mix-blend-mode
   • clip-path on large areas
   Stick to: solid colors, one simple linear-gradient per element, opacity, translate/scale/rotate transforms.
   Include all CSS inside a <style> block in <head>.

6. Stage background and overlay design:
   The overlay is composited onto the template video in post using a colorkey filter —
   pure black (#000000) pixels become transparent so the template video shows through.

   ⚠ The stage (#stage) background MUST be exactly #000000 (pure black). Set it via:
     body { background: #000000; }
     #stage { background: #000000; }
   ⚠ NEVER use black or near-black (any color where R<30 AND G<30 AND B<30) for any
     visible element — text, buttons, icons, shadows, borders, or shapes. Use white,
     bright colors, or light shades. Dark navy, dark red, dark green are all fine as
     long as one channel exceeds 30. Pure black text/shadows will disappear.
   ⚠ NEVER include <video>, <audio>, or <img> elements.

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

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function dispatchToRenderer(
  jobId: string,
  htmlContent: string,
  durationSecs: number,
  templateFileUrl: string | undefined,
  supabase: ReturnType<typeof createServiceClient>
) {
  const rendererUrl = process.env.RENDERER_SERVICE_URL
  const rendererSecret = process.env.RENDERER_SECRET
  if (!rendererUrl) {
    await supabase.from('render_jobs')
      .update({ status: 'failed', error_message: 'Renderer not configured' })
      .eq('id', jobId)
    return
  }
  try {
    const res = await fetch(`${rendererUrl}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rendererSecret}` },
      body: JSON.stringify({ jobId, htmlContent, duration: durationSecs, templateUrl: templateFileUrl }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => res.status.toString())
      await supabase.from('render_jobs')
        .update({ status: 'failed', error_message: `Renderer ${res.status}: ${text}` })
        .eq('id', jobId)
    }
  } catch (err: any) {
    await supabase.from('render_jobs')
      .update({ status: 'failed', error_message: 'Renderer unreachable: ' + err.message })
      .eq('id', jobId)
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = createServiceClient()
  const body = await request.json()
  const { prompt, templateId, templateDuration } = body

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const durationSecs = typeof templateDuration === 'number' && templateDuration > 0
    ? Math.min(60, Math.round(templateDuration))
    : 3

  // ── Fetch template metadata (needed for both single and multi-variant) ──────
  let templateContext = ''
  let templateFileUrl: string | undefined
  if (templateId) {
    const { data: template } = await supabase
      .from('templates')
      .select('name, file_url')
      .eq('id', templateId)
      .single()
    if (template) {
      templateFileUrl = template.file_url
      templateContext = `\n\nTemplate video context: "${template.name}" — ${durationSecs}s vertical video.\nYour overlay will be composited on top of this video in post. Black background areas in your composition become transparent (showing the video underneath). All text, buttons, and visible elements must be non-black so they appear on top of the video.`
    }
  }

  // ── Detect multi-language request ──────────────────────────────────────────
  const languages = detectLanguages(prompt)
  const isMultiVariant = languages.length >= 2

  if (isMultiVariant) {
    // ── Multi-variant path: one job per language, parallel Claude calls ──────

    // Build per-language prompts
    const languagePrompts = languages.map(lang => ({
      language: lang,
      prompt: buildLanguagePrompt(prompt, lang, languages),
    }))

    // Insert all job records in one batch
    const { data: jobs, error: jobError } = await supabase
      .from('render_jobs')
      .insert(languagePrompts.map(lp => ({
        prompt: lp.prompt,
        template_id: templateId || null,
        status: 'pending',
      })))
      .select()

    if (jobError || !jobs) {
      return NextResponse.json({ error: jobError?.message || 'Failed to create jobs' }, { status: 500 })
    }

    const jobIds = jobs.map(j => j.id)

    // Fan out to Claude + renderer in parallel (fire-and-forget after acknowledging)
    // We await here so failures are captured within the 60 s window
    await Promise.all(jobs.map(async (job, i) => {
      const lp = languagePrompts[i]
      try {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 8192,
          system: buildSystemPrompt(durationSecs),
          messages: [{
            role: 'user',
            content: `Generate a HyperFrames end card composition for: ${lp.prompt}${templateContext}`,
          }],
        })
        const html = (message.content[0] as { text: string }).text.trim()
        await dispatchToRenderer(job.id, html, durationSecs, templateFileUrl, supabase)
      } catch (err: any) {
        await supabase.from('render_jobs')
          .update({ status: 'failed', error_message: err.message })
          .eq('id', job.id)
      }
    }))

    return NextResponse.json({ jobIds })
  }

  // ── Single-variant path (unchanged logic, returns { jobIds: [id] }) ────────

  const { data: job, error: jobError } = await supabase
    .from('render_jobs')
    .insert({ prompt, template_id: templateId || null, status: 'pending' })
    .select()
    .single()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

  let htmlContent: string
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: buildSystemPrompt(durationSecs),
      messages: [{
        role: 'user',
        content: `Generate a HyperFrames end card composition for: ${prompt}${templateContext}`,
      }],
    })
    htmlContent = (message.content[0] as { text: string }).text.trim()
  } catch (err: any) {
    await supabase.from('render_jobs')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', job.id)
    return NextResponse.json({ error: 'Claude API failed: ' + err.message }, { status: 500 })
  }

  await dispatchToRenderer(job.id, htmlContent, durationSecs, templateFileUrl, supabase)

  return NextResponse.json({ jobIds: [job.id] })
}
