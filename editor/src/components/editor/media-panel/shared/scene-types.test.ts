import { describe, expect, it } from 'vitest';

import {
  buildSharedSceneSelect,
  getSceneClipPanelState,
  SCENE_DATA_NOT_FOUND,
  SHARED_SCENE_SELECT_FIELDS,
  type SceneData,
} from '@/components/editor/media-panel/shared/scene-types';

const baseScene: SceneData = {
  id: 'scene-1',
  order: 1,
  title: 'Opening scene',
  structured_prompt: [{ action: 'A character enters the room.' }],
  audio_text: 'Hello there.',
  audio_url: 'https://cdn.example.com/audio.mp3',
  audio_duration: 3.2,
  video_url: 'https://cdn.example.com/video.mp4',
  video_duration: 3.2,
  status: 'ready',
  location_variant_slug: 'control-room-main',
  character_variant_slugs: ['lead-character-main'],
  prop_variant_slugs: ['console-main'],
  tts_status: 'done',
  video_status: 'done',
  tts_generation_metadata: null,
  video_generation_metadata: null,
};

describe('scene shared helpers', () => {
  it('resolves a loading scene clip panel state', () => {
    expect(
      getSceneClipPanelState({
        scene: null,
        isLoading: true,
        error: null,
      })
    ).toEqual({ kind: 'loading' });
  });

  it('resolves a ready scene clip panel state', () => {
    expect(
      getSceneClipPanelState({
        scene: baseScene,
        isLoading: false,
        error: null,
      })
    ).toEqual({ kind: 'ready', scene: baseScene });
  });

  it('resolves generic fetch errors to an inline error state', () => {
    expect(
      getSceneClipPanelState({
        scene: null,
        isLoading: false,
        error: 'network_failed',
      })
    ).toEqual({ kind: 'error', reason: 'load-failed' });
  });

  it('resolves missing scenes to an inline error state', () => {
    expect(
      getSceneClipPanelState({
        scene: null,
        isLoading: false,
        error: SCENE_DATA_NOT_FOUND,
      })
    ).toEqual({ kind: 'error', reason: 'missing-scene' });
  });

  it('shares the scene select fields without the deprecated prompt column', () => {
    expect(SHARED_SCENE_SELECT_FIELDS).not.toContain('prompt');
    expect(SHARED_SCENE_SELECT_FIELDS).toEqual(
      expect.arrayContaining([
        '"order"',
        'structured_prompt',
        'audio_text',
        'audio_url',
        'video_url',
        'tts_status',
        'video_status',
      ])
    );
    expect(buildSharedSceneSelect(['chapter_id'])).toContain('chapter_id');
  });
});
