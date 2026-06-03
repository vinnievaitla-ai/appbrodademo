import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const HYPERFRAMES_SYSTEM_PROMPT = `You are a HyperFrames video composition generator.

HyperFrames converts HTML files into MP4 videos by driving headless Chrome frame-by-frame and encoding with FFmpeg.

════════════════════════════════════════
MANDATORY: window.__hf SETUP SCRIPT
════════════════════════════════════════
Every composition MUST include this exact <script> block immediately before </body>.
Do NOT omit it. Do NOT modify the window.__hf assignment logic. It is what makes rendering work.

<script>
(function () {
  function setup() {
    var anims = document.getAnimations();
    var maxEnd = 0;
    anims.forEach(function (a) {
      var t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
      if (!t) return;
      var delay = typeof t.delay === 'number' ? t.delay : 0;
      var dur = typeof t.duration === 'number' ? t.duration : 0;
      var end = (delay + dur) / 1000;
      if (end > maxEnd) maxEnd = end;
    });
    window.__hf = {
      duration: maxEnd || 8,
      seek: function (t) {
        document.getAnimations().forEach(function (a) {
          a.currentTime = t * 1000;
        });
      }
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
</script>

════════════════════════════════════════
COMPOSITION RULES
════════════════════════════════════════
1. Root element must be:
   <div id="stage" data-composition-id="variant" data-width="1080" data-height="1920" data-start="0">
   Always 1080×1920 (vertical format). Body must be 1080px × 1920px with overflow:hidden.

2. Timing with CSS animations (NOT JavaScript timers):
   - Use animation-delay to control WHEN an element appears (e.g. animation-delay: 2s to appear at 2 s)
   - Use animation-duration to control HOW LONG it is visible
   - Every animated element MUST have: animation-play-state: paused; animation-fill-mode: both
   - Pausing is required so the seek function controls time instead of the wall clock

3. Total composition: 5–8 seconds. Keep it tight.

4. Supported CSS: @keyframes, gradients, flexbox, transforms, filters, text-shadow, box-shadow, clip-path.

5. Include all CSS inside a <style> block in <head>.

6. Do NOT use JavaScript setTimeout/setInterval/requestAnimationFrame — all motion must be driven by CSS @keyframes only.

7. No external media (no <img src=>, no <video>) unless a URL is explicitly provided.

════════════════════════════════════════
FONTS — CRITICAL
════════════════════════════════════════
- DO NOT use Georgia, Times New Roman, Palatino, Garamond, or any system serif font — they are not installed in the render container.
- Load ALL custom fonts via Google Fonts @import as the FIRST line of your <style>:
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400;700&display=swap');
- Then use the imported family name: font-family: 'Playfair Display', serif;
- Safe system fallbacks (always available): Arial, Helvetica, sans-serif, monospace.

════════════════════════════════════════
OUTPUT
════════════════════════════════════════
Return ONLY the complete HTML file. No markdown fences, no explanation, no comments outside the HTML.`

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
