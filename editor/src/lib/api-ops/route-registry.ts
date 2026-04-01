export type ApiRouteMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type ApiRouteCategory =
  | 'project'
  | 'series'
  | 'episode'
  | 'asset'
  | 'variant'
  | 'scene'
  | 'webhook';

export type ApiRouteAuth =
  | 'session-or-api-key'
  | 'session'
  | 'webhook-signature';

export type ApiRouteDefinition = {
  id: string;
  label: string;
  method: ApiRouteMethod;
  pathTemplate: string;
  category: ApiRouteCategory;
  auth: ApiRouteAuth;
  description: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
};

// ─── Projects ────────────────────────────────────────────────────────────────

const projectRoutes: ApiRouteDefinition[] = [
  {
    id: 'v2-projects-list',
    label: 'List projects',
    method: 'GET',
    pathTemplate: '/api/v2/projects',
    category: 'project',
    auth: 'session-or-api-key',
    description:
      'Returns all projects owned by the authenticated user, ordered by creation date.',
    body: null,
    response: {
      projects: [
        {
          id: 'uuid',
          name: 'My Series Project',
          description: 'Optional description',
          created_at: '2026-03-31T00:00:00Z',
          updated_at: '2026-03-31T00:00:00Z',
        },
      ],
    },
  },
  {
    id: 'v2-projects-create',
    label: 'Create project',
    method: 'POST',
    pathTemplate: '/api/v2/projects',
    category: 'project',
    auth: 'session-or-api-key',
    description:
      'Creates a new project. A project is the top-level container that holds one or more series.',
    body: {
      name: 'My Series Project',
      description: 'Optional project description',
    },
    response: {
      id: 'uuid',
      name: 'My Series Project',
      description: 'Optional project description',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-project-get',
    label: 'Get project',
    method: 'GET',
    pathTemplate: '/api/v2/projects/{id}',
    category: 'project',
    auth: 'session-or-api-key',
    description: 'Returns a single project by ID with all fields.',
    pathParams: { id: 'project-uuid' },
    body: null,
    response: {
      id: 'uuid',
      name: 'My Series Project',
      description: 'Optional project description',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-project-update',
    label: 'Update project',
    method: 'PATCH',
    pathTemplate: '/api/v2/projects/{id}',
    category: 'project',
    auth: 'session-or-api-key',
    description:
      'Updates project fields. Only pass the fields you want to change. Set description to null to clear it.',
    pathParams: { id: 'project-uuid' },
    body: {
      name: 'Updated Project Name',
      description: 'Updated description or null to clear',
    },
    response: {
      id: 'uuid',
      name: 'Updated Project Name',
      description: 'Updated description',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-project-delete',
    label: 'Delete project',
    method: 'DELETE',
    pathTemplate: '/api/v2/projects/{id}',
    category: 'project',
    auth: 'session-or-api-key',
    description:
      'Hard-deletes a project and everything under it: series → assets → variants → episodes → scenes. No soft delete.',
    pathParams: { id: 'project-uuid' },
    body: null,
    response: {
      deleted: true,
      id: 'project-uuid',
    },
  },
];

// ─── Series ──────────────────────────────────────────────────────────────────

const seriesRoutes: ApiRouteDefinition[] = [
  {
    id: 'v2-series-create',
    label: 'Create series',
    method: 'POST',
    pathTemplate: '/api/v2/series/create',
    category: 'series',
    auth: 'session-or-api-key',
    description:
      'Creates a new series linked to a project. A series defines the creative identity: genre, tone, bible, models, and content mode.',
    body: {
      project_id: 'project-uuid',
      name: 'Stories of Mercy',
      genre: 'historical drama',
      tone: 'Cinematic, emotionally rich',
      bible: 'Full creative brief / world description...',
      content_mode: 'narrative',
      language: 'en',
      aspect_ratio: '16:9',
      video_model: 'kling-v2.1',
      image_model: 'flux-1.1-pro',
      voice_id: 'voice-123',
      tts_speed: 1.0,
      visual_style: 'Photorealistic cinematic, warm golden-hour tones',
    },
    response: {
      id: 'series-uuid',
      project_id: 'project-uuid',
      name: 'Stories of Mercy',
      genre: 'historical drama',
      tone: 'Cinematic, emotionally rich',
      bible: 'Full creative brief...',
      content_mode: 'narrative',
      language: 'en',
      aspect_ratio: '16:9',
      video_model: 'kling-v2.1',
      image_model: 'flux-1.1-pro',
      voice_id: 'voice-123',
      tts_speed: 1.0,
      visual_style: 'Photorealistic cinematic, warm golden-hour tones',
      creative_brief: null,
      plan_status: 'draft',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-series-get',
    label: 'Get series',
    method: 'GET',
    pathTemplate: '/api/v2/series/{id}',
    category: 'series',
    auth: 'session-or-api-key',
    description:
      'Returns full series detail including all config fields (models, voice, style, creative brief).',
    pathParams: { id: 'series-uuid' },
    body: null,
    response: {
      id: 'series-uuid',
      project_id: 'project-uuid',
      name: 'Stories of Mercy',
      genre: 'historical drama',
      tone: 'Cinematic, emotionally rich',
      bible: 'Full creative brief...',
      content_mode: 'narrative',
      language: 'en',
      aspect_ratio: '16:9',
      video_model: 'kling-v2.1',
      image_model: 'flux-1.1-pro',
      voice_id: 'voice-123',
      tts_speed: 1.0,
      visual_style: 'Photorealistic cinematic, warm golden-hour tones',
      creative_brief: null,
      plan_status: 'draft',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-series-update',
    label: 'Update series',
    method: 'PATCH',
    pathTemplate: '/api/v2/series/{id}',
    category: 'series',
    auth: 'session-or-api-key',
    description:
      'Updates any series field. Only pass fields you want to change. Supports: name, genre, tone, bible, content_mode, language, aspect_ratio, video_model, image_model, voice_id, tts_speed, visual_style, creative_brief, plan_status.',
    pathParams: { id: 'series-uuid' },
    body: {
      name: 'Updated Series Name',
      genre: 'sci-fi',
      tone: 'Dark and atmospheric',
      bible: 'Updated world description...',
      content_mode: 'cinematic',
      language: 'tr',
      aspect_ratio: '9:16',
      video_model: 'kling-v2.1',
      image_model: 'flux-1.1-pro',
      voice_id: 'voice-456',
      tts_speed: 1.2,
      visual_style: 'Neon noir, high contrast',
      creative_brief: { theme: 'Redemption', audience: 'Young adults' },
      plan_status: 'finalized',
    },
    response: {
      id: 'series-uuid',
      name: 'Updated Series Name',
      genre: 'sci-fi',
      content_mode: 'cinematic',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-series-delete',
    label: 'Delete series',
    method: 'DELETE',
    pathTemplate: '/api/v2/series/{id}',
    category: 'series',
    auth: 'session-or-api-key',
    description:
      'Hard-deletes a series and everything under it: assets → variants → episodes → scenes. Does NOT delete the parent project.',
    pathParams: { id: 'series-uuid' },
    body: null,
    response: {
      deleted: true,
      id: 'series-uuid',
    },
  },
];

// ─── Episodes ────────────────────────────────────────────────────────────────

const episodeRoutes: ApiRouteDefinition[] = [
  {
    id: 'v2-episodes-list',
    label: 'List episodes',
    method: 'GET',
    pathTemplate: '/api/v2/series/{id}/episodes',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Lists all episodes for a series, ordered by the order column. Each episode includes title, synopsis, status, and asset map.',
    pathParams: { id: 'series-uuid' },
    body: null,
    response: {
      episodes: [
        {
          id: 'episode-uuid',
          series_id: 'series-uuid',
          order: 1000,
          title: 'The Arrival',
          synopsis: 'A stranger arrives at the village gate at dusk...',
          audio_content: 'Full narration text for the episode...',
          visual_outline: 'Visual direction notes...',
          asset_variant_map: {
            characters: ['ali-main'],
            locations: ['medina-courtyard-main'],
            props: ['seal-ring-main'],
          },
          plan_json: null,
          status: 'draft',
          created_at: '2026-03-31T00:00:00Z',
          updated_at: '2026-03-31T00:00:00Z',
        },
      ],
    },
  },
  {
    id: 'v2-episodes-create-batch',
    label: 'Create episodes (batch)',
    method: 'POST',
    pathTemplate: '/api/v2/series/{id}/episodes',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Creates one or more episodes in a single request. Order is auto-assigned at 1000 increments. Send an array of episode objects.',
    pathParams: { id: 'series-uuid' },
    body: {
      _note: 'Send an array at top level',
      episodes: [
        {
          title: 'The Arrival',
          synopsis: 'A stranger arrives at the village gate at dusk...',
          audio_content: 'Full narration text...',
          visual_outline: 'Visual direction notes...',
        },
        {
          title: 'The Confrontation',
          synopsis: 'The village elders challenge the stranger...',
          audio_content: 'Dialog and narration...',
          visual_outline: 'Tense close-ups, dramatic lighting...',
        },
      ],
    },
    response: {
      episodes: [
        {
          id: 'episode-uuid-1',
          order: 1000,
          title: 'The Arrival',
          status: 'draft',
        },
        {
          id: 'episode-uuid-2',
          order: 2000,
          title: 'The Confrontation',
          status: 'draft',
        },
      ],
    },
  },
  {
    id: 'v2-episode-get',
    label: 'Get episode',
    method: 'GET',
    pathTemplate: '/api/v2/episodes/{id}',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Returns a single episode with all fields including asset_variant_map and plan_json.',
    pathParams: { id: 'episode-uuid' },
    body: null,
    response: {
      id: 'episode-uuid',
      series_id: 'series-uuid',
      order: 1000,
      title: 'The Arrival',
      synopsis: 'A stranger arrives at the village gate at dusk...',
      audio_content: 'Full narration text...',
      visual_outline: 'Visual direction notes...',
      asset_variant_map: {
        characters: ['ali-main'],
        locations: ['medina-courtyard-main'],
        props: ['seal-ring-main'],
      },
      plan_json: null,
      status: 'draft',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-episode-update',
    label: 'Update episode',
    method: 'PATCH',
    pathTemplate: '/api/v2/episodes/{id}',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Updates one or more episode fields. Supports: title, synopsis, audio_content, visual_outline, order, status (draft|ready|in_progress|done), asset_variant_map, plan_json.',
    pathParams: { id: 'episode-uuid' },
    body: {
      title: 'Updated Episode Title',
      synopsis: 'Updated synopsis...',
      audio_content: 'Updated narration text...',
      visual_outline: 'Updated visual notes...',
      status: 'ready',
      order: 1500,
      asset_variant_map: {
        characters: ['ali-main', 'fatima-night'],
        locations: ['medina-courtyard-main'],
        props: [],
      },
    },
    response: {
      id: 'episode-uuid',
      title: 'Updated Episode Title',
      status: 'ready',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-episode-delete',
    label: 'Delete episode',
    method: 'DELETE',
    pathTemplate: '/api/v2/episodes/{id}',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Hard-deletes an episode and all its scenes (cascade). Does NOT delete the parent series.',
    pathParams: { id: 'episode-uuid' },
    body: null,
    response: { deleted: true, id: 'episode-uuid' },
  },
  {
    id: 'v2-episode-map-assets',
    label: 'Auto-map episode assets',
    method: 'POST',
    pathTemplate: '/api/v2/episodes/{id}/map-assets',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Scans all scenes in the episode, collects unique variant slugs, and writes the aggregated asset_variant_map back to the episode. No LLM needed — pure slug resolution.',
    pathParams: { id: 'episode-uuid' },
    body: null,
    response: {
      asset_variant_map: {
        characters: ['ali-main', 'fatima-night'],
        locations: ['medina-courtyard-main'],
        props: ['seal-ring-main'],
      },
    },
  },
  {
    id: 'v2-episode-asset-map-get',
    label: 'Get episode asset map',
    method: 'GET',
    pathTemplate: '/api/v2/episodes/{id}/asset-map',
    category: 'episode',
    auth: 'session-or-api-key',
    description:
      'Returns the current asset_variant_map JSONB for an episode. Shows which character/location/prop variant slugs are referenced.',
    pathParams: { id: 'episode-uuid' },
    body: null,
    response: {
      asset_variant_map: {
        characters: ['ali-main'],
        locations: ['medina-courtyard-main'],
        props: ['seal-ring-main'],
      },
    },
  },
];

// ─── Assets (Characters / Locations / Props) ─────────────────────────────────

const assetRoutes: ApiRouteDefinition[] = [
  // Characters
  {
    id: 'v2-characters-list',
    label: 'List characters',
    method: 'GET',
    pathTemplate: '/api/v2/series/{id}/characters',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Lists all character assets for a series with their variants. Each asset has a slug, description, and one or more variants.',
    pathParams: { id: 'series-uuid' },
    body: null,
    response: {
      items: [
        {
          id: 'asset-uuid',
          series_id: 'series-uuid',
          type: 'character',
          name: 'Ali',
          slug: 'ali',
          description: 'Young brave companion with a kind heart',
          sort_order: 0,
          created_at: '2026-03-31T00:00:00Z',
          updated_at: '2026-03-31T00:00:00Z',
          variants: [
            {
              id: 'variant-uuid',
              name: 'Default',
              slug: 'ali-main',
              prompt: 'Young man, 20s, dark hair, determined expression...',
              image_url: null,
              is_main: true,
              where_to_use: 'Standard daylight scenes',
              reasoning: 'Primary appearance for most scenes',
            },
          ],
        },
      ],
    },
  },
  {
    id: 'v2-characters-create',
    label: 'Create characters (batch)',
    method: 'POST',
    pathTemplate: '/api/v2/series/{id}/characters',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Creates one or more character assets. Send a bare JSON array (not wrapped in an object). Each character auto-gets a default variant. Slug is auto-generated from name.',
    pathParams: { id: 'series-uuid' },
    body: {
      _note: 'Send a bare array at top level: [{...}, {...}]',
      example: [
        {
          name: 'Ali',
          description: 'Young brave companion with a kind heart',
        },
        {
          name: 'Fatima',
          description: 'Wise elder woman who guides the village',
        },
      ],
    },
    response: {
      items: [
        {
          id: 'asset-uuid-1',
          type: 'character',
          name: 'Ali',
          slug: 'ali',
        },
        {
          id: 'asset-uuid-2',
          type: 'character',
          name: 'Fatima',
          slug: 'fatima',
        },
      ],
    },
  },
  {
    id: 'v2-character-update',
    label: 'Update character',
    method: 'PATCH',
    pathTemplate: '/api/v2/characters/{id}',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Updates a character asset. Supports: name, slug, description, sort_order.',
    pathParams: { id: 'asset-uuid' },
    body: {
      name: 'Updated Character Name',
      slug: 'updated-slug',
      description: 'Updated character description',
      sort_order: 1,
    },
    response: {
      id: 'asset-uuid',
      type: 'character',
      name: 'Updated Character Name',
      slug: 'updated-slug',
      description: 'Updated character description',
      sort_order: 1,
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-character-delete',
    label: 'Delete character',
    method: 'DELETE',
    pathTemplate: '/api/v2/characters/{id}',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Hard-deletes a character asset and all its variants (cascade).',
    pathParams: { id: 'asset-uuid' },
    body: null,
    response: { deleted: true, id: 'asset-uuid' },
  },

  // Locations
  {
    id: 'v2-locations-list',
    label: 'List locations',
    method: 'GET',
    pathTemplate: '/api/v2/series/{id}/locations',
    category: 'asset',
    auth: 'session-or-api-key',
    description: 'Lists all location assets for a series with their variants.',
    pathParams: { id: 'series-uuid' },
    body: null,
    response: {
      items: [
        {
          id: 'asset-uuid',
          series_id: 'series-uuid',
          type: 'location',
          name: 'Medina Courtyard',
          slug: 'medina-courtyard',
          description: 'Open courtyard surrounded by arched corridors',
          sort_order: 0,
          variants: [
            {
              id: 'variant-uuid',
              name: 'Default',
              slug: 'medina-courtyard-main',
              prompt: 'Sunlit open courtyard with sandstone arches...',
              image_url: null,
              is_main: true,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'v2-locations-create',
    label: 'Create locations (batch)',
    method: 'POST',
    pathTemplate: '/api/v2/series/{id}/locations',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Creates one or more location assets. Send a bare JSON array. Each location auto-gets a default variant.',
    pathParams: { id: 'series-uuid' },
    body: {
      _note: 'Send a bare array at top level: [{...}, {...}]',
      example: [
        {
          name: 'Medina Courtyard',
          description: 'Open courtyard surrounded by arched corridors',
        },
        {
          name: 'Desert Road',
          description: 'Dusty desert road at sunset with distant mountains',
        },
      ],
    },
    response: {
      items: [
        {
          id: 'asset-uuid-1',
          type: 'location',
          name: 'Medina Courtyard',
          slug: 'medina-courtyard',
        },
        {
          id: 'asset-uuid-2',
          type: 'location',
          name: 'Desert Road',
          slug: 'desert-road',
        },
      ],
    },
  },
  {
    id: 'v2-location-update',
    label: 'Update location',
    method: 'PATCH',
    pathTemplate: '/api/v2/locations/{id}',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Updates a location asset. Supports: name, slug, description, sort_order.',
    pathParams: { id: 'asset-uuid' },
    body: {
      name: 'Updated Location',
      slug: 'updated-location',
      description: 'Updated location description',
      sort_order: 2,
    },
    response: {
      id: 'asset-uuid',
      type: 'location',
      name: 'Updated Location',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-location-delete',
    label: 'Delete location',
    method: 'DELETE',
    pathTemplate: '/api/v2/locations/{id}',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Hard-deletes a location asset and all its variants (cascade).',
    pathParams: { id: 'asset-uuid' },
    body: null,
    response: { deleted: true, id: 'asset-uuid' },
  },

  // Props
  {
    id: 'v2-props-list',
    label: 'List props',
    method: 'GET',
    pathTemplate: '/api/v2/series/{id}/props',
    category: 'asset',
    auth: 'session-or-api-key',
    description: 'Lists all prop assets for a series with their variants.',
    pathParams: { id: 'series-uuid' },
    body: null,
    response: {
      items: [
        {
          id: 'asset-uuid',
          series_id: 'series-uuid',
          type: 'prop',
          name: 'Seal Ring',
          slug: 'seal-ring',
          description:
            'Continuity-critical signet ring passed through generations',
          sort_order: 0,
          variants: [
            {
              id: 'variant-uuid',
              name: 'Default',
              slug: 'seal-ring-main',
              prompt: 'Gold signet ring with intricate arabesque engraving...',
              image_url: null,
              is_main: true,
            },
          ],
        },
      ],
    },
  },
  {
    id: 'v2-props-create',
    label: 'Create props (batch)',
    method: 'POST',
    pathTemplate: '/api/v2/series/{id}/props',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Creates one or more prop assets. Send a bare JSON array. Each prop auto-gets a default variant.',
    pathParams: { id: 'series-uuid' },
    body: {
      _note: 'Send a bare array at top level: [{...}, {...}]',
      example: [
        {
          name: 'Seal Ring',
          description:
            'Continuity-critical signet ring passed through generations',
        },
        {
          name: 'Ancient Scroll',
          description: 'Weathered parchment with hidden message',
        },
      ],
    },
    response: {
      items: [
        {
          id: 'asset-uuid-1',
          type: 'prop',
          name: 'Seal Ring',
          slug: 'seal-ring',
        },
        {
          id: 'asset-uuid-2',
          type: 'prop',
          name: 'Ancient Scroll',
          slug: 'ancient-scroll',
        },
      ],
    },
  },
  {
    id: 'v2-prop-update',
    label: 'Update prop',
    method: 'PATCH',
    pathTemplate: '/api/v2/props/{id}',
    category: 'asset',
    auth: 'session-or-api-key',
    description:
      'Updates a prop asset. Supports: name, slug, description, sort_order.',
    pathParams: { id: 'asset-uuid' },
    body: {
      name: 'Updated Prop',
      slug: 'updated-prop',
      description: 'Updated prop description',
      sort_order: 1,
    },
    response: {
      id: 'asset-uuid',
      type: 'prop',
      name: 'Updated Prop',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-prop-delete',
    label: 'Delete prop',
    method: 'DELETE',
    pathTemplate: '/api/v2/props/{id}',
    category: 'asset',
    auth: 'session-or-api-key',
    description: 'Hard-deletes a prop asset and all its variants (cascade).',
    pathParams: { id: 'asset-uuid' },
    body: null,
    response: { deleted: true, id: 'asset-uuid' },
  },
];

// ─── Variants ────────────────────────────────────────────────────────────────

const variantRoutes: ApiRouteDefinition[] = [
  {
    id: 'v2-variants-list',
    label: 'List asset variants',
    method: 'GET',
    pathTemplate: '/api/v2/assets/{assetId}/variants',
    category: 'variant',
    auth: 'session-or-api-key',
    description:
      'Lists all variants for a single asset. Each variant has a unique slug, generation prompt, optional image_url, and a default flag.',
    pathParams: { assetId: 'asset-uuid' },
    body: null,
    response: {
      variants: [
        {
          id: 'variant-uuid',
          asset_id: 'asset-uuid',
          name: 'Default',
          slug: 'ali-main',
          prompt: 'Young man, 20s, dark hair, determined expression...',
          image_url: null,
          is_main: true,
          where_to_use: 'Standard daylight scenes',
          reasoning: 'Primary appearance for most scenes',
          created_at: '2026-03-31T00:00:00Z',
          updated_at: '2026-03-31T00:00:00Z',
        },
      ],
    },
  },
  {
    id: 'v2-variants-create',
    label: 'Create variant(s)',
    method: 'POST',
    pathTemplate: '/api/v2/assets/{assetId}/variants',
    category: 'variant',
    auth: 'session-or-api-key',
    description:
      "Creates one or more variants for an asset. Accepts a single object or an array. If is_main=true, resets all other variants' main flag.",
    pathParams: { assetId: 'asset-uuid' },
    body: {
      name: 'Night Variant',
      slug: 'ali-night',
      prompt:
        'Young man in dramatic moonlit silhouette, blue-toned lighting...',
      image_url: null,
      is_main: false,
      where_to_use: 'Night and dramatic scenes',
      reasoning: 'Creates visual contrast for evening sequences',
    },
    response: {
      variants: [
        {
          id: 'variant-uuid',
          name: 'Night Variant',
          slug: 'ali-night',
          is_main: false,
        },
      ],
    },
  },
  {
    id: 'v2-variant-update',
    label: 'Update variant',
    method: 'PATCH',
    pathTemplate: '/api/v2/variants/{id}',
    category: 'variant',
    auth: 'session-or-api-key',
    description:
      'Updates a variant. Supports: name, slug, prompt, image_url, is_main, where_to_use, reasoning. Setting is_main=true resets others.',
    pathParams: { id: 'variant-uuid' },
    body: {
      name: 'Updated Variant Name',
      slug: 'updated-slug',
      prompt: 'Updated generation prompt...',
      image_url: 'https://example.com/variant-ref.png',
      is_main: true,
      where_to_use: 'Updated usage notes',
      reasoning: 'Updated reasoning',
    },
    response: {
      id: 'variant-uuid',
      name: 'Updated Variant Name',
      prompt: 'Updated generation prompt...',
      is_main: true,
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-variant-delete',
    label: 'Delete variant',
    method: 'DELETE',
    pathTemplate: '/api/v2/variants/{id}',
    category: 'variant',
    auth: 'session-or-api-key',
    description:
      'Hard-deletes a variant. If this was the default variant, no new default is auto-assigned.',
    pathParams: { id: 'variant-uuid' },
    body: null,
    response: { deleted: true, id: 'variant-uuid' },
  },
];

// ─── Scenes ──────────────────────────────────────────────────────────────────

const sceneRoutes: ApiRouteDefinition[] = [
  {
    id: 'v2-scenes-list',
    label: 'List scenes for episode',
    method: 'GET',
    pathTemplate: '/api/v2/episodes/{id}/scenes',
    category: 'scene',
    auth: 'session-or-api-key',
    description:
      'Lists all scenes for an episode in order. Each scene includes prompt, audio, video URLs, variant slugs, and status.',
    pathParams: { id: 'episode-uuid' },
    body: null,
    response: {
      scenes: [
        {
          id: 'scene-uuid',
          episode_id: 'episode-uuid',
          order: 1000,
          title: 'The Gate',
          content_mode: 'narrative',
          visual_direction: 'Wide establishing shot, golden hour...',
          prompt:
            'A lone figure approaches a massive wooden gate set in ancient sandstone walls...',
          location_variant_slug: 'medina-courtyard-main',
          character_variant_slugs: ['ali-main'],
          prop_variant_slugs: ['seal-ring-main'],
          audio_text:
            'As the sun dipped below the horizon, Ali approached the village gate...',
          audio_url: null,
          audio_duration: null,
          video_url: null,
          video_duration: null,
          duration: null,
          status: 'draft',
          created_at: '2026-03-31T00:00:00Z',
          updated_at: '2026-03-31T00:00:00Z',
        },
      ],
    },
  },
  {
    id: 'v2-scenes-create-batch',
    label: 'Create scenes (batch)',
    method: 'POST',
    pathTemplate: '/api/v2/episodes/{id}/scenes',
    category: 'scene',
    auth: 'session-or-api-key',
    description:
      'Creates one or more scenes for an episode. Order is auto-assigned at 1000 increments. Send a bare array or wrap in { scenes: [...] }.',
    pathParams: { id: 'episode-uuid' },
    body: {
      scenes: [
        {
          title: 'The Gate',
          content_mode: 'narrative',
          visual_direction: 'Wide establishing shot, golden hour...',
          prompt: 'A lone figure approaches a massive wooden gate...',
          location_variant_slug: 'medina-courtyard-main',
          character_variant_slugs: ['ali-main'],
          prop_variant_slugs: ['seal-ring-main'],
          audio_text: 'As the sun dipped below the horizon, Ali approached...',
        },
        {
          title: 'The Confrontation',
          content_mode: 'cinematic',
          visual_direction: 'Close-up sequence, dramatic lighting...',
          prompt: 'The village elder steps forward, blocking the path...',
          location_variant_slug: 'medina-courtyard-main',
          character_variant_slugs: ['ali-main', 'fatima-main'],
          prop_variant_slugs: [],
          audio_text:
            'The elder raised her hand. "You cannot pass," she said...',
        },
      ],
    },
    response: {
      scenes: [
        { id: 'scene-uuid-1', order: 1000, title: 'The Gate', status: 'draft' },
        {
          id: 'scene-uuid-2',
          order: 2000,
          title: 'The Confrontation',
          status: 'draft',
        },
      ],
    },
  },
  {
    id: 'v2-scene-get',
    label: 'Get scene',
    method: 'GET',
    pathTemplate: '/api/v2/scenes/{id}',
    category: 'scene',
    auth: 'session-or-api-key',
    description:
      'Returns a single scene with all fields including variant slugs, audio/video URLs, and durations.',
    pathParams: { id: 'scene-uuid' },
    body: null,
    response: {
      id: 'scene-uuid',
      episode_id: 'episode-uuid',
      order: 1000,
      title: 'The Gate',
      content_mode: 'narrative',
      visual_direction: 'Wide establishing shot...',
      prompt: 'A lone figure approaches...',
      location_variant_slug: 'medina-courtyard-main',
      character_variant_slugs: ['ali-main'],
      prop_variant_slugs: ['seal-ring-main'],
      audio_text: 'As the sun dipped below the horizon...',
      audio_url: 'https://storage.example.com/tts/scene-uuid.mp3',
      audio_duration: 12.5,
      video_url: null,
      video_duration: null,
      duration: 12.5,
      status: 'draft',
      created_at: '2026-03-31T00:00:00Z',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-scene-update',
    label: 'Update scene',
    method: 'PATCH',
    pathTemplate: '/api/v2/scenes/{id}',
    category: 'scene',
    auth: 'session-or-api-key',
    description:
      'Updates one or more scene fields. Supports: title, order, content_mode (narrative|cinematic|hybrid), visual_direction, prompt, location_variant_slug, character_variant_slugs, prop_variant_slugs, audio_text, audio_url, audio_duration, video_url, video_duration, status (draft|ready|in_progress|done|failed).',
    pathParams: { id: 'scene-uuid' },
    body: {
      title: 'Updated Scene Title',
      prompt: 'Updated generation prompt...',
      visual_direction: 'Updated visual direction...',
      location_variant_slug: 'desert-road-main',
      character_variant_slugs: ['ali-night', 'fatima-main'],
      prop_variant_slugs: ['seal-ring-main'],
      audio_text: 'Updated narration text...',
      audio_url: 'https://storage.example.com/tts/updated.mp3',
      audio_duration: 15.0,
      video_url: 'https://storage.example.com/video/updated.mp4',
      video_duration: 15.0,
      status: 'done',
      order: 1500,
    },
    response: {
      id: 'scene-uuid',
      title: 'Updated Scene Title',
      status: 'done',
      updated_at: '2026-03-31T00:00:00Z',
    },
  },
  {
    id: 'v2-scene-delete',
    label: 'Delete scene',
    method: 'DELETE',
    pathTemplate: '/api/v2/scenes/{id}',
    category: 'scene',
    auth: 'session-or-api-key',
    description: 'Hard-deletes a scene.',
    pathParams: { id: 'scene-uuid' },
    body: null,
    response: { deleted: true, id: 'scene-uuid' },
  },
];

// ─── Webhook ─────────────────────────────────────────────────────────────────

// ─── Generation ──────────────────────────────────────────────────────────────

const generationRoutes: ApiRouteDefinition[] = [
  {
    id: 'v2-scene-generate-tts',
    label: 'Generate TTS for scene',
    method: 'POST',
    pathTemplate: '/api/v2/scenes/{id}/generate-tts',
    category: 'scene',
    auth: 'session-or-api-key',
    description:
      'Generates TTS audio for a scene using ElevenLabs Turbo v2.5 via kie.ai. Uses scene audio_text as input. Supports voice_id, speed, language_code, previous_text, next_text for continuity. Async — webhook updates scene.audio_url on completion.',
    pathParams: { id: 'scene-uuid' },
    body: {
      voice_id: 'Rachel',
      speed: 1.0,
      language_code: 'tr',
      previous_text: 'Previous scene narration for speech continuity...',
      next_text: 'Next scene narration for speech continuity...',
    },
    response: {
      task_id: 'kie-task-id',
      model: 'elevenlabs/text-to-speech-turbo-2-5',
      scene_id: 'scene-uuid',
      voice_id: 'Rachel',
      speed: 1.0,
    },
  },
  {
    id: 'v2-variant-generate-image',
    label: 'Generate image for variant',
    method: 'POST',
    pathTemplate: '/api/v2/variants/{id}/generate-image',
    category: 'variant',
    auth: 'session-or-api-key',
    description:
      'Generates an image for an asset variant using Nano Banana 2 via kie.ai. Always 1K resolution, 9:16, JPG. Uses variant.prompt + asset context as input. Async — webhook uploads to storage, inserts into variant_images, and updates variant.image_url.',
    pathParams: { id: 'variant-uuid' },
    body: {
      prompt_override: 'Optional custom prompt instead of variant.prompt',
    },
    response: {
      task_id: 'kie-task-id',
      model: 'nano-banana-2',
      variant_id: 'variant-uuid',
      aspect_ratio: '9:16',
      resolution: '1K',
    },
  },
  {
    id: 'v2-scene-generate-video',
    label: 'Generate video for scene',
    method: 'POST',
    pathTemplate: '/api/v2/scenes/{id}/generate-video',
    category: 'scene',
    auth: 'session-or-api-key',
    description:
      'Generates video for a scene using Grok Imagine ref-to-video via kie.ai. Compiles @variant-slug → @imageN refs and resolves image URLs from DB. Always 480p, 9:16, 6 or 10 sec. All referenced variant images must exist. Async — webhook updates scene.video_url on completion.',
    pathParams: { id: 'scene-uuid' },
    body: {
      duration: 6,
      prompt_override: 'Optional compiled prompt (bypasses auto-compile)',
      image_urls_override: ['https://...variant1.jpg', 'https://...variant2.jpg'],
    },
    response: {
      task_id: 'kie-task-id',
      model: 'grok-imagine/image-to-video',
      scene_id: 'scene-uuid',
      duration: 6,
      aspect_ratio: '9:16',
      resolution: '480p',
      image_count: 2,
    },
  },
  {
    id: 'v2-variant-edit-image',
    label: 'Edit variant image',
    method: 'POST',
    pathTemplate: '/api/v2/variants/{id}/edit-image',
    category: 'variant',
    auth: 'session-or-api-key',
    description:
      'Edits a variant\'s existing image using Grok Imagine image-to-image via kie.ai. Variant must already have an image_url. Always 9:16. Async — webhook uploads to storage, inserts into variant_images, and updates variant.image_url.',
    pathParams: { id: 'variant-uuid' },
    body: {
      prompt: 'Make the character wear a red robe instead of blue',
    },
    response: {
      task_id: 'kie-task-id',
      model: 'grok-imagine/image-to-image',
      variant_id: 'variant-uuid',
      source_image: 'https://...current-image.jpg',
    },
  },
];

const webhookRoutes: ApiRouteDefinition[] = [
  {
    id: 'kie-webhook',
    label: 'KIE webhook callback',
    method: 'POST',
    pathTemplate: '/api/webhook/kieai',
    category: 'webhook',
    auth: 'webhook-signature',
    description:
      'Receives async task completion callbacks from KIE.ai video/image generation provider. Updates scene status, stores result URLs, and writes generation logs. Not meant to be called manually.',
    queryParams: {
      step: 'GenerateVideo',
      scene_id: 'scene-uuid',
    },
    body: {
      code: 200,
      data: {
        task_id: 'kie-task-id',
        state: 'success',
        works: [{ url: 'https://cdn.kie.ai/result.mp4', type: 'video' }],
      },
    },
    response: {
      success: true,
      step: 'GenerateVideo',
      task_id: 'kie-task-id',
    },
  },
];

// ─── Export ──────────────────────────────────────────────────────────────────

export const API_OPS_ROUTES: ApiRouteDefinition[] = [
  ...projectRoutes,
  ...seriesRoutes,
  ...episodeRoutes,
  ...assetRoutes,
  ...variantRoutes,
  ...sceneRoutes,
  ...generationRoutes,
  ...webhookRoutes,
];

export function getApiRouteDefinition(routeId: string) {
  return API_OPS_ROUTES.find((route) => route.id === routeId);
}
