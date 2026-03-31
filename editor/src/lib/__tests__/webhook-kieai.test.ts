import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OPTIONS, POST } from '@/app/api/webhook/kieai/route';

const HOISTED = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setContext: vi.fn(),
  };

  return {
    createServiceClientMock: vi.fn(),
    verifyWebhookSignatureMock: vi.fn(),
    parseResultJsonMock: vi.fn(),
    createLoggerMock: vi.fn(),
    logger,
    sharpMock: vi.fn(),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: HOISTED.createServiceClientMock,
}));

vi.mock('@/lib/kieai', () => ({
  parseResultJson: HOISTED.parseResultJsonMock,
  verifyWebhookSignature: HOISTED.verifyWebhookSignatureMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: HOISTED.createLoggerMock,
}));

vi.mock('sharp', () => ({
  default: HOISTED.sharpMock,
}));

type QueryAction = 'select' | 'update' | 'insert' | 'delete' | null;

interface QueryCall {
  table: string;
  action: QueryAction;
  selectColumns?: string;
  updateValues?: Record<string, unknown>;
  insertValues?: unknown;
  filters: Array<{ column: string; value: unknown }>;
  maybeSingle: boolean;
  orderBy?: string;
  orderOptions?: unknown;
  limitCount?: number;
}

interface QueryResult {
  data?: unknown;
  error?: { message: string } | null;
}

interface QueryBuilder extends PromiseLike<QueryResult> {
  select(columns: string): QueryBuilder;
  update(values: Record<string, unknown>): QueryBuilder;
  insert(values: unknown): QueryBuilder;
  delete(): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: unknown): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
}

function defaultParseResultJson(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  if (input && typeof input === 'object') {
    return input as Record<string, unknown>;
  }

  return {};
}

function makeRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): NextRequest {
  return {
    json: async () => body,
    headers: new Headers(headers),
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

function createSupabaseMock() {
  const queries: QueryCall[] = [];
  let resolver = (query: QueryCall): QueryResult => {
    if (query.action === 'select') {
      return { data: query.maybeSingle ? null : [], error: null };
    }

    return { data: null, error: null };
  };

  const execute = async (query: QueryCall): Promise<QueryResult> => {
    const snapshot: QueryCall = {
      table: query.table,
      action: query.action,
      selectColumns: query.selectColumns,
      updateValues: query.updateValues,
      insertValues: query.insertValues,
      filters: [...query.filters],
      maybeSingle: query.maybeSingle,
      orderBy: query.orderBy,
      orderOptions: query.orderOptions,
      limitCount: query.limitCount,
    };

    queries.push(snapshot);
    const result = resolver(snapshot);

    if (snapshot.action === 'select') {
      return {
        data: result.data ?? (snapshot.maybeSingle ? null : ([] as unknown[])),
        error: result.error ?? null,
      };
    }

    return { data: result.data ?? null, error: result.error ?? null };
  };

  const storageUpload = vi.fn(async () => ({ error: null }));
  const storageRemove = vi.fn(async () => ({ error: null }));
  const storageGetPublicUrl = vi.fn((storagePath: string) => ({
    data: { publicUrl: `https://cdn.example.com/${storagePath}` },
  }));

  const storageFrom = vi.fn((_bucket: string) => ({
    upload: storageUpload,
    remove: storageRemove,
    getPublicUrl: storageGetPublicUrl,
  }));

  const from = vi.fn((table: string): QueryBuilder => {
    const query: QueryCall = {
      table,
      action: null,
      filters: [],
      maybeSingle: false,
    };

    const builder: QueryBuilder = {
      select(columns: string) {
        query.action = 'select';
        query.selectColumns = columns;
        return builder;
      },
      update(values: Record<string, unknown>) {
        query.action = 'update';
        query.updateValues = values;
        return builder;
      },
      insert(values: unknown) {
        query.action = 'insert';
        query.insertValues = values;
        return builder;
      },
      delete() {
        query.action = 'delete';
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ column, value });
        return builder;
      },
      order(column: string, options?: unknown) {
        query.orderBy = column;
        query.orderOptions = options;
        return builder;
      },
      limit(count: number) {
        query.limitCount = count;
        return builder;
      },
      maybeSingle() {
        query.maybeSingle = true;
        return execute(query);
      },
      // biome-ignore lint/suspicious/noThenProperty: required for PromiseLike mock
      then<TResult1 = QueryResult, TResult2 = never>(
        onfulfilled?:
          | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?:
          | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
          | null
      ): Promise<TResult1 | TResult2> {
        return execute(query).then(onfulfilled, onrejected);
      },
    };

    return builder;
  });

  return {
    supabase: { from, storage: { from: storageFrom } },
    queries,
    setResolver(nextResolver: (query: QueryCall) => QueryResult) {
      resolver = nextResolver;
    },
    storageUpload,
    storageRemove,
    storageGetPublicUrl,
  };
}

describe('webhook/kieai route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());

    HOISTED.logger.setContext.mockReturnValue(HOISTED.logger);
    HOISTED.createLoggerMock.mockReturnValue(HOISTED.logger);
    HOISTED.parseResultJsonMock.mockImplementation(defaultParseResultJson);
    HOISTED.verifyWebhookSignatureMock.mockReturnValue({
      ok: true,
      taskId: 'task-123',
    });
    HOISTED.sharpMock.mockImplementation(() => ({
      metadata: vi.fn().mockResolvedValue({ width: 2048, height: 2048 }),
      extract: vi.fn(() => ({
        jpeg: vi.fn(() => ({
          toBuffer: vi.fn().mockResolvedValue(Buffer.from('cell-buffer')),
        })),
      })),
    }));
  });

  it('OPTIONS returns 200 with CORS headers', async () => {
    const response = await OPTIONS();

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'POST, OPTIONS'
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain(
      'x-webhook-signature'
    );
  });

  it('GenerateVideo success updates scenes.video_status=success', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'scenes' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: { video_status: 'processing', video_request_id: 'task-123' },
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenerateVideo&scene_id=scene-1',
      {
        data: {
          task_id: 'task-123',
          state: 'success',
          resultJson: JSON.stringify({
            resultUrls: ['https://cdn.example.com/video.mp4'],
          }),
        },
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'GenerateVideo',
      scene_id: 'scene-1',
      video_url: 'https://cdn.example.com/video.mp4',
    });

    const sceneUpdate = supabaseMock.queries.find(
      (query) => query.table === 'scenes' && query.action === 'update'
    );

    expect(sceneUpdate?.updateValues).toEqual({
      video_status: 'success',
      video_url: 'https://cdn.example.com/video.mp4',
      video_error_message: null,
    });
  });

  it('GenerateVideo failure updates scenes.video_status=failed', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'scenes' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: { video_status: 'processing', video_request_id: 'task-123' },
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenerateVideo&scene_id=scene-1',
      { data: { task_id: 'task-123', state: 'fail' } }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'GenerateVideo',
      failed: true,
    });

    const sceneUpdate = supabaseMock.queries.find(
      (query) => query.table === 'scenes' && query.action === 'update'
    );

    expect(sceneUpdate?.updateValues).toEqual({
      video_status: 'failed',
      video_error_message: 'kie.ai task failed (fail)',
    });
  });

  it('GenerateVideo stale request returns ignored=true with reason=status_mismatch', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'scenes' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: { video_status: 'success', video_request_id: 'task-123' },
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenerateVideo&scene_id=scene-1',
      {
        data: {
          task_id: 'task-123',
          state: 'success',
          resultJson: JSON.stringify({
            video_url: 'https://cdn.example.com/video.mp4',
          }),
        },
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      ignored: true,
      reason: 'status_mismatch',
    });
    expect(
      supabaseMock.queries.some(
        (query) => query.table === 'scenes' && query.action === 'update'
      )
    ).toBe(false);
  });

  it('GenerateTTS success parses resultJson.resultUrls[0] and updates voiceovers.status=success', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'voiceovers' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: { status: 'processing', request_id: 'task-123' },
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenerateTTS&voiceover_id=voice-1',
      {
        data: {
          task_id: 'task-123',
          state: 'success',
          resultJson: JSON.stringify({
            resultUrls: ['https://cdn.example.com/audio.mp3'],
          }),
        },
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'GenerateTTS',
      voiceover_id: 'voice-1',
      audio_url: 'https://cdn.example.com/audio.mp3',
    });

    const ttsUpdate = supabaseMock.queries.find(
      (query) => query.table === 'voiceovers' && query.action === 'update'
    );

    expect(ttsUpdate?.updateValues).toEqual({
      status: 'success',
      audio_url: 'https://cdn.example.com/audio.mp3',
      error_message: null,
    });
  });

  it('GenerateTTS failure updates voiceovers.status=failed', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'voiceovers' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: { status: 'processing', request_id: 'task-123' },
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenerateTTS&voiceover_id=voice-1',
      { data: { task_id: 'task-123', state: 'fail' } }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'GenerateTTS',
      failed: true,
    });

    const ttsUpdate = supabaseMock.queries.find(
      (query) => query.table === 'voiceovers' && query.action === 'update'
    );

    expect(ttsUpdate?.updateValues).toEqual({
      status: 'failed',
      error_message: 'kie.ai task failed (fail)',
    });
  });

  it('SeriesAssetImage success downloads image, uploads to storage, inserts variant image record', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'series_asset_variant_images' &&
        query.action === 'select' &&
        query.selectColumns?.includes('id, metadata')
      ) {
        return { data: [], error: null };
      }

      if (
        query.table === 'series_generation_jobs' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: {
            prompt: 'Golden-hour portrait',
            model: 'nano-banana-2',
            config: null,
          },
          error: null,
        };
      }

      if (
        query.table === 'series_asset_variant_images' &&
        query.action === 'select' &&
        query.selectColumns?.includes('storage_path')
      ) {
        return { data: [], error: null };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    );

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=SeriesAssetImage&variant_id=variant-1',
      {
        data: {
          task_id: 'task-123',
          state: 'success',
          resultJson: JSON.stringify({
            image_url: 'https://cdn.example.com/source.png',
          }),
          model: 'nano-banana-2',
        },
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'SeriesAssetImage',
      variant_id: 'variant-1',
    });
    expect(String(body.url)).toContain(
      'https://cdn.example.com/generated/variant-1/'
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdn.example.com/source.png'
    );
    expect(supabaseMock.storageUpload).toHaveBeenCalledTimes(1);

    const variantInsert = supabaseMock.queries.find(
      (query) =>
        query.table === 'series_asset_variant_images' &&
        query.action === 'insert'
    );
    const inserted = (variantInsert?.insertValues ?? {}) as Record<
      string,
      unknown
    >;
    const metadata = (inserted.metadata ?? {}) as Record<string, unknown>;

    expect(inserted).toMatchObject({
      variant_id: 'variant-1',
      angle: 'front',
      kind: 'frontal',
      source: 'generated',
    });
    expect(metadata).toMatchObject({
      provider: 'kie',
      kie_task_id: 'task-123',
      prompt: 'Golden-hour portrait',
      model: 'nano-banana-2',
    });
  });

  it('SeriesAssetImage duplicate returns duplicate=true and does not insert', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'series_asset_variant_images' &&
        query.action === 'select' &&
        query.selectColumns?.includes('id, metadata')
      ) {
        return {
          data: [{ id: 'img-1', metadata: { kie_task_id: 'task-123' } }],
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=SeriesAssetImage&variant_id=variant-1',
      {
        data: {
          task_id: 'task-123',
          state: 'success',
          resultJson: JSON.stringify({
            image_url: 'https://cdn.example.com/source.png',
          }),
        },
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'SeriesAssetImage',
      variant_id: 'variant-1',
      duplicate: true,
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(supabaseMock.storageUpload).not.toHaveBeenCalled();
    expect(
      supabaseMock.queries.some(
        (query) =>
          query.table === 'series_asset_variant_images' &&
          query.action === 'insert'
      )
    ).toBe(false);
  });

  it('GenGridImage success updates grid_images.status=generated', async () => {
    const supabaseMock = createSupabaseMock();
    supabaseMock.setResolver((query) => {
      if (
        query.table === 'grid_images' &&
        query.action === 'select' &&
        query.maybeSingle
      ) {
        return {
          data: { status: 'processing', request_id: 'task-123' },
          error: null,
        };
      }

      return { data: null, error: null };
    });
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenGridImage&grid_image_id=grid-1',
      {
        data: {
          task_id: 'task-123',
          state: 'success',
          resultJson: JSON.stringify({
            image_url: 'https://cdn.example.com/grid.png',
          }),
        },
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      step: 'GenGridImage',
      grid_image_id: 'grid-1',
      image_url: 'https://cdn.example.com/grid.png',
    });

    const gridUpdate = supabaseMock.queries.find(
      (query) => query.table === 'grid_images' && query.action === 'update'
    );

    expect(gridUpdate?.updateValues).toEqual({
      status: 'generated',
      url: 'https://cdn.example.com/grid.png',
      error_message: null,
    });
  });

  it('Missing step param returns ignored with reason=unhandled_step', async () => {
    const supabaseMock = createSupabaseMock();
    HOISTED.createServiceClientMock.mockReturnValue(supabaseMock.supabase);

    const req = makeRequest('https://app.example.com/api/webhook/kieai', {
      data: { task_id: 'task-123', state: 'success' },
    });

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      ignored: true,
      reason: 'unhandled_step',
    });
  });

  it('Invalid signature returns 401', async () => {
    HOISTED.verifyWebhookSignatureMock.mockReturnValueOnce({
      ok: false,
      taskId: null,
      reason: 'signature_mismatch',
    });

    const req = makeRequest(
      'https://app.example.com/api/webhook/kieai?step=GenerateVideo&scene_id=scene-1',
      { data: { task_id: 'task-123', state: 'success' } },
      {
        'x-webhook-signature': 'bad-signature',
        'x-webhook-timestamp': '1711111111',
      }
    );

    const response = await POST(req);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body).toEqual({
      success: false,
      error: 'signature_mismatch',
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(HOISTED.createServiceClientMock).not.toHaveBeenCalled();
  });
});
