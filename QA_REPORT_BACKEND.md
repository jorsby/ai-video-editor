# QA Report: Backend, API & Data Integrity Audit

**Date:** 2026-03-05
**Auditor:** QA Agent B (Principal QA Engineer)
**Branch:** `dev` (commit `c17d890`)
**Scope:** All API routes, database schema, RLS, cron/scheduling, platform publishing, security

---

## Executive Summary

This audit uncovered **4 critical**, **7 high**, **8 medium**, and **5 low** severity issues across the backend. The most urgent finding is that **OAuth access tokens for all 26 social media accounts are stored in plaintext in a table with NO Row Level Security** — any client with the Supabase anon key can read every token. Combined with several unauthenticated API routes and a bypassable cron secret, the backend has significant security exposure requiring immediate remediation.

---

## 1. API Audit

### Route Inventory (44 routes total)

| Category | Routes | Auth? |
|----------|--------|:-----:|
| Social/v2 | accounts, accounts/sync, posts CRUD, posts/list, posts/publish | Yes |
| Social (legacy) | social/media, social/posts | Yes |
| Studio | projects, assets, rendered-videos, storyboard/*, project-tags, project/reset | Yes |
| AI/Generation | chat, chat/editor, generate-caption, generate-hook, fal/image, fal/video, elevenlabs/* | Mixed |
| Media | audio/music, audio/sfx, pexels, proxy/media, transcribe, translate-* | **NO** |
| Upload | uploads/presign, uploads/multipart/* | Yes |
| System | cron/publish-scheduled, batch-export, workflow-runs, account-groups/*, account-tags | Mixed |

---

### BUG-B-001: OAuth Tokens Table Has No RLS — Full Token Exposure
- **Severity:** Critical
- **Area:** DB / Security
- **Details:** `social_auth.tokens` stores `access_token` (NOT NULL), `refresh_token`, and `token_data` in plaintext. This table has **RLS disabled**. Any request using the Supabase anon key can `SELECT * FROM social_auth.tokens` and retrieve all 26 OAuth tokens for every connected social media account (Instagram, TikTok, YouTube, Facebook).
- **Impact:** Complete compromise of all connected social media accounts. An attacker can post, delete content, or exfiltrate data from every linked platform account.
- **Fix:**
  1. **Immediately** enable RLS on `social_auth.tokens`
  2. Add a `user_id` column to `social_auth.tokens` (currently missing — there is no way to scope tokens to users at the DB level)
  3. Add RLS policy: `auth.uid() = user_id` for SELECT/UPDATE/DELETE
  4. Consider encrypting tokens at rest using Supabase Vault or application-level encryption

### BUG-B-002: GET /api/v2/accounts Returns ALL Tokens (No user_id Filter)
- **Severity:** Critical
- **Area:** API / Security
- **Details:** `src/app/api/v2/accounts/route.ts:17-20` queries `social_auth.tokens` without filtering by `user_id`:
  ```typescript
  const { data: tokens, error } = await supabase
    .from('tokens')
    .select('platform, account_id, account_name, ...')
    .order('platform')
    .order('account_name');
  // NO .eq('user_id', user.id) — returns ALL users' accounts
  ```
  Since the tokens table also lacks RLS (BUG-B-001), this returns every account for every user. Even if RLS were enabled, the query itself is wrong — it should filter by `user_id`.
- **Impact:** User A sees User B's connected social accounts. Combined with BUG-B-001, full token exposure.
- **Fix:** Add `.eq('user_id', user.id)` filter. But first, the tokens table needs a `user_id` column (see BUG-B-001).

### BUG-B-003: POST /api/v2/accounts/sync Returns access_token in Response
- **Severity:** Critical
- **Area:** API / Security
- **Details:** `src/app/api/v2/accounts/sync/route.ts:37` uses `select('*')` which returns ALL columns including `access_token`, `refresh_token`, and `token_data`:
  ```typescript
  const { data: socialAccounts, error } = await supabase
    .from('tokens')
    .select('*')  // Returns access_token, refresh_token, token_data!
    .eq('user_id', user.id)
    .order('platform');
  return NextResponse.json({ accounts: socialAccounts });
  ```
- **Impact:** OAuth tokens sent to the browser in JSON response. Visible in DevTools, browser history, network logs, and any proxy/CDN.
- **Fix:** Replace `select('*')` with explicit column list excluding sensitive fields: `select('platform, account_id, account_name, account_username, language, agent_id, expires_at, profile_image_url')`.

### BUG-B-004: Cron Secret Validation Is Bypassable
- **Severity:** Critical
- **Area:** Cron / Security
- **Details:** `src/app/api/cron/publish-scheduled/route.ts:8-14`:
  ```typescript
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {  // If env var is unset, check is SKIPPED entirely
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  ```
  If `CRON_SECRET` is not set in the environment, **anyone** can trigger scheduled post publication by hitting `GET /api/cron/publish-scheduled`.
- **Impact:** Unauthorized triggering of all scheduled posts. Posts could be published before their intended time.
- **Fix:** Invert the logic:
  ```typescript
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  ```

### BUG-B-005: Multiple API Routes Have No Authentication
- **Severity:** High
- **Area:** API / Security
- **Details:** The following routes perform operations without any auth check:
  - `POST /api/audio/music` — Proxies to external music API
  - `POST /api/audio/sfx` — Proxies to external SFX API
  - `GET /api/pexels` — Proxies to Pexels API using server's API key
  - `GET/POST /api/batch-export` — Batch export operations
  - `GET /api/proxy/media` — Open SSRF-adjacent proxy (domain-limited)
  - `POST /api/chat` — Proxies to AI API (costs money per request)
- **Impact:** Anyone can use these endpoints to consume paid API quotas (ElevenLabs, Pexels, AI chat). The proxy/media endpoint can be used to scan allowed domains from the server's IP.
- **Fix:** Add Supabase auth check to all routes. At minimum:
  ```typescript
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  ```

### BUG-B-006: debug_logs Table Has No RLS
- **Severity:** High
- **Area:** DB / Security
- **Details:** `public.debug_logs` (1,630 rows) has RLS disabled. Any client with the anon key can read all debug logs, which may contain internal application state, error details, user actions, or stack traces.
- **Impact:** Information disclosure of internal application behavior, potential exposure of user data in log entries.
- **Fix:** Enable RLS on `debug_logs`. Add policy restricting access to service_role only, or delete the table if it's only for development.

### BUG-B-007: No Account Ownership Verification in social/media Route
- **Severity:** High
- **Area:** API / Security
- **Details:** `src/app/api/social/media/route.ts:45-56` accepts an `accountId` parameter and fetches tokens from Octupost without verifying the authenticated user owns that account:
  ```typescript
  const accountId = searchParams.get('accountId');
  // No check: does this accountId belong to user.id?
  const token = await fetchToken(accountId);
  ```
- **Impact:** User A can pass User B's accountId to fetch media from their social accounts.
- **Fix:** Before calling `fetchToken`, verify the account belongs to the user by querying `social_auth.tokens` with both `account_id` and `user_id`.

### BUG-B-008: Cron Doesn't Handle Stale processing_started_at
- **Severity:** High
- **Area:** Cron
- **Details:** `src/app/api/cron/publish-scheduled/route.ts:24` filters for `processing_started_at IS NULL`, but if a previous cron run crashes mid-publish, the post's `processing_started_at` is never cleared. The post becomes permanently stuck — it will never be retried.
- **Impact:** Posts silently fail to publish with no recovery mechanism. Users see a post stuck in "publishing" status forever.
- **Fix:** Add a staleness check. Consider posts with `processing_started_at` older than 10 minutes as failed:
  ```typescript
  .or('processing_started_at.is.null,processing_started_at.lt.' + tenMinutesAgo)
  ```

### BUG-B-009: Database Error Messages Leaked to Clients
- **Severity:** High
- **Area:** API / Security
- **Details:** Multiple routes return raw Supabase error messages in responses:
  - `v2/accounts/sync/route.ts:43`: `{ error: error.message }`
  - `v2/posts/[id]/route.ts:103`: `{ error: updateErr.message }`
  - `v2/posts/list/route.ts:47`: `{ error: error.message }`
  - `social/posts/route.ts` — similar pattern

  These messages can reveal table names, column names, constraint names, and schema structure.
- **Impact:** Information disclosure enabling targeted SQL injection or schema-aware attacks.
- **Fix:** Return generic error messages to clients (`"Operation failed"`). Log the real error server-side.

### BUG-B-010: Token Cache Has No User Scoping
- **Severity:** High
- **Area:** Security
- **Details:** `src/lib/octupost/client.ts:10-13` caches tokens by `accountId` only, with no user context:
  ```typescript
  const tokenCache = new Map<string, { token: OctupostToken; cachedAt: number }>();
  ```
  If User A requests a token for accountId "abc123", the cached token is served to User B if they also request accountId "abc123". This is an in-memory global cache shared across all requests.
- **Impact:** Cross-user token leakage via cache. In a serverless environment, this is less severe (each invocation may get a new instance), but in a long-lived server process, this is a real vulnerability.
- **Fix:** Include `user_id` in the cache key, or remove caching entirely since tokens are fetched from Octupost's API which likely has its own caching.

### BUG-B-011: Facebook Provider Logs Token Prefixes
- **Severity:** High
- **Area:** Security
- **Details:** `src/lib/social/providers/facebook.ts:12-17`:
  ```typescript
  console.log('[getFacebookPageToken] Exchanging user token for page token', {
    providerId,
    hasUserAccessToken: !!userAccessToken,
    tokenLength: userAccessToken?.length,
    tokenPrefix: userAccessToken?.substring(0, 10) + '...',
  });
  ```
  Token prefixes are logged to stdout. In production, these end up in log aggregators (Vercel logs, CloudWatch, etc.).
- **Impact:** Partial token exposure in logs. Combined with known token patterns (e.g., Facebook tokens starting with "EAA"), this aids in token reconstruction.
- **Fix:** Remove `tokenPrefix` and `tokenLength` from log output.

### BUG-B-012: No Rate Limiting on Expensive AI API Routes
- **Severity:** Medium
- **Area:** API / Performance
- **Details:** The following routes call external paid APIs with no rate limiting:
  - `POST /api/chat` — AI chat (OpenRouter)
  - `POST /api/generate-caption` — AI caption generation
  - `POST /api/generate-hook` — AI hook generation
  - `POST /api/fal/image` — FAL AI image generation
  - `POST /api/fal/video` — FAL AI video generation
  - `POST /api/elevenlabs/voiceover` — ElevenLabs TTS
  - `POST /api/elevenlabs/music` — ElevenLabs music
  - `POST /api/transcribe` — Transcription service
- **Impact:** A single authenticated user (or unauthenticated for some routes) can drain API budgets by spamming requests.
- **Fix:** Implement per-user rate limiting using middleware or a rate limiter like `@upstash/ratelimit`.

### BUG-B-013: Instagram Access Token Passed in URL Query Parameter
- **Severity:** Medium
- **Area:** Security
- **Details:** `src/lib/social/providers/instagram.ts:16`:
  ```typescript
  `https://graph.facebook.com/v24.0/${providerId}/media?...&access_token=${encodeURIComponent(accessToken)}`
  ```
  Similarly in `facebook.ts:19` and `facebook.ts:60`. Access tokens are sent as URL query parameters instead of Authorization headers. URL parameters are logged by proxies, CDNs, and web servers.
- **Impact:** Token exposure in server access logs, upstream proxy logs, and potentially browser history if redirected.
- **Fix:** Use `Authorization: Bearer {token}` header instead of query parameter. The Facebook Graph API supports both methods.

### BUG-B-014: No Pagination on Multiple List Endpoints
- **Severity:** Medium
- **Area:** API / Performance
- **Details:** These GET endpoints return all records with no limit:
  - `GET /api/account-groups` — All groups
  - `GET /api/account-tags` — All tags
  - `GET /api/project-tags` — All tags
  - `GET /api/assets` — All assets
  - `GET /api/projects` — All projects
  - `GET /api/v2/accounts` — All accounts

  Only `GET /api/v2/posts/list` implements pagination properly.
- **Impact:** Memory exhaustion and timeouts as data grows. A user with thousands of projects would cause significant server load.
- **Fix:** Add `limit` and `offset` parameters (or cursor-based pagination) to all list endpoints.

### BUG-B-015: Scheduled Post Date Parsing Has No Timezone Handling
- **Severity:** Medium
- **Area:** API / Data Integrity
- **Details:** `src/app/api/v2/posts/route.ts:55-57`:
  ```typescript
  if (scheduleType === 'scheduled' && scheduledDate && scheduledTime) {
    scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`).toISOString();
  }
  ```
  The `timezone` field is stored but never used in the date computation. `new Date()` parses the string in the server's local timezone (or UTC depending on runtime), ignoring the user's timezone entirely.
- **Impact:** Posts scheduled for "3:00 PM PST" may actually publish at 3:00 PM UTC (8 hours early). Users in non-UTC timezones will have posts published at wrong times.
- **Fix:** Use the timezone parameter to construct the correct UTC timestamp:
  ```typescript
  const localDate = new Date(`${scheduledDate}T${scheduledTime}`);
  // Convert from user's timezone to UTC using Intl or date-fns-tz
  ```

### BUG-B-016: No Idempotency Protection on Post Creation
- **Severity:** Medium
- **Area:** API / Data Integrity
- **Details:** `POST /api/v2/posts` has no idempotency key. Network retries (e.g., from a flaky connection, browser retry, or Next.js server-side retry) will create duplicate posts and potentially publish the same content twice to social platforms.
- **Impact:** Duplicate posts published to social media accounts. Difficult to detect and clean up.
- **Fix:** Accept an `idempotencyKey` in the request body and check for existing posts with that key before creating a new one.

### BUG-B-017: Proxy/Media Route Has No Authentication
- **Severity:** Medium
- **Area:** API / Security
- **Details:** `GET /api/proxy/media` is completely unauthenticated. While it has a domain allowlist, it effectively turns the server into an open proxy for the 7 allowed domains (`r2.dev`, `fal.media`, `fal.ai`, `pexels.com`, `cloud-45c.workers.dev`, `elevenlabs.io`, `scenify.io`).
- **Impact:** Anyone can use the server to proxy requests to these domains, potentially for bandwidth abuse or to mask their IP address when accessing these services.
- **Fix:** Add authentication. Also consider adding a `Content-Length` limit to prevent the server from proxying very large files.

### BUG-B-018: Upload Routes Accept Arbitrary userId
- **Severity:** Medium
- **Area:** API / Security
- **Details:** Upload multipart initiate route accepts `userId` from the request body with a default of `'mockuser'`:
  ```typescript
  const { fileName, fileSize, chunkSize = DEFAULT_CHUNK_SIZE, userId = 'mockuser' } = body;
  ```
  This means files can be uploaded under any userId, and if no userId is provided, files go under "mockuser".
- **Impact:** File path injection — users can upload files under another user's directory. The "mockuser" default suggests this was left in from development.
- **Fix:** Always derive userId from the authenticated session, never from the request body.

### BUG-B-019: Missing cleanup of post_accounts on cron failure
- **Severity:** Medium
- **Area:** Cron / Data Integrity
- **Details:** In the cron publish route, if `fetchToken()` throws an error for one account within `Promise.allSettled`, the individual account's status is updated to `failed`. However, if the entire cron handler throws (e.g., database connection lost during the loop at line 110-117), the post status update is skipped. The `processing_started_at` is set but never cleared, and `post_accounts` may have inconsistent statuses.
- **Impact:** Orphaned processing state. Posts stuck in "publishing" with some accounts marked as "publishing" and others untouched.
- **Fix:** Wrap the per-post processing in a try/catch that always clears `processing_started_at` on failure.

### BUG-B-020: PUT /api/v2/posts/[id] Update Doesn't Re-check user_id
- **Severity:** Low
- **Area:** API / Security
- **Details:** `src/app/api/v2/posts/[id]/route.ts:97-100`: The actual update query doesn't include `user_id` filter:
  ```typescript
  const { error: updateErr } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', id);  // Missing: .eq('user_id', user.id)
  ```
  The earlier SELECT does check user_id (line 73-74), so this is defense-in-depth missing rather than a direct exploit. RLS should also prevent it. But if RLS were misconfigured, this would be an authorization bypass.
- **Impact:** Low — mitigated by RLS and the prior ownership check. But violates defense-in-depth principle.
- **Fix:** Add `.eq('user_id', user.id)` to the update query.

### BUG-B-021: Token Cache Never Evicts on Memory Pressure
- **Severity:** Low
- **Area:** Performance
- **Details:** `src/lib/octupost/client.ts:10` uses a `Map` for token caching with a 5-minute TTL but no size limit. Entries are only evicted when re-fetched after TTL. Stale entries for accounts that are no longer queried remain in memory forever.
- **Impact:** Minor memory leak in long-running processes. Negligible in serverless environments.
- **Fix:** Use an LRU cache with a max size, or accept the current behavior for serverless.

### BUG-B-022: Inconsistent Schema Usage Across Routes
- **Severity:** Low
- **Area:** API / Code Quality
- **Details:** Some routes specify schema explicitly, others don't:
  - `project/reset/route.ts` — `createClient()` with no schema (defaults to public)
  - Social routes — `createClient('social_auth')` (correct)
  - Studio routes — `createClient('studio')` (correct)

  The `project/reset` route calls `supabase.rpc('reset_project', ...)` which may target the wrong schema.
- **Impact:** RPC calls may execute against the wrong schema, causing silent failures or data corruption.
- **Fix:** Always specify the schema explicitly when creating the Supabase client.

### BUG-B-023: sync Route Upserts on Non-Existent Unique Constraint
- **Severity:** Low
- **Area:** API / Data Integrity
- **Details:** `src/app/api/v2/accounts/sync/route.ts:31`:
  ```typescript
  await supabase.from('tokens').upsert(rows, { onConflict: 'user_id,octupost_account_id' });
  ```
  But the `tokens` table has NO `user_id` column (confirmed by DB audit). The unique index is on `(platform, account_id)`. This upsert would fail silently or insert duplicates.
- **Impact:** Account sync may create duplicate token records or fail entirely. The sync response might return stale data.
- **Fix:** Match the `onConflict` to the actual unique constraint: `'platform, account_id'`. Also add `user_id` column to the tokens table.

### BUG-B-024: Post List Date Filter Uses Server Timezone
- **Severity:** Low
- **Area:** API / Data Integrity
- **Details:** `src/app/api/v2/posts/list/route.ts:34-36`:
  ```typescript
  const [year, month] = date.split('-').map(Number);
  const start = new Date(year, month - 1, 1).toISOString();
  const end = new Date(year, month, 1).toISOString();
  ```
  `new Date(year, month, 1)` creates dates in the server's local timezone. The resulting ISO strings may be off by hours depending on the server's timezone configuration.
- **Impact:** Calendar view may show posts from adjacent months or miss posts at month boundaries.
- **Fix:** Use explicit UTC construction: `new Date(Date.UTC(year, month - 1, 1))`.

---

## 2. Database Audit

### Schema Overview

| Schema | Tables | Purpose |
|--------|--------|---------|
| `public` | 3 (auto_login_tokens, debug_logs, user_integrations) | Auth & integrations |
| `social_auth` | 9 (tokens, posts, post_accounts, account_groups, account_group_members, account_tags, workflow_runs, workflow_run_lanes) | Social media management |
| `studio` | 15 (projects, storyboards, scenes, clips, tracks, assets, etc.) | Video editing |
| `mixpost` | 39 | Legacy — NOT AUDITED (potential blind spot) |

### RLS Status

| Table | RLS Enabled | Policies |
|-------|:-----------:|:--------:|
| public.auto_login_tokens | Yes | 2 |
| **public.debug_logs** | **NO** | 0 |
| public.user_integrations | Yes | 2 |
| social_auth.account_group_members | Yes | 2 |
| social_auth.account_groups | Yes | 4 |
| social_auth.account_tags | Yes | 2 |
| social_auth.post_accounts | Yes | 4 |
| social_auth.posts | Yes | 4 |
| **social_auth.tokens** | **NO** | **0** |
| social_auth.workflow_run_lanes | Yes | 4 |
| social_auth.workflow_runs | Yes | 4 |
| studio.* (15 tables) | Yes | 60 |

**Critical:** 2 tables without RLS (`tokens` and `debug_logs`). The `tokens` table is the most dangerous — see BUG-B-001.

### Foreign Key Gaps

| Missing FK | Risk |
|-----------|------|
| `social_auth.tokens` has no `user_id` column | Cannot enforce user scoping at DB level |
| `social_auth.posts.user_id` has no FK to `auth.users` | Orphaned posts if users deleted |
| `studio.projects.user_id` has no FK to `auth.users` | Orphaned projects if users deleted |
| `social_auth.workflow_runs.project_id` has no FK to `studio.projects` | Cross-schema reference gap |

### Index Coverage

Generally well-indexed. Notable gaps:
- `studio.rendered_videos` — has `user_id` column used in RLS but no index on it
- `social_auth.tokens` — no `user_id` index (because no `user_id` column exists)
- `social_auth.posts` — no index on `scheduled_at` (queried by cron) or `status` (queried by filters)

### Data Integrity

| Check | Result |
|-------|--------|
| NULL user_id in social_auth.posts | 0 (clean) |
| Orphaned post_accounts | 0 (clean) |
| Duplicate tokens (platform + account_id) | 0 (enforced by unique index) |
| Row counts | 26 tokens, 0 posts, 23 projects, ~2340 clips |

---

## 3. Security Issues

### Summary of Security Findings

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| B-001 | Tokens table has no RLS — all OAuth tokens exposed | Critical | Open |
| B-002 | GET /api/v2/accounts returns all users' accounts | Critical | Open |
| B-003 | Sync route returns access_token in JSON response | Critical | Open |
| B-004 | Cron secret check is bypassable | Critical | Open |
| B-005 | 6 API routes have no authentication | High | Open |
| B-006 | debug_logs table has no RLS | High | Open |
| B-007 | No account ownership verification in social/media | High | Open |
| B-009 | Database errors leaked to clients | High | Open |
| B-010 | Token cache shared across users | High | Open |
| B-011 | Facebook provider logs token prefixes | High | Open |
| B-013 | Access tokens passed in URL query strings | Medium | Open |
| B-017 | Proxy/media route is unauthenticated | Medium | Open |
| B-018 | Upload routes accept arbitrary userId | Medium | Open |

### Attack Scenarios

1. **Full Account Takeover:** An attacker uses the anon key to query `social_auth.tokens` directly via PostgREST, obtaining all 26 OAuth tokens. They can then post/delete content on every connected social account.

2. **API Cost Drain:** An attacker spams unauthenticated AI endpoints (`/api/chat`, `/api/fal/video`, `/api/elevenlabs/voiceover`), draining paid API credits.

3. **Cron Manipulation:** If `CRON_SECRET` is unset, an attacker triggers `GET /api/cron/publish-scheduled` to force-publish all scheduled posts ahead of schedule.

---

## 4. Cron/Scheduling Issues

### BUG-B-004: Bypassable CRON_SECRET (see above)

### BUG-B-008: Stale processing_started_at (see above)

### BUG-B-015: Timezone Handling (see above)

### Additional Observations:

- **No retry mechanism:** If a platform publish fails, the post is marked as `failed` with no automatic retry. The `retry_count` column exists in the `posts` table (default 0) but is never incremented or used.
- **No dead letter queue:** Failed posts have no alerting or recovery workflow. They silently remain in `failed` status.
- **No concurrency guard:** If the cron runs every minute and a publish takes >1 minute, the `processing_started_at` claim mechanism works, but there's no distributed lock. Two concurrent cron invocations could race on the initial SELECT.
- **Cron publishes posts with no media gracefully** (skips them), which is correct behavior.
- **Cron handles posts with no post_accounts gracefully** (skips them), which is correct behavior.

---

## 5. Data Flow Issues

### Token Flow (Critical Path)

```
Octupost API → fetchToken() → in-memory cache → Platform APIs
                                    ↓
                              No user scoping
                              No encryption
                              5-min TTL cache
```

**Issues:**
1. Tokens flow from Octupost without user verification (BUG-B-010)
2. Tokens are cached globally, not per-user
3. The `fetchToken(accountId)` function accepts any accountId — there's no verification the requesting user owns that account

### Accounts Sync Flow

```
Octupost /accounts → sync route → UPSERT into tokens table
                                        ↓
                                  onConflict: 'user_id,octupost_account_id'
                                  BUT tokens table has no user_id column!
```

**Issue:** The upsert conflict resolution references a non-existent column combination (BUG-B-023). This likely causes silent failures or unexpected behavior.

### Post Publishing Flow

```
Create post → Create post_accounts → If 'now': publish immediately
                                   → If 'scheduled': wait for cron
                                        ↓
                                   Cron picks up → sets processing_started_at
                                        ↓
                                   fetchToken per account → publish to platform
                                        ↓
                                   Update post_accounts status
                                        ↓
                                   Update post status (published/partial/failed)
```

**Issues:**
1. No ownership verification when fetching tokens (BUG-B-007)
2. Stale processing_started_at blocks retries (BUG-B-008)
3. Timezone ignored in scheduling (BUG-B-015)
4. No idempotency (BUG-B-016)

---

## 6. Performance Concerns

### Missing Database Indexes

| Table | Column | Used By | Impact |
|-------|--------|---------|--------|
| `social_auth.posts` | `status` | Cron query, list filter | Full table scan on every cron run |
| `social_auth.posts` | `scheduled_at` | Cron query | Full table scan to find due posts |
| `social_auth.posts` | `processing_started_at` | Cron query | Full table scan |
| `studio.rendered_videos` | `user_id` | RLS policy | RLS policy requires scanning all rows |

**Recommendation:** Create composite index:
```sql
CREATE INDEX idx_posts_cron_lookup ON social_auth.posts (status, scheduled_at, processing_started_at)
  WHERE status = 'scheduled';
```

### N+1 Query Patterns

- **Cron route:** For each scheduled post, it makes N separate `fetchToken()` calls (one per account), then N separate `post_accounts.update()` calls, then one `posts.update()`. For a batch of 10 posts each with 5 accounts, that's 10 + 50 + 50 + 10 = 120 database/API calls.
- **Post creation (publish now):** Similar pattern — N token fetches + N platform publishes + N status updates.

### Unbounded Pagination

6 list endpoints return all records without limits (BUG-B-014). As data grows, these will become increasingly slow and memory-intensive.

### Token Cache Considerations

The 5-minute token cache (BUG-B-021) is reasonable for reducing Octupost API calls, but in a serverless environment (Vercel), each function invocation starts with a cold cache. The cache provides value only during warm invocations handling multiple requests.

---

## Bug Severity Summary

| Severity | Count | IDs |
|----------|-------|-----|
| **Critical** | 4 | B-001, B-002, B-003, B-004 |
| **High** | 7 | B-005, B-006, B-007, B-008, B-009, B-010, B-011 |
| **Medium** | 8 | B-012, B-013, B-014, B-015, B-016, B-017, B-018, B-019 |
| **Low** | 5 | B-020, B-021, B-022, B-023, B-024 |
| **Total** | **24** | |

---

## Recommended Fix Priority

### Immediate (Today)
1. **Enable RLS on `social_auth.tokens`** — This is a live credential exposure (B-001)
2. **Fix accounts route to filter by user** (B-002)
3. **Remove `select('*')` from sync route** (B-003)
4. **Fix cron secret validation** (B-004)

### This Week
5. Add authentication to all unauthenticated routes (B-005)
6. Enable RLS on `debug_logs` (B-006)
7. Add account ownership checks (B-007)
8. Add stale processing recovery to cron (B-008)
9. Sanitize all error responses (B-009)
10. Remove token prefix logging (B-011)

### This Sprint
11. Add `user_id` column to `social_auth.tokens` table
12. Fix sync upsert conflict key (B-023)
13. Implement rate limiting on AI routes (B-012)
14. Fix timezone handling in scheduling (B-015)
15. Add missing database indexes
16. Add pagination to all list endpoints (B-014)
17. Authenticate proxy/media route (B-017)
18. Fix upload userId handling (B-018)

### Next Sprint
19. Add idempotency keys (B-016)
20. Implement retry mechanism for failed publishes
21. Add audit logging
22. Move tokens to URL headers (B-013)
23. Audit `mixpost` schema for RLS

---

*End of QA Report — Backend, API & Data Integrity Audit*
