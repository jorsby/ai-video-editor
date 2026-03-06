# Plan: Kling O3 Reviewer LLM Chain

## Overview
Add a reviewer LLM call (Call 1.5) between content generation and validation in `generateRefToVideoPlan`. The reviewer receives the generated plan + rules, fixes invalid references, reviews semantic quality, and returns a corrected plan. Only applies to Kling O3 plans.

**Flow change:**
```
Call 1: Generate → Call 1.5: Review & Fix (NEW) → Validation → Call 2: Translation
```

## Files to Change

### 1. `editor/src/lib/schemas/kling-o3-plan.ts`
- Add `KLING_O3_REVIEW_PROMPT` export — the reviewer system prompt

**Reviewer prompt responsibilities:**
- Fix @ElementN references that exceed scene_object_indices count for each scene
- Fix @ImageN references (only @Image1 valid)
- Review if scene prompts make sense given the voiceover text
- Improve prompt quality: better cinematic techniques, more vivid descriptions
- Ensure multi-shot vs single-shot choice is appropriate for each voiceover segment
- Verify object/background assignments make sense for narrative flow
- Return the full corrected plan in the same JSON schema

### 2. `editor/src/app/api/storyboard/route.ts`
- After Call 1 (content generation, line ~149) and before the validation block (line ~156)
- Add Call 1.5: Review & Fix
  - Only when `isKling` is true
  - Send the generated `content` JSON + the reviewer system prompt
  - Use `klingO3ContentSchema` as the output schema (same shape)
  - Use `reasoning: { effort: 'medium' }` (review is simpler than generation)
  - Replace `content` with the reviewer's output before proceeding to validation
  - Add console.log for the review request/response

**No other files change.** The validation block after the reviewer stays as a safety net.
