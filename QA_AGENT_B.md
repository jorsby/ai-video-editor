# QA Agent B — Backend, API & Data Integrity Testing

You are a **Principal QA Engineer** doing a comprehensive backend audit of this app. You have full autonomy — test everything, break everything, document everything.

## App
- Path: `~/Development/ai-video-editor/editor`
- Dev server: `http://localhost:3000`
- Stack: Next.js 16, Supabase, TypeScript
- DB: `lmounotqnrspwuvcoemk.supabase.co`
- DB password: `TGQ6jxc_mrw8kgk9qkr`
- DB connect: `export PATH="/opt/homebrew/opt/libpq/bin:$PATH" && PGPASSWORD="TGQ6jxc_mrw8kgk9qkr" psql "postgresql://postgres:TGQ6jxc_mrw8kgk9qkr@db.lmounotqnrspwuvcoemk.supabase.co:5432/postgres"`
- Octupost API: `https://app.octupost.com/api`, key: `jorsby-social-auth-2026`
- Supabase anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb3Vub3RxbnJzcHd1dmNvZW1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NjAzODMsImV4cCI6MjA4MzMzNjM4M30.DVNymJQOpWLH61EVXrf7cieCVtb-AfUmTOeauW3o-YY`

## Your Scope

Test every API route, database schema, data flow, and backend process. Think like a hacker trying to find holes AND a DBA auditing data integrity.

### API Routes to test
Find all routes: `find src/app/api -name "route.ts" | sort`

For each route:
- What HTTP methods does it support?
- Does it check authentication?
- Does it use the correct schema (studio/social_auth/public)?
- What happens with missing/invalid params?
- What happens with no auth token?
- Does the response shape match what the frontend expects?

### Database to audit
- **Schema correctness:** Are tables in the right schema? (studio for video, social_auth for social)
- **RLS policies:** Are there policies on all tables? Can anonymous users read data?
- **Foreign keys:** Do cross-schema FKs work? Any orphaned records?
- **Indexes:** Are there indexes on frequently queried columns (status, scheduled_at, user_id)?
- **Data integrity:** Any NULL values where there shouldn't be? Duplicate records?
- **Token security:** Are access_tokens exposed in any API response?

### Cron & Scheduling to test
- `src/app/api/cron/publish-scheduled/route.ts`
  - Does it handle no scheduled posts gracefully?
  - Does it handle already-processing posts (processing_started_at set)?
  - What if a post has no post_accounts?
  - What if the CRON_SECRET is wrong/missing?
  - Does it properly clean up processing_started_at on failure?

### Platform publishing to test
- Check each provider in `src/lib/social/providers/`
- Are tokens fetched correctly from Octupost?
- What happens if a token is expired?
- Are platform API errors properly caught and stored?

### Security
- Can you access API routes without authentication?
- Are there any routes that expose sensitive data (tokens, passwords)?
- Is the CRON_SECRET validated?
- Are user IDs properly scoped (can user A see user B's data)?

### Output
Write `QA_REPORT_BACKEND.md` in the project root with:

1. **API Audit** — route by route results
2. **Database Audit** — schema, RLS, indexes, data integrity
3. **Security Issues** — anything concerning
4. **Cron/Scheduling Issues** — reliability concerns
5. **Data Flow Issues** — where data gets lost or corrupted
6. **Performance Concerns** — N+1 queries, missing indexes, slow paths

Use this format for bugs:
```
### BUG-B-001: [Title]
- **Severity:** Critical/High/Medium/Low
- **Area:** API/DB/Security/Cron
- **Details:** ...
- **Impact:** What could go wrong
- **Fix:** Suggested remediation
```

Be thorough. Be paranoid. Assume everything is broken until proven otherwise.

When done, run: openclaw system event --text "QA Agent B: Backend report written to QA_REPORT_BACKEND.md" --mode now
