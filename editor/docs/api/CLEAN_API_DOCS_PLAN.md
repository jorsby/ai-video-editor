# Clean API Documentation Plan (OpenAPI-First)

## Goal
Use a single, pure API documentation source focused on endpoint contracts and examples.
Remove cookbook/workflow-style narrative from active docs/UI.

## Source of Truth
- **Primary:** `openapi.yaml` (or `/api/dev/openapi` output)
- **Renderer:** `/dev/api/reference` (Scalar)
- **Everything else:** generated or archived

## Keep (Active)
1. `docs/api/auth.md`
2. `docs/api/endpoints.md` (generated from OpenAPI tags)
3. `docs/api/errors.md`
4. `docs/api/webhooks.md`
5. `openapi.yaml`

## Remove from Active Surface
- Cookbook narrative sections
- Workflow stage prose in API docs page
- Non-contract notes mixed into endpoint cards

## Archive (Do not delete history)
Move old docs to:
- `docs/api/archive/cookbook/`
- `docs/api/archive/workflow/`

## UI Changes
### `/dev/api/reference`
- Keep as pure OpenAPI viewer.
- Show tags, schemas, examples, auth.

### `/dev/api`
- Keep as ops/testing panel only.
- Remove cookbook narrative blocks.
- Keep route test + mapping + live events.

## Endpoint Documentation Standard
Each endpoint must include:
- method + path
- auth type
- request schema
- response schema
- error codes
- example request
- example response
- webhook relation (if async)

## Rollout Steps
1. Freeze and validate OpenAPI spec (all current v1 routes).
2. Generate/refresh endpoint docs from spec.
3. Archive cookbook/workflow text docs.
4. Simplify `/dev/api` UI copy to contract-first labels.
5. Final review in UI (reference + ops).

## Acceptance Criteria
- No active page depends on cookbook text.
- API docs are contract-only and example-rich.
- `/dev/api/reference` is the canonical external-facing doc view.
- `/dev/api` is operational testing only.
