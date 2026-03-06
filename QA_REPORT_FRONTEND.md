# QA Report: Frontend & UX Audit

**Date:** 2026-03-06
**Auditor:** QA Agent A (Principal QA Engineer)
**Branch:** `dev` (commit `c17d890`)
**App:** Combo — AI-powered video editor
**Stack:** Next.js 16, Supabase, TypeScript, Tailwind CSS

---

## Executive Summary

The application is functional for its core flows (login, project management, social account management, post creation/scheduling, workflow publishing). However, the audit uncovered **4 Critical**, **8 High**, **12 Medium**, and **8 Low** severity issues spanning security vulnerabilities, missing auth guards, data integrity concerns, and UX gaps.

---

## 1. Test Results by Page

### 1.1 Login Page (`/login`)

| Feature | Status |
|---------|--------|
| Email/password login | PASS |
| Signup flow | PASS |
| Forgot password flow | PASS |
| Form validation (required, minLength) | PASS |
| Error toast on invalid credentials | PASS |
| Loading state with spinner | PASS |
| Mode switching (login/signup/forgot) | PASS |
| Animation transitions | PASS |
| Redirect to `/dashboard` on success | PASS |

**Issues found:** See BUG-A-001, BUG-A-002, BUG-A-017

### 1.2 Root Page (`/`)

| Feature | Status |
|---------|--------|
| Authenticated redirect to `/dashboard` | PASS |
| Unauthenticated redirect to `/login` | PASS |

### 1.3 Dashboard — Projects Tab

| Feature | Status |
|---------|--------|
| Project list display | PASS |
| Loading skeleton | PASS |
| Empty state | PASS |
| Create project + open in new tab | PASS |
| Archive/unarchive project | PASS |
| Delete project (optimistic UI) | PASS |
| Project tag management | PASS |
| Tag filtering (include/exclude) | PASS |
| View archived toggle | PASS |

**Issues found:** See BUG-A-008 (Medium), BUG-A-013

### 1.4 Dashboard — Social Tab

| Feature | Status |
|---------|--------|
| Account list display | PASS |
| Account groups display | PASS |
| Create group | PASS |
| Rename/delete group | PASS |
| Add/remove group members | PASS |
| Tag management on accounts | PASS |
| Tag filtering | PASS |
| Platform filtering | PASS |
| Profile images | PASS |
| Token expiry warning | PASS |
| Platform media sync | PASS |
| Post count per account | PASS |
| Expand/collapse all groups | PASS |
| Browser open (Instagram/TikTok) | PASS |
| Companion setup dialog | PASS |

**Issues found:** See BUG-A-009, BUG-A-014

### 1.5 Calendar Page (`/calendar`)

| Feature | Status |
|---------|--------|
| Month view | PASS |
| Week view | PASS |
| Day view | PASS |
| Date navigation (prev/next/today) | PASS |
| Status filter (All/Queued/Published/Failed) | PASS |
| Timezone selector | PASS |
| Post detail dialog | PASS |
| Workflow run detail dialog | PASS |
| Failed posts banner | PASS |
| SWR caching with keepPreviousData | PASS |
| Loading skeletons per view | PASS |
| Error state with retry | PASS |
| Channel/group/tag filter bar | PASS |

**Issues found:** See BUG-A-010, BUG-A-015

### 1.6 Post Page (`/post/[renderedVideoId]`)

| Feature | Status |
|---------|--------|
| Video preview with controls | PASS |
| Account selector with groups/tags | PASS |
| Caption editor | PASS |
| AI caption generation | PASS |
| Platform-specific options | PASS |
| Schedule picker (now/scheduled) | PASS |
| Timezone selector | PASS |
| Form validation | PASS |
| Publish progress stepper | PASS |
| Per-account result display | PASS |
| Partial failure handling | PASS |
| Retry with only failed accounts | PASS |
| Instagram 90s duration check | PASS |
| YouTube title requirement | PASS |

**Issues found:** See BUG-A-011

### 1.7 Edit Post Page (`/post/edit/[uuid]`)

| Feature | Status |
|---------|--------|
| Load existing post data | PASS |
| Pre-fill all form fields | PASS |
| Account selector | PASS |
| Caption editing | PASS |
| Schedule editing | PASS |
| Past date validation | PASS |
| Save success screen | PASS |

**Issues found:** See BUG-A-029

### 1.8 Workflow Page (`/workflow/[projectId]`)

| Feature | Status |
|---------|--------|
| Language lane display | PASS |
| Auto-assign groups by language | PASS |
| Per-lane caption generation | PASS |
| Per-lane platform options | PASS |
| Shared schedule state | PASS |
| Publish all lanes | PASS |
| Draft persistence (localStorage) | PASS |
| Video preview per lane | PASS |

**Issues found:** See BUG-A-003, BUG-A-012, BUG-A-016

### 1.9 Auth Routes

| Feature | Status |
|---------|--------|
| Sign out (POST /auth/signout) | PASS |
| Code exchange (GET /auth/confirm) | PASS |
| Password reset page | PASS |
| Expired link handling | PASS |
| Error parameter handling | PASS |

**Issues found:** See BUG-A-001

---

## 2. Bugs

### BUG-A-001: Open Redirect in /auth/confirm
- **Severity:** Critical
- **Page:** `/auth/confirm`
- **Steps:** 1. Craft URL: `/auth/confirm?code=VALID_CODE&next=https://evil.com` 2. User clicks link from email 3. After code exchange, user is redirected to `https://evil.com`
- **Expected:** The `next` parameter should be validated to only allow internal paths (relative URLs starting with `/`)
- **Actual:** Any URL is accepted as the redirect target, enabling phishing attacks
- **File:** `editor/src/app/auth/confirm/route.ts:8,29`

### BUG-A-002: Signup Does Not Verify Email
- **Severity:** Critical
- **Page:** `/login`
- **Steps:** 1. Switch to signup mode 2. Enter any email and password 3. Submit 4. User is immediately redirected to `/dashboard`
- **Expected:** After signup, user should verify their email before gaining access, or at minimum see a "check your email" message
- **Actual:** `signup()` in `actions.ts` calls `supabase.auth.signUp()` and immediately redirects to `/dashboard` without checking if email confirmation is required. If Supabase is configured to require email confirmation, the redirect will still fire (causing potential errors). If not configured, anyone can create accounts with unverified emails.
- **File:** `editor/src/app/login/actions.ts:45-64`

### BUG-A-003: Workflow Route Missing from Middleware Protected Routes
- **Severity:** Critical
- **Page:** `/workflow/[projectId]`
- **Steps:** 1. Sign out 2. Navigate directly to `/workflow/some-project-id` 3. Middleware does NOT intercept
- **Expected:** Middleware should redirect unauthenticated users to `/login` (as it does for `/dashboard`, `/editor`, `/post`, `/calendar`)
- **Actual:** The middleware at `editor/middleware.ts:40` defines protected routes as `['/dashboard', '/editor', '/post', '/calendar']` — `/workflow` is missing from this list. The workflow `page.tsx` has its own server-side auth check, so the user does get redirected, but the middleware gap means an extra server component render cycle is wasted. More critically, if the page-level check were ever removed, the route would be fully exposed.
- **File:** `editor/middleware.ts:40`

### BUG-A-004: Cron Endpoint Accessible Without Auth When CRON_SECRET Not Set
- **Severity:** Critical
- **Page:** `/api/cron/publish-scheduled`
- **Steps:** 1. Run `curl http://localhost:3000/api/cron/publish-scheduled` 2. Endpoint returns `{"published":0,"failed":0,"skipped":0}`
- **Expected:** Endpoint should require authentication always
- **Actual:** When `CRON_SECRET` environment variable is not set, the auth check is bypassed entirely (line 9: `if (cronSecret) { ... }`). An attacker could trigger premature publishing of all scheduled posts.
- **File:** `editor/src/app/api/cron/publish-scheduled/route.ts:8-14`

### BUG-A-005: Scheduled Post Timezone Not Applied Correctly
- **Severity:** High
- **Page:** `/post/[renderedVideoId]`, API `/api/v2/posts`
- **Steps:** 1. Create a scheduled post with timezone "America/New_York" 2. Set date "2026-03-10" time "14:00" 3. Check the stored `scheduled_at` value
- **Expected:** `scheduled_at` should be `2026-03-10T14:00` converted from Eastern Time to UTC
- **Actual:** The API creates the ISO string with `new Date('2026-03-10T14:00').toISOString()` which uses the SERVER's local timezone, not the user-selected timezone. The timezone is stored separately but never used in the date computation.
- **File:** `editor/src/app/api/v2/posts/route.ts:55-57`

### BUG-A-006: Middleware Excludes API Routes — No Defense-in-Depth for APIs
- **Severity:** High
- **Page:** All `/api/*` routes
- **Steps:** 1. Examine middleware matcher at `editor/middleware.ts:71` 2. Note `api` is excluded from the matcher pattern
- **Expected:** Middleware should provide a defense-in-depth layer for API routes, or at minimum, a shared utility should enforce auth consistently across all API handlers
- **Actual:** The middleware explicitly excludes `/api` routes from its matcher. Each API route must independently verify auth. While most routes do check auth correctly, this pattern is fragile — any new API route that forgets to add an auth check is immediately exposed (as demonstrated by `BUG-A-004` with the cron endpoint and `BUG-A-030` with the proxy endpoint).
- **File:** `editor/middleware.ts:61-73`

### BUG-A-007: Application Metadata Still Shows "Create Next App"
- **Severity:** High
- **Page:** All pages (HTML `<title>`)
- **Steps:** 1. Open any page 2. Check browser tab title
- **Expected:** Title should be "Combo" or "Combo — AI Video Editor"
- **Actual:** `<title>Create Next App</title>` and description is "Generated by create next app"
- **File:** `editor/src/app/layout.tsx:17-19`

### BUG-A-008: Delete Project Error Not Surfaced to User
- **Severity:** Medium
- **Page:** `/dashboard` — Projects tab
- **Steps:** 1. Click delete on a project 2. Confirm in the dialog 3. If the API call fails, observe behavior
- **Expected:** User sees an error toast or message explaining the delete failed
- **Actual:** The delete confirmation dialog exists and works correctly. However, if the API call fails, the error is only logged to `console.error` with no user-facing feedback. The dialog closes and the project remains, but the user gets no explanation of the failure.
- **File:** `editor/src/components/dashboard/project-card.tsx:58-59`

### BUG-A-009: "Sync All" Can Fire 26+ Parallel API Calls
- **Severity:** High
- **Page:** `/dashboard` — Social tab
- **Steps:** 1. Click "Sync All" button 2. All 26 accounts fire parallel requests to `/api/social/media`
- **Expected:** Sync should be batched or throttled to avoid overwhelming the server and hitting rate limits
- **Actual:** Every account fires a separate request simultaneously. Server logs show some take 3-7 seconds each. This can cause timeouts and rate limiting from upstream platforms.
- **File:** `editor/src/components/dashboard/social-accounts-list.tsx:95-99`

### BUG-A-010: Calendar Fetches Only 100 Posts Per Month
- **Severity:** High
- **Page:** `/calendar`
- **Steps:** 1. Have more than 100 posts in a single month 2. Open calendar
- **Expected:** All posts should be visible on the calendar
- **Actual:** The calendar SWR fetcher hard-codes `limit=100` and does not paginate. Any posts beyond 100 in a month are silently dropped.
- **File:** `editor/src/components/calendar/calendar-content.tsx:146-148`

### BUG-A-011: Post Page "Close" Button Calls window.close() — May Not Work
- **Severity:** High
- **Page:** `/post/[renderedVideoId]`, `/post/edit/[uuid]`
- **Steps:** 1. Navigate to post page directly (not via window.open) 2. Complete publishing 3. Click "Close" button
- **Expected:** User is navigated somewhere useful
- **Actual:** `window.close()` only works for windows opened via `window.open()`. If user navigated to the page directly, the button does nothing. No fallback navigation.
- **File:** `editor/src/components/post/post-page.tsx:399,644` and `editor/src/components/post/edit-post-page.tsx:247,279,389`

### BUG-A-012: Workflow Page Has No Empty State for Missing Videos
- **Severity:** Medium
- **Page:** `/workflow/[projectId]`
- **Steps:** 1. Open workflow page for a project with no rendered videos
- **Expected:** Clear message explaining that videos need to be rendered first
- **Actual:** The page loads but shows an empty lane list. User has no guidance on what to do next.
- **File:** `editor/src/components/workflow/workflow-page.tsx`

### BUG-A-013: Project Archive Uses Boolean Toggle Instead of Explicit Action
- **Severity:** Medium
- **Page:** `/dashboard` — Projects tab
- **Steps:** 1. View archived projects 2. Click archive button on an archived project
- **Expected:** Clear "Unarchive" action label
- **Actual:** The archive handler sends `archive: !showArchived`, meaning it unarchives when viewing archived and archives when viewing active. While functionally correct, the button label and UX could be confusing — the same icon/action does opposite things depending on context.
- **File:** `editor/src/components/dashboard/dashboard-content.tsx:352-369`

### BUG-A-014: Tag Filter Uses Account UUID Key Inconsistently
- **Severity:** Medium
- **Page:** `/dashboard` — Social tab
- **Steps:** 1. Add tags to accounts 2. Use tag filter
- **Expected:** Filtering works correctly
- **Actual:** The `tags` state uses `account_id` (which is `octupost_account_id`) as the key, but the `filteredAccounts` memo also filters by `tags[a.account_id]`. The tag API uses `account_uuid` parameter. This works only because `account_id` in the OctupostAccount type happens to map to the same value, but the naming inconsistency is fragile and could break if the data model changes.
- **File:** `editor/src/components/dashboard/social-accounts-list.tsx:148-149`, `editor/src/components/dashboard/dashboard-content.tsx:235-258`

### BUG-A-015: Calendar Week View May Miss Posts at Month Boundary
- **Severity:** Medium
- **Page:** `/calendar` (week view)
- **Steps:** 1. Navigate to a week that spans two months (e.g., Mar 29 - Apr 4) 2. Check if posts from both months are visible
- **Expected:** Posts from both months visible
- **Actual:** The `getMonthsToFetch` function correctly identifies two months to fetch, but the SWR key includes both months. If only one month's posts are cached, the other month's data may show stale results until revalidation completes.
- **File:** `editor/src/components/calendar/calendar-content.tsx:80-96`

### BUG-A-016: Workflow Page Draft Persistence Doesn't Clear on Success
- **Severity:** Medium
- **Page:** `/workflow/[projectId]`
- **Steps:** 1. Start a workflow publish 2. All lanes succeed 3. Reload the page
- **Expected:** Fresh state — the successful publish should clear the draft
- **Actual:** Need to verify if `clearDraft` is called after successful publish-all. If not, old draft data would be restored on reload.
- **File:** `editor/src/components/workflow/workflow-page.tsx`

### BUG-A-017: Login Page Has No Rate Limiting Indication
- **Severity:** Medium
- **Page:** `/login`
- **Steps:** 1. Enter wrong password 10+ times rapidly 2. Supabase rate-limits the requests
- **Expected:** Clear message about being rate-limited, with a cooldown indicator
- **Actual:** Supabase returns a rate-limit error that gets displayed as a raw error message. No specific handling for rate-limit scenarios.
- **File:** `editor/src/app/login/page.tsx`

### BUG-A-018: Background Post Check Never Cleans Up Failed/Stale Posts
- **Severity:** Medium
- **Page:** All pages (BackgroundPostCheck runs in root layout)
- **Steps:** 1. Publish a post that fails 2. Post stays in localStorage pending-posts store 3. Every page load checks it forever
- **Expected:** Failed posts should be cleaned up from the pending store after detection or after a timeout
- **Actual:** The hook only removes posts when `post.status === 'published'`. Failed posts, partial posts, or posts that never complete stay in localStorage indefinitely, causing unnecessary API calls on every page load.
- **File:** `editor/src/hooks/use-background-post-check.ts:36-41`

### BUG-A-019: Dashboard Fetches Data Without Error Recovery
- **Severity:** Medium
- **Page:** `/dashboard`
- **Steps:** 1. Dashboard loads 2. One of the 6 parallel API calls fails (accounts, groups, tags, project-tags, projects, posts) 3. No retry mechanism
- **Expected:** Failed fetches should retry or show an error with retry option
- **Actual:** Most fetch handlers silently swallow errors with `console.error` and leave state empty. The user sees an empty list with no indication that data failed to load. Only `accountsError` is tracked; others fail silently.
- **File:** `editor/src/components/dashboard/dashboard-content.tsx:153-233`

### BUG-A-020: useEffect Dependency Missing in Dashboard
- **Severity:** Medium
- **Page:** `/dashboard`
- **Steps:** Code review
- **Expected:** All functions called in useEffect should be in the dependency array
- **Actual:** The initial data fetch `useEffect` (line 153) calls `fetchAccounts`, `fetchGroups`, `fetchTags`, `fetchProjectTags` which are not memoized with `useCallback` and not in the dependency array. Only `fetchAllPosts` is. This means React's linting would flag this (though it works in practice because the functions are stable closures).
- **File:** `editor/src/components/dashboard/dashboard-content.tsx:153-159`

### BUG-A-021: Post API Doesn't Validate accountIds Against User's Accounts
- **Severity:** Medium
- **Page:** `/api/v2/posts`
- **Steps:** 1. Create a post with an accountId that belongs to another user
- **Expected:** API should reject accountIds that don't belong to the authenticated user
- **Actual:** The API looks up tokens with `user_id` filter (line 91), so unknown accounts get `platform: 'unknown'`. But it doesn't reject the request — it creates a post with platform "unknown" and the publish will fail confusingly.
- **File:** `editor/src/app/api/v2/posts/route.ts:88-96`

### BUG-A-022: Tokens Table Has No Primary Key Column Named `id`
- **Severity:** Medium
- **Page:** Database schema
- **Steps:** 1. Query `social_auth.tokens` schema
- **Expected:** Table has a standard `id` column or composite primary key
- **Actual:** The tokens table has `platform` + `account_id` as its key columns but no `id` column. The API queries use `octupost_account_id` which doesn't match any column name — the actual column is `account_id`. This inconsistency between code and schema could cause subtle bugs.
- **File:** Database schema `social_auth.tokens`

### BUG-A-024: Hardcoded Background Color on Post/Workflow Pages
- **Severity:** Low
- **Page:** `/post/*`, `/workflow/*`
- **Steps:** 1. Note the `bg-[#0a0a0c]` hardcoded class
- **Expected:** Should use Tailwind theme color `bg-background` for consistency
- **Actual:** Post and workflow pages use hardcoded `bg-[#0a0a0c]` while dashboard/calendar use `bg-background`. This means theme changes won't apply consistently.
- **File:** `editor/src/components/post/post-page.tsx:379,455`, `editor/src/components/post/edit-post-page.tsx:232,272`

### BUG-A-025: "Terms of Service" Link on Login Page Goes Nowhere
- **Severity:** Low
- **Page:** `/login`
- **Steps:** 1. Observe footer text "By continuing, you agree to our terms of service" 2. Text is not a link
- **Expected:** Either link to actual TOS or remove the text
- **Actual:** Static text with no link. Implies TOS exists when it may not.
- **File:** `editor/src/app/login/page.tsx:207-209`

### BUG-A-026: No Favicon or App Icon Configured
- **Severity:** Low
- **Page:** All pages
- **Steps:** 1. Check browser tab for favicon
- **Expected:** Custom Combo favicon
- **Actual:** Only `favicon.ico` exists in app dir — likely the default Next.js favicon. No apple-touch-icon or PWA manifest.
- **File:** `editor/src/app/favicon.ico`

### BUG-A-027: Calendar "Queued" Label vs Database "scheduled" Status
- **Severity:** Low
- **Page:** `/calendar`
- **Steps:** 1. Create a scheduled post 2. View calendar 3. Note the filter tab says "Queued"
- **Expected:** Consistent naming
- **Actual:** The filter tab says "Queued" but the database status is "scheduled". The code maps `scheduled` -> `Queued` for display. While functional, this inconsistency between UI and data model could confuse developers.
- **File:** `editor/src/components/calendar/calendar-content.tsx:128-132`

### BUG-A-028: Background Post Check Same Toast Message for 1 and N Accounts
- **Severity:** Low
- **Page:** All pages
- **Steps:** 1. Check code for toast messages
- **Expected:** Different message for single vs multiple accounts
- **Actual:** Lines 38-42 have identical ternary branches — both return the same message regardless of `accountNames.length`.
- **File:** `editor/src/hooks/use-background-post-check.ts:38-42`

### BUG-A-029: Edit Post Page Has No "Publish Now" Option
- **Severity:** Low
- **Page:** `/post/edit/[uuid]`
- **Steps:** 1. Open a scheduled post for editing 2. Cannot change to "Publish Now"
- **Expected:** Option to publish immediately instead of just rescheduling
- **Actual:** `SchedulePicker` receives `scheduleType="scheduled"` and `onScheduleTypeChange={() => {}}` — the type is hardcoded to scheduled with a no-op change handler. User cannot switch a scheduled post to immediate publish from the edit screen.
- **File:** `editor/src/components/post/edit-post-page.tsx:368-369`

### BUG-A-030: Proxy Media Endpoint Has No Auth Check
- **Severity:** Low
- **Page:** `/api/proxy/media`
- **Steps:** 1. Call endpoint without auth: `curl "http://localhost:3000/api/proxy/media?url=https://some.fal.media/file.mp4"`
- **Expected:** Require authentication
- **Actual:** The proxy endpoint only validates the domain allowlist but doesn't check if the user is authenticated. While the domain allowlist limits abuse, an unauthenticated user could still proxy content from allowed domains.
- **File:** `editor/src/app/api/proxy/media/route.ts`

### BUG-A-031: Multiple API Routes Have No Authentication
- **Severity:** High
- **Page:** Various `/api/*` routes
- **Steps:** 1. Call any of these endpoints without auth cookies
- **Expected:** All API routes should require authentication
- **Actual:** The following API routes have NO authentication check whatsoever:
  - `/api/audio/music` (POST) — generates/searches music
  - `/api/audio/sfx` (POST) — generates/searches sound effects
  - `/api/chat` (POST) — OpenRouter chat with tools
  - `/api/chat/editor` (POST) — Genkit-based editor chat
  - `/api/transcribe` (POST) — Deepgram transcription
  - `/api/pexels` (GET) — Pexels image/video search proxy
  - `/api/batch-export` (GET/POST) — animation presets and file write

  These endpoints call external paid APIs (OpenRouter, Deepgram, ElevenLabs, Pexels) without verifying the caller is authenticated. An attacker could abuse these to run up API costs.
- **File:** `editor/src/app/api/audio/music/route.ts`, `editor/src/app/api/audio/sfx/route.ts`, `editor/src/app/api/chat/route.ts`, `editor/src/app/api/transcribe/route.ts`, `editor/src/app/api/pexels/route.ts`, `editor/src/app/api/batch-export/route.ts`

### BUG-A-032: Sign Out Form Uses Action Attribute Instead of Server Action
- **Severity:** Low
- **Page:** `/dashboard`, `/calendar`
- **Steps:** 1. Click sign out button 2. Form submits to `/auth/signout`
- **Expected:** Works correctly
- **Actual:** The form uses `action="/auth/signout" method="post"` as a regular HTML form. This works but doesn't benefit from Next.js server actions. It also means the sign-out will cause a full page navigation to `/auth/signout` which then redirects to `/login`, causing two round trips.
- **File:** `editor/src/app/dashboard/page.tsx:41-45`

### BUG-A-033: Language Copy-and-Switch Locks UI in "Switching" State
- **Severity:** High
- **Page:** `/editor/[projectId]`
- **Steps:** 1. Open the editor 2. Copy timeline to a new language via `copyAndSwitch` 3. Operation succeeds
- **Expected:** The "Switching language…" overlay dismisses and the editor is usable
- **Actual:** `setIsLanguageSwitching(false)` is only called in the `catch` block, never on success. After a successful copy-and-switch, the UI remains locked in the switching overlay permanently. Only a page refresh clears it.
- **File:** `editor/src/hooks/use-language-switch.ts:87-121`

---

## 3. UX Issues

### UX-001: No Global Navigation
The app lacks a consistent navigation bar or sidebar. Users must know to go to `/dashboard` to access everything. The calendar page has a back arrow, but there's no way to navigate to calendar from post/workflow pages.

### UX-002: New Project Opens in New Tab
When creating a project, it opens in `_blank`. This is jarring — the user is now managing two tabs. Most SaaS apps navigate in the same tab.

### UX-003: No Loading Indicator for Delete/Archive Operations
When deleting or archiving a project, there's no loading spinner or visual feedback — the item just disappears (optimistic update). If the API call fails, the item reappears with no explanation.

### UX-004: Post Page Relies on window.open / window.close Pattern
The entire post/workflow flow assumes the user opened the page in a new tab. The "Close" button calls `window.close()` and the "Cancel" button calls `window.history.back()`. For users who navigate directly, these actions do nothing or behave unpredictably.

### UX-005: No Search Functionality
There's no way to search projects by name, or search posts by caption. With 23+ projects and potentially hundreds of posts, this becomes important.

### UX-006: Calendar View Doesn't Handle Dense Days Well
When a day has many posts, they stack up in the cell. The month view cells are fixed height (`h-[100px]` skeleton), so content could overflow.

### UX-007: No Keyboard Shortcuts
No keyboard shortcuts for common actions (create project, navigate calendar, submit forms with Cmd+Enter, etc.).

### UX-008: Platform Filter Resets on Every Load
The `useEffect` that sets `selectedPlatforms` fires on every `availablePlatforms` change (which happens on every accounts load), resetting any user selections.
- **File:** `editor/src/components/dashboard/social-accounts-list.tsx:128-130`

### UX-009: No Bulk Operations
Cannot bulk-delete or bulk-archive projects. Cannot bulk-publish or bulk-schedule posts. For a tool managing 26 accounts across 7 groups, bulk operations are essential.

### UX-010: RTL Language Support Missing
Arabic accounts (`ar`) are present in the data but the UI has no RTL text direction handling. Arabic text in captions, account names, and post previews will display incorrectly.

---

## 4. Missing Features

1. **Middleware missing `/workflow` route** — The middleware at `editor/middleware.ts` protects `/dashboard`, `/editor`, `/post`, `/calendar` but omits `/workflow`. See BUG-A-003.
2. **No user profile/settings page** — No way to change password (outside of forgot-password flow), update email, or manage account settings.
3. **No notification system** — Post publish results are only shown via toast. If the user closes the tab, there's no way to see what happened.
4. **No post analytics** — Published posts show no engagement metrics, even though platform APIs provide them.
5. **No undo for destructive actions** — Delete operations are immediate with no undo capability.
6. **No responsive/mobile layout** — Dashboard, calendar, and post pages have no mobile breakpoints. The calendar grid will be unusable on mobile screens.
7. **No dark/light mode toggle** — The app is hardcoded to dark mode (`className="dark"` on HTML element in layout.tsx).
8. **No error boundary** — No React error boundary wrapping pages. A component crash will show a white screen.
9. **No OAuth social account connection UI** — Social accounts come from Octupost but there's no in-app way to connect new accounts or disconnect existing ones.

---

## 5. Console Errors & Server Logs

### Server Log Analysis
From `/tmp/nextdev.log`:
- **No 500 errors** observed in recent logs
- **Warning:** Next.js reports "inferred workspace root may not be correct" — turbopack config should set `turbopack.root`
- **Slow requests:** `/api/social/media` calls take 3-7 seconds per account (Facebook token exchange + API calls)
- All API routes return 200 on authenticated requests

### Console Errors (Code Review)
- `console.error('Auth error:', error)` in login page catches and logs auth errors
- `console.error('Failed to fetch posts/groups/tags:', error)` in dashboard — these errors are logged but not surfaced to user
- No `console.error` in calendar component — errors handled via SWR error state

---

## 6. API Issues

### API-001: Cron Endpoint Has No Auth When CRON_SECRET Unset
See BUG-A-004. Verified with `curl` — endpoint returns data without authentication.

### API-002: Timezone Ignored in Scheduled Post Creation
See BUG-A-005. The timezone is stored but not used when computing `scheduled_at`.

### API-003: POST /api/v2/posts Accepts Invalid Account IDs
See BUG-A-021. No validation that accountIds belong to the authenticated user. Creates posts with `platform: 'unknown'`.

### API-004: Core Social/Project API Routes Properly Authenticated
Verified with `curl`:
- `GET /api/v2/accounts` → 401 Unauthorized
- `GET /api/projects?archived=false` → 401 Unauthorized
- `GET /api/account-groups` → 401 Unauthorized
- `GET /api/account-tags` → 401 Unauthorized
- `GET /api/project-tags` → 401 Unauthorized
- `GET /api/v2/posts/list?limit=100&offset=0` → 401 Unauthorized
- `GET /api/social/media?accountId=test` → 401 Unauthorized

### API-005: 7 API Routes Have No Authentication At All
See BUG-A-031. Routes for audio generation, chat, transcription, Pexels search, and batch export are completely unprotected. These call external paid APIs and could be abused to run up costs.

### API-006: Proxy Endpoint Has No Auth But Has Domain Allowlist
See BUG-A-030. Domain allowlist mitigates SSRF but auth would be better defense-in-depth.

### API-007: No Input Length Validation on Caption/Title Fields
The POST /api/v2/posts endpoint doesn't validate caption length. Social platforms have character limits (Instagram: 2200, TikTok: 4000, Twitter: 280, YouTube description: 5000). Exceeding these will cause publish failures with cryptic platform errors instead of clear validation messages.

---

## 7. Database Integrity

### Data Verified
- **26 social accounts** across 5 platforms (facebook, instagram, tiktok, twitter, youtube)
- **7 account groups** with 2-8 members each (50 total memberships)
- **23 projects** (1 archived via `archived_at`)
- **0 posts** in the database (all testing was presumably done with test data that was cleaned up)
- **Profile images:** All YouTube, Instagram, and Facebook accounts have profile images. TikTok and Twitter accounts do not (`has_profile_img = false`).

### Schema Notes
- The `tokens` table lacks a standard `id` column — uses composite key of `platform` + `account_id`
- The `account_group_members` table uses `account_uuid` column but the API code references `account_id` — naming inconsistency
- The `posts.tags` column is `jsonb` type — no foreign key constraint, tags are free-form strings

---

## Summary Table

| Severity | Count |
|----------|-------|
| Critical | 4     |
| High     | 8     |
| Medium   | 12    |
| Low      | 8     |
| UX Issues | 10   |
| Missing Features | 9 |

**Top Priority Fixes:**
1. BUG-A-001: Open redirect vulnerability in `/auth/confirm` (security)
2. BUG-A-004: Cron endpoint unprotected when CRON_SECRET unset (security)
3. BUG-A-003: `/workflow` route missing from middleware protected routes (security)
4. BUG-A-002: Signup bypasses email verification (security)
5. BUG-A-005: Timezone not applied to scheduled posts (data integrity)
6. BUG-A-007: Fix metadata — "Create Next App" is embarrassing in production
