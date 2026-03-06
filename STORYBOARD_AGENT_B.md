# Storyboard Documentation Agent B

## Mission
Independently document the COMPLETE storyboard video creation pipeline. Read every file, trace every function call, capture every prompt/schema with 100% fidelity. Your output will be compared against another agent's work to find discrepancies.

## Context
The project has 2 storyboard pipelines:
1. **Image to Video (I2V)** — Generate a grid image → split into individual scene images → generate a video clip for each scene
2. **Ref to Video** — Two model-specific variants:
   - **Kling 0.3** model
   - **Wan 2.6 Flash** model

## Files You MUST Read (all of them, thoroughly)

### Schema definitions
- `editor/src/lib/schemas/i2v-plan.ts`
- `editor/src/lib/schemas/kling-o3-plan.ts`
- `editor/src/lib/schemas/wan26-flash-plan.ts`
- `editor/src/components/schema.ts`

### UI Components
- `editor/src/components/editor/media-panel/panel/storyboard.tsx`
- `editor/src/components/editor/media-panel/panel/storyboard-cards.tsx`
- `editor/src/components/editor/media-panel/panel/scene-card.tsx`
- `editor/src/components/editor/media-panel/panel/grid-image-review.tsx`
- `editor/src/components/editor/media-panel/panel/ref-grid-image-review.tsx`
- `editor/src/components/editor/media-panel/panel/draft-plan-editor.tsx`
- `editor/src/components/editor/media-panel/panel/visuals.tsx`
- `editor/src/components/editor/media-panel/visuals-chat-panel.tsx`
- `editor/src/components/editor/media-panel/store.ts`
- `editor/src/components/editor/media-panel/index.tsx`

### Next.js API Routes
- `editor/src/app/api/storyboard/route.ts`
- `editor/src/app/api/storyboard/approve/route.ts`
- `editor/src/app/api/storyboard/approve-grid/route.ts`
- `editor/src/app/api/storyboard/approve-ref-grid/route.ts`
- `editor/src/app/api/storyboard/regenerate-grid/route.ts`

### Supabase Edge Functions
- `supabase/functions/start-workflow/index.ts`
- `supabase/functions/start-ref-workflow/index.ts`
- `supabase/functions/approve-grid-split/index.ts`
- `supabase/functions/approve-ref-split/index.ts`
- `supabase/functions/generate-video/index.ts`
- `supabase/functions/generate-tts/index.ts`
- `supabase/functions/generate-sfx/index.ts`
- `supabase/functions/edit-image/index.ts`
- `supabase/functions/webhook/index.ts`
- `supabase/functions/_shared/logger.ts`

### Libraries & Hooks
- `editor/src/lib/supabase/workflow-service.ts`
- `editor/src/lib/supabase/timeline-service.ts`
- `editor/src/lib/scene-timeline-utils.ts`
- `editor/src/hooks/use-workflow.ts`
- `editor/src/genkit/script-to-video-flow.ts`
- `editor/src/genkit/script-to-video-tools.ts`

## Output — Write 3 Documents

### Document 1: `STORYBOARD_I2V_B.md`
**Image to Video Pipeline**

Structure your document as:
1. **Overview** — what I2V does end-to-end in 3-4 sentences
2. **User Journey** — what buttons the user clicks, what they see at each step
3. **Technical Flow** — step by step, every function call chain:
   - Frontend action → API route → Supabase function → external API → webhook → DB update → UI update
4. **AI Prompts** — COPY EVERY PROMPT VERBATIM. Include the system prompt, user prompt, any template variables, and the exact context sent to the AI. Show where in the code each prompt lives (file:line if possible).
5. **Schemas** — COPY EVERY ZOD/TYPE SCHEMA VERBATIM for the I2V plan, grid image, scene, etc.
6. **Grid Image Generation** — what model generates it, what prompt, what resolution, how the grid is structured (NxN), how it maps to scenes
7. **Grid Splitting** — how the grid image is cut into individual scene images, what determines the crop coordinates
8. **Video Generation** — from scene image to video clip: what API, what model, what parameters
9. **TTS/Voiceover** — how voiceover is generated per scene
10. **Timeline Assembly** — how video clips + voiceover are assembled into the final timeline
11. **Database State** — what tables/columns track storyboard state, what status values exist
12. **Error Handling** — what happens on failure at each step
13. **Flow Diagram** — Mermaid sequence diagram

### Document 2: `STORYBOARD_REF_KLING_B.md`
**Ref to Video — Kling 0.3 Pipeline**

Same structure as Document 1, but focused on:
- How Ref differs from I2V (what's shared, what's different)
- Kling 0.3 specific: model ID, API endpoint, parameters, aspect ratios, durations
- Reference image handling (how the ref image is used vs I2V grid)
- The EXACT Kling prompts (verbatim)
- The EXACT Kling schema (verbatim)

### Document 3: `STORYBOARD_REF_WAN_B.md`
**Ref to Video — Wan 2.6 Flash Pipeline**

Same structure, but focused on:
- How Wan differs from both I2V and Kling
- Wan 2.6 specific: model ID, API endpoint, parameters
- The EXACT Wan prompts (verbatim)
- The EXACT Wan schema (verbatim)
- Any Wan-specific limitations or behaviors

## Critical Rules
1. **COPY PROMPTS VERBATIM** — every system prompt, every user prompt template, every few-shot example. Character for character. If it's a template string with ${variables}, show the template AND explain what fills each variable.
2. **COPY SCHEMAS VERBATIM** — every zod schema, every TypeScript interface that defines plan/scene/grid structure.
3. **FULL CALL CHAINS** — trace from UI click to final DB write. No gaps. No "and then it calls the API" without showing which API, which parameters.
4. **FILE PATHS** — every code reference includes the exact file path.
5. **NO ASSUMPTIONS** — if you're not sure about something, read the file again. Don't guess.

When done: `openclaw system event --text "Storyboard Agent B: 3 documents written (I2V, Kling, Wan)" --mode now`
