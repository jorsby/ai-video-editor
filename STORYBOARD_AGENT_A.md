# Storyboard Documentation Agent A

## Mission
Document the COMPLETE storyboard video creation pipeline with 100% accuracy. Read every file, trace every function call, capture every prompt/schema. Produce 3 separate documents.

## Context
This project has 2 storyboard pipelines:
1. **Image to Video (I2V)** — Generate grid image → split into scene images → create video from each image
2. **Ref to Video** — Two variants using different AI models:
   - **Kling 0.3** — Reference-based video generation
   - **Wan 2.6 Flash** — Reference-based video generation (different model/approach)

## Files to Read (read ALL of these thoroughly)

### Schemas (define the AI plan structure)
- `editor/src/lib/schemas/i2v-plan.ts`
- `editor/src/lib/schemas/kling-o3-plan.ts`
- `editor/src/lib/schemas/wan26-flash-plan.ts`
- `editor/src/components/schema.ts`

### Frontend — Storyboard UI
- `editor/src/components/editor/media-panel/panel/storyboard.tsx` (main storyboard component)
- `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx` (scene cards list)
- `editor/src/components/editor/media-panel/panel/scene-card.tsx` (individual scene)
- `editor/src/components/editor/media-panel/panel/grid-image-review.tsx` (I2V grid review)
- `editor/src/components/editor/media-panel/panel/ref-grid-image-review.tsx` (Ref grid review)
- `editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx` (plan editing)
- `editor/src/components/editor/media-panel/panel/visuals.tsx` (visuals panel)
- `editor/src/components/editor/media-panel/visuals-chat-panel.tsx`
- `editor/src/components/editor/media-panel/store.ts` (state management)
- `editor/src/components/editor/media-panel/index.tsx`

### API Routes
- `editor/src/app/api/storyboard/route.ts` (main storyboard API — plan generation)
- `editor/src/app/api/storyboard/approve/route.ts` (approve storyboard plan)
- `editor/src/app/api/storyboard/approve-grid/route.ts` (approve I2V grid)
- `editor/src/app/api/storyboard/approve-ref-grid/route.ts` (approve Ref grid)
- `editor/src/app/api/storyboard/regenerate-grid/route.ts` (regenerate grid)

### Supabase Edge Functions (server-side processing)
- `supabase/functions/start-workflow/index.ts` (I2V workflow)
- `supabase/functions/start-ref-workflow/index.ts` (Ref workflow)
- `supabase/functions/approve-grid-split/index.ts` (split grid into scenes)
- `supabase/functions/approve-ref-split/index.ts` (split ref grid into scenes)
- `supabase/functions/generate-video/index.ts` (video generation)
- `supabase/functions/generate-tts/index.ts` (voiceover)
- `supabase/functions/generate-sfx/index.ts` (sound effects)
- `supabase/functions/edit-image/index.ts` (image editing)
- `supabase/functions/webhook/index.ts` (webhook handler)
- `supabase/functions/_shared/logger.ts` (shared utilities)

### Supporting Libraries
- `editor/src/lib/supabase/workflow-service.ts`
- `editor/src/lib/supabase/timeline-service.ts`
- `editor/src/lib/scene-timeline-utils.ts`
- `editor/src/hooks/use-workflow.ts`
- `editor/src/genkit/script-to-video-flow.ts`
- `editor/src/genkit/script-to-video-tools.ts`

## Output — 3 Documents

### Document 1: `STORYBOARD_I2V_A.md`
**Image to Video Pipeline — Complete Documentation**
- Step-by-step flow from user action to final video
- Every API call in order
- Every Supabase function invocation
- The EXACT prompts used for AI generation (copy them verbatim from code)
- The EXACT schemas (copy the zod/JSON schemas verbatim)
- Grid image generation: how it works, what model, what parameters
- Grid splitting: how images are split into scenes
- Video generation from images: what API, what parameters
- State management: what DB tables/columns track progress
- Error handling: what happens when things fail
- Mermaid diagram of the full flow

### Document 2: `STORYBOARD_REF_KLING_A.md`
**Ref to Video — Kling 0.3 Pipeline**
- Same level of detail as Document 1
- How it differs from I2V
- The EXACT Kling-specific prompts (verbatim from code)
- The EXACT Kling schema (verbatim)
- Reference image handling
- Kling API parameters and model config
- State tracking specific to Kling workflow

### Document 3: `STORYBOARD_REF_WAN_A.md`
**Ref to Video — Wan 2.6 Flash Pipeline**
- Same level of detail as Document 1
- How it differs from I2V AND from Kling
- The EXACT Wan-specific prompts (verbatim from code)
- The EXACT Wan schema (verbatim)
- Wan API parameters and model config
- State tracking specific to Wan workflow

## Rules
- **VERBATIM prompts** — copy every AI prompt exactly as it appears in the code. No paraphrasing.
- **VERBATIM schemas** — copy every zod schema / type definition exactly.
- **Trace every function call** — if function A calls function B which calls Supabase function C, document the full chain.
- **Include file paths** — for every code reference, include the exact file path.
- **Include parameters** — every API call, every model parameter, every config option.
- Do NOT skip "obvious" things. Document everything.

When done: `openclaw system event --text "Storyboard Agent A: 3 documents written (I2V, Kling, Wan)" --mode now`
