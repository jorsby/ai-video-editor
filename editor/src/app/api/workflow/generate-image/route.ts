import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createTask, getTaskStatus, parseResultJson } from '@/lib/kieai';
import { KIE_IMAGE_MODEL, normalizeKieAspectRatio } from '@/lib/kie-image';

const MAX_STATUS_CHECKS = 30;
const STATUS_CHECK_INTERVAL_MS = 2_000;

type KieTaskState =
  | 'success'
  | 'fail'
  | 'waiting'
  | 'queuing'
  | 'generating'
  | string;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractKieImageUrl(result: Record<string, unknown>): string | null {
  const direct = [
    result.image_url,
    result.imageUrl,
    result.url,
    result.output,
  ].find((candidate) => typeof candidate === 'string' && candidate.length > 0);

  if (typeof direct === 'string') {
    return direct;
  }

  const resultUrls = result.resultUrls;
  if (Array.isArray(resultUrls) && resultUrls.length > 0) {
    const first = resultUrls[0];
    if (typeof first === 'string' && first.length > 0) {
      return first;
    }
  }

  const images = result.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === 'string' && first.length > 0) {
      return first;
    }
    if (first && typeof first === 'object' && 'url' in first) {
      const url = (first as { url?: unknown }).url;
      if (typeof url === 'string' && url.length > 0) {
        return url;
      }
    }
  }

  return null;
}

async function waitForKieImage(taskId: string): Promise<{
  state: KieTaskState;
  imageUrl: string;
}> {
  let lastState: KieTaskState = 'waiting';

  for (let attempt = 0; attempt < MAX_STATUS_CHECKS; attempt += 1) {
    const task = await getTaskStatus(taskId);
    const state = (task.data?.state ?? 'unknown') as KieTaskState;
    lastState = state;

    if (state === 'success') {
      const result = parseResultJson(task.data?.resultJson);
      const imageUrl = extractKieImageUrl(result);

      if (!imageUrl) {
        throw new Error('kie.ai task completed without an image URL');
      }

      return { state, imageUrl };
    }

    if (state === 'fail') {
      throw new Error(task.msg || 'kie.ai image generation failed');
    }

    if (attempt < MAX_STATUS_CHECKS - 1) {
      await sleep(STATUS_CHECK_INTERVAL_MS);
    }
  }

  throw new Error(
    `kie.ai image generation timed out (last state: ${lastState})`
  );
}

export async function POST(req: NextRequest) {
  const supabase = await createClient('studio');
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await req.json().catch(() => null)) as {
      prompt?: unknown;
      aspectRatio?: unknown;
      project_id?: unknown;
    } | null;

    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    const projectId =
      typeof body?.project_id === 'string' ? body.project_id.trim() : '';

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    if (!projectId) {
      return NextResponse.json(
        { error: 'project_id is required' },
        { status: 400 }
      );
    }

    const normalizedAspectRatio = normalizeKieAspectRatio(
      typeof body?.aspectRatio === 'string' ? body.aspectRatio : null,
      '9:16'
    );

    const { taskId } = await createTask({
      model: KIE_IMAGE_MODEL,
      input: {
        prompt,
        aspect_ratio: normalizedAspectRatio,
        resolution: '1K',
        output_format: 'jpg',
      },
    });

    const { imageUrl } = await waitForKieImage(taskId);

    const { data: asset, error: insertError } = await supabase
      .from('assets')
      .insert({
        user_id: user.id,
        project_id: projectId,
        type: 'image',
        url: imageUrl,
        name: prompt,
        prompt,
      })
      .select('id, url')
      .single();

    if (insertError || !asset) {
      return NextResponse.json(
        { error: insertError?.message ?? 'Failed to store generated image' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: asset.id,
      url: asset.url,
      provider: 'kie',
      request_id: taskId,
    });
  } catch (error) {
    console.error('Image generation error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to generate image',
      },
      { status: 500 }
    );
  }
}
