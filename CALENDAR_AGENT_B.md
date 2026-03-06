# Calendar & Scheduling — Agent B (Backend-First)

You are Agent B. Another agent (Agent A) is independently investigating the same problem. You'll each write a plan, then review each other's.

## Context
- App: AI video editor + social media publisher at `~/Development/ai-video-editor/editor`
- Stack: Next.js 16, Supabase, TypeScript, Tailwind
- DB schemas: `studio` (video tables), `social_auth` (social/posting), `public` (shared)
- Calendar page: `src/app/calendar/page.tsx` or similar
- 26 social accounts across IG, FB, TikTok, YouTube, Twitter
- Cron job exists at `src/app/api/cron/publish-scheduled/route.ts`
- Posts table: `social_auth.posts` (currently empty — posts were published via CLI, not through the app)
- Post scheduling fields: `schedule_type` (now/scheduled), `scheduled_at`, `timezone`, `status`
- Octupost API at `https://app.octupost.com/api` handles token management (key: `jorsby-social-auth-2026`)
- Platform publishing functions in `src/lib/social/providers/` (instagram.ts, facebook.ts, tiktok.ts, youtube.ts, twitter.ts)

## Your Mission

Investigate the Calendar page and scheduling system. Then write a comprehensive plan for making the calendar a **real, useful scheduling hub** — not just for social posts, but potentially for any scheduled activity.

### Investigate
1. How does the cron job work? What triggers it? How reliable is it?
2. What's the DB schema for scheduling? Is it sufficient?
3. How does the publishing pipeline work? (post created → scheduled → cron picks up → publishes)
4. What happens on failure? Retry logic? Error tracking?
5. What's missing from the backend to support a real scheduling system?

### Design a Plan
Think about:
- Scheduling reliability — how to guarantee posts publish on time
- Queue management — what if 10 posts are scheduled for the same minute?
- Retry logic — what if Instagram API is down? Rate limits?
- Status tracking — draft → scheduled → publishing → published → failed
- Multi-account publishing — one post → 6 accounts, some succeed, some fail
- Timezone handling — user in Toronto, posting to global accounts
- Recurring schedules — DB model for "every Tuesday at 9am to these 4 accounts"
- Cron architecture — Vercel cron? Supabase pg_cron? External scheduler?
- Webhook/callback handling — platform confirmation that post went live
- Analytics integration — track what was posted when, engagement later

### Your Perspective
You're the **backend-first thinker**. Prioritize:
- Data integrity and reliability
- Scalable scheduling architecture
- Error handling and recovery
- The system that RUNS behind the scenes

### Output
Write your plan to `CALENDAR_PLAN_B.md` in the project root. Include:
1. **Current State Analysis** — what exists, what's broken
2. **Proposed Architecture** — data model, queue design, cron strategy
3. **Reliability Design** — retry logic, failure modes, monitoring
4. **Implementation Plan** — ordered steps, estimated complexity
5. **Trade-offs** — what you're choosing and why

Be specific. Include SQL schemas, API route signatures, cron configurations. This isn't a vague proposal — it's an engineering plan.

After writing your plan, STOP. Don't implement anything yet.

When done writing your plan, run: openclaw system event --text "Agent B: Calendar plan written to CALENDAR_PLAN_B.md" --mode now
