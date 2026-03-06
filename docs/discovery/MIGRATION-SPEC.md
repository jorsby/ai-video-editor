# Migration Spec: Supabase Edge Functions → Next.js API Routes

## Goal
Eliminate ALL Supabase edge functions. Move their logic into Next.js API routes so everything deploys together on Vercel.

## Branch
`feat/migrate-edge-to-nextjs-routes`

## Reference
- Full architecture analysis: `docs/discovery/03-architecture-recommendation.md`
- Current edge functions: `supabase/functions/` (10 functions, ~5,400 lines)
- Current API routes that call them: `editor/src/app/api/storyboard/`

## Phase 1: Webhook Handler (Critical Path)

The `webhook` edge function is the only one called by fal.ai (external callback). Create:

`editor/src/app/api/webhook/fal/route.ts`

Port ALL step handlers from `supabase/functions/webhook/index.ts`:
- GenGridImage, SplitGridImage, GenerateTTS, OutpaintImage, EnhanceImage, GenerateVideo, GenerateSFX

Translation rules:
- `Deno.serve()` → Next.js `export async function POST(req: NextRequest)`
- `Deno.env.get()` → `process.env.`
- `jsr:@supabase/supabase-js@2` → `@supabase/supabase-js` (already in package.json)
- `npm:music-metadata@10` → `music-metadata` (add to package.json if needed)
- Keep CORS headers, keep `?step=` query param routing
- Use SUPABASE_SERVICE_ROLE_KEY from env

## Phase 2: Inline Orchestrators

| Edge Function | Inline Into |
|---|---|
| `start-workflow` | `editor/src/app/api/storyboard/approve/route.ts` |
| `start-ref-workflow` | `editor/src/app/api/storyboard/approve/route.ts` |
| `approve-grid-split` | `editor/src/app/api/storyboard/approve-grid/route.ts` |
| `approve-ref-split` | `editor/src/app/api/storyboard/approve-ref-grid/route.ts` |

Remove fetch() calls to edge functions. Inline the logic. Update webhook URLs from `${SUPABASE_URL}/functions/v1/webhook` to `${NEXT_PUBLIC_APP_URL}/api/webhook/fal`.

## Phase 3: Port Frontend-Called Functions

| Edge Function | New Route |
|---|---|
| `generate-tts` | `editor/src/app/api/workflow/tts/route.ts` |
| `generate-video` | `editor/src/app/api/workflow/video/route.ts` |
| `generate-sfx` | `editor/src/app/api/workflow/sfx/route.ts` |
| `edit-image` | `editor/src/app/api/workflow/edit-image/route.ts` |
| `poll-skyreels` | `editor/src/app/api/workflow/poll-skyreels/route.ts` |

Update frontend calls in `workflow-service.ts` to point to new routes.

## Phase 4: Cleanup
- Do NOT delete supabase/functions/ yet
- Add music-metadata to editor/package.json if needed
- Document all required env vars
- Search codebase for remaining `functions/v1/` references

## Code Quality Rules
- Keep same error handling, logger patterns, helper functions
- Keep atomic DB gate (tryCompleteSplitting)
- TypeScript strict, no new `any` types
- Webhook route: NO auth (fal.ai callback), Orchestrator routes: user auth via getUser()
