# Social Page Investigation Report

## Bugs Found

### Bug #1: All accounts show "0 posts" (P1)
- **File:** `src/components/dashboard/social-accounts-list.tsx:359`, `src/components/dashboard/account-group-section.tsx:268`
- **Root cause:** Post counts are derived from `postsByAccount` which merges DB posts + platform posts. The DB (`social_auth.posts`) is empty because posts were published externally. Platform posts are only fetched lazily when a user clicks into a specific account. Until that happens, every account shows "0 posts".
- **Fix:** When an account has not been synced from the platform yet and the count is 0, show a dash ("--") instead of "0 posts" to indicate the count is unknown. Once synced (via "Sync All" or clicking in), show the real count. Pass `platformMediaSyncedAt` to `AccountGroupSection` so grouped accounts also benefit.

### Bug #2: Profile images not showing in group view (P1)
- **File:** `src/components/dashboard/account-group-section.tsx:37`
- **Root cause:** The import line reads `import { Avatar, AvatarFallback } from '@/components/ui/avatar'` — `AvatarImage` is NOT imported. The render code (line 276-279) only uses `AvatarFallback`, never `AvatarImage`. The ungrouped section in `social-accounts-list.tsx` correctly imports and uses `AvatarImage`.
- **Fix:** Import `AvatarImage` and render it with `account.profile_image_url`.

### Bug #2b: Profile image missing in account detail header (P2)
- **File:** `src/components/dashboard/account-posts-list.tsx:4, 82-83`
- **Root cause:** Same issue as Bug #2. `AvatarImage` not imported, only `AvatarFallback` rendered.
- **Fix:** Import `AvatarImage` and render it.

## UI Inconsistencies

### Grouped vs ungrouped account card styling (P2)
- **Ungrouped cards:** `p-4` padding, default `Avatar` size (~40px), post count `text-lg font-semibold`
- **Grouped cards:** `p-3` padding, `Avatar h-8 w-8` (32px), post count `text-sm font-semibold`
- Creates visible size/density difference between sections
- **Recommendation:** Normalize to consistent padding and avatar size

### X button on grouped accounts (P3 -- cosmetic)
- **File:** `src/components/dashboard/account-group-section.tsx:319-330`
- The X button removes an account from a group. It appears on hover (`opacity-0 group-hover:opacity-100`). Functionally correct, but has no tooltip/aria-label explaining what it does. Could be mistaken for "delete account".
- **Recommendation:** Add `title="Remove from group"` for clarity.

## Improvement Suggestions

### P1 (implemented)
1. Show "--" for unsynchronized post counts instead of misleading "0 posts"
2. Fix profile images in group view and detail view

### P2 (implemented)
3. Fix profile image in account detail header
4. Normalize card styling between grouped and ungrouped views

### P3 (documented only)
5. Add tooltip to X (remove from group) button
6. Deduplicate `getInitials()` helper (defined in 3 files)
7. Platform filter shows "facebook" and "facebook_page" separately, both labeled "Facebook" -- could be confusing
8. Consider auto-syncing a few accounts on page load (staggered) for immediate value
9. Show total post count per group in the group header badge
