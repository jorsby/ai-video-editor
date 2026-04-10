# CLAUDE.md

**Read [`AGENTS.md`](AGENTS.md)** for full project context, architecture, patterns, and rules.
**Read [`HOW-TO-DEVELOP.md`](HOW-TO-DEVELOP.md)** for the mandatory development workflow (data model → API → UI).
**If working on a project:** Read `docs/projects/<project>/PROJECT.md`.

## Quick Reference

```bash
pnpm dev                    # Start dev server
cd editor && pnpm build     # Build (= test suite, must pass before commit)
pnpm biome check . --write  # Auto-fix lint/format
```

## Git Workflow

- Push directly to `main` — no branches, no PRs
- Commit prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- One logical change per commit
- `pnpm build` before pushing

## Keep Docs Updated (same commit as code change)

| Doc | Update when... |
|-----|---------------|
| [`API-COOKBOOK.md`](API-COOKBOOK.md) | Any API endpoint added, changed, or removed |
| [`AGENTS.md`](AGENTS.md) | Architecture, patterns, DB schema, env vars, or project structure changes |
| [`HOW-TO-DEVELOP.md`](HOW-TO-DEVELOP.md) | Development workflow or async pattern changes |
