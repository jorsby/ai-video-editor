import { legacyRouteRetired } from '@/lib/legacy-route';

export async function POST() {
  return legacyRouteRetired({
    route: '/api/workflow/edit-image',
    message:
      'Legacy workflow image editing endpoint is retired in the simplified schema.',
    replacements: ['/api/v2/storyboard/{chapterId}/prompts'],
    details: [
      'Edit scene prompts through canonical prompt endpoints and regenerate via v2 generation routes.',
      'Legacy first_frames/backgrounds/objects image-edit states are no longer supported.',
    ],
  });
}
