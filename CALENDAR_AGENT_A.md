# Calendar & Scheduling — Agent A (Frontend-First)

You are Agent A. Another agent (Agent B) is independently investigating the same problem. You'll each write a plan, then review each other's.

## Context
- App: AI video editor + social media publisher at `~/Development/ai-video-editor/editor`
- Stack: Next.js 16, Supabase, TypeScript, Tailwind
- DB schemas: `studio` (video tables), `social_auth` (social/posting), `public` (shared)
- Calendar page: `src/app/calendar/page.tsx` or similar
- 26 social accounts across IG, FB, TikTok, YouTube, Twitter
- Cron job exists at `src/app/api/cron/publish-scheduled/route.ts`
- Posts table: `social_auth.posts` (currently empty — posts were published via CLI, not through the app)
- Post scheduling fields: `schedule_type` (now/scheduled), `scheduled_at`, `timezone`, `status`

## Your Mission

Investigate the Calendar page and scheduling system. Then write a comprehensive plan for making the calendar a **real, useful scheduling hub** — not just for social posts, but potentially for any scheduled activity.

### Investigate
1. How does the current calendar work? What data does it show?
2. What's the current post scheduling flow? (Create post → schedule → cron publishes)
3. What cron jobs exist? How do they trigger?
4. What does the calendar look like right now? (empty? broken? functional?)

### Design a Plan
Think about:
- What should appear on the calendar? (scheduled posts, published posts, draft deadlines, render completions?)
- How should the scheduling UX work? (drag-to-schedule? click-to-create? bulk scheduling?)
- How do we make this work for 26 accounts across 5 platforms?
- What's the optimal data model for a scheduling system?
- How should timezone handling work?
- What about recurring schedules? (e.g., "post every Tuesday at 9am")
- How does the cron job need to evolve?
- What calendar view options matter? (day/week/month, filters by platform/account/group)

### Your Perspective
You're the **frontend-first thinker**. Prioritize:
- User experience and interaction design
- Visual clarity for managing 26 accounts
- Drag-and-drop, quick actions, bulk operations
- What the user SEES and DOES

### Output
Write your plan to `CALENDAR_PLAN_A.md` in the project root. Include:
1. **Current State Analysis** — what exists, what's broken
2. **Proposed Architecture** — data model, API routes, components
3. **UX Design** — how the user interacts with scheduling
4. **Implementation Plan** — ordered steps, estimated complexity
5. **Trade-offs** — what you're choosing and why

Be specific. Include file paths, component names, data structures. This isn't a vague proposal — it's an engineering plan.

After writing your plan, STOP. Don't implement anything yet.

When done writing your plan, run: openclaw system event --text "Agent A: Calendar plan written to CALENDAR_PLAN_A.md" --mode now
