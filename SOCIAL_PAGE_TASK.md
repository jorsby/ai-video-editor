# SOCIAL PAGE — Investigation & Improvements

## Project
- Path: `~/Development/ai-video-editor/editor`
- Stack: Next.js 16, Supabase, TypeScript, Tailwind, shadcn/ui
- DB schemas: `studio` (video), `social_auth` (social/posting), `public` (shared)
- Supabase clients: `createClient('social_auth')` for social routes, `createClient('studio')` for video routes

## Bug #1: All accounts show "0 posts"

### Root Cause (already identified)
The `social_auth.posts` and `social_auth.post_accounts` tables are **empty** — posts were published via external CLI tools directly to platforms, never recorded in the app's DB.

The post count comes from `postsByAccount` map in `src/components/dashboard/dashboard-content.tsx` (line ~75) which reads from `/api/v2/posts/list`. That returns DB posts. Since DB has 0 posts → all counts = 0.

There's a secondary `platformPostsByAccount` map that fetches posts from platform APIs (IG, TikTok, FB, YT) — but this only loads when you **click into a specific account** (lazy load). The counts on the main list only use the DB posts.

### What to fix
The "0 posts" count next to each account should reflect ACTUAL platform post counts, not just DB records.

**Option A (recommended):** When accounts load, also fetch post counts from platform APIs for each account in the background (or cache them). Show the platform-sourced count.

**Option B:** Show a "sync" indicator instead of "0 posts" for accounts that haven't been synced. Only show real counts after platform media sync.

**Option C:** Fetch platform media counts during `/api/v2/accounts` response — add a `post_count` field.

Choose the best UX approach that's responsive (don't block page load waiting for 26 API calls).

## Bug #2: Profile images not showing in group view

In the "Ungrouped" section at the bottom, some accounts show profile images. But inside groups (Jorsby TR, Jorsby EN, etc.), accounts show only initials (J, JS, etc.) with no profile pics.

Check: `src/components/dashboard/account-group-section.tsx` — does it render `AvatarImage` or just `AvatarFallback`?

The `profile_image_url` field exists on the account data from `/api/v2/accounts` endpoint. Make sure group account cards use it.

## Investigation: Social Page UI Issues

Carefully review the entire Social tab and note ALL issues. Focus on:

1. **Inconsistencies** — different styling between grouped vs ungrouped accounts
2. **Duplications** — any accounts appearing twice or redundant UI elements
3. **Missing features** — what would make this page actually useful for managing 26 social accounts
4. **UX issues** — confusing interactions, missing feedback, accessibility
5. **The "X" button** — on some account cards there's a delete/remove (X) button that seems random

### Files to review:
- `src/components/dashboard/social-accounts-list.tsx` — main social list
- `src/components/dashboard/account-group-section.tsx` — group sections
- `src/components/dashboard/account-posts-list.tsx` — post list per account
- `src/components/dashboard/dashboard-content.tsx` — parent that manages state
- `src/components/dashboard/platform-filter.tsx` — platform filter bar
- `src/app/api/v2/accounts/route.ts` — accounts API
- `src/app/api/v2/posts/list/route.ts` — posts list API
- `src/app/api/social/media/route.ts` — platform media fetching
- `src/app/api/account-groups/route.ts` — groups API

## Output

Write your findings to `SOCIAL_PAGE_REPORT.md` in the project root with:
1. **Bugs found** — with file, line, and fix
2. **UI inconsistencies** — grouped vs ungrouped, styling gaps
3. **Improvement suggestions** — prioritized (P1/P2/P3)
4. **Recommended fixes** — specific code changes

Then implement:
1. Fix the post count display (Bug #1)
2. Fix profile images in groups (Bug #2)
3. Fix any other bugs you find during investigation

Do NOT fix cosmetic/P3 items — just document them in the report.

## DB Context
```sql
-- social_auth.tokens columns:
-- platform, account_id, account_name, account_username, access_token, refresh_token, 
-- token_data, expires_at, created_at, updated_at, language, agent_id, profile_image_url

-- social_auth.posts: id, user_id, project_id, caption, media_url, media_type, 
--   schedule_type, scheduled_at, timezone, status, platform_options, tags, 
--   workflow_run_id, created_at, updated_at

-- social_auth.post_accounts: id, post_id, octupost_account_id, platform, status, 
--   platform_post_id, error_message, published_at, created_at
```

## Supabase
- Project: `lmounotqnrspwuvcoemk.supabase.co`
- Social routes use: `createClient('social_auth')`
- The `createClient(schema)` function in `src/lib/supabase/server.ts` accepts optional schema param
