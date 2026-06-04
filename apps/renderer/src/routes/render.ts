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

async function generateHtml(prompt: string, durationSecs: number, templateContext: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: buildSystemPrompt(durationSecs),
    messages: [{
      role: 'user',
      content: `Generate a HyperFrames end card composition for: ${prompt}${templateContext}`,
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
