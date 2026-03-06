# Phase 0: Make Scheduled Posts Actually Publish

Read UNIFIED_CALENDAR_PLAN.md for full context. You're implementing Phase 0.

## Project
- Path: `~/Development/ai-video-editor/editor`
- Stack: Next.js 16, Supabase, TypeScript, pnpm
- DB schemas: `studio` (video), `social_auth` (social/posting), `public` (shared)
- Supabase project: `lmounotqnrspwuvcoemk.supabase.co`
- DB password: `TGQ6jxc_mrw8kgk9qkr`
- Supabase clients: `createClient('social_auth')` for social routes
- Admin client: `src/lib/supabase/admin.ts` — CHECK if it specifies schema
- Cron route: `src/app/api/cron/publish-scheduled/route.ts`
- Platform providers: `src/lib/social/providers/` (instagram.ts, facebook.ts, tiktok.ts, youtube.ts, twitter.ts)
- Octupost API: `https://app.octupost.com/api`, key: `jorsby-social-auth-2026`

## Tasks

### 0.1 — Verify & fix admin client schema
Check `src/lib/supabase/admin.ts`. If it creates a Supabase client without specifying `social_auth` schema, the cron job can't find the `posts` or `post_accounts` tables. Fix it.

Also check `createClient` in `src/lib/supabase/server.ts` — it accepts an optional `DbSchema` param ('public' | 'studio' | 'social_auth'). The admin client should follow the same pattern OR the cron route should use the regular `createClient('social_auth')`.

### 0.2 — Add processing_started_at column
Run this migration against the DB:
```sql
ALTER TABLE social_auth.posts ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE social_auth.posts ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
```

Connect via: `PGPASSWORD="TGQ6jxc_mrw8kgk9qkr" psql "postgresql://postgres:TGQ6jxc_mrw8kgk9qkr@db.lmounotqnrspwuvcoemk.supabase.co:5432/postgres"`
PATH needs: `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`

### 0.3 — Update cron handler
Fix `src/app/api/cron/publish-scheduled/route.ts` to:
1. Use the correct schema (social_auth) for all queries
2. Query: `WHERE status = 'scheduled' AND scheduled_at <= now() AND processing_started_at IS NULL`
3. Set `processing_started_at = now()` before processing each post
4. On success: set `status = 'published'`, clear `processing_started_at`
5. On failure: set `status = 'failed'`, store error in post_accounts, clear `processing_started_at`
6. Use `Promise.allSettled` for multi-account publishing within a post

### 0.4 — Add vercel.json cron config
Create `vercel.json` in project root (`~/Development/ai-video-editor/editor/vercel.json`):
```json
{
  "crons": [
    {
      "path": "/api/cron/publish-scheduled",
      "schedule": "* * * * *"
    }
  ]
}
```

### 0.5 — Add failed posts banner to calendar
In the calendar component, add a simple query for `status = 'failed'` posts. If any exist, show a red banner: "X post(s) failed to publish" with a link/button to filter to failed posts.

Check `src/components/calendar/calendar-content.tsx` for the right place.

### 0.6 — Verify everything compiles
Run `cd editor && npx tsc --noEmit` and fix any errors your changes introduce.

## Important
- Do NOT touch files outside the scope of these tasks
- The dev server is running on localhost:3000 — don't restart it
- Commit nothing — I'll review and commit after

When completely finished, run: openclaw system event --text "Phase 0 complete: cron fixed, schema verified, processing guard added" --mode now
