# Agents

Project conventions and instructions for AI coding agents.

## Smoke Tests

Before committing, run the smoke test against your local dev server:

```bash
# Terminal 1: start dev server
pnpm dev

# Terminal 2: run smoke tests
pnpm test:smoke
# Or against a deployed URL:
pnpm test:smoke --url https://your-app.vercel.app
```

All routes must return expected status codes. If any fail, fix before committing.
