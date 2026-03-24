// Generic polling endpoint (provider-aware rollout).
// Phase 0: delegates to legacy fal poller; provider-specific task polling
// will be wired in subsequent migration phases.
export { POST } from '../poll-fal/route';
