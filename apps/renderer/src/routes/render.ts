import { Router, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { renderComposition, cleanupTmp } from '../services/hyperframes'
import { uploadGeneratedVariant, updateJobStatus } from '../services/storage'

const router = Router()

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

router.post('/render', (req: Request, res: Response) => {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.RENDERER_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { jobId, htmlContent, duration, templateUrl } = req.body as {
    jobId: string
    htmlContent: string
    duration?: number
    templateUrl?: string
  }

  if (!jobId || !htmlContent) {
    res.status(400).json({ error: 'jobId and htmlContent are required' })
    return
  }

  // Acknowledge immediately — rendering happens async
  res.json({ status: 'accepted', jobId })

  // Enqueue — at most 1 render runs at a time; others wait
  enqueueRender(async () => {
    try {
      await updateJobStatus(jobId, { status: 'processing' })

      const outputPath = await renderComposition(htmlContent, jobId, duration, templateUrl)
      const publicUrl = await uploadGeneratedVariant(outputPath, jobId)

      await updateJobStatus(jobId, {
        status: 'done',
        output_url: publicUrl,
        completed_at: new Date().toISOString(),
      })
    } catch (err: any) {
      console.error(`Render failed for job ${jobId}:`, err.message)

      // Read the sanitized HTML before cleanup to debug data-composition-id / data-duration issues.
      let htmlDebug = ''
      try {
        const indexPath = path.join('/app/tmp', jobId, 'index.html')
        const raw = fs.readFileSync(indexPath, 'utf-8')
        // Strip script blocks first so we don't land inside the injected TIMELINE_STUB_SCRIPT
        // (which contains the string [data-composition-id] as a CSS selector).
        const rawNoScript = raw.replace(/<script[\s\S]*?<\/script>/gi, '')
        // Search for data-composition-id= (with =) to find the actual HTML attribute.
        const idx = rawNoScript.indexOf('data-composition-id=')
        if (idx === -1) {
          htmlDebug = '\n[HTML debug] data-composition-id NOT FOUND in sanitized HTML'
        } else {
          const snippet = rawNoScript.substring(Math.max(0, idx - 60), idx + 340)
          htmlDebug = '\n[HTML debug] ...around composition root:\n' + snippet
        }
      } catch { /* file may not exist if hyperframes never wrote it */ }

      await updateJobStatus(jobId, {
        status: 'failed',
        error_message: err.message + htmlDebug,
        completed_at: new Date().toISOString(),
      })
    } finally {
      cleanupTmp(jobId)
    }
  })
})

export default router
