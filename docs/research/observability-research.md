# Observability & Developer Visibility Research

## What Exists Today

### Structured Logger (`editor/src/lib/logger.ts` + `supabase/functions/_shared/logger.ts`)
- Custom `Logger` class with request IDs, timing, log levels (info/success/warn/error)
- Step-aware context (`GenGridImage`, `SplitGridImage`, etc.) with emoji prefixes
- Timing helpers (`startTiming`/`endTiming`) for measuring operations
- Helper methods: `db()` for DB operations, `api()` for external calls, `summary()` for final status
- **Output**: `console.log`/`console.error` only -- no persistence, no structured JSON, no external sink
- Duplicated identically across editor and Supabase Edge Functions

### Toast Notifications (Sonner)
- `sonner` v2.0.7 already installed and wired up via `components/ui/sonner.tsx`
- Used across ~15+ components for success/error/loading feedback
- Mostly for user-initiated actions (export, login, language switch, timeline reset)
- **Gap**: No toasts for async webhook-driven events (storyboard generation progress, video completion, etc.)

### Supabase Realtime (already extensive)
- `workflow-service.ts` has `subscribeToSceneUpdates()` subscribing to 7+ tables via `postgres_changes`
- Tables watched: storyboards, grid_images, first_frames, scenes, voiceovers, backgrounds, objects
- Used by `use-workflow.ts` hook in the storyboard panel
- **Gap**: Realtime data drives UI re-renders but doesn't trigger user-facing notifications (toasts/progress indicators)

### Debug Logs Table
- Webhook handler (`api/webhook/fal/route.ts`) inserts raw fal.ai payloads into `debug_logs` table
- No UI to view these -- only accessible via Supabase dashboard or SQL

### What's Missing
- **No error tracking service** (no Sentry, no GlitchTip, no error boundary reporting)
- **No APM/tracing** (no OpenTelemetry, no distributed trace IDs across webhook chains)
- **No log aggregation** (logs go to stdout only, lost on container restart)
- **No developer dashboard** for monitoring async job status
- **No user-facing progress** for multi-step storyboard workflows
- **361 raw `console.log/error/warn` calls** scattered across 121 files (most bypass the Logger)

---

## Top 3 Recommendations (Ranked by Impact vs Effort)

### 1. Real-Time Workflow Toasts via Supabase Realtime (Quick Win)

**What**: Wire existing Supabase Realtime subscriptions to show toast notifications when async operations complete or fail.

**Why**: The infrastructure is already in place. `subscribeToSceneUpdates()` already watches all relevant tables. Users currently click "approve" and have zero visibility into what happens next. This closes the biggest UX gap with minimal code.

**How to integrate**:
1. Create a `useWorkflowToasts(storyboardId)` hook that:
   - Subscribes to storyboard `plan_status` changes
   - Shows `toast.loading("Generating grid image...")` on `generating`
   - Shows `toast.success("Grid ready for review")` on `grid_ready`
   - Shows `toast.error("Generation failed")` on `failed`
   - Tracks scene video_status changes and shows per-scene progress ("Scene 3/5 video complete")
2. Mount in the editor layout so it works globally, not just when storyboard panel is open
3. Use Sonner's `toast.promise()` and `toast.loading()` with IDs for updateable toasts

**Effort**: ~2-4 hours. No new dependencies. Uses existing Sonner + Supabase Realtime.

**Cost**: Free (already using Supabase Realtime).

---

### 2. Structured JSON Logging + Dev Log Viewer (Medium Effort)

**What**: Upgrade the Logger to output structured JSON, add a lightweight in-app dev log viewer page, and consolidate the 361 scattered `console.*` calls.

**Why**: Logs currently go to stdout as emoji-decorated strings -- useful for local dev but unsearchable, un-parseable, and invisible in production. A structured format makes logs compatible with any future aggregation tool.

**How to integrate**:

**Phase A -- Structured output (quick)**:
1. Add a `toJSON()` method to Logger that outputs `{ timestamp, level, requestId, step, message, data, elapsed_ms }`
2. In production (`NODE_ENV=production`), output JSON; in dev, keep the current pretty format
3. Add a `NEXT_PUBLIC_LOG_LEVEL` env var to control verbosity

**Phase B -- Dev log viewer page (medium)**:
1. Create `/dev/logs` page (behind auth/dev-only middleware) that queries the existing `debug_logs` table
2. Show webhook payloads with filters by step, status, time range
3. Add a simple status dashboard: count of pending/processing/success/failed per step
4. Consider adding a `workflow_events` table for structured event logging beyond raw webhook payloads

**Phase C -- Consolidate console calls (ongoing)**:
- Gradually replace raw `console.*` calls in API routes with `createLogger()` calls
- Priority: webhook handlers, workflow API routes, storyboard routes (the async-critical paths)

**Effort**: Phase A: ~2 hours. Phase B: ~4-6 hours. Phase C: incremental.

**Cost**: Free. Uses existing Supabase DB and Next.js pages.

**Open-source alternatives for log aggregation** (if you outgrow the DB approach):
- **Grafana Loki** -- log aggregation designed for Grafana. Free, self-hosted. Lightweight. Pairs with Grafana dashboards. Would require a Loki instance (Docker) and a log shipper.
- **Pino** -- fast structured JSON logger for Node.js. Drop-in replacement for the custom Logger. Has transports for files, Loki, OpenTelemetry. Zero-overhead in production. (`pino` + `pino-pretty` for dev)

---

### 3. OpenTelemetry Tracing for Async Workflows (Longer-Term)

**What**: Add OpenTelemetry (OTel) instrumentation to trace a storyboard from approve -> fal.ai submission -> webhook callback -> DB update -> next step, as a single distributed trace.

**Why**: The hardest debugging problem is tracing a multi-step async workflow across boundaries (Next.js API route -> fal.ai -> webhook -> Supabase Edge Function -> webhook -> Next.js). A trace ID propagated through the webhook URL params would connect all the dots.

**How to integrate**:
1. **Add `@opentelemetry/sdk-node`** and `@opentelemetry/auto-instrumentations-node` (already in node_modules as transitive deps)
2. **Instrument the approve route** to start a trace span, embed trace ID in the fal.ai webhook URL
3. **Instrument the webhook handler** to continue the trace using the trace ID from URL params
4. **Export traces to Jaeger** (free, self-hosted) or **Grafana Tempo** (free, pairs with Grafana)
5. The existing Logger's `requestId` concept maps naturally to OTel trace/span IDs

**Quick-start path** (just Next.js, no external collector):
```
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```
Then create `instrumentation.ts` (Next.js 16 has built-in support for `instrumentation.ts` file).

**Effort**: ~1-2 days for basic setup. Ongoing for full coverage.

**Cost**: Free. Jaeger or Grafana Tempo are self-hosted and open-source.

**Open-source tools for this**:
- **Jaeger** -- distributed tracing backend. Docker one-liner: `docker run -p 16686:16686 jaegertracing/all-in-one`
- **Grafana Tempo** -- trace backend that integrates with Grafana. Free, simpler than Jaeger for small teams.
- **SigNoz** -- full observability platform (traces + metrics + logs). Self-hosted, open-source alternative to Datadog. Heavier but all-in-one.

---

## Additional Open-Source Tools Worth Knowing

| Tool | Category | Why it's relevant | Self-hosted? |
|------|----------|-------------------|-------------|
| **GlitchTip** | Error tracking | Self-hosted Sentry alternative. Catches unhandled exceptions, groups errors, alerts. | Yes, Docker |
| **Highlight.io** | Session replay + errors + logs | Full-stack observability with a generous free tier. Session replay is unique for debugging UI issues. | Yes (OSS) or hosted free tier |
| **Uptime Kuma** | Uptime monitoring | Monitor webhook endpoints, API health. Simple Docker deploy. | Yes, Docker |
| **Grafana + Loki + Tempo** | Logs + Traces + Dashboards | The "free Datadog" stack. Loki for logs, Tempo for traces, Grafana for dashboards. | Yes, Docker Compose |
| **Pino** | Structured logging | Fast JSON logger for Node.js. 5x faster than Winston. Has transports for Loki, files, pretty-print. | N/A (library) |

---

## Quick Wins vs Longer-Term

### Quick Wins (this week)
1. **Workflow toasts** -- wire Supabase Realtime to Sonner toasts (~2-4 hours)
2. **JSON logging mode** -- add structured output to existing Logger (~2 hours)
3. **Dev log viewer** -- simple `/dev/logs` page querying `debug_logs` table (~4 hours)

### Medium-Term (next sprint)
4. **Consolidate console.* calls** in API routes to use Logger (incremental)
5. **Add `workflow_events` table** for structured event tracking beyond raw payloads
6. **GlitchTip or Highlight.io** for error tracking in production

### Longer-Term (when scale demands it)
7. **OpenTelemetry + Jaeger/Tempo** for distributed tracing
8. **Grafana + Loki** for log aggregation and dashboards
9. **Pino** to replace custom Logger with an industry-standard library
