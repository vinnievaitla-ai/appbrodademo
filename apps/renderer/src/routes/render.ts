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

════════════════════════════════════════
THE MOST IMPORTANT RULE
════════════════════════════════════════
⚠ Render ONLY the elements the user explicitly requests. Nothing more.
  If the user asks for a button → render only the button.
  If the user asks for text → render only that text.
  If the user asks for text + button → render both.
  NEVER invent headlines, slogans, decorative shapes, or extra copy that wasn't asked for.

════════════════════════════════════════
HOW THIS WORKS
════════════════════════════════════════
You are compositing an overlay onto a real video. The stage background is pure black (#000000).
FFmpeg colorkeys out all pure-black pixels — only your non-black elements appear over the video.
  • Every visible element MUST use a non-black color or background.
  • rgba(0,0,0,N) with N < 1 is fine — it is NOT pure black.
  • Pure #000000 or any color where R<30 AND G<30 AND B<30 becomes INVISIBLE.

════════════════════════════════════════
ELEMENT REFERENCE — use only what is asked for
════════════════════════════════════════

TEXT CARD — use when the user asks for a text overlay, message, caption, headline, or localized text
  position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%);
  background: rgba(0,0,0,0.58); border-radius: 24px; padding: 52px 72px;
  text-align: center; width: 880px;
  Headline: font-size 88px; font-weight 800; color: #FFFFFF; line-height: 1.15;
  Animation: fade-in opacity 0→1 over 0.6s.
  If combined with a button below, shift the card higher (top: 28%).

CTA BUTTON — use when the user asks for a button, CTA, download/install prompt, or action
  position: absolute; left: 50%; top: 82%; transform: translateX(-50%);
  width: 700px; height: 112px; border-radius: 999px;
  background: linear-gradient(180deg, #FFB627 0%, #E8821A 55%, #C8600E 100%);
  border: 3px solid rgba(255,210,100,0.55);
  box-shadow: inset 0 4px 0 rgba(255,255,255,0.28), 0 8px 24px rgba(0,0,0,0.38);
  display: flex; align-items: center; justify-content: center;
  Label: font-size 52px; font-weight 800; color: #FFFFFF; letter-spacing: 0.03em;
         text-shadow: 0 2px 6px rgba(0,0,0,0.35);
  Adapt gradient hue to context (blue → Install, green → Download, amber/gold → gaming).
  Keep it a two-stop vertical gradient — ONE colour family only.
  Animation: fade + scale-in opacity 0→1, scale 0.93→1 over 0.55s.
  If combined with a text card above, shift button to top: 78%.

REWARD CALLOUT — use when the user asks for a reward, coin amount, bonus, or prize callout
  Smaller pill above the button or standalone.
  background: rgba(255,200,0,0.15); border: 2px solid rgba(255,200,0,0.5);
  border-radius: 999px; padding: 18px 48px;
  Text: font-size 48px; font-weight 700; color: #FFD700;
  Animation: fade-in opacity 0→1 over 0.5s.

COUNTDOWN TIMER — use when the user asks for a countdown or timer
  Large centered number, font-size 160px; font-weight 900; color: #FFFFFF;
  Animate each digit with a scale pop (scale 1.2→1 over 0.2s) per second tick.

CAPTION / SUBTITLE — use when the user asks for captions or subtitles
  position: absolute; bottom: 180px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,0.72); border-radius: 12px; padding: 24px 48px;
  font-size 52px; font-weight 600; color: #FFFFFF; text-align: center; width: 960px;

BUTTON DESIGN LAWS (whenever a button is rendered):
  ✗ NEVER use multiple competing hue families on the same button.
  ✗ NEVER add a neon glow box-shadow. One drop shadow only.
  ✗ NEVER use yellow, lime, or cyan text — always #FFFFFF.
  ✗ NEVER add an outer border-color that clashes with the gradient.
  ✗ NEVER add more than one box-shadow layer.

════════════════════════════════════════
COMPOSITION RULES
════════════════════════════════════════
1. Root element (exact format required — ONE only):
   <div id="stage" data-composition-id="variant" data-width="1080" data-height="1920"
        data-start="0" data-duration="${durationSecs}">
   - Always 1080×1920 (vertical format for mobile)
   ⚠ CRITICAL: data-composition-id MUST be exactly "variant".
   ⚠ CRITICAL: data-duration MUST be exactly "${durationSecs}".
   - Body must be exactly 1080px × 1920px with overflow:hidden; margin:0; padding:0
   ⚠ NEVER put data-composition-id on any child element.

2. Animated elements — use CSS @keyframes for ALL motion:
   - Add data-start="N" on each element (in seconds)
   - Every animated element MUST have: animation-play-state: paused; animation-fill-mode: both

3. Clip visibility:
   <div data-start="1" data-duration="5" data-track-index="1" class="overlay">
   ⚠ Do NOT add data-composition-id to clips — use data-start/data-duration only.

4. Total composition: exactly ${durationSecs} seconds.
   The last animation's (delay + duration) must equal ${durationSecs}s.

5. Supported CSS: @keyframes, simple linear-gradient, flexbox, transforms, opacity, text-shadow, box-shadow.
   STRICTLY AVOID: filter, backdrop-filter, radial-gradient as backgrounds, mix-blend-mode, clip-path on large areas.
   Include all CSS inside a <style> block in <head>.

6. Stage background:
   ⚠ body and #stage background MUST be exactly #000000 (pure black — keys out to transparent).
   ⚠ NEVER include <video>, <audio>, or <img> elements.

════════════════════════════════════════
FONTS
════════════════════════════════════════
- Load fonts via Google Fonts @import as the FIRST line of your <style>.
- Safe fallbacks: Arial, Helvetica, sans-serif.
- NEVER use Georgia, Times New Roman, or any serif font.

════════════════════════════════════════
OUTPUT
════════════════════════════════════════
Return ONLY the complete HTML file. No markdown fences, no explanation, no comments outside the HTML.`
}

import type {
  ContentBlockParam,
  TextBlockParam,
  ImageBlockParam,
  DocumentBlockParam,
} from '@anthropic-ai/sdk/resources/messages'

type RendererAttachment = { type: 'image' | 'pdf' | 'document'; url: string; name: string }

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

function toImageMediaType(raw: string): ImageMediaType {
  const t = raw.split(';')[0].trim().toLowerCase()
  if (t === 'image/png')  return 'image/png'
  if (t === 'image/gif')  return 'image/gif'
  if (t === 'image/webp') return 'image/webp'
  return 'image/jpeg'
}

async function fetchBase64(url: string): Promise<{ data: string; contentType: string }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch attachment: ${url} (${res.status})`)
  const buffer = await res.arrayBuffer()
  return {
    data: Buffer.from(buffer).toString('base64'),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  }
}

async function generateHtml(
  prompt: string,
  durationSecs: number,
  templateContext: string,
  attachments: RendererAttachment[] = []
): Promise<string> {
  const content: ContentBlockParam[] = [
    {
      type: 'text',
      text: `Request: ${prompt}${templateContext}`,
    } satisfies TextBlockParam,
  ]

  for (const att of attachments) {
    try {
      if (att.type === 'image') {
        const { data, contentType } = await fetchBase64(att.url)
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: toImageMediaType(contentType),
            data,
          },
        } satisfies ImageBlockParam)
      } else if (att.type === 'pdf') {
        const { data } = await fetchBase64(att.url)
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data },
        } satisfies DocumentBlockParam)
      } else {
        // document (PPTX/DOCX/JSON) — filename context hint only (Phase 2 parsing)
        content.push({
          type: 'text',
          text: `Reference file attached: ${att.name} (use context from prompt to interpret)`,
        } satisfies TextBlockParam)
      }
    } catch (err: any) {
      console.warn(`[render] Could not load attachment ${att.name}: ${err.message}`)
    }
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 8192,
    system: buildSystemPrompt(durationSecs),
    messages: [{ role: 'user', content }],
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

  const { jobId, htmlContent, prompt, duration, templateUrl, templateContext, attachments } = req.body as {
    jobId: string
    htmlContent?: string
    prompt?: string
    duration?: number
    templateUrl?: string
    templateContext?: string
    attachments?: RendererAttachment[]
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
      const html = htmlContent ?? await generateHtml(prompt!, durationSecs, templateContext ?? '', attachments ?? [])
      await runRenderJob(jobId, html, durationSecs, templateUrl)
    } catch (err: any) {
      await handleJobError(jobId, err)
    } finally {
      cleanupTmp(jobId)
    }
  })
})

export default router
