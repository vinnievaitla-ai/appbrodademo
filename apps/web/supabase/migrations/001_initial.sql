-- ─────────────────────────────────────────────────────────────────────────────
-- Appbroda — Initial schema
-- Run this in: supabase.com → your project → SQL Editor → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── templates ────────────────────────────────────────────────────────────────
create table if not exists templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  file_url         text not null,
  file_size_bytes  bigint not null default 0,
  category         text not null default 'end_card'
                   check (category in ('hook', 'body', 'text', 'audio', 'end_card')),
  created_at       timestamptz not null default now()
);

-- ── render_jobs ──────────────────────────────────────────────────────────────
create table if not exists render_jobs (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid references templates(id) on delete set null,
  prompt          text not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'failed')),
  output_url      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- ── RLS — disabled (no auth, demo project) ───────────────────────────────────
alter table templates disable row level security;
alter table render_jobs disable row level security;

-- ── indexes ───────────────────────────────────────────────────────────────────
create index if not exists templates_category_idx on templates(category, created_at desc);
create index if not exists render_jobs_status_idx on render_jobs(status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Storage buckets — run AFTER creating tables
-- (or create these in Supabase Dashboard → Storage → New bucket)
-- ─────────────────────────────────────────────────────────────────────────────

-- Public bucket for uploaded template videos
insert into storage.buckets (id, name, public)
values ('templates', 'templates', true)
on conflict (id) do nothing;

-- Public bucket for AI-generated variant videos
insert into storage.buckets (id, name, public)
values ('generated-variants', 'generated-variants', true)
on conflict (id) do nothing;

-- Allow anyone to read from both public buckets
create policy "Public read templates"
  on storage.objects for select
  using (bucket_id = 'templates');

create policy "Public read generated-variants"
  on storage.objects for select
  using (bucket_id = 'generated-variants');

-- Allow service role to upload/delete (API routes use service role key)
create policy "Service role full access templates"
  on storage.objects for all
  using (bucket_id = 'templates');

create policy "Service role full access generated-variants"
  on storage.objects for all
  using (bucket_id = 'generated-variants');
