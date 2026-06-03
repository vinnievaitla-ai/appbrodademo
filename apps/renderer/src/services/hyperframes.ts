import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const TMP_DIR = path.join(process.cwd(), 'tmp')

export function renderComposition(htmlContent: string, jobId: string): string {
  fs.mkdirSync(TMP_DIR, { recursive: true })

  const htmlPath = path.join(TMP_DIR, `${jobId}.html`)
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.writeFileSync(htmlPath, htmlContent, 'utf-8')

  execSync(`npx hyperframes render ${htmlPath} -o ${outputPath}`, {
    timeout: 300_000,
    stdio: 'pipe',
  })

  return outputPath
}

export function cleanupTmp(jobId: string) {
  for (const ext of ['html', 'mp4']) {
    try {
      fs.unlinkSync(path.join(TMP_DIR, `${jobId}.${ext}`))
    } catch {}
  }
}
