# Unified Calendar Plan — Challenge Round Critique & Merged Plan

**Challenger verdict:** Both agents did solid research but each has a blind spot shaped by their lens. Agent A built a feature-rich UX palace on top of a backend that literally doesn't work. Agent B built a bulletproof backend for a product with zero users to stress-test it. The truth is in between, leaning heavily toward B's priorities first.

---

## Critique: Plan A (Frontend-First)

### What's Strong
- **Excellent current-state analysis.** The file path reference table alone is worth keeping. Thorough inventory of what exists.
- **Click-to-create from calendar** is the single most impactful UX feature identified. The current flow (Dashboard -> Project -> Render -> Post) is absurd for simple posts.
- **Inline editing over new-tab** is correct. Opening a new tab breaks flow entirely.
- **Platform color bands** — simple, effective, and cheap to implement. Good taste.
- **"Phase 1 first (creation) over Phase 2 first (DnD)" reasoning** shows good product instinct.

### What's Weak
- **Builds a mansion on a broken foundation.** The entire plan assumes the backend works. It doesn't. There's no cron trigger. Scheduled posts never fire. Plan A doesn't mention this once. You can't drag-and-drop reschedule posts that will never publish.
- **Massively over-scoped.** 25 numbered items across 6 phases. Schedule templates, bulk operations, calendar sidebar, calendar events table, compact density toggle, account group swimlanes. This is 2-3 months of work for a product with 0 revenue and 0 paying users.
- **`@dnd-kit` is a luxury.** Drag-and-drop rescheduling is a "wow" demo feature. Nobody is churning because they can't drag a post pill. A simple "Reschedule" button in the post dialog is 95% as useful at 5% of the cost.
- **Schedule templates are premature.** A `schedule_templates` table, template CRUD API, slot indicators, auto-fill — this is a feature for a team managing 100+ posts/week. The user has 0 posts flowing through the system.
- **Bulk operations are premature.** Same reasoning. You need volume before bulk ops matter.
- **Calendar sidebar is a layout reshuffling** that adds zero new capability. The filter bar already works.
- **`calendar_events` table** — correctly deferred, but shouldn't even be in the plan. It's a distraction.

### What's Missing
- No mention of the cron trigger gap (the #1 blocker)
- No mention of the admin client schema bug
- No mention of retry logic or failure recovery
- No mention of what happens when Vercel cold-starts or times out
- No discussion of the empty-DB problem beyond a line about "empty state UI"

---

## Critique: Plan B (Backend-First)

### What's Strong
- **Identified the #1 blocker immediately:** nothing triggers the cron. This is the only thing that matters right now.
- **Admin client schema bug catch** — critical finding. If the tables are in `social_auth` and the client queries `public`, nothing works.
- **`claim_scheduled_posts` with `FOR UPDATE SKIP LOCKED`** — correct concurrency primitive. Clean, no external dependencies.
- **Per-account retry** — right design. If Instagram fails but YouTube succeeds, don't re-publish to YouTube.
- **Status state machine** is well-thought-out. `processing` as a lock state is the right pattern.
- **"Not adding a message queue (yet)"** — perfect startup instinct. Postgres can be your job queue until it can't.
- **Vercel Cron as Phase 1, external queue as Phase 3+** — correct sequencing.

### What's Weak
- **Over-engineered retry system for Day 1.** Exponential backoff, `retry_count`, `max_retries`, `next_retry_at`, `failed_permanent` status, `publish_log` table with structured error codes — this is reliability engineering for a system that hasn't published its first post yet. Ship the simple cron first, add retries when you have data on actual failure rates.
- **Recurring schedules via materialized posts** is complex. `recurrence_parent_id`, `generateRecurringPosts()` in cron, "edit this vs edit all future" — this is Google Calendar territory. A social media scheduler doesn't need this on day 1 (or day 30).
- **Rate limit tracking table** — premature. With 26 accounts and <10 posts/day, you're nowhere near Instagram's 25 posts/day limit. Don't build infrastructure for problems you don't have.
- **Batch size of 5 is conservative.** With `Promise.allSettled` for accounts within a post, 5 posts should finish well within Vercel Pro's 5-minute window. But this is a tuning parameter, not a design decision worth agonizing over.
- **No UX improvements proposed.** The calendar is read-only. Agent B doesn't address this at all. You can have the most reliable cron in the world, but if users can't create posts from the calendar, the product is still incomplete.

### What's Missing
- No discussion of calendar UX improvements
- No mention of the empty-DB bootstrap problem (how do users start using this?)
- No consideration of the 26-account visual density problem
- Health endpoint is nice but who's looking at it? No alerting strategy.

---

## Where They Conflict

| Topic | Plan A | Plan B | Verdict |
|-------|--------|--------|---------|
| **Priority** | UX features first | Backend reliability first | **B is right.** Fix the engine before painting the car. |
| **Recurring schedules** | Schedule templates (UI-driven, slot-based) | Materialized posts with recurrence_rule (data-driven) | **Neither — defer entirely.** Both are over-engineered for a product at zero. |
| **Recurrence format** | iCal RRULE string on posts | JSONB recurrence_rule | Moot since we're deferring, but JSONB is simpler when we get there. |
| **Cron reliability** | Not discussed | Vercel Cron + advisory locks | **B wins by default** — A didn't even notice the cron is broken. |
| **Admin client schema** | Not discussed | Identified as critical bug | **B wins.** Must verify and fix. |
| **Drag-and-drop** | `@dnd-kit`, full DnD system | Not discussed | **Defer.** A reschedule button is enough for now. |
| **Edit flow** | Inline editor dialog | Not discussed | **A is right** that the new-tab edit is bad UX. But a dialog reusing existing form is enough. |

---

## What Both Plans Missed

1. **The empty database is the real UX problem.** Neither plan seriously addresses that the `posts` table is empty because posts were published via CLI, not through the app. The first thing a user sees is an empty calendar. The #1 priority after fixing the cron is making it trivially easy to create a post.

2. **No error notification to the user.** Both plans track failures in the DB but neither proposes telling the user when a post fails. A simple "1 post failed" banner on the calendar or a toast on page load would be more valuable than a `publish_log` table.

3. **No consideration of Vercel's execution time limits on Hobby vs Pro.** Hobby plan: 10s max for serverless functions. Pro: 5 min for cron. If on Hobby, the entire cron architecture needs rethinking. Which plan is the app on?

4. **Media handling is hand-waved.** Both plans assume `media_url` just works. But video uploads to platforms can take minutes. What if the media URL expires between scheduling and publishing? Plan B mentions it as a failure mode but doesn't propose a solution beyond "mark as failed."

5. **No mobile/responsive consideration.** Calendar UX on mobile is fundamentally different. Neither plan mentions it. (Acceptable to defer, but worth noting.)

---

## UNIFIED PLAN

### Phase 0: Ship Today (2-4 hours)

**Goal:** Scheduled posts actually publish. The calendar shows real data.

| # | Task | Source | Effort |
|---|------|--------|--------|
| 0.1 | **Add `vercel.json` with 1-min cron trigger** | Plan B | 10 min |
| 0.2 | **Verify admin client schema** — check if tables are in `public` or `social_auth`, fix `createAdminClient()` if needed | Plan B | 30 min |
| 0.3 | **Add `processing_started_at` column** to `posts` — simple migration, prevents double-publish | Plan B | 15 min |
| 0.4 | **Update cron handler** — set `processing_started_at` before processing, clear on completion. Use `WHERE status = 'scheduled' AND scheduled_at <= now() AND processing_started_at IS NULL` instead of the full RPC for now. | Plan B (simplified) | 1 hour |
| 0.5 | **Create a test post via the existing UI** to verify end-to-end flow works | — | 30 min |
| 0.6 | **Add "failed posts" banner** on calendar page — simple query for `status = 'failed'` posts, show count with link to filter | New | 30 min |

**What we're NOT doing:** Full `claim_scheduled_posts` RPC (overkill for day 1 — the `processing_started_at IS NULL` check is sufficient at current scale). No retry logic. No publish_log table.

### Phase 1: This Week (2-3 days)

**Goal:** Calendar becomes actionable — users can create and reschedule posts without leaving it.

| # | Task | Source | Effort |
|---|------|--------|--------|
| 1.1 | **Quick-create from calendar** — click a day/timeslot, get a popover with caption + media URL + account selector + schedule time. Calls existing POST `/api/v2/posts`. | Plan A | 4-6 hours |
| 1.2 | **Inline post editor** — replace "edit in new tab" with a dialog/sheet. Reuse form from `edit-post-page.tsx`. Keep the full page as "Open full editor" link. | Plan A | 3-4 hours |
| 1.3 | **Reschedule endpoint** — `PATCH /api/v2/posts/[id]/reschedule` with just `{ scheduled_at, timezone }`. Add a "Reschedule" button in post detail dialog with a date/time picker. | Plan A | 2 hours |
| 1.4 | **Platform color bands** on PostPill — left-border color by platform. 5 colors, zero new components. | Plan A | 1 hour |
| 1.5 | **Empty state** — when no posts exist, show "Schedule your first post" CTA that opens the quick-create flow. | Plan A | 1 hour |
| 1.6 | **Upgrade cron to `claim_scheduled_posts` RPC** with `FOR UPDATE SKIP LOCKED` if we're seeing any concurrency issues. Otherwise, keep the simple approach from Phase 0. | Plan B | 2-3 hours (conditional) |

**What we're NOT doing:** Drag-and-drop (a reschedule button is enough). Calendar sidebar (filter bar works). Bulk operations (no volume yet). Schedule templates (no recurring need yet).

### Phase 2: Next Week (3-5 days)

**Goal:** Reliability and polish. Posts don't silently fail. Power users can manage at scale.

| # | Task | Source | Effort |
|---|------|--------|--------|
| 2.1 | **Simple retry logic** — if a post fails, set `retry_count` and `next_retry_at`. Cron picks up retries. Max 3 retries with 5min/15min/60min delays. No exponential backoff formula needed — just a lookup table. | Plan B (simplified) | 3-4 hours |
| 2.2 | **Token refresh wrapper** — catch 401, refresh via Octupost, retry once. | Plan B | 1-2 hours |
| 2.3 | **Per-post timezone display** in post detail — "9:00 AM EST (2:00 PM UTC)" | Plan A | 30 min |
| 2.4 | **Failed post detail** — show error message in post detail dialog. Show retry status if retrying. | New | 2 hours |
| 2.5 | **Compact post pills in month view** — show platform icon + time only. Caption on hover. Handles visual density for 26 accounts. | Plan A | 2 hours |
| 2.6 | **Drag-and-drop rescheduling** — install `@dnd-kit`, add DnD to month/week views. Only if users are actively requesting this. | Plan A | 4-6 hours (conditional) |

**What we're NOT doing:** `publish_log` table (console logs + Vercel logs are fine for now). Rate limit tracking (nowhere near limits). Health endpoint (no one to alert). Account group swimlanes.

### Phase 3: Later (when there's traction)

These features earn their place only when we have paying users or clear demand:

| Feature | Source | Trigger to build |
|---------|--------|-------------------|
| **Recurring schedules / templates** | Both plans | Users posting >20 times/week and asking for it |
| **Bulk operations** | Plan A | Users managing >50 scheduled posts at once |
| **`publish_log` audit table** | Plan B | Debugging failures becomes a regular task |
| **Rate limit tracking** | Plan B | Actually hitting platform rate limits |
| **Calendar sidebar** | Plan A | Filter bar becomes insufficient (unlikely soon) |
| **External job queue (Inngest/Trigger.dev)** | Plan B | Vercel Cron timing/reliability becomes a problem |
| **Optimal posting time suggestions** | Plan A | Have enough publish data to analyze |
| **Calendar events (reminders, deadlines)** | Plan A | Users ask for it (they probably won't) |

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| Fix backend before building UX features | A beautiful calendar that never publishes is worse than an ugly one that works |
| Simple `processing_started_at` check before full RPC | YAGNI at current scale. Upgrade when needed. |
| No retry logic in Phase 0 | Ship the happy path first. Understand actual failure modes before engineering around them. |
| Reschedule button over drag-and-drop | 95% of the value at 5% of the cost. DnD is Phase 2 conditional. |
| No recurring schedules until Phase 3 | Both plans over-engineered this. Zero users are asking for it. |
| No `publish_log` table yet | Vercel logs exist. Don't build observability infrastructure before you have traffic. |
| No rate limit tracking | 26 accounts * <5 posts/day = nowhere near any platform limit |
| Keep filter bar, skip sidebar | The filter bar works. A sidebar is a layout change that adds no capability. |

---

## Key Files (from Plan A — keeping this, it's genuinely useful)

| Purpose | Path |
|---------|------|
| Calendar page | `src/app/calendar/page.tsx` |
| Calendar main component | `src/components/calendar/calendar-content.tsx` |
| Day cell (month view) | `src/components/calendar/calendar-day-cell.tsx` |
| Post detail dialog | `src/components/calendar/post-detail-dialog.tsx` |
| Post creation page | `src/components/post/post-page.tsx` |
| Post edit page | `src/components/post/edit-post-page.tsx` |
| Schedule picker | `src/components/post/schedule-picker.tsx` |
| Account selector | `src/components/post/account-selector.tsx` |
| Cron publisher | `src/app/api/cron/publish-scheduled/route.ts` |
| Posts API | `src/app/api/v2/posts/route.ts` |
| Admin client | `src/lib/supabase/admin.ts` |
| DB migration | `supabase/migrations/20260305000000_create_social_posts.sql` |
