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
// Duration accuracy: HyperFrames 0.6.72 bridge sets window.__hf.duration as:
//   max(p.getDuration(), getDeclaredDuration())  where p is the CSS frame adapter player.
// p.getDuration() calls timeline.duration() on window.__timelines['variant'].
// If the stub duration doesn't match the actual composition duration, the bridge reports
// a wrong duration (or 0 if the compiled HTML's data-duration attribute was stripped by
// HyperFrames' own linkedom re-serialization pipeline). Fix: always use the actual
// composition duration in the stub so p.getDuration() is authoritative.
//
// DOMContentLoaded: ALWAYS overwrite the stub so that even if the synchronous stub was
// registered with the wrong duration (race conditions or template reuse), it gets fixed
// before the HyperFrames runtime finishes discovering timelines.
function buildTimelineStubScript(durationSecs: number): string {
  return `<script>
(function () {
  window.__timelines = window.__timelines || {};
  var COMP_DURATION = ${durationSecs};
  function makeStub(dur) {
    var d = dur || COMP_DURATION;
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
  // Register synchronously so the stub is visible before the HyperFrames RUNTIME_IIFE.
  window.__timelines['variant'] = makeStub(COMP_DURATION);
  // On DOMContentLoaded, fix data-duration on the root if missing and update all stubs.
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-composition-id]').forEach(function (el) {
      var id  = el.getAttribute('data-composition-id');
      var dur = parseFloat(el.getAttribute('data-duration') || '0');
      if (!(dur > 0)) el.setAttribute('data-duration', String(COMP_DURATION));
      // Always overwrite — ensures the stub duration matches even if HyperFrames'
      // compilation pipeline stripped data-duration from the compiled HTML.
      if (id) window.__timelines[id] = makeStub(dur > 0 ? dur : COMP_DURATION);
    });
  });
})();
</script>`;
}

function sanitizeHtml(html: string, defaultDuration = 3): string {
  let found = false

  // Fix 1 & 3 – root gets data-duration; extra data-composition-id stripped from children.
  // Match ANY opening tag that carries data-composition-id (div, section, html, custom elements…).
  // The regex captures (tagName)(everything-before-closing->), so we can rebuild the tag safely
  // without relying on a fixed allowlist or a fragile `match.replace('>', …)`.
  html = html.replace(
    /<(\w[\w-]*)(\s[^>]*?data-composition-id\s*=\s*["'][^"']*["'][^>]*?)>/g,
    (match, tag, attrs) => {
      if (!found) {
        found = true
        // Always overwrite data-duration to the intended composition length.
        if (/data-duration\s*=\s*["']/.test(attrs)) {
          const newAttrs = attrs.replace(/data-duration\s*=\s*["'][^"']*["']/, `data-duration="${defaultDuration}"`)
          return `<${tag}${newAttrs}>`
        }
        return `<${tag}${attrs} data-duration="${defaultDuration}">`
      }
      // Strip data-composition-id from child elements (they become sub-compositions).
      const newAttrs = attrs.replace(/\s*data-composition-id\s*=\s*["'][^"']*["']/, '')
      return `<${tag}${newAttrs}>`
    }
  )

  // Belt-and-suspenders: catch any remaining data-composition-id= not handled above.
  // With --fps 15 HyperFrames reads data-duration synchronously before DOMContentLoaded,
  // so it MUST be present in the serialised HTML, not set at runtime.
  if (!found && /data-composition-id\s*=\s*["']/.test(html)) {
    if (/data-duration\s*=\s*["']/.test(html)) {
      html = html.replace(/data-duration\s*=\s*["'][^"']*["']/, `data-duration="${defaultDuration}"`)
    } else {
      html = html.replace(/(data-composition-id\s*=\s*["'][^"']*["'])/, `$1 data-duration="${defaultDuration}"`)
    }
    found = true
  }

  // Last-resort: Claude omitted data-composition-id entirely (e.g. generated plain HTML without
  // the required root attributes). Wrap the <body> content in a proper composition root so
  // HyperFrames can find the duration instead of reporting zero and aborting.
  if (!found) {
    const compositionRoot = `<div id="stage" data-composition-id="variant" data-width="1080" data-height="1920" data-start="0" data-duration="${defaultDuration}" style="width:1080px;height:1920px;overflow:hidden;position:relative;margin:0;padding:0;">`
    if (/<body[^>]*>/i.test(html)) {
      html = html.replace(/(<body[^>]*>)/i, `$1${compositionRoot}`)
      html = html.replace(/<\/body>/i, `</div></body>`)
    } else {
      html = compositionRoot + html + '</div>'
    }
  }

  // Fix 2 – inject duration-aware timeline stub into <head>
  const timelineStub = buildTimelineStubScript(defaultDuration)
  if (html.includes('<head>')) {
    html = html.replace('<head>', '<head>\n' + timelineStub)
  } else if (html.includes('<html>')) {
    html = html.replace('<html>', '<html>\n<head>' + timelineStub + '</head>')
  } else {
    html = timelineStub + '\n' + html
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
