import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

const TMP_DIR = path.join(process.cwd(), 'tmp')

// ─── How HyperFrames 0.6.x decides a composition is renderable ───────────────
//
// 1. window.__hf.duration > 0
//    getDeclaredDuration() reads data-duration from the [data-composition-id] root.
//    Fix: ensureDataDuration() regex-adds data-duration="8" if missing.
//
// 2. pollSubCompositionTimelines: for EVERY element with data-composition-id,
//    window.__timelines[id] must be truthy. Without it the renderer logs a 45 s
//    warning and produces blank frames → FFmpeg streaming encode fails.
//    Fix: timeline stub injected into <head> registers a minimal GSAP-compatible
//    object for each id. It satisfies the check; the CSS frame adapter handles
//    actual animation seeking via animation.currentTime.
//
// 3. Extra data-composition-id on child elements creates "sub-compositions" with
//    the same 45 s timeline timeout. Fix: strip them, keep only the root.

// Injected into <head> — not stripped by HyperFrames (no RUNTIME_INLINE_MARKERS).
//
// IMPORTANT: registration must be SYNCHRONOUS. The RUNTIME_IIFE (injected at end of
// <head> by the HyperFrames file server) reads window.__timelines during its
// DOMContentLoaded handler. A DOMContentLoaded-based registration races with the
// runtime and loses — window.__timelines appears empty. Synchronous <head> execution
// guarantees the stubs are visible before the runtime ever inspects the registry.
const TIMELINE_STUB_SCRIPT = `<script>
(function () {
  window.__timelines = window.__timelines || {};
  function makeStub(dur) {
    var d = dur || 8;
    return {
      seek: function () { return this; },
      time: function () { return 0; },
      duration: function () { return d; },
      totalDuration: function () { return d; },
      pause: function () { return this; },
      play: function () { return this; },
      kill: function () {}
    };
  }
  // Register synchronously for the standard composition id used in generated HTML.
  // This runs in <head>, before the HyperFrames RUNTIME_IIFE, so the stub is
  // present when the runtime queries window.__timelines on DOMContentLoaded.
  if (!window.__timelines['variant']) window.__timelines['variant'] = makeStub(6);
  // Belt-and-suspenders: also catch any other ids after DOM is ready.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-composition-id]').forEach(function (el) {
      var id = el.getAttribute('data-composition-id');
      if (id && !window.__timelines[id]) window.__timelines[id] = makeStub(8);
    });
  });
})();
</script>`

function sanitizeHtml(html: string, defaultDuration = 6): string {
  let found = false

  // Fix 1 & 3 – root gets data-duration; extra data-composition-id stripped from children
  html = html.replace(
    /(<(?:div|section|article|main|span)(\s[^>]*)?>)/g,
    (match, _full, attrs = '') => {
      if (!attrs.includes('data-composition-id')) return match

      if (!found) {
        found = true
        if (!attrs.includes('data-duration')) {
          return match.replace('>', ` data-duration="${defaultDuration}">`)
        }
        return match
      }

      return match.replace(/\s*data-composition-id="[^"]*"/, '')
    }
  )

  // Fix 2 – inject timeline stub into <head>
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>\n' + TIMELINE_STUB_SCRIPT)
  } else if (html.includes('<html>')) {
    html = html.replace('<html>', '<html>\n<head>' + TIMELINE_STUB_SCRIPT + '</head>')
  } else {
    html = TIMELINE_STUB_SCRIPT + '\n' + html
  }

  return html
}

export function renderComposition(htmlContent: string, jobId: string): string {
  const jobDir = path.join(TMP_DIR, jobId)
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.mkdirSync(jobDir, { recursive: true })
  fs.writeFileSync(path.join(jobDir, 'index.html'), sanitizeHtml(htmlContent), 'utf-8')

  // --workers 1: single Chrome — parallel workers (default in 0.6.x) cause OOM in
  // Railway's Docker container because each worker spawns its own Chrome process.
  execSync(`npx hyperframes render ${jobDir} -o ${outputPath} --workers 1`, {
    timeout: 300_000,
    stdio: 'pipe',
  })

  return outputPath
}

export function cleanupTmp(jobId: string) {
  try { fs.rmSync(path.join(TMP_DIR, jobId), { recursive: true, force: true }) } catch {}
  try { fs.unlinkSync(path.join(TMP_DIR, `${jobId}.mp4`)) } catch {}
}
