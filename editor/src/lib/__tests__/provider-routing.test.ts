import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = {
  PROVIDER_VIDEO: process.env.PROVIDER_VIDEO,
  PROVIDER_TTS: process.env.PROVIDER_TTS,
  PROVIDER_IMAGE: process.env.PROVIDER_IMAGE,
  PROVIDER_ROUTING_TABLE: process.env.PROVIDER_ROUTING_TABLE,
};

describe('provider-routing', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.PROVIDER_VIDEO = '';
    process.env.PROVIDER_TTS = '';
    process.env.PROVIDER_IMAGE = '';
    process.env.PROVIDER_ROUTING_TABLE = '';
  });

  afterEach(() => {
    if (ORIGINAL_ENV.PROVIDER_VIDEO === undefined) {
      delete process.env.PROVIDER_VIDEO;
    } else {
      process.env.PROVIDER_VIDEO = ORIGINAL_ENV.PROVIDER_VIDEO;
    }

    if (ORIGINAL_ENV.PROVIDER_TTS === undefined) {
      delete process.env.PROVIDER_TTS;
    } else {
      process.env.PROVIDER_TTS = ORIGINAL_ENV.PROVIDER_TTS;
    }

    if (ORIGINAL_ENV.PROVIDER_IMAGE === undefined) {
      delete process.env.PROVIDER_IMAGE;
    } else {
      process.env.PROVIDER_IMAGE = ORIGINAL_ENV.PROVIDER_IMAGE;
    }

    if (ORIGINAL_ENV.PROVIDER_ROUTING_TABLE === undefined) {
      delete process.env.PROVIDER_ROUTING_TABLE;
    } else {
      process.env.PROVIDER_ROUTING_TABLE = ORIGINAL_ENV.PROVIDER_ROUTING_TABLE;
    }
  });

  it('returns fal as default when no env/request/db config exists', async () => {
    const { resolveProvider } = await import('../provider-routing');

    const result = await resolveProvider({ service: 'video' });

    expect(result).toEqual({ provider: 'fal', source: 'default' });
  });

  it('returns provider from env for video service', async () => {
    process.env.PROVIDER_VIDEO = 'kie';
    const { resolveProvider } = await import('../provider-routing');

    const result = await resolveProvider({ service: 'video' });

    expect(result).toEqual({ provider: 'kie', source: 'env' });
  });

  it('returns env provider per-service and falls back for unset service', async () => {
    process.env.PROVIDER_TTS = 'kie';
    const { resolveProvider } = await import('../provider-routing');

    const ttsResult = await resolveProvider({ service: 'tts' });
    const imageResult = await resolveProvider({ service: 'image' });

    expect(ttsResult).toEqual({ provider: 'kie', source: 'env' });
    expect(imageResult).toEqual({ provider: 'fal', source: 'default' });
  });

  it('uses request body direct provider override', async () => {
    const { resolveProvider } = await import('../provider-routing');

    const result = await resolveProvider({
      service: 'video',
      body: { provider: 'kie' },
    });

    expect(result).toEqual({ provider: 'kie', source: 'request' });
  });

  it('uses request body service-specific override', async () => {
    const { resolveProvider } = await import('../provider-routing');

    const videoResult = await resolveProvider({
      service: 'video',
      body: { video: 'kie' },
    });
    const ttsResult = await resolveProvider({
      service: 'tts',
      body: { video: 'kie' },
    });

    expect(videoResult).toEqual({ provider: 'kie', source: 'request' });
    expect(ttsResult).toEqual({ provider: 'fal', source: 'default' });
  });

  it('falls back to env/default when provider in body is invalid', async () => {
    process.env.PROVIDER_VIDEO = 'kie';
    const { resolveProvider } = await import('../provider-routing');

    const envFallback = await resolveProvider({
      service: 'video',
      body: { provider: 'invalid-provider' },
    });

    process.env.PROVIDER_VIDEO = '';
    const { resolveProvider: resolveProviderNoEnv } = await import(
      '../provider-routing'
    );
    const defaultFallback = await resolveProviderNoEnv({
      service: 'video',
      body: { provider: 'invalid-provider' },
    });

    expect(envFallback).toEqual({ provider: 'kie', source: 'env' });
    expect(defaultFallback).toEqual({ provider: 'fal', source: 'default' });
  });
});
