# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) working in this repository.
**Read this before writing any code.**

---

## ⚠️ The #1 Mistake

**Webhook URLs must point to Next.js API routes, NOT Supabase.**

```ts
// ✅ CORRECT
const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal?step=${step}&id=${id}`;

// ❌ WRONG — old Supabase URL, will silently fail
const webhookUrl = `${process.env.SUPABASE_URL}/functions/v1/webhook?step=${step}`;
```

We migrated away from Supabase Edge Functions. Search for `NEXT_PUBLIC_APP_URL` to see existing patterns.

---

## Project Overview

AI Video Editor (Octupost) — SaaS platform for AI-powered video creation and social media publishing.

```
┌─────────────┐       ┌──────────────────┐       ┌───────────┐
│   Browser    │──────▶│  Next.js API      │──────▶│  fal.ai   │
│  (React/TS)  │◀─sub─│  Routes (Vercel)  │◀─wh──│  (async)  │
└─────────────┘       └──────────────────┘       └───────────┘
       │                       │
       │     Supabase Realtime │ service role
       └───────────────────────┘
```

**All AI generation is async.** Frontend → API route → fal.ai queue → webhook callback → DB update → frontend polls/subscribes via Supabase Realtime.

## Common Commands

| Command | Where | Purpose |
|---|---|---|
| `pnpm dev` | root | Start dev server |
| `pnpm build` | `editor/` | Production build (**this is the test suite**) |
| `turbo build` | root | Build all packages |
| `turbo check-types` | root | TypeScript checks across monorepo |
| `pnpm biome check .` | any | Lint + format check |
| `pnpm biome check . --write` | any | Auto-fix lint/format issues |

> **We use pnpm + Biome.** Not npm, not yarn, not ESLint, not Prettier.

## Monorepo Structure

```
editor/                      # Next.js 16 app (App Router)
  src/
    app/api/                 # 25+ API route groups
      webhook/fal/           # fal.ai callback handler (no auth)
      workflow/              # Workflow routes (video, tts, sfx, edit-image)
      storyboard/            # Storyboard lifecycle (plan, approve, grids)
    components/
      editor/                # Video editor UI
      dashboard/             # Dashboard views
      workflow/              # Workflow components
      post/                  # Social posting UI
      ui/                    # Shared primitives (shadcn-style)
    lib/
      supabase/              # DB clients (admin, server, client)
      social/                # Social media provider integrations
      supabase/workflow-service.ts  # Frontend → API orchestration
packages/
  openvideo/                 # Video engine
  video/                     # Video utilities
  node/                      # Node utilities
supabase/
  migrations/                # SQL migrations
  config.toml                # Supabase config
  functions/                 # ⚠️ DEPRECATED — do not add here
```

**Path alias:** `@/*` → `editor/src/*`. Use it everywhere.

## Supabase Client Rules

**This is the #1 source of bugs. Get it right.**

| File | Client | Use When |
|------|--------|----------|
| `admin.ts` | Service role | API routes, webhooks, workflow operations |
| `server.ts` | User auth | User-facing server code, RLS-protected reads |
| `client.ts` | Browser (anon) | Frontend components, Realtime subscriptions |

```ts
// ✅ Server-side DB operations
import { adminClient } from "@/lib/supabase/admin";

// ❌ NEVER use anon key server-side — silently misses data due to RLS
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
```

**Hard rules:**
- `admin.ts` = server-side only. Never import in `"use client"` files.
- `SUPABASE_SERVICE_ROLE_KEY` and `FAL_KEY` must NEVER appear in client-side code.

## The Storyboard Workflow

This is the core feature. Understand it before touching anything.

1. **Plan** — User creates storyboard. LLM (via OpenRouter) generates a plan.
2. **Approve** — User approves → API route writes to DB, queues fal.ai jobs.
3. **Generate** — fal.ai processes (grid images, video gen, TTS, SFX).
4. **Webhook** — fal.ai POSTs results to `/api/webhook/fal?step=GenGridImage` (etc.).
5. **Update** — Webhook handler parses results, updates DB tables.
6. **Subscribe** — Frontend subscribes via Supabase Realtime for status changes.

**Modes:** `image_to_video` (generate images → animate) | `ref_to_video` (reference images → video)

## Database Schema (Key Tables)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `storyboards` | Top-level container | `plan`, `plan_status`, `mode` |
| `grid_images` | Generated image grids | `prompt`, `url`, `status`, `type` (scene/objects/backgrounds) |
| `scenes` | Individual scenes | `order`, `video_url`, `video_status`, `sfx_status` |
| `first_frames` | Scene first frames | `url`, `final_url`, `image_edit_status` |
| `voiceovers` | TTS audio | `text`, `audio_url`, `duration`, `status` |
| `objects` | Extracted objects | `url`, `final_url`, `grid_position`, `status` |
| `backgrounds` | Extracted backgrounds | `url`, `final_url`, `grid_position`, `status` |

Schemas: `studio` (main app), `social_auth` (social media accounts).

## Critical Patterns

### fal.ai Webhook Pattern

Every fal.ai request follows this pattern. Do not invent a new one.

```ts
// Submitting a job (in API route)
const falUrl = new URL("https://queue.fal.run/workflows/octupost/model");
falUrl.searchParams.set("fal_webhook", webhookUrl);

const response = await fetch(falUrl.toString(), {
  method: "POST",
  headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt }),
});
```

```ts
// Receiving callback (in /api/webhook/fal/route.ts)
const { searchParams } = new URL(request.url);
const step = searchParams.get("step");
// Route to handler based on step
```

### Atomic DB Gates (Race Condition Prevention)

fal.ai sends concurrent webhooks. We prevent double-processing with atomic UPDATE gates:

```ts
// ✅ CORRECT — atomic gate: only one callback wins
const { data } = await supabase
  .from("storyboards")
  .update({ plan_status: "approved" })
  .eq("id", storyboardId)
  .eq("plan_status", "splitting")  // ← Only succeeds if still "splitting"
  .select("id");

if (!data || data.length === 0) return; // Another webhook already processed this
```

```ts
// ❌ WRONG — race condition: two callbacks both read "splitting" and both proceed
const job = await supabase.from("storyboards").select().eq("id", id).single();
if (job.data.plan_status === "splitting") {
  await supabase.from("storyboards").update({ plan_status: "approved" }).eq("id", id);
}
```

Pattern names in codebase: `tryCompleteSplitting`, `tryComplete*`. **Do not refactor these into check-then-act.**

### CORS on Webhook Routes

Webhook routes **must** include CORS headers. fal.ai callbacks fail silently without them.

```ts
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

export async function OPTIONS() {
  return new Response(null, { headers: CORS_HEADERS });
}
```

### Auth Rules by Route Type

| Route Pattern | Auth Required? | Why |
|---|---|---|
| `/api/webhook/*` | **NO** | External services (fal.ai) POST here |
| `/api/*` (everything else) | **YES** — `getUser()` | User-facing, must verify identity |

## 🚫 DO NOT

| Don't | Why | Do Instead |
|-------|-----|------------|
| Use `npm` or `yarn` | pnpm monorepo | `pnpm add <package>` |
| Add ESLint/Prettier configs | We use Biome | `pnpm biome check .` |
| Create Supabase edge functions | Migrating away | Next.js API routes in `editor/src/app/api/` |
| Edit `supabase/functions/` | Deprecated | Port to Next.js API route instead |
| Use anon key server-side | Misses data (RLS) | Import from `admin.ts` |
| Skip error handling on fal.ai | They fail often | Always try/catch + update DB status to "failed" |
| Forget CORS on webhook routes | Silent failures | Add CORS headers |
| Hardcode URLs | Breaks across envs | Use `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL` |
| Refactor `try*` functions | Race conditions | Keep atomic UPDATE gates |
| Make direct fetch from components | Breaks pattern | Use `workflow-service.ts` |
| Add packages without checking | May already exist | Search codebase first |

## Environment Variables

| Variable | Purpose | Server/Client |
|---|---|---|
| `SUPABASE_URL` | Supabase project URL | Both |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key (RLS-enforced) | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (bypasses RLS) | **Server only** |
| `FAL_KEY` | fal.ai API key | **Server only** |
| `NEXT_PUBLIC_APP_URL` | App URL (webhook callbacks) | Both |
| `OPENROUTER_API_KEY` | LLM calls | Server only |

## Adding a New fal.ai Generation Step

1. **DB** — Add status columns to relevant table (migration in `supabase/migrations/`)
2. **API route** — Create `editor/src/app/api/workflow/<step>/route.ts` that queues fal.ai with webhook URL
3. **Webhook handler** — Add case in `/api/webhook/fal/route.ts` `switch(step)` block
4. **Atomic gate** — Use `UPDATE ... WHERE status='processing'` in webhook handler
5. **Workflow service** — Add method in `workflow-service.ts` for frontend to call
6. **Frontend** — Subscribe to Supabase Realtime for status changes
7. **CORS** — Ensure webhook route has CORS headers

## Before You Commit

```bash
cd editor && pnpm build          # Must pass — this is the test suite
pnpm biome check .               # Must pass — lint + format
```

**Self-review checklist:**
- [ ] No hardcoded URLs (search for `https://` in your changes)
- [ ] Webhook routes have CORS headers + no auth
- [ ] User-facing routes check auth via `getUser()`
- [ ] fal.ai webhook URL uses `NEXT_PUBLIC_APP_URL`
- [ ] fal.ai errors handled with try/catch + DB status update
- [ ] No `any` types without justification comment
- [ ] No new files in `supabase/functions/`
- [ ] `pnpm build` passes
