import type { NextRequest } from 'next/server';

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isLocalOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1'
    );
  } catch {
    return false;
  }
}

export function resolveWebhookBaseUrl(req?: NextRequest): string | null {
  const requestOrigin = normalizeBaseUrl(req?.nextUrl?.origin);
  const webhookBase = normalizeBaseUrl(process.env.WEBHOOK_BASE_URL);
  const appBase = normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);

  // Prefer the live request origin when it is public and differs from stale envs.
  if (requestOrigin && !isLocalOrigin(requestOrigin)) {
    return requestOrigin;
  }

  return webhookBase ?? appBase ?? requestOrigin;
}

export function requireWebhookBaseUrl(req?: NextRequest): string {
  const resolved = resolveWebhookBaseUrl(req);
  if (!resolved) {
    throw new Error('Missing WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL');
  }
  return resolved;
}

export function isWebhookBasePubliclyReachable(base: string): boolean {
  const allowLocal =
    process.env.ALLOW_LOCAL_WEBHOOK_BASE === '1' ||
    process.env.ALLOW_LOCAL_WEBHOOK_BASE === 'true';
  if (allowLocal) return true;
  return !isLocalOrigin(base);
}

export const LOCAL_WEBHOOK_BASE_ERROR =
  'Webhook callback resolves to localhost; external providers (KIE, Suno, etc.) cannot reach it. Set WEBHOOK_BASE_URL or NEXT_PUBLIC_APP_URL to a publicly reachable URL (ngrok, cloudflared, production domain). Set ALLOW_LOCAL_WEBHOOK_BASE=1 to bypass for local testing without external callbacks.';
