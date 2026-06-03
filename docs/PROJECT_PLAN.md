# Appbroda — Project Plan

> **Purpose:** Single source of truth for all product, architecture, and delivery decisions.
> **Last updated:** 2026-06-04

---

## 1. Product Summary

Appbroda is a web platform for programmatic ad-creative generation. Users upload video templates (End Cards, Hooks, Bodies), then generate multiple variants using AI-driven prompts. Variants are rendered as MP4 files via the HyperFrames engine and stored in a browsable library.

**Demo goal:** Share a working, hosted URL with interested parties to demonstrate the core loop:
_Upload template → write prompt → generate variant → view in library._

---

## 2. Core User Flow

```
Library Page (End Cards tab)
  │
  ├── Upload Template (MP4) → stored in Supabase Storage → appears in library
  │
  └── "Generate Variants" CTA
        │
        └── Modal: enter prompt + optional inputs
              │
              └── Claude API generates HyperFrames HTML composition
                    │
                    └── Railway render service runs @hyperframes/producer
                          │
                          └── MP4 saved to Supabase Storage
                                │
                                └── Appears in library under "Generated Variants"
```

---

## 3. Tech Stack

| Layer | Tool | Hosting |
|---|---|---|
| Frontend + API routes | Next.js 15 (App Router) | Vercel |
| Render service | Express + `@hyperframes/producer` | Railway (Docker) |
| Database | Supabase PostgreSQL | Supabase |
| File storage | Supabase Storage | Supabase |
| LLM | Claude API (Anthropic) | — |
| Styling | Tailwind CSS + shadcn/ui | — |

**Key constraints:**
- HyperFrames requires Puppeteer (headless Chrome) + FFmpeg — cannot run on Vercel serverless. Railway handles this in a Docker container.
- Vercel API routes act only as lightweight orchestrators (DB reads/writes, LLM calls, dispatching jobs to Railway). No heavy processing on Vercel.
- No auth — single shared workspace, demo-grade.

---

## 4. Repository Structure

```
appbroda/
│
├── apps/
│   ├── web/                          # Next.js 15 app (Vercel)
│   │   ├── app/
│   │   │   ├── page.tsx              # Redirects to /library
│   │   │   ├── library/
│   │   │   │   └── page.tsx          # Main library page
│   │   │   └── api/
│   │   │       ├── templates/
│   │   │       │   ├── route.ts      # GET list, POST upload
│   │   │       ├── variants/
│   │   │       │   ├── route.ts      # GET list, POST generate
│   │   │       └── jobs/
│   │   │           └── [id]/
│   │   │               └── route.ts  # GET job status (for polling)
│   │   ├── components/
│   │   │   ├── library/
│   │   │   │   ├── LibraryPage.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── MediaGrid.tsx
│   │   │   │   ├── MediaCard.tsx
│   │   │   │   ├── UploadButton.tsx
│   │   │   │   └── FilterBar.tsx
│   │   │   └── variants/
│   │   │       ├── GenerateModal.tsx  # Prompt input + generate CTA
│   │   │       └── JobStatusBadge.tsx
│   │   └── lib/
│   │       ├── supabase.ts           # Supabase client
│   │       └── types.ts              # Shared TS types
│   │
│   └── renderer/                     # Express render service (Railway)
│       ├── src/
│       │   ├── index.ts              # Express server
│       │   ├── routes/
│       │   │   └── render.ts         # POST /render endpoint
│       │   └── services/
│       │       ├── hyperframes.ts    # Wraps @hyperframes/producer
│       │       └── storage.ts        # Uploads output MP4 to Supabase Storage
│       ├── Dockerfile
│       └── railway.toml
│
├── docs/
│   └── PROJECT_PLAN.md               # ← this file
│
├── .env.example                      # All required env vars documented
├── package.json                      # Workspace root (npm workspaces)
└── turbo.json                        # Turborepo (build orchestration only)
```

---

## 5. Data Model

### `templates` table
| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| name | text | Display name |
| file_url | text | Supabase Storage URL |
| file_size_bytes | int | For display (e.g. "2.31 MB") |
| category | text | `end_card` \| `hook` \| `body` |
| created_at | timestamptz | |

### `render_jobs` table
| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| template_id | uuid | FK → templates |
| prompt | text | User-entered prompt |
| status | text | `pending` \| `processing` \| `done` \| `failed` |
| output_url | text | Supabase Storage URL of generated MP4 (null until done) |
| error_message | text | Populated on failure |
| created_at | timestamptz | |
| completed_at | timestamptz | |

---

## 6. API Contracts

### Web → Supabase (direct from API routes)
- `GET /api/templates` → fetch all templates by category
- `POST /api/templates` → upload MP4 to Supabase Storage, insert row in `templates`
- `GET /api/variants` → fetch `render_jobs` where status = `done`
- `GET /api/jobs/[id]` → fetch single job status (used for polling)

### Web → Claude API (from `/api/variants` POST)
- Input: user prompt + template metadata
- Output: a complete HyperFrames-compatible HTML composition string
- This HTML is passed as the job payload to the Railway render service

### Web → Railway render service
- `POST /render` with body `{ jobId, htmlContent, outputFileName }`
- Railway renders async: updates `render_jobs` status in Supabase directly
- Web polls `GET /api/jobs/[id]` every 3s until status = `done` or `failed`

### Railway → Supabase Storage
- Renders MP4 to temp file → uploads to `generated-variants/` bucket → writes URL to DB

---

## 7. UI Reference (from design brief)

The Library page has:
- **Left sidebar:** module navigation — Hook, Body, Text, Audio, End Card
- **Top bar:** "Add End Card" primary CTA button (+ dropdown), Search input, Owner filter, Date Range filter, Sort by Latest
- **Main grid:** card-based layout showing video thumbnails, filename, file type + size, overflow menu (⋮)
- **Sub-sections within End Card tab:**
  - `Templates` — user-uploaded MP4s
  - `Generated Variants` — AI-generated outputs (render_jobs where status = done)
- **Generate Variants modal:** prompt textarea, optional fields (TBD — Phase 2 will add structured inputs), Generate button, status indicator while rendering

---

## 8. Phases & Task Breakdown

### Phase 1 — Foundation + Library + End Card Generation ✅ COMPLETE

| # | Task | Status |
|---|---|---|
| 1.1 | Initialize repo, workspace config (npm workspaces + Turborepo) | `done` |
| 1.2 | Scaffold `apps/web` — Next.js 15 + Tailwind + shadcn/ui | `done` |
| 1.3 | Scaffold `apps/renderer` — Express + Dockerfile | `done` |
| 1.4 | Supabase: create project, tables (`templates`, `render_jobs`), storage buckets | `done` |
| 1.5 | Library page UI — TopBar, Sidebar, MediaCard, FilterBar, section headers | `done` |
| 1.6 | Upload template flow — file picker → Supabase Storage → templates table | `done` |
| 1.6a | Delete template flow — removes from DB + Supabase Storage | `done` |
| 1.7 | Generate Variants modal — 2-screen (compose + generating animation) | `done` |
| 1.8 | Claude API integration — prompt → HyperFrames HTML composition | `done` |
| 1.9 | Renderer service — POST /render → hyperframes CLI → MP4 → Supabase Storage | `done` |
| 1.10 | Job status polling — 3s interval, shimmer skeleton cards while rendering | `done` |
| 1.11 | HF Generated Variants section — completed jobs with HF badge | `done` |
| 1.12 | Deployment: Vercel (web) + Railway (renderer) — live at appbrodademo-web.vercel.app | `done` |

**Post-launch improvements (also done):**
- Full UI redesign: TopBar matching reference screenshot, refined sidebar with dot indicator, polished cards with hover overlays, illustrated empty states, shimmer skeletons
- Error surfacing: upload errors shown in red banner with exact Supabase message
- RLS disabled on tables (demo, no auth)
- Dockerfile path + npm ci → npm install fixes for Railway monorepo build

### Phase 2 — URL-based Template Generation (backlog)

| # | Task |
|---|---|
| 2.1 | URL input mode in Generate modal (no template upload required) |
| 2.2 | Scrape/screenshot URL → pass context to Claude for HTML generation |
| 2.3 | End-to-end render from URL input |

### Phase 3 — Structured Inputs (backlog)

| # | Task |
|---|---|
| 3.1 | Approach A: structured form inputs (CTA text, brand color, logo URL) injected into HyperFrames HTML data attributes |
| 3.2 | Hook and Body module library views |
| 3.3 | Per-card variant history (see all variants generated from a template) |

---

## 9. Environment Variables

All services share a common `.env.example`. Each deployment only needs the variables relevant to its service.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic (Claude API)
ANTHROPIC_API_KEY=

# Railway render service URL (used by web to dispatch jobs)
RENDERER_SERVICE_URL=
RENDERER_SECRET=               # Simple shared secret to authenticate web → renderer calls

# Renderer internal
PORT=3001
```

---

## 10. Deployment Checklist (one-time setup)

### Supabase
1. Create project at supabase.com
2. Run SQL to create `templates` and `render_jobs` tables (migration file in `apps/web/supabase/migrations/`)
3. Create two storage buckets: `templates` (public) and `generated-variants` (public)
4. Copy project URL + anon key + service role key to env vars

### Railway (renderer)
1. Create account at railway.app
2. New Project → Deploy from GitHub → select this repo → set root to `apps/renderer`
3. Add env vars: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `PORT=3001`
4. Copy the generated Railway public URL → set as `RENDERER_SERVICE_URL` in Vercel

### Vercel (web)
1. Import repo at vercel.com → set root to `apps/web`
2. Add all env vars from `.env.example`
3. Deploy — auto-deploys on every push to `main`

---

## 11. Key Decisions Log

| Decision | Rationale |
|---|---|
| HyperFrames on Railway (not Vercel) | Vercel serverless cannot run Puppeteer/FFmpeg; Railway Docker containers can |
| Supabase over local disk | Project is hosted (Vercel) so local disk is not persistent; Supabase provides both DB and Storage |
| Claude API for HTML generation (Approach B first) | Free-form prompts are faster to demo than building a structured form UI; structured inputs (Approach A) added in Phase 3 |
| No auth | Demo-grade project; single shared workspace |
| Polling over WebSockets | Simpler to implement; 3s polling is acceptable UX for a demo where renders take 30–90s |
| npm workspaces + Turborepo | Keeps web and renderer in one repo for unified deploys while allowing independent Dockerization |
