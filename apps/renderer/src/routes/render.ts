import { Router, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { renderComposition, cleanupTmp } from '../services/hyperframes'
import { uploadGeneratedVariant, updateJobStatus } from '../services/storage'

const router = Router()
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ─── Concurrency queue ────────────────────────────────────────────────────────
// The container has ~512 MB RAM. Running multiple Chrome + FFmpeg processes in
// parallel causes OOM kills and Supabase upload failures (fetch failed).
// Limit to 1 active render at a time; all others wait in the FIFO queue.

let activeRenders = 0
const MAX_CONCURRENT = 1
const renderQueue: Array<() => void> = []

function drainQueue() {
  if (renderQueue.length === 0 || activeRenders >= MAX_CONCURRENT) return
  const next = renderQueue.shift()!
  next()
}

function enqueueRender(fn: () => Promise<void>) {
  const run = () => {
    activeRenders++
    fn().finally(() => {
      activeRenders--
      drainQueue()
    })
  }
  if (activeRenders < MAX_CONCURRENT) {
    run()
  } else {
    console.log(`[queue] ${renderQueue.length + 1} jobs waiting (1 active)`)
    renderQueue.push(run)
  }
}

// ─── Claude HTML generation ───────────────────────────────────────────────────
// Claude is called HERE (in the renderer on Railway) rather than in the Vercel
// API route, so the generation isn't subject to Vercel's serverless timeout.

function buildSystemPrompt(durationSecs: number): string {
  return `You are a professional mobile ad overlay designer using HyperFrames.

HyperFrames converts HTML files into MP4 videos by driving headless Chrome frame-by-frame and encoding with FFmpeg.
The renderer has a built-in CSS animation frame adapter — do NOT add any custom window.__hf or window.__player scripts.

HOW THIS WORKS — READ FIRST
You are compositing a TEXT OVERLAY onto a real video. The stage background is pure black (#000000).
After rendering, FFmpeg colorkeys out all pure-black pixels so only your non-black elements appear
over the video. This means:
  • Every visible element MUST have a non-black background or color.
  • rgba(0,0,0,N) with N < 1 is fine — it is NOT pure black.
  • Pure #000000 or any color where R<30 AND G<30 AND B<30 becomes INVISIBLE. Never use these for text, buttons, or backgrounds you want seen.

════════════════════════════════════════
TWO COMPOSITION MODES — choose based on the request
════════════════════════════════════════

MODE A — TEXT ONLY  (use when NO button/CTA/download is requested)
─────────────────────────────────────────
• One element: a text card centered on the frame.
• Text card:
    position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.58);   ← semi-transparent dark card (NOT pure black)
    border-radius: 24px; padding: 52px 72px; text-align: center; width: 880px;
• Headline inside card: font-size 88px; font-weight 800; color: #FFFFFF; line-height: 1.15;
• Fade-in animation: opacity 0→1 over 0.6s.
• NOTHING ELSE — no buttons, no extra copy, no decorative shapes.

MODE B — TEXT + CTA  (use when user asks for a button, CTA, download prompt, etc.)
─────────────────────────────────────────
• Element 1 — text card (same as Mode A but positioned higher):
    top: 30%; same styles as above.
• Element 2 — CTA pill button. Copy this CSS exactly as a starting point, then adapt colors:

    .cta-btn {
      position: absolute;
      left: 50%; top: 78%; transform: translateX(-50%);
      width: 700px; height: 112px; border-radius: 999px;
      /* Golden gradient — professional game style. Swap hues to match context. */
      background: linear-gradient(180deg, #FFB627 0%, #E8821A 55%, #C8600E 100%);
      border: 3px solid rgba(255, 210, 100, 0.55);
      box-shadow: inset 0 4px 0 rgba(255,255,255,0.28), 0 8px 24px rgba(0,0,0,0.38);
      display: flex; align-items: center; justify-content: center; gap: 18px;
    }
    .cta-label {
      font-size: 52px; font-weight: 800; color: #FFFFFF; letter-spacing: 0.03em;
      text-shadow: 0 2px 6px rgba(0,0,0,0.35);
    }

• Adapt the gradient to fit the context (e.g. blue for "Install", green for "Download", amber/gold for gaming). Keep it a two-stop vertical gradient — ONE colour family only.
• Fade+scale-in animation: opacity 0→1 and scale 0.93→1 over 0.55s.

BUTTON DESIGN LAWS — violations produce ugly output:
  ✗ NEVER use multiple competing hue families on the same button (no red + yellow + green).
  ✗ NEVER add a neon glow box-shadow (e.g. 0 0 30px #00FF00). One drop shadow only.
  ✗ NEVER use yellow, lime, or cyan text — always #FFFFFF on coloured buttons.
  ✗ NEVER add an outer border-color that clashes with the gradient (keep it a lighter tint of the gradient).
  ✗ NEVER add more than one box-shadow layer.

UNIVERSAL RULES (both modes)
─────────────────────────────────────────
• Do NOT add anything the user did not ask for (no extra slogans, no extra buttons, no shapes).
• Do NOT use black or near-black (R<30 AND G<30 AND B<30) for any visible element.
• Do NOT use CSS filter, backdrop-filter, or mix-blend-mode.
• Keep everything else on the stage pure #000000 so it keys out cleanly.

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
   - Use @keyframes for fade, scale, slide, glow, etc.

3. Clip visibility — use data-start and data-duration on each visible element:
   <div data-start="1" data-duration="5" data-track-index="1" class="overlay">
   ⚠ Do NOT add data-composition-id here — clips use data-start/data-duration only.

4. Total composition: exactly ${durationSecs} seconds. Design all animations to fill the full ${durationSecs} s.
   The last animation's (delay + duration) must equal ${durationSecs} s.

5. Supported CSS: @keyframes, simple linear-gradient, flexbox, transforms, opacity, text-shadow, box-shadow.
   STRICTLY AVOID:
   • CSS filter or backdrop-filter (blur, drop-shadow, brightness, etc.)
   • radial-gradient or conic-gradient used as tiled backgrounds
   • background-size smaller than 100px (tiled repeating patterns)
   • mix-blend-mode
   • clip-path on large areas
   Stick to: solid colors, one simple linear-gradient per element, opacity, translate/scale/rotate.
   Include all CSS inside a <style> block in <head>.

6. Stage background and overlay design:
   The overlay is composited onto the template video using a colorkey filter —
   pure black (#000000) pixels become transparent so the template video shows through.

   ⚠ The stage (#stage) background MUST be exactly #000000 (pure black):
     body { background: #000000; }
     #stage { background: #000000; }
   ⚠ NEVER use black or near-black (R<30 AND G<30 AND B<30) for any visible element.
   ⚠ NEVER include <video>, <audio>, or <img> elements.

════════════════════════════════════════
FONTS — CRITICAL
════════════════════════════════════════
- DO NOT use Georgia, Times New Roman, Palatino, Garamond, or any system serif font.
- Load ALL custom fonts via Google Fonts @import as the FIRST line of your <style>:
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
- Safe system fallbacks: Arial, Helvetica, sans-serif, monospace.

════════════════════════════════════════
OUTPUT
════════════════════════════════════════
Return ONLY the complete HTML file. No markdown fences, no explanation, no comments outside the HTML.`
}

// Detect whether the prompt is asking for a CTA button
function hasCta(prompt: string): boolean {
  return /\b(cta|button|btn|download|install|play now|try now|sign up|get it|buy|shop|tap|click|call.?to.?action)\b/i.test(prompt)
}

async function generateHtml(prompt: string, durationSecs: number, templateContext: string): Promise<string> {
  const mode = hasCta(prompt) ? 'B' : 'A'
  const modeLabel = mode === 'B'
    ? 'MODE B (TEXT + CTA): render the overlay text in a text card AND a CTA pill button at the bottom.'
    : 'MODE A (TEXT ONLY): render only the overlay text in a centered text card. No buttons, no extra copy.'

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: buildSystemPrompt(durationSecs),
    messages: [{
      role: 'user',
      content: `${modeLabel}\n\nRequest: ${prompt}${templateContext}`,
    }],
  })
  return (message.content[0] as { text: string }).text.trim()
}

// ─── Shared render-and-upload logic ──────────────────────────────────────────

async function runRenderJob(
  jobId: string,
  htmlContent: string,
  duration: number,
  templateUrl: string | undefined
) {
  await updateJobStatus(jobId, { status: 'processing' })

  const outputPath = await renderComposition(htmlContent, jobId, duration, templateUrl)
  const publicUrl = await uploadGeneratedVariant(outputPath, jobId)

  await updateJobStatus(jobId, {
    status: 'done',
    output_url: publicUrl,
    completed_at: new Date().toISOString(),
  })
}

async function handleJobError(jobId: string, err: Error) {
  console.error(`Render failed for job ${jobId}:`, err.message)

  let htmlDebug = ''
  try {
    const indexPath = path.join('/app/tmp', jobId, 'index.html')
    const raw = fs.readFileSync(indexPath, 'utf-8')
    const rawNoScript = raw.replace(/<script[\s\S]*?<\/script>/gi, '')
    const idx = rawNoScript.indexOf('data-composition-id=')
    if (idx === -1) {
      htmlDebug = '\n[HTML debug] data-composition-id NOT FOUND in sanitized HTML'
    } else {
      const snippet = rawNoScript.substring(Math.max(0, idx - 60), idx + 340)
      htmlDebug = '\n[HTML debug] ...around composition root:\n' + snippet
    }
  } catch {}

  await updateJobStatus(jobId, {
    status: 'failed',
    error_message: err.message + htmlDebug,
    completed_at: new Date().toISOString(),
  })
}

// ─── POST /render ─────────────────────────────────────────────────────────────
//
// Accepts TWO modes:
//   1. { jobId, htmlContent, duration, templateUrl }  — pre-generated HTML (legacy)
//   2. { jobId, prompt, duration, templateUrl, templateContext } — Claude generates HTML here
//
// Mode 2 is used by multi-variant generation so the Vercel API route stays
// fast (just creates jobs + dispatches prompts) without timing out.

router.post('/render', (req: Request, res: Response) => {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.RENDERER_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { jobId, htmlContent, prompt, duration, templateUrl, templateContext } = req.body as {
    jobId: string
    htmlContent?: string
    prompt?: string
    duration?: number
    templateUrl?: string
    templateContext?: string
  }

  if (!jobId || (!htmlContent && !prompt)) {
    res.status(400).json({ error: 'jobId and either htmlContent or prompt are required' })
    return
  }

  // Acknowledge immediately — rendering happens async in the queue
  res.json({ status: 'accepted', jobId })

  const durationSecs = duration ?? 3

  enqueueRender(async () => {
    try {
      // If prompt-mode: generate HTML here on Railway (no Vercel timeout risk)
      const html = htmlContent ?? await generateHtml(prompt!, durationSecs, templateContext ?? '')
      await runRenderJob(jobId, html, durationSecs, templateUrl)
    } catch (err: any) {
      await handleJobError(jobId, err)
    } finally {
      cleanupTmp(jobId)
    }
  })
})

export default router
