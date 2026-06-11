import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { detectLanguages, buildLanguagePrompt } from '@/lib/language-detection'
import type { ProcessedAttachment } from '@/lib/attachments'
import { rowToText, formatAttachmentContext } from '@/lib/attachments'

// No Claude calls here — HTML generation happens inside the renderer (Railway).
// This keeps the Vercel function well under any timeout limit.

export async function GET(request: NextRequest) {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('render_jobs')
    .select('*')
    .eq('status', 'done')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ variants: data })
}

// ─── Dispatch helper ──────────────────────────────────────────────────────────
// Sends a prompt (not pre-generated HTML) to the renderer.
// The renderer calls Claude internally — no serverless timeout risk.

type AttachmentUrl = { type: 'image' | 'pdf' | 'document'; url: string; name: string }

async function dispatchPromptToRenderer(
  jobId: string,
  prompt: string,
  durationSecs: number,
  templateFileUrl: string | undefined,
  templateContext: string,
  supabase: ReturnType<typeof createServiceClient>,
  attachmentUrls?: AttachmentUrl[],
  htmlContent?: string,
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
      body: JSON.stringify({
        jobId,
        ...(htmlContent ? { htmlContent } : { prompt }),
        duration: durationSecs,
        templateUrl: templateFileUrl,
        templateContext,
        ...(attachmentUrls?.length ? { attachments: attachmentUrls } : {}),
      }),
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
  const { prompt, templateId, templateDuration, attachments } = body as {
    prompt: string
    templateId?: string
    templateDuration?: number
    attachments?: ProcessedAttachment[]
  }

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const durationSecs = typeof templateDuration === 'number' && templateDuration > 0
    ? Math.min(60, Math.round(templateDuration))
    : 3

  // Fetch template metadata (fast — just a DB lookup)
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
      templateContext = `\n\nTemplate video context: "${template.name}" — ${durationSecs}s vertical video.\nYour overlay will be composited on top of this video in post. Black background areas become transparent (showing the video underneath). All text and visible elements must be non-black.`
    }
  }

  // ── Attachment routing ─────────────────────────────────────────────────────

  // 1. HTML/CSS attachment — skip Claude, send htmlContent directly to renderer
  const htmlAttachment = attachments?.find(a => a.category === 'html-css')
  if (htmlAttachment?.textContent) {
    // Merge HTML + CSS if both present
    let combined = htmlAttachment.textContent
    const cssAttachment = attachments?.find(a => a.category === 'html-css' && a.name.endsWith('.css') && a !== htmlAttachment)
    if (cssAttachment?.textContent) {
      combined = combined.replace('</head>', `<style>${cssAttachment.textContent}</style></head>`)
    }

    const { data: job, error: jobError } = await supabase
      .from('render_jobs')
      .insert({ prompt, template_id: templateId || null, status: 'pending' })
      .select()
      .single()

    if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

    await dispatchPromptToRenderer(
      job.id, prompt, durationSecs, templateFileUrl, templateContext, supabase,
      undefined, combined
    )

    return NextResponse.json({ jobIds: [job.id] })
  }

  // 2. CSV / XLSX — one job per row
  const dataAttachment = attachments?.find(a => a.category === 'csv' || a.category === 'xlsx')
  if (dataAttachment?.rows?.length) {
    const rowPrompts = dataAttachment.rows.map(row => ({
      prompt: `${prompt}\n\nVariant data:\n${rowToText(row)}`,
    }))

    const { data: jobs, error: jobError } = await supabase
      .from('render_jobs')
      .insert(rowPrompts.map(rp => ({
        prompt: rp.prompt,
        template_id: templateId || null,
        status: 'pending',
      })))
      .select()

    if (jobError || !jobs) {
      return NextResponse.json({ error: jobError?.message || 'Failed to create jobs' }, { status: 500 })
    }

    const attachmentUrls = buildAttachmentUrls(attachments)

    await Promise.all(jobs.map((job, i) =>
      dispatchPromptToRenderer(
        job.id, rowPrompts[i].prompt, durationSecs, templateFileUrl, templateContext, supabase,
        attachmentUrls
      )
    ))

    return NextResponse.json({ jobIds: jobs.map(j => j.id) })
  }

  // 3. Image / PDF / document URLs → forwarded to renderer for Claude vision/document blocks
  const attachmentUrls = buildAttachmentUrls(attachments)

  // Append filename context for PPTX/DOCX/JSON (Phase 2 parsing not yet available)
  const docContext = attachments ? formatAttachmentContext(attachments) : ''
  const fullTemplateContext = docContext ? `${templateContext}\n\n${docContext}` : templateContext

  // ── Detect multi-language request ──────────────────────────────────────────
  const languages = detectLanguages(prompt)
  const isMultiVariant = languages.length >= 2

  if (isMultiVariant) {
    const languagePrompts = languages.map(lang => ({
      language: lang,
      prompt: buildLanguagePrompt(prompt, lang, languages),
    }))

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

    await Promise.all(jobs.map((job, i) =>
      dispatchPromptToRenderer(
        job.id, languagePrompts[i].prompt, durationSecs, templateFileUrl, fullTemplateContext, supabase,
        attachmentUrls
      )
    ))

    return NextResponse.json({ jobIds })
  }

  // ── Single-variant path ────────────────────────────────────────────────────
  const { data: job, error: jobError } = await supabase
    .from('render_jobs')
    .insert({ prompt, template_id: templateId || null, status: 'pending' })
    .select()
    .single()

  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 })

  await dispatchPromptToRenderer(
    job.id, prompt, durationSecs, templateFileUrl, fullTemplateContext, supabase,
    attachmentUrls
  )

  return NextResponse.json({ jobIds: [job.id] })
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildAttachmentUrls(
  attachments: ProcessedAttachment[] | undefined
): AttachmentUrl[] | undefined {
  if (!attachments) return undefined
  const urls = attachments
    .filter(a => (a.category === 'image' || a.category === 'pdf' || a.category === 'document') && a.storageUrl)
    .map(a => ({
      type: a.category as 'image' | 'pdf' | 'document',
      url: a.storageUrl!,
      name: a.name,
    }))
  return urls.length > 0 ? urls : undefined
}
