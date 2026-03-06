# Discovery: Supabase Edge Functions — JWT & Deployment Fix

**Date:** 2026-03-06  
**Status:** Ready for implementation  
**Project:** ai-video-editor  
**Supabase Project Ref:** `lmounotqnrspwuvcoemk`

---

## 1. Root Cause Analysis

### The Symptom
When a user approves a storyboard in the frontend, the call to the `start-workflow` (or `start-ref-workflow`) edge function fails. The API route at `editor/src/app/api/storyboard/approve/route.ts` returns **"Failed to start workflow"** (HTTP 500).

### The Call Chain
```
Browser → Next.js API route (approve/route.ts)
    → supabase.auth.getUser() ← verifies the user is logged in
    → fetch(`${supabaseUrl}/functions/v1/start-workflow`, {
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,   // ← THE PROBLEM
          apikey: supabaseAnonKey,
        },
        body: JSON.stringify(workflowBody)
      })
```

### Why It Fails

The edge function gateway's JWT verification rejects the request. Here's the chain of events:

1. **The frontend sends the anon key as the Bearer token** — not a user session JWT. The anon key is a pre-signed HS256 JWT (`{"alg":"HS256","typ":"JWT"}`) with `"role":"anon"`.

2. **The `config.toml` has `verify_jwt = false` for all functions** — this SHOULD disable gateway-level JWT verification. However, there are two known ways this setting fails to reach production:

   **Cause A — Functions were deployed before `config.toml` was configured (most likely):**
   If functions were deployed with `supabase functions deploy` BEFORE the `[functions.start-workflow] verify_jwt = false` entries were added to `config.toml`, the deployed functions retain the default setting: **verify_jwt = true**. The config.toml is only read at deploy time — it is not retroactively applied to already-deployed functions.

   **Cause B — Project migrated to new JWT signing keys:**
   Supabase is deprecating legacy HS256 JWT secrets in favor of asymmetric signing keys (ES256/RSA). If the project was migrated (or auto-migrated) to the new signing keys system, the edge function gateway may reject the HS256-signed anon key even with verify_jwt = true, because it now expects ES256. The comment in `approve/route.ts` suggests someone already encountered this:
   > "Supabase Auth issues ES256 JWTs which the edge function gateway cannot verify (it expects HS256)"

   This comment has the algorithm mismatch backwards (Auth → ES256, gateway expects HS256), but it confirms an algorithm mismatch exists.

3. **The gateway returns a 401/403**, which the frontend interprets as a generic failure and surfaces as "Failed to start workflow".

### Why It Works Locally
`supabase functions serve` reads `config.toml` at startup and applies `verify_jwt = false` immediately. The local development gateway skips JWT verification as configured. There is no stale deployed state to worry about.

---

## 2. Exact Fix Steps

### Step 1: Re-deploy all functions with config.toml (PRIMARY FIX)

The Supabase CLI reads `config.toml` during deployment. Re-deploying ensures the `verify_jwt = false` setting is pushed to production.

```bash
cd ~/Development/ai-video-editor

# Login if not already authenticated
supabase login

# Verify the project is linked (should show lmounotqnrspwuvcoemk)
cat supabase/.temp/project-ref

# Deploy ALL functions — CLI reads config.toml and applies verify_jwt = false
supabase functions deploy --project-ref lmounotqnrspwuvcoemk
```

This is the official approach per Supabase docs:
> "Individual function configuration like JWT verification and import map location can be set via the config.toml file. This ensures your function configurations are consistent across all environments and deployments."

### Step 2: Verify via the Supabase Dashboard

After deploying, check each function in the **Supabase Dashboard**:
1. Go to: `https://supabase.com/dashboard/project/lmounotqnrspwuvcoemk/functions`
2. Click on each function (start-workflow, start-ref-workflow, webhook, etc.)
3. Look for the **"Enforce JWT Verification"** toggle — it should be **OFF**
4. If any function still shows JWT verification enabled, toggle it off manually

### Step 3: Alternative — Deploy with explicit --no-verify-jwt flag

If Step 1 doesn't work (e.g., config.toml parsing bug in the CLI version), deploy each function individually with the flag:

```bash
cd ~/Development/ai-video-editor

for fn in start-workflow start-ref-workflow webhook approve-grid-split approve-ref-split generate-sfx generate-tts generate-video edit-image poll-skyreels; do
  supabase functions deploy "$fn" --no-verify-jwt --project-ref lmounotqnrspwuvcoemk
done
```

### Step 4: Verify the fix with curl

```bash
# Test that the function is reachable (should get a 400 "Missing required fields", not a 401)
curl -X POST \
  "https://lmounotqnrspwuvcoemk.supabase.co/functions/v1/start-workflow" \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -d '{"test": true}'
```

**Expected response:** `{"success":false,"error":"Missing required fields"}` (400)  
**Before fix:** `{"msg":"Invalid JWT"}` or similar (401/403)

---

## 3. Security Considerations

### What disabling JWT verification means

With `verify_jwt = false`, the Supabase edge function gateway **does not check the Authorization header** at all. Anyone who knows the function URL can invoke it. The `apikey` header (anon key) is still required by the API gateway for rate limiting and project routing, but it's a public key — not a secret.

### Why this is acceptable for this project

1. **The edge functions use `SUPABASE_SERVICE_ROLE_KEY` internally.** All database operations in `start-workflow/index.ts` use a service role client:
   ```typescript
   const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
   ```
   The service role key is a Supabase secret (environment variable), not exposed to the client.

2. **The caller (approve/route.ts) already authenticates the user** via `supabase.auth.getUser()` before calling the edge function. The auth check happens server-side in the Next.js API route.

3. **Input validation exists** in the edge function — `validateInput()` checks all required fields.

4. **The webhook function MUST be public** — it's called by fal.ai as a callback. JWT verification would break the webhook entirely.

### Risks and mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Direct invocation by attackers who know the function URL | Medium | The anon key is required (public but acts as a basic rate-limiting barrier). Add server-side API key validation if needed. |
| Abuse of fal.ai credits via direct start-workflow calls | Medium | Consider adding a shared secret header between the Next.js API route and edge functions. |
| Data integrity issues from invalid payloads | Low | `validateInput()` already handles this. |

### Recommended hardening (future)

If you want to add a layer of protection without relying on JWT verification:

```typescript
// In the edge function, verify a shared secret
const INTERNAL_API_KEY = Deno.env.get('INTERNAL_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();
  
  // Verify internal API key for non-webhook functions
  const apiKey = req.headers.get('x-internal-key');
  if (apiKey !== INTERNAL_API_KEY) {
    return errorResponse('Unauthorized', 401);
  }
  // ... rest of function
});
```

Then set the secret:
```bash
supabase secrets set INTERNAL_API_KEY=<random-secret> --project-ref lmounotqnrspwuvcoemk
```

And pass it from the Next.js route:
```typescript
headers: {
  'Content-Type': 'application/json',
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'x-internal-key': process.env.INTERNAL_API_KEY!,
},
```

---

## 4. Background: Supabase JWT Evolution

Supabase is actively migrating from legacy HS256 JWT secrets to asymmetric signing keys (ES256/RSA). Key facts:

- **Legacy system:** Single shared HS256 secret signs everything (anon key, service_role, user tokens).
- **New system:** Asymmetric keys (ES256) for user session JWTs, separate publishable/secret API keys.
- **Edge function gateway:** Historically verified JWTs using the legacy HS256 secret. With the new signing keys, the gateway's built-in verification breaks for ES256 tokens.
- **Supabase's recommendation** (per GitHub Discussion #34988): Disable legacy JWT verification (`--no-verify-jwt`) and implement custom JWT validation in the function code if needed, using `supabase.auth.getClaims()` or the `jose` library.
- **The `verify_jwt` flag itself is being phased out** — Supabase now recommends owning JWT validation in your function code rather than relying on the gateway.

---

## 5. Testing Checklist

### Pre-deployment
- [ ] Verify Supabase CLI is authenticated: `supabase projects list`
- [ ] Verify project is linked: `cat supabase/.temp/project-ref` → `lmounotqnrspwuvcoemk`
- [ ] Verify `config.toml` has `verify_jwt = false` for all 10 functions
- [ ] Verify all required secrets are set: `supabase secrets list --project-ref lmounotqnrspwuvcoemk`
  - Required: `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-set by Supabase)

### Deployment
- [ ] Run `supabase functions deploy --project-ref lmounotqnrspwuvcoemk`
- [ ] Verify no errors in deployment output
- [ ] Check Dashboard: each function shows JWT verification disabled

### Post-deployment verification
- [ ] **curl test:** POST to `start-workflow` with anon key → should get 400 (bad input), not 401 (auth error)
- [ ] **curl test:** POST to `webhook` without any auth → should get through (webhooks must be public)
- [ ] **Frontend test:** Create a new storyboard, fill in a plan, click approve → workflow should start
- [ ] **Frontend test:** Verify "generating" status appears (not "Failed to start workflow")
- [ ] **E2E test:** Complete a full workflow — storyboard → grid generation → webhook callback → scenes created

### Rollback plan
If something breaks:
1. Re-deploy with JWT verification enabled:
   ```bash
   supabase functions deploy --project-ref lmounotqnrspwuvcoemk
   ```
2. Switch the frontend to pass a real user JWT instead of the anon key (requires code changes in approve/route.ts)

---

## 6. Files Involved

| File | Role | Changes Needed |
|------|------|---------------|
| `supabase/config.toml` | JWT config for all functions | ✅ Already correct — has `verify_jwt = false` |
| `editor/src/app/api/storyboard/approve/route.ts` | Frontend caller | ❌ No changes needed (fix is deployment-side) |
| `supabase/functions/start-workflow/index.ts` | Edge function | ❌ No changes needed |
| `supabase/functions/start-ref-workflow/index.ts` | Edge function (ref mode) | ❌ No changes needed |
| `supabase/functions/webhook/index.ts` | fal.ai callback | ❌ No changes needed |

**TL;DR: The code is correct. The fix is re-deploying the functions so that `config.toml`'s `verify_jwt = false` is applied to the production instances.**
