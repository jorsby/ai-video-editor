import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask } from '@/lib/kieai';
import {
  KIE_IMAGE_MODEL,
  normalizeKieAspectRatio,
  normalizeKieResolution,
  queueKieImageTask,
} from '../kie-image';

vi.mock('@/lib/kieai', () => ({
  createTask: vi.fn(),
}));

describe('kie-image', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KIE_API_KEY = 'test-key';
  });

  it('normalizeKieResolution maps expected values', () => {
    expect(normalizeKieResolution('0.5k')).toBe('1K');
    expect(normalizeKieResolution('1k')).toBe('1K');
    expect(normalizeKieResolution('2k')).toBe('2K');
    expect(normalizeKieResolution('3k')).toBe('1K');
    expect(normalizeKieResolution('4k')).toBe('4K');
    expect(normalizeKieResolution(undefined)).toBe('1K');
  });

  it('normalizeKieAspectRatio passes valid values and falls back for invalid', () => {
    expect(normalizeKieAspectRatio('9:16')).toBe('9:16');
    expect(normalizeKieAspectRatio('16:9')).toBe('16:9');
    expect(normalizeKieAspectRatio('1:1')).toBe('1:1');
    expect(normalizeKieAspectRatio('invalid', '16:9')).toBe('16:9');
  });

  it('queueKieImageTask generate mode sends expected model and payload', async () => {
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValueOnce({
      taskId: 'task-generate-1',
      response: { data: { task_id: 'task-generate-1' } },
    });

    await queueKieImageTask({
      prompt: 'A cinematic mountain at sunrise',
      callbackUrl:
        'https://app.example.com/api/webhook/kieai?step=GenerateImage',
      aspectRatio: '9:16',
      resolution: '1k',
      outputFormat: 'png',
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock).toHaveBeenCalledWith({
      model: 'nano-banana-2',
      callbackUrl:
        'https://app.example.com/api/webhook/kieai?step=GenerateImage',
      input: {
        prompt: 'A cinematic mountain at sunrise',
        aspect_ratio: '9:16',
        resolution: '1K',
        output_format: 'png',
      },
    });
    expect(KIE_IMAGE_MODEL).toBe('nano-banana-2');
  });

  it('queueKieImageTask edit mode includes image_input array', async () => {
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValueOnce({
      taskId: 'task-edit-1',
      response: { data: { task_id: 'task-edit-1' } },
    });

    await queueKieImageTask({
      prompt: 'Replace background with snowy mountains',
      callbackUrl: 'https://app.example.com/api/webhook/kieai?step=EditImage',
      aspectRatio: '1:1',
      resolution: '2k',
      outputFormat: 'jpg',
      imageInput: [
        'https://cdn.example.com/image-1.png',
        'https://cdn.example.com/image-2.png',
      ],
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock).toHaveBeenCalledWith({
      model: 'nano-banana-2',
      callbackUrl: 'https://app.example.com/api/webhook/kieai?step=EditImage',
      input: {
        prompt: 'Replace background with snowy mountains',
        aspect_ratio: '1:1',
        resolution: '2K',
        output_format: 'jpg',
        image_input: [
          'https://cdn.example.com/image-1.png',
          'https://cdn.example.com/image-2.png',
        ],
      },
    });
  });
});
