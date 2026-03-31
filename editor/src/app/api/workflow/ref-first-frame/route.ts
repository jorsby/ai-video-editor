import { legacyRouteRetired } from '@/lib/legacy-route';

export async function POST() {
  return legacyRouteRetired({
    route: '/api/workflow/ref-first-frame',
    message:
      'Legacy first-frame reference generation endpoint is retired in the simplified schema.',
    replacements: ['/api/v2/storyboard/{episodeId}/generate-video'],
    details: [
      'The canonical pipeline no longer uses first_frames/backgrounds/objects generation tables.',
      'Use episode asset map + prompt updates + generate-video.',
    ],
  });
}
