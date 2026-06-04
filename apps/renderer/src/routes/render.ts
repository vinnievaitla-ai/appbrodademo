import { Router, Request, Response } from 'express'
import * as fs from 'fs'
import * as path from 'path'
import { renderComposition, cleanupTmp } from '../services/hyperframes'
import { uploadGeneratedVariant, updateJobStatus } from '../services/storage'

const router = Router()

router.post('/render', (req: Request, res: Response) => {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.RENDERER_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { jobId, htmlContent, duration } = req.body as {
    jobId: string
    htmlContent: string
    duration?: number
  }

  if (!jobId || !htmlContent) {
    res.status(400).json({ error: 'jobId and htmlContent are required' })
    return
  }

  // Acknowledge immediately — rendering happens async
  res.json({ status: 'accepted', jobId })

  // Process after response is flushed
  setImmediate(async () => {
    try {
      await updateJobStatus(jobId, { status: 'processing' })

      const outputPath = renderComposition(htmlContent, jobId, duration)
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
        // Extract up to 400 chars around the first data-composition-id occurrence.
        const idx = raw.indexOf('data-composition-id')
        if (idx === -1) {
          htmlDebug = '\n[HTML debug] data-composition-id NOT FOUND in sanitized HTML'
        } else {
          const snippet = raw.substring(Math.max(0, idx - 60), idx + 340)
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
