import { Router, Request, Response } from 'express'
import { renderComposition, cleanupTmp } from '../services/hyperframes'
import { uploadGeneratedVariant, updateJobStatus } from '../services/storage'

const router = Router()

router.post('/render', (req: Request, res: Response) => {
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.RENDERER_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { jobId, htmlContent } = req.body as { jobId: string; htmlContent: string }

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

      const outputPath = renderComposition(htmlContent, jobId)
      const publicUrl = await uploadGeneratedVariant(outputPath, jobId)

      await updateJobStatus(jobId, {
        status: 'done',
        output_url: publicUrl,
        completed_at: new Date().toISOString(),
      })
    } catch (err: any) {
      console.error(`Render failed for job ${jobId}:`, err.message)
      await updateJobStatus(jobId, {
        status: 'failed',
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
    } finally {
      cleanupTmp(jobId)
    }
  })
})

export default router
