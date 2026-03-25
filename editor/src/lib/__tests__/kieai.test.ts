import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('kieai', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());

    process.env.KIE_API_KEY = 'test-key';
    process.env.KIE_WEBHOOK_HMAC_KEY = 'test-hmac-key';
    process.env.KIE_API_BASE_URL = 'https://api.kie.ai';
    process.env.KIE_UPLOAD_BASE_URL = 'https://kieai.redpandaai.co';
  });

  it('createTask sends expected request and returns taskId', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { task_id: 'task-123' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { createTask } = await import('../kieai');

    const result = await createTask({
      model: 'kie/model',
      input: { prompt: 'hello' },
      callbackUrl: 'https://app.example.com/callback',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.kie.ai/api/v1/jobs/createTask');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer test-key',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'kie/model',
      input: { prompt: 'hello' },
      callBackUrl: 'https://app.example.com/callback',
    });
    expect(result.taskId).toBe('task-123');
  });

  it('getTaskStatus sends taskId query param and parses response', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 200,
          data: { taskId: 'task-456', state: 'success' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { getTaskStatus } = await import('../kieai');

    const result = await getTaskStatus('task-456');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task-456'
    );
    expect(result).toEqual({
      code: 200,
      data: { taskId: 'task-456', state: 'success' },
    });
  });

  it('uploadFile sends expected payload and dedupes by trimmed URL', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { fileUrl: 'https://cdn.example.com/file.mp4' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const { uploadFile } = await import('../kieai');

    const first = await uploadFile(
      ' https://files.example.com/source.mp4 ',
      'source.mp4',
      'uploads'
    );
    const second = await uploadFile(
      'https://files.example.com/source.mp4',
      'source.mp4',
      'uploads'
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kieai.redpandaai.co/api/file-url-upload');
    expect(JSON.parse(String(init.body))).toEqual({
      fileUrl: 'https://files.example.com/source.mp4',
      fileName: 'source.mp4',
      uploadPath: 'uploads',
    });
    expect(first.fileUrl).toBe('https://cdn.example.com/file.mp4');
    expect(second.fileUrl).toBe('https://cdn.example.com/file.mp4');
  });

  it('createTask throws on 401', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { createTask } = await import('../kieai');

    await expect(
      createTask({ model: 'kie/model', input: { prompt: 'x' } })
    ).rejects.toThrow('kie.ai createTask failed (401): Unauthorized');
  });

  it('uploadFile throws on 429', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: 'Too Many Requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { uploadFile } = await import('../kieai');

    await expect(
      uploadFile('https://example.com/file.mp4', 'file.mp4')
    ).rejects.toThrow('kie.ai upload failed (429): Too Many Requests');
  });

  it('getTaskStatus throws on 500', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ msg: 'Internal Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { getTaskStatus } = await import('../kieai');

    await expect(getTaskStatus('task-500')).rejects.toThrow(
      'kie.ai getTaskStatus failed (500)'
    );
  });

  it('propagates network error when fetch throws', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { createTask } = await import('../kieai');

    await expect(
      createTask({ model: 'kie/model', input: { prompt: 'x' } })
    ).rejects.toThrow('network down');
  });

  it('verifyWebhook returns ok for a valid signature', async () => {
    const { verifyWebhook } = await import('../kieai');
    const taskId = 'task-999';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', 'test-hmac-key')
      .update(`${taskId}.${timestamp}`)
      .digest('base64');

    const result = verifyWebhook({
      payload: { data: { taskId } },
      signature,
      timestamp,
    });

    expect(result).toEqual({ ok: true, taskId });
  });

  it('verifyWebhook rejects an invalid signature', async () => {
    const { verifyWebhook } = await import('../kieai');
    const timestamp = String(Math.floor(Date.now() / 1000));

    const result = verifyWebhook({
      payload: { data: { taskId: 'task-999' } },
      signature: 'invalid-signature',
      timestamp,
    });

    expect(result).toEqual({
      ok: false,
      taskId: 'task-999',
      reason: 'signature_mismatch',
    });
  });

  it('verifyWebhook rejects an expired timestamp', async () => {
    const { verifyWebhook } = await import('../kieai');
    const taskId = 'task-999';
    const timestamp = '1000';
    const signature = createHmac('sha256', 'test-hmac-key')
      .update(`${taskId}.${timestamp}`)
      .digest('base64');

    const result = verifyWebhook({
      payload: { data: { taskId } },
      signature,
      timestamp,
    });

    expect(result).toEqual({
      ok: false,
      taskId: null,
      reason: 'timestamp_out_of_range',
    });
  });

  it('parseResultJson parses valid JSON string', async () => {
    const { parseResultJson } = await import('../kieai');
    expect(parseResultJson('{"foo":"bar"}')).toEqual({ foo: 'bar' });
  });

  it('parseResultJson returns object input as-is', async () => {
    const { parseResultJson } = await import('../kieai');
    expect(parseResultJson({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });

  it('parseResultJson returns empty object for null input', async () => {
    const { parseResultJson } = await import('../kieai');
    expect(parseResultJson(null)).toEqual({});
  });
});
