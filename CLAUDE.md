# CLAUDE.md

## Quick Start

1. **Read [`AGENTS.md`](AGENTS.md)** — full project context, architecture, patterns, rules
2. **Read [`HOW-TO-DEVELOP.md`](HOW-TO-DEVELOP.md)** — mandatory development workflow (data model → API → UI)
3. **If working on a project:** Read `docs/projects/<project>/PROJECT.md`

## TL;DR

- **Stack:** Next.js 16 (App Router) + TypeScript + Supabase + Kie.ai + PixiJS compositor
- **Monorepo:** pnpm + Turborepo + Biome (NOT npm/yarn/ESLint/Prettier)
- **AI generation:** All async via Kie.ai → webhook → DB update → Supabase Realtime
- **Webhook route:** `/api/webhook/kieai` (HMAC-verified, no user auth)
- **DB clients:** `admin.ts` (server), `server.ts` (user auth), `client.ts` (browser)
- **Build = test suite:** `cd editor && pnpm build` must pass before any commit
- **Lint:** `pnpm biome check .` must pass

## Key Commands

```bash
pnpm dev                    # Start dev server
cd editor && pnpm build     # Build (= test suite)
pnpm biome check . --write  # Auto-fix lint/format
```

## 📝 Keep Docs Updated (MANDATORY)

After every code change, check if these docs need updating **in the same commit**:

| Doc | Update when... |
|-----|---------------|
| [`docs/API-COOKBOOK.md`](docs/API-COOKBOOK.md) | Any API endpoint added, changed, or removed |
| [`AGENTS.md`](AGENTS.md) | Architecture, patterns, DB schema, env vars, or project structure changes |
| [`HOW-TO-DEVELOP.md`](HOW-TO-DEVELOP.md) | Development workflow or async pattern changes |
| [`CLAUDE.md`](CLAUDE.md) | New top-level rules, stack changes, or critical "don't" items |

**Rule:** If you change an API route, the cookbook update goes in the same commit. Not a follow-up. Not "I'll do it later." Same commit.

## Don't

- Don't use fal.ai — removed, we use Kie.ai
- Don't create Supabase edge functions — use Next.js API routes
- Don't use anon key server-side — use `admin.ts`
- Don't skip `await` on `studio.clear()` or `studio.loadFromJSON()`
- Don't hardcode URLs — use `WEBHOOK_BASE_URL` / `NEXT_PUBLIC_APP_URL`
- Don't change an API without updating `docs/API-COOKBOOK.md`
