import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const TMP_DIR = path.join(process.cwd(), 'tmp')

// HyperFrames computes window.__hf.duration via this chain:
//   bridge: window.__hf.duration = p.getDuration() > 0 ? p.getDuration() : getDeclaredDuration()
//   getDeclaredDuration() reads data-duration from the [data-composition-id] root element
//
// Fix 1 – ensureDataDuration: generated HTML often has no data-duration on the root element,
//   causing getDeclaredDuration()=0 → window.__hf.duration=0 → 45-second FrameCapture timeout.
//
// Fix 2 – stripExtraCompositionIds: any element besides the root that has data-composition-id
//   is treated as a "sub-composition" and HyperFrames waits 45 s for its timeline to be
//   registered in window.__timelines[id], which never happens → timeout.
//   Strip those attributes server-side so only the root keeps data-composition-id.

function sanitizeHtml(html: string, defaultDuration = 8): string {
  let found = false

  // Pass 1 – ensure root element has data-duration, strip data-composition-id from all others
  html = html.replace(
    /(<(?:div|section|article|main|span)(\s[^>]*)?>)/g,
    (match, _full, attrs = '') => {
      if (!attrs.includes('data-composition-id')) return match

      if (!found) {
        // This is the root — keep data-composition-id, ensure data-duration is present
        found = true
        if (!attrs.includes('data-duration')) {
          return match.replace('>', ` data-duration="${defaultDuration}">`)
        }
        return match
      }

      // Non-root element — strip data-composition-id to prevent sub-composition error
      return match.replace(/\s*data-composition-id="[^"]*"/, '')
    }
  )

  return html
}

export function renderComposition(htmlContent: string, jobId: string): string {
  const jobDir = path.join(TMP_DIR, jobId)
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.mkdirSync(jobDir, { recursive: true })
  fs.writeFileSync(path.join(jobDir, 'index.html'), sanitizeHtml(htmlContent), 'utf-8')

  execSync(`npx hyperframes render ${jobDir} -o ${outputPath}`, {
    timeout: 300_000,
    stdio: 'pipe',
  })

  return outputPath
}

export function cleanupTmp(jobId: string) {
  try { fs.rmSync(path.join(TMP_DIR, jobId), { recursive: true, force: true }) } catch {}
  try { fs.unlinkSync(path.join(TMP_DIR, `${jobId}.mp4`)) } catch {}
}
