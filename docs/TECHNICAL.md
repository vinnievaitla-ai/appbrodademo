# Appbroda — Technical Documentation

> Last updated: 2026-06-05  
> Status: Shipped (Phase 1 complete, stable at tag `v1-stable`)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [Infrastructure & Hosting](#4-infrastructure--hosting)
5. [Database Schema](#5-database-schema)
6. [Environment Variables](#6-environment-variables)
7. [Core Workflows](#7-core-workflows)
   - 7.1 [Template Upload](#71-template-upload)
   - 7.2 [Variant Generation — Single](#72-variant-generation--single)
   - 7.3 [Variant Generation — Multi-Language](#73-variant-generation--multi-language)
   - 7.4 [The Rendering Pipeline (Detailed)](#74-the-rendering-pipeline-detailed)
   - 7.5 [Folder Organisation](#75-folder-organisation)
8. [AI Integration](#8-ai-integration)
9. [HyperFrames & FFmpeg](#9-hyperframes--ffmpeg)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Design System](#11-design-system)
12. [Known Constraints & Trade-offs](#12-known-constraints--trade-offs)

---

## 1. Project Overview

Appbroda is a programmatic ad-creative generation platform. Users upload video templates (End Cards, Hooks, Bodies, etc.), write natural-language prompts, and the platform uses Claude AI to generate animated HTML overlay compositions that are rendered as MP4 variants using HyperFrames and FFmpeg.

**Core loop:**
```
Upload template → Enter prompt → AI generates overlay → Render to MP4 → Save in library
```

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Monorepo** | npm workspaces + Turborepo |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript 5 |
| **Styling** | Tailwind CSS v4, shadcn/ui, Hanken Grotesk + DM Mono fonts |
| **Backend (web)** | Next.js API Routes (serverless, Vercel) |
| **Renderer service** | Express.js + TypeScript, Node.js 22 (Railway, Docker) |
| **AI** | Anthropic Claude (`claude-sonnet-4-5`) via `@anthropic-ai/sdk` |
| **Video rendering** | HyperFrames 0.6.x (Chrome headless-shell + CSS frame capture) |
| **Video encoding** | FFmpeg (bundled in Docker image) |
| **Database** | Supabase (PostgreSQL) |
| **File storage** | Supabase Storage (S3-compatible) |
| **Frontend hosting** | Vercel |
| **Renderer hosting** | Railway (Docker container, 512 MB RAM) |
| **Runtime** | Node.js ≥ 22 |

---

## 3. Repository Structure

```
appbroda/                          ← monorepo root
├── apps/
│   ├── web/                       ← Next.js frontend + API routes
│   │   ├── app/
│   │   │   ├── api/
│   │   │   │   ├── templates/     ← CRUD + upload-url for template videos
│   │   │   │   ├── variants/      ← POST: create render jobs + dispatch to renderer
│   │   │   │   ├── jobs/[id]/     ← GET: poll job status
│   │   │   │   └── debug/         ← GET: renderer health + recent jobs
│   │   │   ├── library/           ← Main library page route
│   │   │   ├── globals.css
│   │   │   └── layout.tsx
│   │   ├── components/
│   │   │   ├── layout/            ← TopBar
│   │   │   ├── library/           ← LibraryPage, Sidebar, MediaCard, FolderCard, etc.
│   │   │   ├── folders/           ← FolderPickerModal
│   │   │   └── variants/          ← GenerateModal, VariantCard
│   │   ├── lib/
│   │   │   ├── types.ts           ← Shared TypeScript interfaces
│   │   │   ├── supabase.ts        ← Browser + service role Supabase clients
│   │   │   ├── folders.ts         ← Client-side folder state (localStorage)
│   │   │   ├── language-detection.ts  ← Multi-language prompt splitting
│   │   │   └── utils.ts           ← formatRelativeDate, cn()
│   │   └── supabase/migrations/   ← SQL schema
│   │
│   └── renderer/                  ← Express.js render service (Docker → Railway)
│       ├── src/
│       │   ├── index.ts           ← Express app, /health endpoint
│       │   ├── routes/
│       │   │   └── render.ts      ← POST /render — Claude generation + HyperFrames
│       │   └── services/
│       │       ├── hyperframes.ts ← PNG frame capture + FFmpeg encoding + compositing
│       │       └── storage.ts     ← Supabase upload + job status updates
│       ├── scripts/
│       │   └── chrome-wrapper.sh  ← Memory-capped Chrome launcher
│       └── Dockerfile
│
├── docs/
│   ├── PROJECT_PLAN.md
│   └── TECHNICAL.md               ← this file
├── package.json                   ← npm workspaces root
├── turbo.json                     ← Turborepo build config
└── railway.toml                   ← Railway deploy config (points to renderer Dockerfile)
```

---

## 4. Infrastructure & Hosting

### 4.1 Vercel (web app)

- Next.js app deployed on Vercel
- API routes run as serverless functions (max ~10s timeout)
- **Critically:** Claude API is NOT called from Vercel functions due to timeout risk on multi-variant jobs. All Claude calls happen on Railway.

### 4.2 Railway (renderer service)

- Docker container running Express + HyperFrames + FFmpeg
- Single container, **512 MB RAM** (hard constraint)
- Chrome headless-shell is downloaded at build time
- A custom `chrome-wrapper.sh` intercepts Chrome's `--force-gpu-mem-available-mb` flag to cap it at 256 MB (preventing OOM kills in the container)
- Auto-deploys when `apps/renderer/**` files change on `main`; skips web-only commits

**Deployment trigger:** Railway watches for changes in `apps/renderer/`. UI-only commits (sidebar, modal, etc.) are automatically skipped — preventing unnecessary rebuilds.

### 4.3 Supabase

- **PostgreSQL** database for templates and render_jobs
- **Storage buckets:**
  - `templates` (public) — uploaded template MP4s
  - `generated-variants` (public) — AI-rendered output MP4s
- RLS is disabled (demo project, no auth)
- Service role key used server-side; anon key used client-side

### 4.4 Deployment Flow

```
git push origin main
  ├── Vercel auto-deploys web app (always)
  └── Railway auto-deploys renderer (only if apps/renderer/** changed)
```

---

## 5. Database Schema

```sql
-- Templates: user-uploaded source videos
templates (
  id               UUID PK
  name             TEXT
  file_url         TEXT          -- Supabase public URL
  file_size_bytes  BIGINT
  category         TEXT          -- 'hook'|'body'|'text'|'audio'|'end_card'
  created_at       TIMESTAMPTZ
)

-- Render Jobs: one row per AI generation job
render_jobs (
  id              UUID PK
  template_id     UUID → templates(id) SET NULL on delete
  prompt          TEXT          -- the user's prompt (may include language suffix)
  status          TEXT          -- 'pending'|'processing'|'done'|'failed'
  output_url      TEXT          -- Supabase public URL of rendered MP4 (null until done)
  error_message   TEXT          -- null on success
  created_at      TIMESTAMPTZ
  completed_at    TIMESTAMPTZ
)
```

**Indexes:**
- `templates_category_idx` on `(category, created_at DESC)`
- `render_jobs_status_idx` on `(status, created_at DESC)`

**Note:** Folder organisation is **client-side only** — stored in `localStorage` as a map of `variantId → folderId`. No folders table exists in the database.

---

## 6. Environment Variables

### Web app (Vercel)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-side only) |
| `RENDERER_SERVICE_URL` | Railway renderer URL (e.g. `https://renderer-production-*.up.railway.app`) |
| `RENDERER_SECRET` | Shared secret for renderer authentication |

### Renderer service (Railway)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | For uploading rendered videos + updating job status |
| `ANTHROPIC_API_KEY` | Claude API key |
| `RENDERER_SECRET` | Must match `RENDERER_SECRET` in web app |

---

## 7. Core Workflows

### 7.1 Template Upload

```
User selects MP4 file
  │
  ├─ GET /api/templates/upload-url?ext=mp4
  │    └─ Supabase creates signed upload URL → returns { signedUrl, path }
  │
  ├─ Browser PUTs file directly to Supabase Storage (no bytes through Vercel)
  │
  └─ POST /api/templates { name, category, path, fileSizeBytes }
       └─ Inserts row in templates table
            └─ Template appears in library
```

### 7.2 Variant Generation — Single

```
User enters prompt in GenerateModal → clicks Proceed
  │
  ├─ POST /api/variants { prompt, templateId?, templateDuration? }
  │    ├─ Fetches template metadata (name, file_url) from DB
  │    ├─ Inserts render_job row (status: 'pending')
  │    ├─ Fire-and-forgets POST to Railway /render:
  │    │    { jobId, prompt, duration, templateUrl, templateContext }
  │    └─ Returns { jobIds: [uuid] }
  │
  ├─ GenerateModal enters 'generating' screen
  │    └─ Polls GET /api/jobs/:id every 3 seconds
  │
  └─ On job.status === 'done' → GenerateModal shows success screen
     On job.status === 'failed' → GenerateModal shows error with message
```

### 7.3 Variant Generation — Multi-Language

The web API auto-detects multi-language requests by scanning the prompt for 2+ recognised language names:

```
Prompt: "overlay text 'Play this game to relax' in 3 languages - English, Hindi, Telugu"
  │
  └─ detectLanguages() finds ['English', 'Hindi', 'Telugu']
       │
       ├─ buildLanguagePrompt(prompt, 'English', allLangs)
       │    → "overlay text 'Play this game to relax' in english.
       │       Use English only for all text — do not include any other language."
       │
       ├─ buildLanguagePrompt(prompt, 'Hindi', allLangs)
       │    → "overlay text 'Play this game to relax' in hindi.
       │       Use Hindi only for all text — do not include any other language."
       │
       └─ buildLanguagePrompt(prompt, 'Telugu', allLangs)
            → "..."
  │
  ├─ Batch inserts 3 render_job rows
  ├─ Dispatches all 3 to Railway (fire-and-forget, parallel)
  └─ Returns { jobIds: [uuid, uuid, uuid] }
```

**Supported languages:** Telugu, Hindi, English, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati, Punjabi, Odia, Urdu, French, Spanish, German, Arabic, Japanese, Korean, Chinese, Portuguese, Italian.

### 7.4 The Rendering Pipeline (Detailed)

This is the heart of the system. All steps execute in the Railway Docker container.

```
POST /render received
  │
  ├─ Auth check: Authorization: Bearer {RENDERER_SECRET}
  │
  ├─ Validates: jobId + (htmlContent OR prompt) required
  │
  ├─ Responds 200 immediately (async processing begins)
  │
  └─ Enqueued in FIFO render queue (MAX_CONCURRENT = 1)

QUEUE WORKER:
  │
  ├─ updateJobStatus(jobId, 'processing')
  │
  ├─ STEP 1 — HTML Generation (skipped if htmlContent already provided)
  │    ├─ Detect composition mode:
  │    │    - Mode A (text only): no CTA keywords in prompt
  │    │    - Mode B (text + CTA): prompt mentions button/download/install/etc.
  │    ├─ Build Claude system prompt with:
  │    │    - Colorkey rules (black = transparent after FFmpeg)
  │    │    - Mode A spec: centered text card, exact CSS
  │    │    - Mode B spec: text card + golden gradient pill button, exact CSS
  │    │    - HyperFrames composition rules (data-composition-id, data-duration, etc.)
  │    │    - Forbidden CSS (filter, backdrop-filter, mix-blend-mode)
  │    │    - Font loading (Google Fonts @import)
  │    └─ anthropic.messages.create → returns complete HTML file
  │
  ├─ STEP 2 — HTML Sanitization (sanitizeHtml)
  │    ├─ Strip markdown fences if Claude wrapped output
  │    ├─ Remove <video>, <audio>, <img> elements (cause Chrome OOM)
  │    ├─ Neutralize filter:/backdrop-filter:/mix-blend-mode: CSS properties
  │    ├─ Clamp background-size < 100px (prevents SwiftShader tiling OOM)
  │    ├─ Ensure data-composition-id="variant" on root element
  │    ├─ Ensure data-duration="${durationSecs}" on root element
  │    ├─ Strip data-composition-id from all child elements (prevents sub-compositions)
  │    └─ Inject timeline stub <script> into <head>:
  │         - Registers window.__timelines['variant'] synchronously
  │         - duration() returns composition length for HyperFrames bridge
  │
  ├─ STEP 3 — Frame Capture (HyperFrames)
  │    ├─ fps = min(15, max(4, round(45 / durationSecs)))
  │    │    e.g. 3s → 15fps (45 frames), 12s → 4fps (48 frames)
  │    ├─ npx hyperframes render {jobDir} --format=png-sequence
  │    │    -o {framesDir} --workers 1 --fps {fps} --no-browser-gpu
  │    ├─ Chrome headless-shell captures each frame via BeginFrame API
  │    ├─ Frames written as: framesDir/frame_000001.png, frame_000002.png, ...
  │    └─ Chrome exits (frees ~256 MB RAM)
  │
  ├─ STEP 4 — Overlay Encoding (FFmpeg)
  │    └─ ffmpeg -threads 4 -framerate {fps} -i "{framesDir}/frame_%06d.png"
  │              -c:v libx264 -threads 4 -preset ultrafast -pix_fmt yuv420p
  │              -t {durationSecs} "{overlayPath}"
  │    Note: -threads 4 prevents x264's default 60-thread spawn (OOM in 512 MB)
  │
  ├─ STEP 5 — Compositing (only if templateUrl provided)
  │    ├─ Download template MP4 from Supabase URL
  │    └─ ffmpeg -threads 4 -i {templatePath} -i {overlayPath}
  │              -filter_complex
  │                "[0:v]scale=1080:1920,setsar=1[bg];
  │                 [1:v]scale=1080:1920,setsar=1,
  │                 colorkey=0x000000:0.15:0.05[fg];   ← black pixels → transparent
  │                 [bg][fg]overlay=shortest=1[out]"
  │              -map "[out]" -threads 4 -t {durationSecs} {finalPath}
  │
  ├─ STEP 6 — Upload
  │    ├─ Upload finalPath to Supabase 'generated-variants' bucket
  │    └─ updateJobStatus(jobId, { status: 'done', output_url, completed_at })
  │
  └─ CLEANUP: rm -rf tmp/{jobId}*, tmp/{jobId}-frames/
```

### 7.5 Folder Organisation

Folders are entirely **client-side** — no database involvement.

- Stored in `localStorage` as a JSON map: `{ [variantId]: folderId }`
- Folder metadata (name, createdAt) stored separately in `localStorage`
- `lib/folders.ts` exposes: `createFolder`, `renameFolder`, `deleteFolder`, `getFolders`, `getVariantFolder`, `assignVariantsToFolder`
- When a render job completes, a `FolderPickerModal` prompts the user to assign the new variant(s) to a folder
- Folder state is scoped to the current browser (not shared across devices)

---

## 8. AI Integration

### Claude Model

Model: `claude-sonnet-4-5`  
Max tokens: 8,192  
Called from: **Railway renderer only** (never from Vercel, to avoid serverless timeouts)

### Role in the Pipeline

Claude generates the HTML/CSS/JS composition that HyperFrames will render. It acts as a "visual composer" — translating a plain-English prompt into a complete, self-contained HTML file with:
- Precise CSS animations (`@keyframes`)
- HyperFrames-specific attributes (`data-composition-id`, `data-start`, `data-duration`, `data-track-index`)
- Color-safe elements (no pure black, which becomes transparent after colorkey)

### System Prompt Design

The system prompt defines two composition modes and strict rules:

**Mode A — Text Only** (default):
- Single `rgba(0,0,0,0.58)` rounded card centered on frame
- Headline: 88px bold white
- Fade-in animation only

**Mode B — Text + CTA** (triggered by keywords: cta, button, download, install, etc.):
- Text card in upper third of frame
- Pill button at bottom (78% Y position):
  - Golden gradient: `linear-gradient(180deg, #FFB627 0%, #E8821A 55%, #C8600E 100%)`
  - Inset highlight + drop shadow for depth
  - White bold text with text-shadow
- One gradient family only (no multi-colour mixing)

**Colorkey contract:**
- Stage background: exactly `#000000` → becomes transparent
- All visible elements: RGB values where at least one channel ≥ 30
- `rgba(0,0,0,N)` with N < 1 is fine (semi-transparent dark cards)

### Multi-Language Handling

Language detection happens in `apps/web/lib/language-detection.ts`:
- `detectLanguages(prompt)`: regex scan for any of 21 supported language names
- `buildLanguagePrompt(prompt, target, allLangs)`: removes other language names, collapses "N languages" phrases, appends explicit single-language directive

---

## 9. HyperFrames & FFmpeg

### HyperFrames

**Version:** `^0.6.0` (0.6.72 in use)  
**What it does:** Drives Chrome headless-shell frame-by-frame using the `BeginFrame` API, captures each frame as a PNG, then encodes to video.

**Key quirks we work around:**

| Problem | Cause | Fix |
|---------|-------|-----|
| `Streaming encode failed` after 1 frame | x264 spawns 60 threads by default → OOM in 512 MB | Use `--format=png-sequence` to skip HyperFrames' encoder; encode with `ffmpeg -threads 4` separately |
| `data-composition-id` on child elements | Creates "sub-compositions" that wait 45s and produce blank frames | `sanitizeHtml()` strips all but the root |
| `window.__hf.duration = 0` | `data-duration` missing or stripped by HyperFrames' linkedom pipeline | `sanitizeHtml()` always overwrites `data-duration`; timeline stub sets it at DOMContentLoaded |
| Chrome OOM with `<video>` elements | Chrome decodes video frame buffers across every BeginFrame seek | `sanitizeHtml()` strips all `<video>`/`<audio>`/`<img>` elements |
| GPU OOM with `filter:` CSS | SwiftShader software renderer crashes on blur/drop-shadow | `sanitizeHtml()` replaces all `filter:` with `filter: none` |
| Tiled backgrounds OOM | Small `background-size` forces thousands of radial-gradient draws per frame | `sanitizeHtml()` clamps any `background-size < 100px` to `120px 120px` |

### FFmpeg Compositing

The colorkey filter composites the CSS overlay onto the template video:

```
colorkey=0x000000:0.15:0.05
```
- `0x000000` — key colour (pure black)
- `0.15` — similarity threshold (slightly off-black also keyed out)
- `0.05` — blend/smoothness at edges

This allows the stage background to disappear, revealing the template video underneath.

### Memory Budget (512 MB container)

| Process | Peak usage |
|---------|-----------|
| Node.js runtime | ~50 MB |
| Chrome headless-shell | ~256 MB |
| FFmpeg encode (4 threads) | ~60 MB |
| FFmpeg composite (4 threads) | ~80 MB |
| **Total peak** | ~446 MB |

Chrome and FFmpeg don't run simultaneously (Chrome exits after frame capture), keeping peak below 512 MB.

---

## 10. Frontend Architecture

### State Management

No global state library. State is local to components with `useState`/`useEffect`, following React conventions:

- `LibraryPage` — top-level orchestrator: owns templates, variants, pending jobs, folders, selected variant
- `Sidebar` — receives view state and callbacks
- `GenerateModal` — self-contained: owns its own screen state, polling, and status lines
- `FolderCard`, `MediaCard` — purely presentational, callbacks up

### Polling Strategy

`LibraryPage` polls `/api/jobs/:id` for each pending job every 3 seconds via `setInterval`. When a job resolves:
- `done` → adds to variants list, triggers `FolderPickerModal`, fires `setJustCompletedIds`
- `failed` → adds to `failedJobs` state

`GenerateModal` has its own independent polling for the jobs it submitted, so the user sees live status inside the modal window.

### Key Route: `/app/library`

The library page is a single-page app within Next.js:
- `view` state drives what's shown: `{ type: 'templates', category }` | `{ type: 'folder-grid' }` | `{ type: 'folder-workspace', folderId }`
- The `Sidebar` controls view navigation
- No URL params are updated on view change (single-page feel within the route)

---

## 11. Design System

**Name:** Warm Coral  
**Source:** Derived from a fintech reference design, implemented via claude.ai/design handoff

### Colour Tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#E9E6E1` | Page / outer background |
| `--surface` | `#FBFAF8` | Main floating panel |
| `--card` | `#FFFFFF` | Cards |
| `--sunken` | `#F1EEE9` | Inputs, chips, thumbnails |
| `--accent` | `#E2623F` | Primary action colour (coral) |
| `--accent-600` | `#CF5331` | Hover state |
| `--accent-tint` | `#F8E5DD` | Active nav background |
| `--ink-900` | `#1C1A18` | Headings, high-emphasis text |
| `--ink-500` | `#8B847C` | Muted body text |
| `--ink-400` | `#ABA49B` | Placeholder / faint labels |
| `--border` | `#E7E2DB` | Default borders |

### Typography

| Font | Usage |
|------|-------|
| **Hanken Grotesk** | All UI text (loaded via Google Fonts) |
| **DM Mono** | File sizes, metadata labels |

### Shape Language

- Nav items: `border-radius: 14px`
- Template cards: `border-radius: 22px`
- Folder cards: `border-radius: 28px`
- Buttons & search: `border-radius: 999px` (pill)

### App Shell

The entire app floats as a rounded panel (`border-radius: 28px`, `box-shadow: 0 18px 50px rgba(40,28,18,0.10)`) on the warm-gray page background (`#E9E6E1`), mimicking the reference fintech dashboard aesthetic.

---

## 12. Known Constraints & Trade-offs

| Constraint | Detail |
|------------|--------|
| **512 MB renderer RAM** | Max 1 concurrent render. All others queue. Larger plans on Railway would unlock parallelism. |
| **Vercel timeout** | Claude calls happen on Railway, not Vercel. If Railway is unreachable, jobs stay pending forever (no retry mechanism yet). |
| **Client-side folders** | Folder state lives in `localStorage`. Clearing browser storage loses all folder assignments. A DB-backed folders table is the Phase 2 fix. |
| **No auth** | RLS is disabled. The app is demo-grade — all users share the same library. |
| **Font loading in renderer** | HyperFrames runs Chrome headless without internet in some environments. Google Fonts `@import` in Claude-generated HTML may fail silently — falling back to Arial/Helvetica. |
| **Colorkey threshold** | `similarity=0.15` removes slightly off-black pixels. Very dark (non-black) UI elements may appear semi-transparent in output videos. |
| **Job retention** | No cleanup job. `render_jobs` and `generated-variants` storage grow indefinitely. |
| **PPTX/DOCX parsing** | Not implemented (Phase 2). File upload UI accepts these but only passes the filename as a hint. |

---

## Appendix: Restore Point

The project was tagged at a stable, working state:

```bash
git checkout v1-stable   # revert to stable Phase 1
git push --force         # after checkout if reverting on main
```

Tag `v1-stable` = commit `6594ea3` — Warm Coral redesign + all generation fixes shipped.
