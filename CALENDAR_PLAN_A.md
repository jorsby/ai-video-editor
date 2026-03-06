# Calendar & Scheduling Plan — Agent A (Frontend-First)

## 1. Current State Analysis

### What Exists

The calendar system is **surprisingly complete** as a read-only scheduling dashboard. Here's what's already built:

**Calendar Page** (`src/app/calendar/page.tsx` + `src/components/calendar/`)
- 3-view calendar: month, week, day — all functional with proper navigation
- SWR-powered data fetching with caching and `keepPreviousData` for smooth transitions
- Status filter tabs: All / Queued / Published / Failed with live counts
- Channel, Group, and Tag filter dropdowns via `CalendarFilterBar`
- Timezone selector with 23 common timezones
- Post pills with thumbnails, captions, time, and platform icons
- Popover overflow for days with 3+ posts
- Workflow run visualization alongside posts
- Post detail dialog with view, edit (opens new tab), and delete actions
- Skeleton loading states for all views

**Post Scheduling Flow** (`src/components/post/post-page.tsx`, `schedule-picker.tsx`)
- Full post creation: caption, media, account selection, platform options, scheduling
- Schedule picker: "Post Now" vs "Schedule" toggle with date/time/timezone inputs
- POST `/api/v2/posts` creates post and either publishes immediately or sets status to `scheduled`
- PUT `/api/v2/posts/[id]` supports editing caption, schedule, accounts
- POST `/api/v2/posts/[id]/publish` for manual publish of scheduled/draft posts

**Cron Job** (`src/app/api/cron/publish-scheduled/route.ts`)
- Queries `posts` where `status='scheduled'` AND `scheduled_at <= now()`
- Publishes to all linked accounts in parallel via Octupost
- Updates per-account status (published/failed) and overall post status (published/partial/failed)
- Protected by `CRON_SECRET` bearer token

**Data Model** (`supabase/migrations/20260305000000_create_social_posts.sql`)
- `posts`: id, user_id, caption, media_url, media_type, schedule_type, scheduled_at, timezone, status, platform_options, tags, workflow_run_id
- `post_accounts`: id, post_id, octupost_account_id, platform, status, platform_post_id, error_message, published_at
- `social_accounts`: cached Octupost account data

### What's Broken / Missing

1. **No way to create posts FROM the calendar** — you must navigate to `/post/[renderedVideoId]` from a video project. The calendar is read-only.
2. **No drag-and-drop rescheduling** — to change a scheduled time, you click Edit, which opens a new tab to `/post/edit/[uuid]`.
3. **No quick-create** — can't click a day/timeslot to create a new post.
4. **No recurring schedules** — no concept of "post every Tuesday at 9am" or schedule templates.
5. **No bulk operations** — can't select multiple posts to reschedule, delete, or move.
6. **No optimal posting time suggestions** — no data-driven "best time to post" guidance.
7. **No draft management** — drafts exist in the schema but no UI pathway to create or manage them.
8. **Calendar is solo-post only for display** — workflow runs are shown but can't be managed.
9. **26 accounts across 5 platforms** — filter bar works, but visual density at scale is a problem. No color coding per platform, no mini-avatar in pills.
10. **Edit opens in new tab** — breaks calendar flow; user loses context.
11. **No undo** — deleting a post is permanent with a simple confirm dialog.
12. **Empty state** — posts table is empty because posts were published via CLI. Calendar shows nothing useful until posts flow through the app.

---

## 2. Proposed Architecture

### 2A. Data Model Changes

#### New table: `schedule_templates`
```sql
CREATE TABLE social_auth.schedule_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,                      -- "Weekday Morning Routine"
  slots JSONB NOT NULL DEFAULT '[]',       -- [{ day_of_week: 1, time: "09:00" }, ...]
  account_ids TEXT[] NOT NULL DEFAULT '{}', -- Octupost account IDs to auto-apply
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
-- Each slot: { day_of_week: 0-6, time: "HH:mm" }
```

#### New table: `calendar_events` (optional, future)
```sql
CREATE TABLE social_auth.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL,  -- 'reminder', 'deadline', 'note'
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  color TEXT,                -- user-chosen color
  created_at TIMESTAMPTZ DEFAULT now()
);
```
*This is a stretch goal. Focus on posts first.*

#### `posts` table additions
```sql
ALTER TABLE social_auth.posts
  ADD COLUMN template_id UUID REFERENCES social_auth.schedule_templates(id),
  ADD COLUMN recurrence_rule TEXT;  -- iCal RRULE string, e.g. "FREQ=WEEKLY;BYDAY=TU;BYHOUR=9"
```

### 2B. New API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/v2/posts` | POST | Already exists — extend to accept `isDraft: true` |
| `/api/v2/posts/[id]/reschedule` | PATCH | Lightweight reschedule (just `scheduled_at` + `timezone`) |
| `/api/v2/posts/bulk` | POST | Bulk operations: reschedule, delete, duplicate |
| `/api/schedule-templates` | GET/POST | CRUD for schedule templates |
| `/api/schedule-templates/[id]` | PUT/DELETE | Update/delete template |
| `/api/schedule-templates/[id]/fill` | POST | Auto-create draft posts for next N slots |

### 2C. New/Modified Components

```
src/components/calendar/
  calendar-content.tsx        -- MODIFY: add create button, inline edit, drag handlers
  calendar-day-cell.tsx       -- MODIFY: add drop target, click-to-create, platform color bands
  calendar-grid.tsx           -- MODIFY: add drag-and-drop context
  calendar-week-view.tsx      -- MODIFY: time-slot grid for granular scheduling
  calendar-day-view.tsx       -- MODIFY: hour-by-hour timeline with drag support

  quick-create-popover.tsx    -- NEW: click day → popover to create draft/scheduled post
  inline-post-editor.tsx      -- NEW: edit post details without leaving calendar
  reschedule-toast.tsx        -- NEW: "Post moved to Tue 9:00 AM — Undo" toast
  bulk-action-bar.tsx         -- NEW: floating bar when multiple posts selected
  schedule-template-panel.tsx -- NEW: sidebar panel for managing schedule templates
  slot-indicator.tsx          -- NEW: shows template time slots on calendar as empty markers
  platform-color-legend.tsx   -- NEW: color legend for platform visual coding
  calendar-sidebar.tsx        -- NEW: collapsible sidebar with filters + template slots
```

---

## 3. UX Design

### 3A. Core Interaction: Click-to-Create

**Current flow:** Dashboard → Project → Render → Post page → Schedule → Calendar shows it.
**Proposed flow:** Calendar → Click day/timeslot → Quick Create popover → Done.

**Quick Create Popover** appears when clicking an empty area on any day cell or timeslot:
- Pre-filled with clicked date/time
- Minimal form: caption textarea, media upload/URL, account multi-select, schedule time
- "Create Draft" (saves but doesn't schedule) and "Schedule" buttons
- Platform options accordion (collapsed by default)
- Closes on save, post appears immediately on calendar via optimistic update

### 3B. Core Interaction: Drag-to-Reschedule

Using a lightweight drag library (e.g., `@dnd-kit/core` — already tree-shakeable, works with React 19):

- **Month view:** Drag a PostPill from one day cell to another. Shows ghost pill while dragging. On drop, calls `PATCH /api/v2/posts/[id]/reschedule` with new date (keeps original time).
- **Week view:** Drag between day columns. Same behavior.
- **Day view:** Drag vertically between hour slots to change time precisely.
- **Toast with Undo:** Every reschedule shows a toast: "Moved to Wed Mar 11, 9:00 AM — Undo". Undo calls the same PATCH with the original `scheduled_at`.

### 3C. Inline Editing (No More New Tab)

Replace the current "Edit Post" button (which opens `/post/edit/[uuid]` in new tab) with an **inline editor dialog**:

- Opens as a larger dialog/sheet within the calendar page
- Full editing: caption, accounts, platform options, schedule time
- Save → optimistic update → SWR revalidation
- This keeps the user in context. The `/post/edit/[uuid]` page remains for deep linking.

### 3D. Visual Density Solution for 26 Accounts

The core problem: 26 accounts across 5 platforms creates visual noise. Solutions:

1. **Platform color bands** — Each PostPill gets a left-border color by platform:
   - Instagram: gradient pink/purple (`#E1306C`)
   - Facebook: blue (`#1877F2`)
   - TikTok: black/cyan (`#00F2EA`)
   - YouTube: red (`#FF0000`)
   - Twitter/X: black (`#000000`)

2. **Account group view mode** — Toggle between "All accounts" and "By group" view. In group mode, calendar shows one swimlane per group (useful for managing client accounts or language-based account clusters).

3. **Platform-only pills in month view** — In month view (most dense), show only platform icons + time. Full caption only on hover/click.

4. **Compact density toggle** — Let users switch between "comfortable" (current) and "compact" (smaller pills, more posts visible per cell).

### 3E. Bulk Operations

**Selection mode:** Click the checkbox icon in the toolbar to enter selection mode. Each PostPill gains a checkbox. Selected posts get a highlight ring.

**Bulk action bar** (floating at bottom, appears when 1+ selected):
- "Reschedule All" → date/time picker
- "Delete All" → confirmation
- "Duplicate" → creates copies as drafts
- "Change Accounts" → add/remove accounts from selection
- "Tag" → apply/remove tags
- Count indicator: "3 posts selected"

### 3F. Schedule Templates (Recurring Schedules)

**Template creation panel** (accessible from calendar sidebar):
- Name the template: "Weekday Posts"
- Define slots: visual week grid where you click to add time slots
- Assign accounts to the template
- Set timezone

**Calendar visualization:**
- Empty template slots appear as **dashed-border placeholder pills** on the calendar
- Click a placeholder → Quick Create popover pre-filled with that slot's time and accounts
- "Auto-fill" button generates draft posts for all unfilled slots in the visible range

**No auto-publishing from templates** — templates just create drafts/scheduled posts. The existing cron job handles the rest.

### 3G. Calendar Sidebar

Replace the current inline filter bar with a **collapsible left sidebar**:

```
+------+----------------------------------+
| Side |          Calendar Grid           |
| bar  |                                  |
|      |                                  |
| [Filters]                               |
| - Platform checkboxes                   |
| - Group checkboxes                      |
| - Tag checkboxes                        |
|                                         |
| [Templates]                             |
| - Active templates                      |
| - "New Template" button                 |
|                                         |
| [Quick Stats]                           |
| - Posts this week: 14                   |
| - Scheduled: 8                          |
| - Failed: 1 (⚠ click to view)          |
+------+----------------------------------+
```

Collapsible via a toggle button. State persisted in localStorage.

### 3H. Timezone Handling

Current state is solid — timezone selector exists, `Intl.DateTimeFormat` used correctly. Improvements:

1. **Per-post timezone display** — In the post detail dialog, show "Scheduled for 9:00 AM EST (2:00 PM UTC)" to avoid confusion.
2. **Timezone mismatch warning** — When calendar TZ differs from a post's TZ, show a small icon on the pill.
3. **Default timezone** — Save user's preferred timezone in localStorage. Pre-select on page load instead of "Local time".
4. **Template-level timezone** — Templates already include timezone in the schema.

---

## 4. Implementation Plan

### Phase 1: Calendar-Native Post Creation (Complexity: Medium)
*Makes the calendar actually useful instead of read-only.*

1. **Quick Create Popover** (`quick-create-popover.tsx`)
   - Click handler on empty day cell areas and hour slots
   - Minimal post form with account selector reuse
   - Calls existing POST `/api/v2/posts` with `isDraft` or `scheduled`
   - Optimistic SWR update
   - Files: new component + modify `calendar-day-cell.tsx`, `calendar-week-view.tsx`, `calendar-day-view.tsx`

2. **Inline Post Editor** (`inline-post-editor.tsx`)
   - Sheet/dialog that replaces "open in new tab" behavior
   - Reuses form logic from `edit-post-page.tsx` but as a dialog
   - Modify `post-detail-dialog.tsx` to embed the editor
   - Files: new component + modify `post-detail-dialog.tsx`

3. **Lightweight Reschedule API** (`/api/v2/posts/[id]/reschedule`)
   - PATCH with `{ scheduled_at, timezone }` — minimal payload
   - File: `src/app/api/v2/posts/[id]/reschedule/route.ts`

### Phase 2: Drag-and-Drop Rescheduling (Complexity: Medium-High)
*The flagship UX improvement.*

4. **Install `@dnd-kit/core`** — zero-config, composable, React 19 compatible
5. **DnD context wrapper** — wrap calendar views in `DndContext`
6. **Draggable PostPills** — make `PostPill` a draggable item (only for `scheduled` status)
7. **Droppable day cells / time slots** — day cells in month/week, hour slots in day view
8. **Reschedule on drop** — call PATCH reschedule API, optimistic update, undo toast
9. **Undo toast** (`reschedule-toast.tsx`) — Sonner toast with "Undo" action that reverts

### Phase 3: Visual Polish for Scale (Complexity: Low-Medium)
*Makes 26 accounts manageable.*

10. **Platform color bands** — Add left-border color to PostPill based on platform
11. **Compact density toggle** — Button in toolbar to switch pill sizes
12. **Platform color legend** (`platform-color-legend.tsx`) — Small legend in sidebar/toolbar
13. **Account avatars in pills** — Show account profile images instead of generic platform icons (profile images already exist in the data)

### Phase 4: Bulk Operations (Complexity: Medium)
*Power-user feature.*

14. **Selection mode toggle** — Checkbox icon in toolbar header
15. **PostPill checkbox overlay** — Checkbox appears on each pill in selection mode
16. **Bulk action bar** (`bulk-action-bar.tsx`) — Floating bar with reschedule/delete/duplicate/tag actions
17. **Bulk API** (`/api/v2/posts/bulk`) — Accepts array of post IDs + operation

### Phase 5: Schedule Templates (Complexity: Medium-High)
*Recurring schedule support.*

18. **Database migration** — `schedule_templates` table + `posts.template_id` column
19. **Template CRUD API** — `/api/schedule-templates` routes
20. **Template panel** (`schedule-template-panel.tsx`) — Week grid slot editor
21. **Slot indicators** (`slot-indicator.tsx`) — Dashed placeholder pills on calendar
22. **Auto-fill** — "Fill slots" creates draft posts for empty template slots

### Phase 6: Calendar Sidebar & Polish (Complexity: Low)
*Layout improvement.*

23. **Calendar sidebar** (`calendar-sidebar.tsx`) — Move filters + add templates + quick stats
24. **Timezone improvements** — Dual-timezone display, mismatch icon, saved default
25. **Empty state** — When no posts exist, show onboarding: "Schedule your first post" with a prominent CTA

---

## 5. Trade-offs

### Chosen: Quick Create Popover over Full Post Page redirect
**Why:** The existing flow (Dashboard → Project → Render → Post) makes sense for video-first publishing. But many social posts are simple (image + caption) and don't need a video project. A quick-create popover makes the calendar a first-class scheduling tool, not just a viewer.
**Trade-off:** The popover can't support all platform options in a compact form. Advanced options will still require the full post page or the inline editor.

### Chosen: `@dnd-kit` over HTML5 drag-and-drop or `react-beautiful-dnd`
**Why:** `react-beautiful-dnd` is archived and doesn't support React 18+. HTML5 DnD API is painful for custom visuals. `@dnd-kit` is actively maintained, tree-shakeable, works with React 19, and has built-in keyboard accessibility.
**Trade-off:** Adds ~15KB to the bundle. Worth it for the interaction quality.

### Chosen: Inline editor dialog over dedicated edit page
**Why:** Opening `/post/edit/[uuid]` in a new tab breaks calendar flow. Users lose context of what's around the post they're editing. An inline dialog keeps the calendar visible.
**Trade-off:** The inline dialog will be somewhat cramped for posts with many platform-specific options. We keep the full edit page as a fallback link ("Open full editor").

### Chosen: Schedule templates over iCal RRULE recurrence
**Why:** RRULE is powerful but complex. Most social media managers think in "I post at these times each week", not "FREQ=WEEKLY;BYDAY=TU,TH;BYHOUR=9,15". Templates are more intuitive and map directly to the visual calendar.
**Trade-off:** Can't express complex recurrence patterns (e.g., "every 3rd Monday"). This is acceptable — social media scheduling is inherently week-based.

### Chosen: Platform color bands over per-account colors
**Why:** 26 unique account colors would be indistinguishable. 5 platform colors are memorable and meaningful. Users can still filter by account/group to isolate specific accounts.
**Trade-off:** Two Instagram accounts on the same day look identical in the pill. The account name in the pill and the filter system mitigate this.

### Chosen: Phase 1 first (creation) over Phase 2 first (DnD)
**Why:** The calendar currently can't create posts — it's read-only. DnD is flashier but useless if there's nothing to drag. Making the calendar actionable is the priority.
**Trade-off:** DnD is the "wow" feature users would notice first. But a calendar that can't create content is fundamentally incomplete.

### Deferred: `calendar_events` table
**Why:** Generic calendar events (reminders, deadlines, notes) are useful but secondary to the core social scheduling use case. The posts system should be solid before adding a second event type.
**When to revisit:** After Phase 3, when the calendar is polished enough to handle mixed content types.

---

## Key File Paths Reference

| Purpose | Path |
|---------|------|
| Calendar page | `src/app/calendar/page.tsx` |
| Calendar main component | `src/components/calendar/calendar-content.tsx` |
| Day cell (month view) | `src/components/calendar/calendar-day-cell.tsx` |
| Month grid | `src/components/calendar/calendar-grid.tsx` |
| Week view | `src/components/calendar/calendar-week-view.tsx` |
| Day view | `src/components/calendar/calendar-day-view.tsx` |
| Filter bar | `src/components/calendar/calendar-filter-bar.tsx` |
| Post detail dialog | `src/components/calendar/post-detail-dialog.tsx` |
| Post creation page | `src/components/post/post-page.tsx` |
| Post edit page | `src/components/post/edit-post-page.tsx` |
| Schedule picker | `src/components/post/schedule-picker.tsx` |
| Account selector | `src/components/post/account-selector.tsx` |
| Cron publisher | `src/app/api/cron/publish-scheduled/route.ts` |
| Posts API (create) | `src/app/api/v2/posts/route.ts` |
| Posts API (CRUD) | `src/app/api/v2/posts/[id]/route.ts` |
| Posts API (list) | `src/app/api/v2/posts/list/route.ts` |
| Posts API (publish) | `src/app/api/v2/posts/[id]/publish/route.ts` |
| Schedule validation | `src/lib/schedule-validation.ts` |
| Social types | `src/types/social.ts` |
| Octupost types | `src/lib/octupost/types.ts` |
| DB migration | `supabase/migrations/20260305000000_create_social_posts.sql` |
