# Storyboard Documentation — Final Merge

## Mission
Read the 6 discovery documents (3 from Agent A, 3 from Agent B) and produce 2 FINAL authoritative documents.

## Input Files
- `STORYBOARD_I2V_A.md` + `STORYBOARD_I2V_B.md` → merge into `STORYBOARD_I2V_FINAL.md`
- `STORYBOARD_REF_KLING_A.md` + `STORYBOARD_REF_KLING_B.md` + `STORYBOARD_REF_WAN_A.md` + `STORYBOARD_REF_WAN_B.md` → merge into `STORYBOARD_REF_FINAL.md`

## Output — 2 Documents

### Document 1: `STORYBOARD_I2V_FINAL.md`
**Image-to-Video Pipeline — Authoritative Reference**

Combine the best of both A and B. Where they differ:
- Check the ACTUAL source code to determine which is correct
- The source files are in `editor/src/` and `supabase/functions/`

Include:
1. Overview (concise)
2. User Journey (step by step what the user clicks and sees)
3. Technical Flow (complete call chain: frontend → API → edge function → external API → webhook → DB)
4. ALL AI Prompts (VERBATIM — copy from source code if A and B differ)
5. ALL Schemas (VERBATIM — copy from source code if A and B differ)
6. Grid generation details (model, params, resolution, grid structure)
7. Grid splitting (how crops work, validation rules)
8. Video generation (model, params, per-model differences)
9. TTS/Voiceover generation (model, params, voice settings)
10. Timeline assembly (how clips are created in openvideo)
11. Database state machine (all status values, transitions)
12. Error handling (what fails, what recovers, what doesn't)
13. Mermaid sequence diagram

### Document 2: `STORYBOARD_REF_FINAL.md`
**Ref-to-Video Pipeline — Authoritative Reference (Kling O3 + Wan 2.6 Flash)**

Combine both models into ONE document with clear sections for shared logic and model-specific differences.

Structure:
1. Overview (what Ref-to-Video is, how it differs from I2V)
2. Shared Flow (two-pass LLM, dual grids, split, etc.)
3. ALL Shared Prompts (grid prefixes, etc.)
4. **Kling O3 Section**
   - System prompt (VERBATIM)
   - Reviewer prompt (VERBATIM)
   - Content schema + reviewer schema (VERBATIM)
   - @Element/@Image1 reference syntax
   - Multi-shot handling (string | string[])
   - Duration: 3-15s
   - Video API payload format (elements[] + image_urls[])
   - Kling-specific validation
5. **Wan 2.6 Flash Section**
   - System prompt (VERBATIM)
   - Reviewer prompt (VERBATIM)
   - Content schema + reviewer schema (VERBATIM)
   - @Element1=bg, @Element2+=objects reference syntax
   - Multi-shot handling (scene_multi_shots boolean[])
   - Duration: 5s or 10s only
   - Video API payload format (flat image_urls[])
   - Wan-specific validation
6. **Comparison Table** (side-by-side: I2V vs Kling vs Wan)
7. Database state machine (shared + model-specific statuses)
8. Error handling
9. Mermaid diagrams (shared flow + model-specific branches)

## Rules
1. When A and B disagree, READ THE ACTUAL SOURCE CODE to determine truth
2. ALL prompts must be VERBATIM from source files — not paraphrased from A or B
3. ALL schemas must be VERBATIM from source files
4. Include file paths for every code reference
5. The final docs must be standalone — someone reading ONLY these 2 docs should understand the entire storyboard system

When done: `openclaw system event --text "Storyboard: 2 final documents written (I2V + Ref)" --mode now`
