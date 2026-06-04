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
  // ─── Pre-cleaning ─────────────────────────────────────────────────────────────
  // Claude occasionally wraps output in ```html fences despite instructions.
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

  // Strip <video>, <audio>, <img> — they cause Chrome headless OOM / FFmpeg streaming
  // encode failures in the colorkey-compositing pipeline (overlay must be CSS-only).
  html = html.replace(/<video\b[^>]*>[\s\S]*?<\/video\s*>/gi, '')
  html = html.replace(/<video\b[^>]*>/gi, '')
  html = html.replace(/<audio\b[^>]*>[\s\S]*?<\/audio\s*>/gi, '')
  html = html.replace(/<audio\b[^>]*>/gi, '')
  html = html.replace(/<img\b[^>]*\/?>/gi, '')

  // Neutralize forbidden CSS that crashes Chrome headless-shell in SwiftShader (software) mode.
  // Applies to both <style> blocks and inline style= attributes; regex stops at ; } " '
  // so it never bleeds across property boundaries.
  //
  //   filter / -webkit-filter  → 'none'  (blur, drop-shadow, etc. OOM the SW renderer)
  //   backdrop-filter          → removed  (same reason)
  //   mix-blend-mode           → removed  (not composited correctly in SW mode)
  //
  // \bfilter also matches the 'filter' token inside '-webkit-filter' (the '-' is \W so
  // \b fires between it and the 'f'), leaving the prefix in place: -webkit-filter: none.
  html = html
    .replace(/\bfilter\s*:\s*[^;}"']+/gi, 'filter: none')
    .replace(/\bbackdrop-filter\s*:\s*[^;}"']+/gi, '')
    .replace(/\bmix-blend-mode\s*:\s*[^;}"']+/gi, '')

  // Clamp tiny background-size values — halftone/dot patterns (e.g. 8px 8px) force
  // SwiftShader to tessellate thousands of radial-gradients per frame, causing OOM.
  html = html.replace(
    /\bbackground-size\s*:\s*([\d.]+)(px|em|rem)(?:\s+([\d.]+)(px|em|rem))?/gi,
    (m, w, wu, h, hu) => {
      const toPx = (v: string, u: string) => parseFloat(v) * (u === 'px' ? 1 : 16)
      const wPx = toPx(w, wu)
      const hPx = h ? toPx(h, hu) : wPx
      return (wPx < 100 || hPx < 100) ? 'background-size: 120px 120px' : m
    }
  )

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

  // Fallback: Claude used id="stage" but forgot data-composition-id="variant".
  // Patch the existing element rather than wrapping the whole document (which creates malformed HTML).
  if (!found && html.includes('id="stage"')) {
    html = html.replace(
      /(<[^>]+\bid="stage"[^>]*)>/,
      (_, tagContent) => {
        let out = tagContent
        if (!out.includes('data-composition-id')) out += ' data-composition-id="variant"'
        if (!out.includes('data-duration')) {
          out += ` data-duration="${defaultDuration}"`
        } else {
          out = out.replace(/data-duration\s*=\s*["'][^"']*["']/, `data-duration="${defaultDuration}"`)
        }
        return out + '>'
      }
    )
    found = true
  }

  // Last-resort: Claude omitted data-composition-id and id="stage" entirely.
  // Wrap content in a proper composition root so HyperFrames can find the duration.
  if (!found) {
    const compositionRoot = `<div id="stage" data-composition-id="variant" data-width="1080" data-height="1920" data-start="0" data-duration="${defaultDuration}" style="width:1080px;height:1920px;overflow:hidden;position:relative;margin:0;padding:0;">`
    if (/<body[^>]*>/i.test(html)) {
      html = html.replace(/(<body[^>]*>)/i, `$1${compositionRoot}`)
      html = html.replace(/<\/body>/i, `</div></body>`)
    } else if (/<\/html\s*>/i.test(html)) {
      // Full HTML doc without explicit <body> — insert before </html>
      html = html.replace(/<\/html\s*>/i, `<body>${compositionRoot}</div></body></html>`)
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

// ─── Post-render FFmpeg compositing ──────────────────────────────────────────
//
// Including <video> in the HyperFrames HTML causes Chrome headless to OOM at
// 15–19 frames even at half resolution (540×960), because the video decoder keeps
// decoded frame buffers in memory across every seek-and-capture cycle.
//
// Architecture instead:
//   1. HyperFrames renders the CSS overlay on a pure-black stage (no <video> element)
//   2. FFmpeg composites the overlay onto the template video using colorkey:
//        colorkey=0x000000 → black pixels in the overlay become transparent
//      The template video plays at its original quality and fps underneath.
//
// Design contract with Claude (enforced in system prompt):
//   - Stage background: #000000 (becomes transparent after colorkey)
//   - All visible elements: non-black (R>30 or G>30 or B>30)

async function compositeWithTemplate(
  overlayPath: string,
  templateUrl: string,
  finalPath: string,
  durationSecs: number
): Promise<void> {
  const templatePath = overlayPath.replace('-overlay.mp4', '-template.mp4')

  const res = await fetch(templateUrl, { signal: AbortSignal.timeout(90_000) })
  if (!res.ok) throw new Error(`Template download failed: ${res.status}`)
  fs.writeFileSync(templatePath, Buffer.from(await res.arrayBuffer()))

  // colorkey removes pure-black pixels (overlay background) exposing the template video.
  // overlay=shortest=1 stops when the shorter stream ends (handles duration mismatches).
  //
  // -threads 4: cap parallelism so HEVC decode + colorkey (ARGB) + H.264 encode don't
  // collectively exhaust the 512 MB container limit (default spawns 60+ threads → OOM kill).
  execSync(
    `ffmpeg -threads 4 -y -i "${templatePath}" -i "${overlayPath}" ` +
    `-filter_complex ` +
    `"[0:v]scale=1080:1920,setsar=1[bg];` +
    `[1:v]scale=1080:1920,setsar=1,colorkey=0x000000:0.15:0.05[fg];` +
    `[bg][fg]overlay=shortest=1[out]" ` +
    `-map "[out]" -threads 4 -t ${durationSecs} "${finalPath}"`,
    { timeout: 300_000, stdio: 'pipe' }
  )
}

export async function renderComposition(
  htmlContent: string,
  jobId: string,
  durationSecs = 3,
  templateUrl?: string
): Promise<string> {
  const jobDir = path.join(TMP_DIR, jobId)
  // When compositing, HyperFrames writes the overlay to a side file; FFmpeg produces the final.
  const overlayPath = templateUrl
    ? path.join(TMP_DIR, `${jobId}-overlay.mp4`)
    : path.join(TMP_DIR, `${jobId}.mp4`)
  const finalPath = path.join(TMP_DIR, `${jobId}.mp4`)

  fs.mkdirSync(jobDir, { recursive: true })

  // Pass durationSecs so the sanitizer uses it as the data-duration fallback AND
  // always overwrites whatever Claude generated to match the intended composition length.
  fs.writeFileSync(path.join(jobDir, 'index.html'), sanitizeHtml(htmlContent, durationSecs), 'utf-8')

  // CSS-only overlay: safe up to 45 frames (simple text/shapes, no video element).
  // Formula: min(15, max(4, round(45 / duration)))
  //   3 s → 15 fps (45 frames)
  //   5 s →  9 fps (45 frames)
  //  11 s →  4 fps (44 frames)
  const fps = Math.min(15, Math.max(4, Math.round(45 / durationSecs)))

  execSync(
    `npx hyperframes render ${jobDir} -o ${overlayPath} --workers 1 --quality draft --fps ${fps}`,
    { timeout: 300_000, stdio: 'pipe' }
  )

  if (templateUrl) {
    await compositeWithTemplate(overlayPath, templateUrl, finalPath, durationSecs)
  }

  return finalPath
}

export function cleanupTmp(jobId: string) {
  try { fs.rmSync(path.join(TMP_DIR, jobId), { recursive: true, force: true }) } catch {}
  for (const suffix of ['.mp4', '-overlay.mp4', '-template.mp4']) {
    try { fs.unlinkSync(path.join(TMP_DIR, jobId) + suffix) } catch {}
  }
}
