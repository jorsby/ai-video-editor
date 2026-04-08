# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, etc.) working in this repository.
**Read this before writing any code.**

---

## 📖 Before Any Task

1. **Read [`docs/WORKFLOW.md`](docs/WORKFLOW.md)** — the full production funnel (onboarding → publish)
2. **If working on a project:**
   - Read `docs/projects/<project>/PROJECT.md` — get IDs, rules, feedback history
   - Query Supabase for live state — **never use cached/hardcoded IDs** (except video_id and project_id from PROJECT.md)
3. **If generating videos:** Read [`docs/VIDEO_GENERATION_WORKFLOW.md`](docs/VIDEO_GENERATION_WORKFLOW.md) — step-by-step, skip nothing
4. **Follow the workflow order** — don't jump ahead in the funnel

---

## ⚠️ The #1 Mistake

**Webhook URLs must use `WEBHOOK_BASE_URL`, NOT Supabase.**

```ts
// ✅ CORRECT
const webhookUrl = `${process.env.WEBHOOK_BASE_URL}/api/webhook/kieai?step=${step}&scene_id=${id}`;

// ❌ WRONG — old Supabase URL, will silently fail
const webhookUrl = `${process.env.SUPABASE_URL}/functions/v1/webhook?step=${step}`;

// ❌ WRONG — old fal.ai pattern, we use Kie.ai now
const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/fal?step=${step}`;
```

---

## Project Overview

AI Video Editor (Octupost) — SaaS platform for AI-powered video creation and social media publishing.

```
┌─────────────┐       ┌──────────────────┐       ┌───────────┐
│   Browser    │──────▶│  Next.js API      │──────▶│  Kie.ai   │
│  (React/TS)  │◀─sub─│  Routes (Vercel)  │◀─wh──│  (async)  │
└─────────────┘       └──────────────────┘       └───────────┘
       │                       │
       │     Supabase Realtime │ service role
       └───────────────────────┘
```

**All AI generation is async.** Frontend → API route → Kie.ai → webhook callback → DB update → frontend polls/subscribes via Supabase Realtime.

## Common Commands

| Command | Where | Purpose |
|---|---|---|
| `pnpm dev` | root | Start dev server |
| `pnpm build` | `editor/` | Production build (**this is the test suite**) |
| `pnpm turbo build` | root | Build all packages |
| `pnpm turbo check-types` | root | TypeScript checks across monorepo |
| `pnpm biome check .` | any | Lint + format check |
| `pnpm biome check . --write` | any | Auto-fix lint/format issues |

> **We use pnpm + Biome.** Not npm, not yarn, not ESLint, not Prettier.

## Monorepo Structure

```
editor/                      # Next.js 16 app (App Router)
  src/
    app/api/                 # API route groups
      webhook/kieai/         # Kie.ai callback handler (HMAC-verified, no user auth)
      webhook/fal/           # Legacy fal.ai handler (deprecated, being removed)
      v2/                    # V2 API routes (primary)
        videos/              # Video CRUD + chapters/characters/locations/music/props
        chapters/            # Chapter CRUD + scenes + asset-map
        scenes/              # Scene CRUD + generate-video + generate-tts
        variants/            # Variant CRUD + generate-image
        projects/            # Project CRUD + characters/locations/music/props/variants
        posts/               # Post CRUD + publish
        accounts/            # Social account sync
        characters/          # Character CRUD
        locations/           # Location CRUD
        music/               # Music CRUD
        props/               # Prop CRUD
        feedback/            # Feedback
        generation-logs/     # Generation log viewer
      workflow/              # Legacy workflow routes (generate-image, tts, sfx, ref-first-frame)
      proxy/media/           # Media proxy (allowed-domain fetch proxy for CORS)
      transcribe/            # Deepgram transcription API
      generate-caption/      # Social media caption generation
    components/
      editor/                # Video editor UI (timeline, storyboard, export, media panel)
      dashboard/             # Dashboard views
      workflow/              # Workflow components
      post/                  # Social posting UI
      ui/                    # Shared primitives (shadcn-style)
    lib/
      supabase/              # DB clients (admin, server, client) + timeline-service
      social/                # Social media provider integrations
      transcribe/            # Deepgram client + types
      timeline/              # scene-to-timeline conversion
      caption-generator.ts   # Word-level caption clip generator
      caption-utils.ts       # Caption utilities
    stores/
      studio-store.ts        # Compositor/Studio state
      timeline-store.ts      # Timeline state
      panel-collapse-store.ts # Panel expand/collapse
packages/
  openvideo/                 # Video compositor engine (PixiJS + WebCodecs)
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
- `SUPABASE_SERVICE_ROLE_KEY` and `KIE_API_KEY` must NEVER appear in client-side code.

## The Storyboard / Video Workflow

This is the core feature. Understand it before touching anything.

### Data Hierarchy

```
Project
  └── Video (has video_resolution: 480p/720p/1080p)
        └── Chapter (ordered)
              └── Scene (ordered)
                    ├── prompt (image/video generation prompt)
                    ├── audio_text (TTS narration text)
                    ├── audio_url (generated TTS audio)
                    ├── video_url (generated video)
                    ├── video_status (pending/processing/completed/failed)
                    └── Variants (asset variants with generated images)
```

### Generation Flow

1. **Image Generation** — `POST /api/v2/variants/{id}/generate-image` → Kie.ai (Flux 2 Pro) → webhook
2. **TTS Generation** — `POST /api/v2/scenes/{id}/generate-tts` → Kie.ai (ElevenLabs) → webhook
3. **Video Generation** — `POST /api/v2/scenes/{id}/generate-video` → Kie.ai (Grok Imagine) → webhook
4. **Webhook** — Kie.ai POSTs to `/api/webhook/kieai?step=GenerateSceneVideo&scene_id=...`
5. **Update** — Webhook handler verifies HMAC, parses results, updates DB
6. **Subscribe** — Frontend subscribes via Supabase Realtime for status changes

### Models

| Type | Model | Provider |
|------|-------|----------|
| Image | `flux-2/pro-text-to-image` | Kie.ai |
| Video | `grok-imagine/image-to-video` | Kie.ai |
| TTS | ElevenLabs (via Kie.ai) | Kie.ai |
| Transcription | Deepgram `nova-3` | Direct API |
| LLM | OpenRouter (various) | Direct API |

## Database Schema (Key Tables)

All in `studio` schema:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `projects` | Top-level container | `name`, `user_id` |
| `videos` | Videos within project | `project_id`, `title`, `video_resolution`, `order` |
| `chapters` | Chapters within video | `video_id`, `title`, `order` |
| `scenes` | Scenes within chapter | `chapter_id`, `order`, `prompt`, `audio_text`, `audio_url`, `video_url`, `video_status` |
| `assets` | Project-level assets | `project_id`, `name`, `type` (character/location/prop/music) |
| `variants` | Asset variants | `asset_id`, `slug`, `image_url`, `image_gen_status` |
| `tracks` | Timeline tracks | `project_id`, `video_id`, `data` |
| `clips` | Timeline clips | `track_id`, `data`, `position` |
| `rendered_videos` | Exported videos | `project_id`, `url`, `platform` |

Social schema: `social_auth` (social media accounts + posts).

## Critical Patterns

### Kie.ai Webhook Pattern

Every Kie.ai request follows this pattern. Do not invent a new one.

```ts
// Submitting a job (in API route)
const response = await fetch("https://api.kieai.com/v1/tasks", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${process.env.KIE_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "flux-2/pro-text-to-image",
    input: { prompt },
    webhook: {
      url: `${process.env.WEBHOOK_BASE_URL}/api/webhook/kieai?step=GenerateImage&scene_id=${sceneId}`,
      secret: process.env.KIE_WEBHOOK_HMAC_KEY,
    },
  }),
});
const { task_id } = await response.json();
```

```ts
// Receiving callback (in /api/webhook/kieai/route.ts)
// 1. Verify HMAC signature
// 2. Parse step + entity ID from searchParams
// 3. Update DB with result
```

### Atomic DB Gates (Race Condition Prevention)

Concurrent webhooks can cause double-processing. Prevent with atomic UPDATE gates:

```ts
// ✅ CORRECT — atomic gate: only one callback wins
const { data } = await supabase
  .from("scenes")
  .update({ video_status: "completed", video_url: resultUrl })
  .eq("id", sceneId)
  .eq("video_status", "processing")  // ← Only succeeds if still "processing"
  .select("id");

if (!data || data.length === 0) return; // Another webhook already processed this
```

```ts
// ❌ WRONG — race condition
const scene = await supabase.from("scenes").select().eq("id", id).single();
if (scene.data.video_status === "processing") {
  await supabase.from("scenes").update({ video_status: "completed" }).eq("id", id);
}
```

### CORS on Webhook Routes

Webhook routes **must** include CORS headers:

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
| `/api/webhook/*` | **NO** (HMAC-verified) | External services (Kie.ai) POST here |
| `/api/*` (everything else) | **YES** — `getUser()` | User-facing, must verify identity |

### Media Proxy

Timeline clips use proxy URLs for CORS-free media loading:

```ts
// Wrap external URL for browser playback
const proxied = `/api/proxy/media?url=${encodeURIComponent(realUrl)}`;

// Extract real URL from proxy wrapper (e.g., for Deepgram)
const realUrl = new URL(proxyUrl, window.location.origin).searchParams.get("url");
```

Allowed domains: `r2.dev`, `googleapis.com`, `aiquickdraw.com`, `elevenlabs.io`, etc.

### Timeline (Per-Video)

Each video has its own independent timeline. When switching videos:
1. Save current timeline
2. `await studio.clear()` (always await!)
3. Load new video's timeline from DB

Key functions: `saveTimeline()`, `loadTimeline()`, `clearTimeline()` — all accept optional `videoId`.
Auto-save: `pauseAutoSave()` / `resumeAutoSave()` during transitions.

## 🚫 DO NOT

| Don't | Why | Do Instead |
|-------|-----|------------|
| Use `npm` or `yarn` | pnpm monorepo | `pnpm add <package>` |
| Add ESLint/Prettier configs | We use Biome | `pnpm biome check .` |
| Create Supabase edge functions | Migrating away | Next.js API routes in `editor/src/app/api/` |
| Edit `supabase/functions/` | Deprecated | Port to Next.js API route instead |
| Use anon key server-side | Misses data (RLS) | Import from `admin.ts` |
| Skip error handling on Kie.ai | They fail often | Always try/catch + update DB status to "failed" |
| Forget CORS on webhook routes | Silent failures | Add CORS headers |
| Hardcode URLs | Breaks across envs | Use `WEBHOOK_BASE_URL`, `NEXT_PUBLIC_APP_URL` |
| Refactor `try*` functions | Race conditions | Keep atomic UPDATE gates |
| Make direct fetch from components | Breaks pattern | Use API routes or service functions |
| Add packages without checking | May already exist | Search codebase first |
| Use fal.ai | Removed entirely | Use Kie.ai for all generation |
| Forget to `await studio.clear()` | Async — causes race conditions | Always `await` |

## Environment Variables

| Variable | Purpose | Server/Client |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Both |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key (RLS-enforced) | Client |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin key (bypasses RLS) | **Server only** |
| `KIE_API_KEY` | Kie.ai API key | **Server only** |
| `KIE_WEBHOOK_HMAC_KEY` | Kie.ai webhook signature verification | **Server only** |
| `WEBHOOK_BASE_URL` | Base URL for webhook callbacks | Server only |
| `NEXT_PUBLIC_APP_URL` | App URL for frontend | Both |
| `OPENROUTER_API_KEY` | LLM calls (caption gen, storyboard planning) | Server only |
| `DEEPGRAM_API_KEY` | Speech-to-text transcription | Server only |
| `DEEPGRAM_MODEL` | Deepgram model (default: `nova-3`) | Server only |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS (direct, non-Kie path) | Server only |
| `PEXELS_API_KEY` | Stock video/image search | Server only |
| `OCTUPOST_API_KEY` | Internal API auth | Server only |
| `PROVIDER_VIDEO` | Video provider (`kie`) | Server only |
| `PROVIDER_IMAGE` | Image provider (`kie`) | Server only |
| `PROVIDER_TTS` | TTS provider (`kie`) | Server only |

## Adding a New Kie.ai Generation Step

1. **DB** — Add status columns to relevant table (migration in `supabase/migrations/`)
2. **API route** — Create `editor/src/app/api/v2/<entity>/[id]/generate-<type>/route.ts` that sends to Kie.ai with webhook URL
3. **Webhook handler** — Add case in `/api/webhook/kieai/route.ts` `switch(step)` block
4. **Atomic gate** — Use `UPDATE ... WHERE status='processing'` in webhook handler
5. **Frontend** — Subscribe to Supabase Realtime for status changes, add generate/retry buttons
6. **CORS** — Ensure webhook route has CORS headers

## 📝 Keep Docs Updated (MANDATORY)

After every code change, check if these docs need updating **in the same commit**:

| Doc | Update when... |
|-----|---------------|
| `docs/API-COOKBOOK.md` | Any API endpoint added, changed, or removed |
| `AGENTS.md` | Architecture, patterns, DB schema, env vars, or project structure changes |
| `HOW-TO-DEVELOP.md` | Development workflow or async pattern changes |
| `CLAUDE.md` | New top-level rules, stack changes, or critical "don't" items |

**Rule:** Code change + doc update = same commit. No exceptions.

## Before You Commit

```bash
cd editor && pnpm build          # Must pass — this is the test suite
pnpm biome check .               # Must pass — lint + format
```

**Self-review checklist:**
- [ ] No hardcoded URLs (search for `https://` in your changes)
- [ ] Webhook routes have CORS headers + HMAC verification
- [ ] User-facing routes check auth via `getUser()`
- [ ] Webhook URL uses `WEBHOOK_BASE_URL`
- [ ] Kie.ai errors handled with try/catch + DB status update
- [ ] No `any` types without justification comment
- [ ] No new files in `supabase/functions/`
- [ ] `pnpm build` passes
