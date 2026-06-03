import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const TMP_DIR = path.join(process.cwd(), 'tmp')

// HyperFrames computes window.__hf.duration via this chain:
//   bridge.getDuration() = p.getDuration() > 0 ? p.getDuration() : getDeclaredDuration()
//   getDeclaredDuration() reads data-duration from the [data-composition-id] root element
//
// The runtime player (p) returns getDuration()=0 when generated HTML has no clip
// data-duration attributes (CSS-animation-only compositions). So we must ensure the
// root element always has data-duration — otherwise window.__hf.duration stays 0
// and FrameCapture times out after 45 s.
//
// The HyperFrames runtime also has a built-in CSS frame adapter that seeks
// CSS animations via animation.currentTime, so no additional seek injection is needed.
function ensureDataDuration(html: string, defaultSeconds = 8): string {
  // Add data-duration to the [data-composition-id] element if it's missing.
  return html.replace(
    /(<(?:div|section|article|main|span)[^>]*\bdata-composition-id="[^"]*"[^>]*?)(\s*>)/,
    (match, prefix, close) => {
      if (/\bdata-duration\b/.test(prefix)) return match
      return `${prefix} data-duration="${defaultSeconds}"${close}`
    }
  )
}

export function renderComposition(htmlContent: string, jobId: string): string {
  const jobDir = path.join(TMP_DIR, jobId)
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.mkdirSync(jobDir, { recursive: true })
  fs.writeFileSync(path.join(jobDir, 'index.html'), ensureDataDuration(htmlContent), 'utf-8')

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
