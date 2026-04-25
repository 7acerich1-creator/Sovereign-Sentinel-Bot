-- Session 117 (2026-04-25) — Yuki Shorts Auto-Comment Pinner dedup table.
--
-- Tracks which Shorts Yuki has already posted a top-level diagnostic comment
-- on, so the 5-min cron (src/proactive/yuki-shorts-pinner.ts) doesn't double-
-- post on retries or restarts. One row per (brand, video_id).

create table if not exists public.yuki_short_comments_posted (
  video_id     text primary key,
  brand        text not null check (brand in ('sovereign_synthesis','containment_field')),
  posted_at    timestamptz not null default now(),
  comment_id   text,
  comment_text text,
  error        text
);

create index if not exists yuki_short_comments_posted_brand_posted_at_idx
  on public.yuki_short_comments_posted (brand, posted_at desc);

comment on table public.yuki_short_comments_posted is
  'S117 Yuki shorts pinner — dedup ledger. Yuki posts one channel-owner comment per Short within ~5 min of upload; this table prevents reposts on retry / restart.';
