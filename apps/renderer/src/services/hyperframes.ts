import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const TMP_DIR = path.join(process.cwd(), 'tmp')

// HyperFrames requires window.__hf = { duration, seek } to be present on the page.
// The CLI never injects this itself — the HTML must expose it. We inject it at the
// top of <head> so it is set synchronously before any other script runs, regardless
// of what Claude generated.
const HF_RUNTIME = `<script>
window.__hf = {
  duration: 8,
  seek: function(t) {
    document.getAnimations().forEach(function(a) { a.currentTime = t * 1000; });
  }
};
</script>`

function injectHfRuntime(html: string): string {
  if (html.includes('<head>')) return html.replace('<head>', '<head>\n' + HF_RUNTIME)
  if (html.includes('<html>')) return html.replace('<html>', '<html>\n<head>' + HF_RUNTIME + '</head>')
  return HF_RUNTIME + '\n' + html
}

export function renderComposition(htmlContent: string, jobId: string): string {
  // HyperFrames render expects a project directory, not a bare HTML file.
  // Write index.html into a per-job directory and pass the directory path.
  const jobDir = path.join(TMP_DIR, jobId)
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.mkdirSync(jobDir, { recursive: true })
  fs.writeFileSync(path.join(jobDir, 'index.html'), injectHfRuntime(htmlContent), 'utf-8')

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
