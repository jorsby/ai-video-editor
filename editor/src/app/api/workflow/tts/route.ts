import { legacyRouteRetired } from '@/lib/legacy-route';

export async function POST() {
  return legacyRouteRetired({
    route: '/api/workflow/tts',
    message:
      'Legacy workflow TTS endpoint is retired. Use canonical v2 storyboard TTS endpoint.',
    replacements: ['/api/v2/storyboard/{episodeId}/generate-tts'],
    details: [
      'TTS now runs on canonical scene audio_text and scene-level generation state.',
    ],
  });
}
