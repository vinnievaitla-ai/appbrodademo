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
// 4. data-duration must equal the actual CSS animation span.
//    If data-duration > max(animation-delay + animation-duration), HyperFrames seeks
//    past the last keyframe. This causes the streaming encode to receive fewer frames
//    than expected, leaving x264's lookahead buffer unflushed → size=0kB output.
//    Fix: our DOMContentLoaded (fires before the runtime's) reads getAnimations() on
//    every element and sets data-duration to the real animation span.
const TIMELINE_STUB_SCRIPT = `<script>
(function () {
  window.__timelines = window.__timelines || {};
  function makeStub(dur) {
    var d = dur || 6;
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
  // Our DOMContentLoaded fires before HyperFrames' (we're earlier in <head>).
  // Use it to:
  //   a) Compute the true composition span from computed CSS animation timings.
  //      getComputedStyle() returns animationDuration/animationDelay as CSS strings
  //      like "3s" or "500ms" — unambiguous units, available from the first style calc.
  //      (getAnimations().effect.getTiming().duration was tried first but Chrome
  //       headless-shell returns values in seconds, not ms, making /1000 wrong.)
  //   b) Write that span into data-duration so getDeclaredDuration() gets the real value.
  //   c) Register stubs for any non-'variant' composition ids.
  document.addEventListener('DOMContentLoaded', function () {
    // Parses a CSS time string ("2s", "500ms", "0") → number of seconds.
    function parseSec(s) {
      s = (s || '').trim();
      if (!s) return 0;
      return s.indexOf('ms') !== -1 ? parseFloat(s) / 1000 : (parseFloat(s) || 0);
    }

    // Step a: walk every element and read its computed animation timings.
    var maxEnd = 0;
    document.querySelectorAll('*').forEach(function (el) {
      var cs = window.getComputedStyle(el);
      var durs   = (cs.animationDuration || '').split(',');
      var delays = (cs.animationDelay   || '').split(',');
      for (var k = 0; k < durs.length; k++) {
        var d = parseSec(durs[k]);
        if (d <= 0) continue; // no real animation on this slot
        var delay = parseSec(delays[k] || '0s');
        var end = Math.max(0, delay) + d;
        if (end > maxEnd) maxEnd = end;
      }
    });

    // Step b & c: apply to every composition root.
    document.querySelectorAll('[data-composition-id]').forEach(function (el) {
      var id = el.getAttribute('data-composition-id');
      var declared = parseFloat(el.getAttribute('data-duration') || '0');
      // Prefer computed span; fall back to declared value; last resort: 6 s.
      var effective = maxEnd > 0 ? maxEnd : (declared > 0 ? declared : 6);
      el.setAttribute('data-duration', String(effective));

      // Register stub (or update existing one) with the correct duration.
      if (id && !window.__timelines[id]) {
        window.__timelines[id] = makeStub(effective);
      } else if (id && window.__timelines[id]) {
        window.__timelines[id].duration      = function () { return effective; };
        window.__timelines[id].totalDuration = function () { return effective; };
      }
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

  // --workers 1: single Chrome — parallel workers (default in 0.6.x) cause OOM.
  // --quality draft: uses a fast x264 preset without mbtree. The default (standard)
  //   uses mbtree=1 + rc_lookahead=40 which buffers frames before flushing; if Chrome
  //   delivers fewer frames than expected the encoder never flushes → size=0kB output.
  execSync(`npx hyperframes render ${jobDir} -o ${outputPath} --workers 1 --quality draft`, {
    timeout: 300_000,
    stdio: 'pipe',
  })

  return outputPath
}

export function cleanupTmp(jobId: string) {
  try { fs.rmSync(path.join(TMP_DIR, jobId), { recursive: true, force: true }) } catch {}
  try { fs.unlinkSync(path.join(TMP_DIR, `${jobId}.mp4`)) } catch {}
}
