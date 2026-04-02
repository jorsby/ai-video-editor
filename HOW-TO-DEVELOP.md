# HOW-TO-DEVELOP.md — AI Video Editor

## Development Workflow (MANDATORY)

Every feature addition or removal follows this exact sequence.
No skipping steps. No jumping to UI.

### Adding a Feature

1. **Data Model Discussion**
   - What tables/columns are needed?
   - If async (Kie.ai): include task_id, status, and result fields
     - Example: tts_task_id, tts_status, audio_url, audio_duration
     - Example: video_task_id, video_status, video_url, video_duration
   - Discuss with Serhat, get approval before touching DB

2. **API Design**
   - Check API Cookbook — does an endpoint exist?
   - If not: propose endpoint (method, path, input, output)
   - **If async (Kie.ai):** design BOTH directions:
     - Outgoing: POST to Kie.ai → returns task_id
     - Incoming webhook: Kie.ai calls us → updates status + result fields
   - Get approval or self-verify

3. **API Implementation**
   - Write the outgoing endpoint
   - **Write the webhook handler** (if async)
   - Test the full loop:
     - [ ] API call returns task_id?
     - [ ] task_id + status saved to DB?
     - [ ] Webhook fires back?
     - [ ] Webhook updates correct row with result (url, duration)?
     - [ ] Status transitions correct? (pending → processing → completed/failed)

4. **Dev API UI**
   - Update the development API visualization panel
   - Show webhook status if applicable

5. **Backend Logic**
   - Update backend services if needed

6. **UI Implementation**
   - Add/update components, buttons, views
   - Show loading/generating states based on status field
   - Handle webhook-driven updates (polling or realtime)

7. **Review & Test**
   - Review each step sequentially
   - **Async features:** test full round-trip
     - API call → DB pending → webhook received → DB completed → UI reflects
   - Test failure cases: webhook timeout, duplicate webhook, missing fields

8. **Deploy**
   - Push, verify in production

### Removing a Feature

Same sequence, reverse intent:
1. Data Model → identify what to remove
2. API → remove endpoints + webhook handlers
3. Dev API UI → clean up
4. Backend → remove logic
5. UI → remove components
6. Review & Test
7. Deploy

### Async Pattern (Kie.ai)

All Kie.ai integrations follow this pattern:

```
[UI Button Click]
  → POST /api/generate-{type}  (our API)
    → POST Kie.ai API           (external)
    ← task_id returned
    → Save task_id + status=pending to DB
  ← Return task_id to UI

[Kie.ai completes]
  → POST /api/webhooks/{type}   (our webhook handler)
    → Validate payload
    → Update DB: status=completed, url, duration
    → UI picks up new state
```

### Hard Rules
- NEVER skip to UI before data model + API are done
- NEVER write API before data model is agreed
- NEVER forget the webhook handler for async features
- Each step must be reviewed before moving to next
- If uncertain, ask — don't assume
