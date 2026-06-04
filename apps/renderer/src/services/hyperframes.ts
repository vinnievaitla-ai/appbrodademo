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
//
// NOTE on attempted CSS duration detection:
//   getAnimations().effect.getTiming().duration → wrong: Chrome headless-shell returns
//     seconds, not ms, so /1000 produced near-zero values (1 frame captured).
//   getComputedStyle('*').animationDuration → wrong: forced a synchronous style flush
//     across every element, spiking Chrome's memory and reducing the OOM threshold from
//     ~61 frames to ~23 frames. Also returned sub-second values for unknown reasons.
//
//   Both approaches were reverted. The correct strategy is:
//   • Keep data-duration simple: if missing/zero, default to the render fps × duration.
//   • Use --fps 15 so a 3 s composition = 45 total frames, safely below Chrome's ~61-frame
//     OOM ceiling in the container.
const TIMELINE_STUB_SCRIPT = `<script>
(function () {
  window.__timelines = window.__timelines || {};
  function makeStub(dur) {
    var d = dur || 3;
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
  if (!window.__timelines['variant']) window.__timelines['variant'] = makeStub(3);
  // Our DOMContentLoaded fires before HyperFrames' (we're earlier in <head>).
  // Use it to guarantee data-duration > 0 and register stubs for non-'variant' ids.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-composition-id]').forEach(function (el) {
      var id  = el.getAttribute('data-composition-id');
      var dur = parseFloat(el.getAttribute('data-duration') || '0');
      if (!(dur > 0)) el.setAttribute('data-duration', '3');
      if (id && !window.__timelines[id]) window.__timelines[id] = makeStub(dur > 0 ? dur : 3);
    });
  });
})();
</script>`

function sanitizeHtml(html: string, defaultDuration = 3): string {
  let found = false

  // Fix 1 & 3 – root gets data-duration; extra data-composition-id stripped from children.
  // 'body' included so <body data-composition-id="variant"> works too.
  html = html.replace(
    /(<(?:div|section|article|main|span|body)(\s[^>]*)?>)/g,
    (match, _full, attrs = '') => {
      if (!attrs.includes('data-composition-id')) return match

      if (!found) {
        found = true
        // Always overwrite data-duration so it matches the intended composition length
        // regardless of what Claude generated (e.g. it may copy the 3 s template example).
        if (attrs.includes('data-duration')) {
          return match.replace(/data-duration="[^"]*"/, `data-duration="${defaultDuration}"`)
        }
        return match.replace('>', ` data-duration="${defaultDuration}">`)
      }

      return match.replace(/\s*data-composition-id="[^"]*"/, '')
    }
  )

  // Belt-and-suspenders: if data-composition-id is on a tag NOT matched above (e.g. <html>,
  // a custom element, or a tag whose attributes span multiple lines in a way the regex
  // skipped), inject data-duration directly after the attribute value.
  // With --fps 15 HyperFrames reads data-duration synchronously before DOMContentLoaded,
  // so it MUST be present in the serialised HTML, not set at runtime.
  if (!found && html.includes('data-composition-id=')) {
    // Overwrite existing data-duration if present, otherwise inject it.
    if (/data-composition-id="[^"]*"[^>]*data-duration|data-duration[^>]*data-composition-id/.test(html)) {
      html = html.replace(/data-duration="[^"]*"/, `data-duration="${defaultDuration}"`)
    } else {
      html = html.replace(/(data-composition-id="[^"]*")/, `$1 data-duration="${defaultDuration}"`)
    }
    found = true
  }

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

export function renderComposition(htmlContent: string, jobId: string, durationSecs = 3): string {
  const jobDir = path.join(TMP_DIR, jobId)
  const outputPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.mkdirSync(jobDir, { recursive: true })
  // Pass durationSecs so the sanitizer uses it as the data-duration fallback AND
  // always overwrites whatever Claude generated to match the intended composition length.
  fs.writeFileSync(path.join(jobDir, 'index.html'), sanitizeHtml(htmlContent, durationSecs), 'utf-8')

  // fps is chosen to keep total frames ≤ 90 (empirical safe limit in this container)
  // while staying at 15 fps for short clips (smoothest motion for fades/text).
  // Formula: min(15, max(8, round(90 / duration)))
  //   3 s → 15 fps (45 frames)
  //   6 s → 15 fps (90 frames)
  //   9 s → 10 fps (90 frames)
  //  11 s →  8 fps (88 frames)
  const fps = Math.min(15, Math.max(8, Math.round(90 / durationSecs)))

  execSync(
    `npx hyperframes render ${jobDir} -o ${outputPath} --workers 1 --quality draft --fps ${fps}`,
    { timeout: 300_000, stdio: 'pipe' }
  )

  return outputPath
}

export function cleanupTmp(jobId: string) {
  try { fs.rmSync(path.join(TMP_DIR, jobId), { recursive: true, force: true }) } catch {}
  try { fs.unlinkSync(path.join(TMP_DIR, `${jobId}.mp4`)) } catch {}
}
