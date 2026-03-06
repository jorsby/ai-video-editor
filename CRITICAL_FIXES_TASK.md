# Critical Security Fixes

Read QA_REPORT_BACKEND.md and QA_REPORT_FRONTEND.md for full context. Fix ALL Critical and High severity bugs.

## Project
- Path: `~/Development/ai-video-editor/editor`
- DB: `lmounotqnrspwuvcoemk.supabase.co`, password: `TGQ6jxc_mrw8kgk9qkr`
- DB connect: `export PATH="/opt/homebrew/opt/libpq/bin:$PATH" && PGPASSWORD="TGQ6jxc_mrw8kgk9qkr" psql "postgresql://postgres:TGQ6jxc_mrw8kgk9qkr@db.lmounotqnrspwuvcoemk.supabase.co:5432/postgres"`
- Supabase anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb3Vub3RxbnJzcHd1dmNvZW1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NjAzODMsImV4cCI6MjA4MzMzNjM4M30.DVNymJQOpWLH61EVXrf7cieCVtb-AfUmTOeauW3o-YY`
- Schemas: `studio` (video), `social_auth` (social), `public` (shared)
- `createClient('social_auth')` for social routes, `createClient('studio')` for video routes

## Critical Fixes (do ALL)

### 1. Enable RLS on social_auth.tokens + add user_id
```sql
-- Add user_id column
ALTER TABLE social_auth.tokens ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id);

-- Backfill: set all existing tokens to the single user (get the user id first)
-- SELECT id FROM auth.users LIMIT 1; then UPDATE social_auth.tokens SET user_id = '<that_id>';

-- Enable RLS
ALTER TABLE social_auth.tokens ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own tokens" ON social_auth.tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own tokens" ON social_auth.tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access tokens" ON social_auth.tokens FOR ALL USING (auth.role() = 'service_role');
```

### 2. Enable RLS on public.debug_logs
```sql
ALTER TABLE public.debug_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only debug_logs" ON public.debug_logs FOR ALL USING (auth.role() = 'service_role');
```

### 3. Fix GET /api/v2/accounts — filter by user_id
File: `src/app/api/v2/accounts/route.ts`
Add `.eq('user_id', user.id)` to the tokens query.

### 4. Fix POST /api/v2/accounts/sync — don't return tokens
File: `src/app/api/v2/accounts/sync/route.ts`
Replace `select('*')` with explicit safe columns: `select('platform, account_id, account_name, account_username, language, agent_id, expires_at, profile_image_url')`
Also fix the upsert onConflict to match actual unique constraint: `'platform, account_id'`

### 5. Fix cron secret — deny when unset
File: `src/app/api/cron/publish-scheduled/route.ts`
Change:
```typescript
if (cronSecret) { ... }
```
To:
```typescript
if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### 6. Fix open redirect in /auth/confirm
File: `src/app/auth/confirm/route.ts`
Validate the `next` parameter — only allow relative paths starting with `/`:
```typescript
const next = searchParams.get('next') ?? '/dashboard';
const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
```

### 7. Add auth guard to post pages
Files: `src/app/post/[renderedVideoId]/page.tsx`, `src/app/post/edit/[uuid]/page.tsx`
Add server-side auth check like dashboard does:
```typescript
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function Page(...) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  return <ClientComponent ... />;
}
```

### 8. Add auth to unauthenticated API routes
Add Supabase auth check to these routes:
- `src/app/api/audio/music/route.ts`
- `src/app/api/audio/sfx/route.ts`
- `src/app/api/pexels/route.ts`
- `src/app/api/batch-export/route.ts`
- `src/app/api/proxy/media/route.ts`
- `src/app/api/chat/route.ts`

Pattern:
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
```

### 9. Fix stale processing_started_at in cron
File: `src/app/api/cron/publish-scheduled/route.ts`
Add: posts with `processing_started_at` older than 10 minutes should be re-claimable:
```typescript
const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
// In query: .or(`processing_started_at.is.null,processing_started_at.lt.${tenMinutesAgo}`)
```

### 10. Sanitize error responses
In ALL API routes under `src/app/api/`, replace any `{ error: error.message }` or `{ error: err.message }` with `{ error: 'Operation failed' }`. Log the real error with `console.error`.

Routes to check: v2/accounts/sync, v2/posts/[id], v2/posts/list, v2/posts, account-groups, account-tags, projects, workflow-runs.

### 11. Remove token prefix logging from Facebook provider
File: `src/lib/social/providers/facebook.ts`
Remove `tokenPrefix` and `tokenLength` from the console.log call.

### 12. Fix account ownership in social/media
File: `src/app/api/social/media/route.ts`
After getting the user, verify the accountId belongs to them before fetching tokens.

### 13. Fix app metadata
File: `src/app/layout.tsx`
Change title from "Create Next App" to "Combo" and update description.

### 14. Add missing indexes
```sql
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_lookup ON social_auth.posts (status, scheduled_at, processing_started_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON social_auth.posts (user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_user_id ON social_auth.tokens (user_id);
```

## Verification
After all fixes:
1. Run `cd editor && npx tsc --noEmit` — fix any new errors
2. Verify the DB changes: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname IN ('social_auth','public') ORDER BY tablename;`
3. Verify indexes exist

When completely finished, run: openclaw system event --text "Critical fixes complete: RLS, auth guards, cron security, error sanitization" --mode now
