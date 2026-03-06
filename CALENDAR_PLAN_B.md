# Calendar & Scheduling System — Plan B (Backend-First)

**Author:** Agent B | **Date:** 2026-03-05

---

## 1. Current State Analysis

### What Exists

**Database (3 tables in `social_auth` schema — migration `20260305000000`):**
- `posts` — main post record with `schedule_type`, `scheduled_at`, `timezone`, `status`, `platform_options` (JSONB), `tags` (JSONB)
- `post_accounts` — per-platform result tracking with `status`, `platform_post_id`, `error_message`, `published_at`
- `social_accounts` — cached mirror of Octupost accounts (largely replaced by direct `tokens` table queries)

**Cron endpoint (`/api/cron/publish-scheduled/route.ts`):**
- Simple GET handler, authenticated via `CRON_SECRET` Bearer token
- Queries `status='scheduled' AND scheduled_at <= now()`
- Publishes all matched posts sequentially (each post's accounts in parallel via `Promise.allSettled`)
- Updates status per-account and determines aggregate post status: `published | partial | failed`

**Publishing pipeline (`src/lib/platforms/`):**
- Platform-specific publishers for Instagram, Facebook, YouTube, TikTok, Twitter
- Unified `publishToAccount()` router function
- Token fetching via Octupost API with 5-minute in-memory cache

**Calendar UI (`src/components/calendar/`):**
- Month/week/day views with SWR-based data fetching
- Filtering by status, accounts, groups, tags
- Post detail dialog with edit/delete actions
- Timezone selector (22 zones)

**Post APIs (`/api/v2/posts/`):**
- CRUD operations for posts with account reconciliation
- Manual publish endpoint (`/[id]/publish`)
- List endpoint with month-based date filtering

### What's Broken or Missing

1. **No cron trigger exists.** There's no `vercel.json`, no `pg_cron`, no GitHub Actions — the cron endpoint has no caller. Scheduled posts will never fire.

2. **No retry logic.** If a platform API is down or rate-limited, the post is marked `failed` permanently. The only recovery path is manual republish via the UI.

3. **No concurrency protection.** If the cron fires twice (overlapping invocations), the same post could be published twice. There's no locking or idempotency guard.

4. **Admin client doesn't specify `social_auth` schema.** `createAdminClient()` returns a Supabase client with no schema override, so it defaults to `public`. The cron job queries `.from('posts')` — this only works if the tables are in `public` schema, not `social_auth`. This is either a bug or the tables were created in `public` despite the migration file suggesting otherwise.

5. **Sequential post processing.** The cron processes posts in a for-loop. If 10 posts are due, the 10th post waits for all preceding posts (including video uploads that can take 5+ minutes each).

6. **No recurring schedules.** No data model for "every Tuesday at 9am."

7. **No publish confirmation/webhooks.** Some platforms (TikTok) return a `publish_id` but don't confirm the post went live. No webhook handling.

8. **No rate limit awareness.** Each platform has API rate limits. Publishing 26 accounts simultaneously could hit them, especially Instagram (200 calls/hour per user).

9. **Timezone handling is fragile.** `scheduled_at` is stored as TIMESTAMPTZ (good), but the `timezone` field is informational only. If a user changes their timezone preference after scheduling, there's no reconciliation.

10. **No dead letter / audit log.** Failed posts disappear into a `failed` status with an error message string. No structured error tracking, no retry count, no failure history.

---

## 2. Proposed Architecture

### 2.1 Cron Strategy: Vercel Cron + Guard Rails

**Recommendation:** Use Vercel Cron (simplest for the Vercel-deployed Next.js app) with database-level protection.

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/publish-scheduled",
      "schedule": "* * * * *"
    }
  ]
}
```

**Why every minute:** Social media timing matters. A post scheduled for 9:00 AM should not wait until 9:05. Vercel Cron supports 1-minute granularity on Pro plans.

**Idempotency guard:** Use a Postgres advisory lock or a `processing_started_at` column to prevent double-processing.

### 2.2 Data Model Extensions

#### New columns on `posts`:

```sql
ALTER TABLE posts ADD COLUMN retry_count INT DEFAULT 0;
ALTER TABLE posts ADD COLUMN max_retries INT DEFAULT 3;
ALTER TABLE posts ADD COLUMN next_retry_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN processing_started_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN recurrence_rule JSONB;       -- for recurring schedules
ALTER TABLE posts ADD COLUMN recurrence_parent_id UUID REFERENCES posts(id);
```

#### New columns on `post_accounts`:

```sql
ALTER TABLE post_accounts ADD COLUMN retry_count INT DEFAULT 0;
ALTER TABLE post_accounts ADD COLUMN last_error_at TIMESTAMPTZ;
ALTER TABLE post_accounts ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
```

#### New table: `publish_log` (audit trail):

```sql
CREATE TABLE publish_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  post_account_id UUID REFERENCES post_accounts(id) ON DELETE SET NULL,
  event TEXT NOT NULL,  -- 'attempt', 'success', 'failure', 'retry_scheduled', 'timeout'
  platform TEXT,
  error_message TEXT,
  error_code TEXT,      -- structured: 'rate_limit', 'token_expired', 'api_error', 'timeout'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_publish_log_post_id ON publish_log(post_id);
CREATE INDEX idx_publish_log_created_at ON publish_log(created_at);
```

#### Recurrence rule schema (JSONB in `recurrence_rule`):

```typescript
interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;          // every N days/weeks/months
  days_of_week?: number[];   // 0=Sun..6=Sat (for weekly)
  day_of_month?: number;     // 1-31 (for monthly)
  time: string;              // HH:mm
  timezone: string;
  account_ids: string[];
  ends_at?: string;          // ISO date, or null for indefinite
  max_occurrences?: number;
}
```

### 2.3 Status State Machine

```
draft ──► scheduled ──► processing ──► published
                │              │
                │              ├──► partial (some accounts succeeded)
                │              │
                │              └──► failed ──► retry_pending ──► processing (retry)
                │                                                    │
                │                                                    └──► failed_permanent
                │
                └──► cancelled
```

Key transitions:
- `scheduled → processing`: Set `processing_started_at = now()`. This is the lock.
- `processing → published/partial/failed`: Clear `processing_started_at`, set `completed_at`.
- `failed → retry_pending`: Set `next_retry_at` with exponential backoff.
- `retry_pending → processing`: On next cron tick when `next_retry_at <= now()`.
- After `max_retries` exhausted: `failed_permanent`.

### 2.4 Revised Cron Architecture

```typescript
// Pseudocode for the revised cron handler
export async function GET(req: NextRequest) {
  // 1. Auth check (unchanged)

  // 2. Claim posts atomically — prevents double-processing
  const { data: posts } = await supabase.rpc('claim_scheduled_posts', {
    batch_size: 5,  // process max 5 posts per invocation
    stale_threshold_minutes: 10  // reclaim posts stuck in 'processing' for >10min
  });

  // 3. Process each post
  for (const post of posts) {
    await processPost(post);
  }

  // 4. Generate next occurrences for recurring posts
  await generateRecurringPosts();
}
```

#### Postgres function for atomic claim:

```sql
CREATE OR REPLACE FUNCTION claim_scheduled_posts(
  batch_size INT DEFAULT 5,
  stale_threshold_minutes INT DEFAULT 10
)
RETURNS SETOF posts AS $$
BEGIN
  RETURN QUERY
  UPDATE posts
  SET
    status = 'processing',
    processing_started_at = now(),
    updated_at = now()
  WHERE id IN (
    SELECT id FROM posts
    WHERE (
      -- Regular scheduled posts due now
      (status = 'scheduled' AND scheduled_at <= now())
      OR
      -- Retry-pending posts due for retry
      (status = 'retry_pending' AND next_retry_at <= now())
      OR
      -- Stale processing posts (stuck — reclaim them)
      (status = 'processing' AND processing_started_at < now() - (stale_threshold_minutes || ' minutes')::interval)
    )
    ORDER BY scheduled_at ASC
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED  -- critical: skip rows being processed by another invocation
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;
```

The `FOR UPDATE SKIP LOCKED` is the key concurrency primitive. If two cron invocations overlap, each grabs a different batch.

### 2.5 Per-Account Retry with Exponential Backoff

```typescript
async function processPost(post: SocialPost & { post_accounts: SocialPostAccount[] }) {
  const accounts = post.post_accounts.filter(
    a => a.status === 'pending' || a.status === 'failed'
  );

  if (!accounts.length || !post.media_url) {
    await markSkipped(post.id);
    return;
  }

  const results = await Promise.allSettled(
    accounts.map(account => publishWithRetryTracking(post, account))
  );

  // Determine aggregate status
  const allAccounts = post.post_accounts; // includes previously succeeded ones
  const succeeded = allAccounts.filter(a => a.status === 'published').length +
                    results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const total = allAccounts.length;

  if (succeeded === total) {
    await finalizePost(post.id, 'published');
  } else if (succeeded > 0) {
    await finalizePost(post.id, 'partial');
    await scheduleRetryForFailedAccounts(post);
  } else {
    await handleFullFailure(post);
  }
}

function getRetryDelay(retryCount: number): number {
  // Exponential backoff: 2min, 8min, 32min (capped)
  return Math.min(2 * Math.pow(4, retryCount), 30) * 60 * 1000;
}
```

### 2.6 Rate Limit Awareness

Platform rate limits (approximate):
| Platform  | Limit | Window |
|-----------|-------|--------|
| Instagram | 25 posts/day per account, 200 API calls/hr | 24h / 1h |
| Facebook  | 25 posts/day per page | 24h |
| TikTok    | 20 posts/day | 24h |
| YouTube   | 6-10 uploads/day default quota | 24h |
| Twitter   | 300 tweets/3hr, 17 tweets/15min | 3h / 15min |

**Implementation:** Track recent publish counts per account in memory (or a simple `account_publish_counts` table). Before publishing, check if the account is near its limit. If so, delay that account's publish to the next cron tick.

This is a **Phase 2 concern** — for now, with 26 accounts and likely <10 posts/day, rate limits won't bite. But the architecture should accommodate it.

---

## 3. Reliability Design

### 3.1 Failure Modes and Recovery

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Token expired | `fetchToken()` throws / 401 from platform | Auto-call `refreshTokens()`, retry once immediately |
| Platform API down | HTTP 5xx / timeout | Exponential backoff retry (max 3) |
| Rate limited | HTTP 429 | Respect `Retry-After` header, schedule `next_retry_at` accordingly |
| Media URL expired | 404 from platform | Mark as `failed_permanent` — media must be re-uploaded |
| Cron doesn't fire | `processing_started_at` stale check | Next invocation reclaims stale posts |
| Partial success | Some accounts succeed, some fail | Post marked `partial`, failed accounts retried independently |
| Supabase down | DB queries fail | Cron returns 500; next invocation retries. Posts remain in `scheduled` |

### 3.2 Token Refresh Strategy

Current: 5-minute in-memory cache in `fetchToken()`. This is fine for single-invocation cron but doesn't handle token expiry mid-batch.

**Improvement:** Add a try/catch wrapper in the publish loop:
```typescript
async function getValidToken(accountId: string): Promise<string> {
  try {
    const token = await fetchToken(accountId);
    return token.access_token;
  } catch (e) {
    // Token might be expired — refresh and retry
    await refreshTokens();
    clearTokenCache();
    const token = await fetchToken(accountId);
    return token.access_token;
  }
}
```

### 3.3 Monitoring

**Minimal viable monitoring (no external dependencies):**

1. **Publish log table** (defined above) — queryable audit trail
2. **Cron health endpoint** (`/api/cron/health`):
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at < now() - interval '5 minutes') as overdue,
     COUNT(*) FILTER (WHERE status = 'processing' AND processing_started_at < now() - interval '10 minutes') as stuck,
     COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '1 hour') as recent_failures
   FROM posts;
   ```
3. **Dashboard widget** — surface overdue/stuck/failed counts on the calendar page header

### 3.4 Schema Bug: Admin Client

**Critical issue:** `createAdminClient()` creates a Supabase client with no schema override:

```typescript
// admin.ts line 10
return createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  serviceRoleKey,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

If tables are in `social_auth` schema, this client queries `public.posts` (doesn't exist). Either:
- **Option A:** The migration ran in `public` schema (likely, since the SQL has no `SET search_path` or schema prefix) — in which case the code works but disagrees with the stated architecture
- **Option B:** Add `db: { schema: 'social_auth' }` to the admin client options

**Action:** Verify which schema the tables actually live in. If `public`, document that decision. If `social_auth`, fix the admin client.

---

## 4. Implementation Plan

### Phase 1: Make Scheduling Actually Work (Complexity: Medium)

**Goal:** Posts scheduled via the UI actually publish on time.

| Step | Task | Files | Complexity |
|------|------|-------|------------|
| 1.1 | Add `vercel.json` with 1-minute cron | `editor/vercel.json` | Trivial |
| 1.2 | Verify/fix admin client schema | `src/lib/supabase/admin.ts` | Trivial |
| 1.3 | Add `processing_started_at` column | New migration | Low |
| 1.4 | Create `claim_scheduled_posts` RPC | New migration | Medium |
| 1.5 | Rewrite cron handler with claim-based processing | `src/app/api/cron/publish-scheduled/route.ts` | Medium |
| 1.6 | Add token refresh retry wrapper | `src/lib/octupost/client.ts` | Low |

### Phase 2: Retry & Resilience (Complexity: Medium)

| Step | Task | Files | Complexity |
|------|------|-------|------------|
| 2.1 | Add retry columns to `posts` and `post_accounts` | New migration | Low |
| 2.2 | Create `publish_log` table | New migration | Low |
| 2.3 | Implement per-account retry with backoff | Cron handler | Medium |
| 2.4 | Add stale post reclamation logic | Cron handler | Low |
| 2.5 | Log all publish attempts to `publish_log` | Cron handler + manual publish route | Medium |
| 2.6 | Surface retry status in calendar UI | Calendar components | Low |

### Phase 3: Recurring Schedules (Complexity: High)

| Step | Task | Files | Complexity |
|------|------|-------|------------|
| 3.1 | Add `recurrence_rule` and `recurrence_parent_id` columns | New migration | Low |
| 3.2 | Create recurring schedule CRUD API | New API route | Medium |
| 3.3 | Implement `generateRecurringPosts()` in cron | Cron handler | High |
| 3.4 | Calendar UI for creating/viewing recurring schedules | Calendar components | High |
| 3.5 | Handle "edit this occurrence" vs "edit all future" | API + UI | High |

### Phase 4: Observability & Polish (Complexity: Low-Medium)

| Step | Task | Files | Complexity |
|------|------|-------|------------|
| 4.1 | Create `/api/cron/health` endpoint | New API route | Low |
| 4.2 | Add overdue/stuck/failed counts to calendar header | Calendar components | Low |
| 4.3 | Publish log viewer in post detail dialog | Post detail component | Medium |
| 4.4 | Rate limit tracking (if needed) | New utility | Medium |

---

## 5. Trade-offs

### Vercel Cron vs. Supabase pg_cron vs. External Queue

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Vercel Cron** | Zero infra, 1-line config, same deployment | 1-min minimum, no sub-minute, Pro plan needed, max 60s execution (can extend to 5min on Pro) | **Chosen for Phase 1** |
| Supabase pg_cron | Database-native, no HTTP overhead | Can't call Node.js code directly (needs pg_net for HTTP calls), harder to debug | Good alternative if Vercel times out |
| External queue (BullMQ, Inngest) | Sub-second precision, proper job queue semantics, retries built-in | New infrastructure dependency, deployment complexity | **Consider for Phase 3+** if scale demands it |

**Decision:** Start with Vercel Cron. It's the simplest path that works for the current scale (26 accounts, <50 posts/day). The `claim_scheduled_posts` RPC with `FOR UPDATE SKIP LOCKED` handles the concurrency edge cases that Vercel Cron's at-least-once delivery can cause.

### Per-Post vs. Per-Account Retry

**Chosen: Per-account retry.** If Instagram fails but YouTube succeeds, we only retry Instagram. The `post_accounts` table already tracks per-account status — we extend it with `retry_count`. The post stays in `partial` until all accounts resolve.

### Recurring: Template-Based vs. Materialized Posts

**Chosen: Materialized posts with parent reference.** Each occurrence is a real `posts` row (can be individually edited/cancelled) linked to the parent via `recurrence_parent_id`. The cron generates the next N occurrences ahead of time (e.g., 2 weeks out). This is simpler to query, display on the calendar, and reason about than a virtual expansion model.

### JSONB Recurrence vs. iCal RRULE

**Chosen: JSONB.** Our recurrence needs are simple (daily/weekly/monthly). iCal RRULE is powerful but overkill — it adds parsing complexity for features we don't need (BYHOUR, BYSETPOS, EXDATE). If we ever need complex recurrence, we can migrate the JSONB to RRULE.

### Batch Size: 5 Posts Per Cron Tick

**Rationale:** With 1-minute cron and ~60s max execution time (Vercel Hobby) or ~5min (Pro), processing 5 posts with video uploads could take the full window. Processing fewer posts more frequently is safer than processing many posts and risking timeout. Posts not claimed this tick will be claimed next tick (1 minute later — acceptable latency).

### Not Adding a Message Queue (Yet)

A proper job queue (Inngest, Trigger.dev, BullMQ) would give us: sub-second scheduling, built-in retries, dead letter queues, concurrency control, and observability. But it's a new dependency, new infrastructure, and new deployment concern. The Postgres-based approach (advisory locks, `FOR UPDATE SKIP LOCKED`, retry columns) gives us 90% of the reliability at 10% of the complexity. If we outgrow it, the migration path to Inngest is clean — the `publish_log` and retry columns translate directly to job queue concepts.

---

## Summary

The scheduling system's bones are solid — the data model, publishing pipeline, and UI are all in place. The critical gap is that **nothing triggers the cron endpoint**. Phase 1 is a small fix with outsized impact: add `vercel.json`, fix the admin client schema, and add concurrency protection. Phases 2-4 layer on retry logic, recurring schedules, and monitoring. The architecture stays Postgres-centric (no new infrastructure) until scale demands otherwise.
