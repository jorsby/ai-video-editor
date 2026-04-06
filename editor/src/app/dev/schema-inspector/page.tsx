import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';

type ParamValue = string | string[] | undefined;

type ContentMode = 'narrative' | 'cinematic' | 'hybrid';

type AssetType = 'character' | 'location' | 'prop';

type ChapterStatus = 'draft' | 'ready' | 'in_progress' | 'done';

type SceneStatus = 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';

interface SchemaProject {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface SchemaVideo {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  genre: string | null;
  tone: string | null;
  bible: string | null;
  content_mode: ContentMode;
  language: string | null;
  aspect_ratio: string | null;
  video_model: string | null;
  image_model: string | null;
  voice_id: string | null;
  tts_speed: number | null;
  visual_style: string | null;
  creative_brief: Record<string, unknown> | null;
  plan_status: 'draft' | 'finalized';
  created_at: string;
  updated_at: string;
}

interface SchemaVideoAsset {
  id: string;
  project_id: string;
  type: AssetType;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface SchemaVideoAssetVariant {
  id: string;
  asset_id: string;
  slug: string;
  name: string;
  prompt: string | null;
  image_url: string | null;
  is_main: boolean;
  where_to_use: string | null;
  reasoning: string | null;
  created_at: string;
  updated_at: string;
}

interface SchemaChapter {
  id: string;
  video_id: string;
  order: number;
  title: string | null;
  synopsis: string | null;
  audio_content: string | null;
  visual_outline: string | null;
  asset_variant_map: Record<string, unknown>;
  plan_json: Record<string, unknown> | null;
  status: ChapterStatus;
  created_at: string;
  updated_at: string;
}

interface SchemaScene {
  id: string;
  chapter_id: string;
  order: number;
  title: string | null;
  audio_duration: number | null;
  video_duration: number | null;
  content_mode: ContentMode | null;
  visual_direction: string | null;
  prompt: string | null;
  location_variant_slug: string | null;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  audio_text: string | null;
  audio_url: string | null;
  video_url: string | null;
  status: SceneStatus;
  created_at: string;
  updated_at: string;
}

type InspectorMode = 'real' | 'mock';
type InspectorModeParam = InspectorMode | 'auto';

type QueryErrorLike = {
  code?: string;
  message?: string;
  details?: string;
};

interface PageProps {
  searchParams: Promise<Record<string, ParamValue>>;
}

function getFirstParam(value: ParamValue): string | null {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' && value[0].trim() ? value[0] : null;
  }

  return typeof value === 'string' && value.trim() ? value : null;
}

function parseModeParam(value: ParamValue): InspectorModeParam {
  const first = getFirstParam(value)?.toLowerCase();
  if (first === 'mock') return 'mock';
  if (first === 'real') return 'real';
  if (first === 'auto') return 'auto';
  return 'mock';
}

function buildInspectorHref({
  mode,
  projectId,
  videoId,
}: {
  mode?: InspectorModeParam;
  projectId?: string;
  videoId?: string;
}) {
  const params = new URLSearchParams();

  if (mode) params.set('mode', mode);
  if (projectId) params.set('projectId', projectId);
  if (videoId) params.set('videoId', videoId);

  const query = params.toString();
  return query ? `/dev/schema-inspector?${query}` : '/dev/schema-inspector';
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '[]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isSchemaCompatibilityError(error: QueryErrorLike): boolean {
  const schemaCodes = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);

  if (error.code && schemaCodes.has(error.code)) {
    return true;
  }

  const combined =
    `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return (
    combined.includes('does not exist') ||
    combined.includes('schema cache') ||
    combined.includes('could not find the')
  );
}

function countByStatus<T extends string>(values: T[]) {
  return values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<T, number>
  );
}

function isCanonicalVariantSlug(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function getAssetVariantMapShapeReview(variantMap: Record<string, unknown>) {
  const requiredKeys = ['characters', 'locations', 'props'] as const;

  const missingKeys = requiredKeys.filter((key) => !(key in variantMap));
  const wrongTypeKeys = requiredKeys.filter((key) => {
    const value = variantMap[key];
    return value !== undefined && !Array.isArray(value);
  });

  const invalidVariantSlugGroups = requiredKeys.filter((key) => {
    const value = variantMap[key];
    if (!Array.isArray(value)) return false;

    return value.some(
      (entry) => typeof entry !== 'string' || !isCanonicalVariantSlug(entry)
    );
  });

  return {
    missingKeys,
    wrongTypeKeys,
    invalidVariantSlugGroups,
    isValid:
      missingKeys.length === 0 &&
      wrongTypeKeys.length === 0 &&
      invalidVariantSlugGroups.length === 0,
  };
}

function getDurationResolutionLabel(scene: SchemaScene) {
  if (scene.audio_url) {
    return 'resolved from audio_url (actual audio duration)';
  }

  if (scene.video_duration) {
    return 'fallback to video_duration (no audio_url)';
  }

  return 'missing audio_duration and video_duration';
}

function getStatusBadgeClass(status: ChapterStatus | SceneStatus) {
  if (status === 'done') {
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  }

  if (status === 'in_progress') {
    return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  }

  if (status === 'ready') {
    return 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300';
  }

  if (status === 'failed') {
    return 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  }

  return 'border-border bg-muted/40 text-muted-foreground';
}

function getAssetTypeEmoji(type: AssetType) {
  if (type === 'character') return '👤';
  if (type === 'location') return '📍';
  return '🧩';
}

function JsonNode({
  name,
  value,
  depth = 0,
}: {
  name: string;
  value: unknown;
  depth?: number;
}) {
  if (value === null || value === undefined) {
    return (
      <div className="text-xs font-mono text-muted-foreground">
        <span className="text-foreground/80">{name}</span>: null
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <details
        open={depth < 1}
        className="rounded border border-border/50 bg-muted/10 px-2 py-1"
      >
        <summary className="cursor-pointer text-xs font-mono">
          {name}{' '}
          <span className="text-muted-foreground">(array, {value.length})</span>
        </summary>
        <div className="mt-2 space-y-1 pl-2">
          {value.length === 0 ? (
            <p className="text-xs text-muted-foreground">[]</p>
          ) : (
            value.map((item, index) => (
              <JsonNode
                key={`${name}-${index}`}
                name={`[${index}]`}
                value={item}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      </details>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    return (
      <details
        open={depth < 1}
        className="rounded border border-border/50 bg-muted/10 px-2 py-1"
      >
        <summary className="cursor-pointer text-xs font-mono">
          {name}{' '}
          <span className="text-muted-foreground">
            (object, {entries.length})
          </span>
        </summary>
        <div className="mt-2 space-y-1 pl-2">
          {entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{'{}'}</p>
          ) : (
            entries.map(([entryName, entryValue]) => (
              <JsonNode
                key={`${name}-${entryName}`}
                name={entryName}
                value={entryValue}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      </details>
    );
  }

  return (
    <div className="text-xs font-mono text-foreground/90">
      <span className="text-foreground/80">{name}</span>: {String(value)}
    </div>
  );
}

function JsonField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-2 rounded border border-border/50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="space-y-2">
        <JsonNode name={label} value={value} />
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Raw JSON
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/20 p-2 text-xs font-mono">
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function FieldTable({
  title,
  fields,
}: {
  title: string;
  fields: Array<{ label: string; value: unknown }>;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="rounded border border-border/50">
        {fields.map((field, index) => (
          <div
            key={`${title}-${field.label}`}
            className={`grid grid-cols-[180px_1fr] gap-3 px-3 py-2 text-xs ${
              index !== fields.length - 1 ? 'border-b border-border/40' : ''
            }`}
          >
            <span className="font-mono text-muted-foreground">
              {field.label}
            </span>
            <span className="font-mono break-all">
              {displayValue(field.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function createMockInspectorData(userId: string) {
  const createdAt = '2026-03-29T21:00:00.000Z';
  const updatedAt = '2026-03-29T21:45:00.000Z';

  const project: SchemaProject = {
    id: 'mock-project-neon-backroads',
    user_id: userId,
    name: 'Schema Inspector Review: Neon Backroads',
    description:
      'Mock review dataset shown when schema reset migrations are not yet applied.',
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const video: SchemaVideo = {
    id: 'mock-video-casefile-echo',
    project_id: project.id,
    user_id: userId,
    name: 'Neon Backroads: Casefile Echo',
    genre: 'Investigative thriller',
    tone: 'Noir, urgent, emotionally restrained',
    bible:
      'Ava Kim reopens archived corruption cases by tracking hidden shipment timing patterns.',
    content_mode: 'hybrid',
    language: 'en-US',
    aspect_ratio: '9:16',
    video_model: 'kling-v2.1-reference',
    image_model: 'flux-dev-cinematic-v3',
    voice_id: 'alloy-investigative-neutral',
    tts_speed: 1.03,
    visual_style:
      'Neon noir documentary realism with practical lighting and damp textures.',
    creative_brief: {
      version: 3,
      objective:
        'Make the new schema hierarchy visually reviewable field-by-field before API redesign.',
      target_runtime_seconds: 68,
      recurring_motifs: [
        'rain on metal',
        'searchlights',
        'paper trail overlays',
      ],
      pacing_notes: {
        cold_open_seconds: 16,
        evidence_reveal_seconds: 38,
        cliffhanger_seconds: 14,
      },
    },
    plan_status: 'finalized',
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const secondaryProject: SchemaProject = {
    id: 'mock-project-signal-atlas',
    user_id: userId,
    name: 'Schema Inspector Review: Signal Atlas',
    description:
      'Secondary project to validate project/video navigation shell states.',
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const secondaryVideo: SchemaVideo = {
    id: 'mock-video-signal-atlas',
    project_id: secondaryProject.id,
    user_id: userId,
    name: 'Signal Atlas: Dry Run',
    genre: 'Sci-fi procedural',
    tone: 'Measured, analytical',
    bible:
      'A compact secondary mock video used to validate empty-state behavior in inspector shells.',
    content_mode: 'narrative',
    language: 'en-US',
    aspect_ratio: '16:9',
    video_model: 'kling-v2.1-reference',
    image_model: 'flux-dev-cinematic-v3',
    voice_id: 'alloy-neutral',
    tts_speed: 1,
    visual_style: 'Minimal control sample for selector and empty-state checks.',
    creative_brief: {
      objective: 'UI shell fallback check only',
    },
    plan_status: 'draft',
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const assets: SchemaVideoAsset[] = [
    {
      id: 'mock-asset-ava-kim',
      project_id: video.project_id,
      type: 'character',
      name: 'Ava Kim',
      slug: 'ava-kim',
      description:
        'Investigative host with calm delivery and strong pattern recognition.',
      sort_order: 10,
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-asset-pier-17',
      project_id: video.project_id,
      type: 'location',
      name: 'Pier 17 Container Yard',
      slug: 'pier-17-container-yard',
      description:
        'Foggy industrial dock with stacked containers and sodium lamps.',
      sort_order: 20,
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-asset-cipher-watch',
      project_id: video.project_id,
      type: 'prop',
      name: 'Cipher Watch',
      slug: 'cipher-watch',
      description: 'Modified analog wristwatch with hidden microfilm key.',
      sort_order: 30,
      created_at: createdAt,
      updated_at: updatedAt,
    },
  ];

  const variants: SchemaVideoAssetVariant[] = [
    {
      id: 'mock-variant-ava-studio',
      asset_id: 'mock-asset-ava-kim',
      slug: 'ava-kim-studio-intro',
      name: 'Studio Intro Look',
      prompt:
        'Ava Kim in modern newsroom, charcoal blazer, soft key light, cinematic realism, shallow depth of field.',
      image_url:
        'https://cdn.octupost.dev/samples/schema-inspector/variants/ava-kim-studio-intro.jpg',
      is_main: true,
      where_to_use:
        'Opening monologues, recap moments, and direct-to-camera sections.',
      reasoning:
        'Neutral wardrobe and stable lighting preserve continuity across recurring intros.',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-variant-ava-field',
      asset_id: 'mock-asset-ava-kim',
      slug: 'ava-kim-field-reporter',
      name: 'Field Reporter Look',
      prompt:
        'Ava Kim on rainy neon-lit street in weatherproof jacket, documentary handheld framing.',
      image_url:
        'https://cdn.octupost.dev/samples/schema-inspector/variants/ava-kim-field-reporter.jpg',
      is_main: false,
      where_to_use: 'On-location scenes and high-risk discovery beats.',
      reasoning:
        'Adds urgency and environmental context while keeping character identity fixed.',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-variant-pier-blue-hour',
      asset_id: 'mock-asset-pier-17',
      slug: 'pier-17-container-yard-blue-hour-establishing',
      name: 'Blue Hour Establishing',
      prompt:
        'Wide cinematic harbor shot at blue hour with fog, wet asphalt reflections, and crane silhouettes.',
      image_url:
        'https://cdn.octupost.dev/samples/schema-inspector/variants/pier-17-blue-hour.jpg',
      is_main: true,
      where_to_use: 'Cold opens and transition shots into field investigation.',
      reasoning:
        'Reliable establishing frame that quickly orients viewers in recurring chapters.',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-variant-pier-night',
      asset_id: 'mock-asset-pier-17',
      slug: 'pier-17-container-yard-night-searchlight-pass',
      name: 'Night Searchlight Pass',
      prompt:
        'Same harbor at night with rotating searchlights, stronger contrast, and volumetric fog.',
      image_url:
        'https://cdn.octupost.dev/samples/schema-inspector/variants/pier-17-searchlight-night.jpg',
      is_main: false,
      where_to_use: 'Pursuit scenes and escalating tension moments.',
      reasoning: 'Introduces danger cues while preserving location continuity.',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-variant-watch-closed',
      asset_id: 'mock-asset-cipher-watch',
      slug: 'cipher-watch-closed-wristwatch',
      name: 'Closed Wristwatch',
      prompt:
        'Close-up of vintage steel wristwatch on matte surface, engraved bezel, practical highlights.',
      image_url:
        'https://cdn.octupost.dev/samples/schema-inspector/variants/cipher-watch-closed.jpg',
      is_main: true,
      where_to_use: 'Continuity shots when the watch is present but unopened.',
      reasoning:
        'Defines baseline silhouette and material consistency for prop tracking.',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-variant-watch-open',
      asset_id: 'mock-asset-cipher-watch',
      slug: 'cipher-watch-open-microfilm-mechanism',
      name: 'Open Microfilm Mechanism',
      prompt:
        'Macro shot of opened watch bezel exposing hidden microfilm key, noir practical lighting.',
      image_url:
        'https://cdn.octupost.dev/samples/schema-inspector/variants/cipher-watch-open.jpg',
      is_main: false,
      where_to_use: 'Reveal moments and clue decoding sequences.',
      reasoning:
        'Makes the hidden mechanism explicit during pivotal narrative turns.',
      created_at: createdAt,
      updated_at: updatedAt,
    },
  ];

  const chapters: SchemaChapter[] = [
    {
      id: 'mock-chapter-echo-1',
      video_id: video.id,
      order: 1,
      title: 'Chapter 1 — Echo at Pier 17',
      synopsis:
        'Ava links a hidden watch mechanism to unauthorized harbor shipments and sets up the larger case.',
      audio_content:
        'Voiceover alternates between Ava narration and clipped source quotes to raise urgency.',
      visual_outline:
        'Scene 1 establish dock, Scene 2 reveal evidence, Scene 3 decode mechanism, Scene 4 interruption.',
      asset_variant_map: {
        characters: ['ava-kim-studio-intro', 'ava-kim-field-reporter'],
        locations: [
          'pier-17-container-yard-blue-hour-establishing',
          'pier-17-container-yard-night-searchlight-pass',
        ],
        props: [
          'cipher-watch-closed-wristwatch',
          'cipher-watch-open-microfilm-mechanism',
        ],
      },
      plan_json: {
        structure: {
          hook: 'Suspicious movement at a dead port.',
          reveal: 'Timing key hidden in a watch bezel.',
          cliffhanger: 'Searchlights activate before clean extraction.',
        },
        scene_objectives: [
          {
            order: 1,
            objective:
              'Confirm Pier 17 remains active despite official closure.',
          },
          {
            order: 2,
            objective:
              'Surface the first physical clue tied to shipment timing.',
          },
          {
            order: 3,
            objective: 'Connect artifact mechanics to transfer schedule.',
          },
          {
            order: 4,
            objective: 'Escalate threat and hand off to next chapter.',
          },
        ],
      },
      status: 'in_progress',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-chapter-echo-2',
      video_id: video.id,
      order: 2,
      title: 'Chapter 2 — Relay at Dawn',
      synopsis:
        'Follow-up chapter where Ava verifies who receives the copied transfer logs.',
      audio_content:
        'Narration-heavy with shorter dialogue inserts to keep continuity from chapter 1.',
      visual_outline:
        'Scene 1 recap bridge, Scene 2 hand-off location, Scene 3 unresolved lookout beat.',
      asset_variant_map: {
        characters: ['ava-kim-studio-intro', 'ava-kim-field-reporter'],
        locations: ['pier-17-container-yard-night-searchlight-pass'],
        props: ['cipher-watch-open-microfilm-mechanism'],
      },
      plan_json: {
        structure: {
          hook: 'A coded relay appears before sunrise.',
          reveal: 'Transfer logs now map to a new pickup chain.',
        },
        review_note:
          'Kept in draft intentionally for UI-first pass so status progression is visible.',
      },
      status: 'draft',
      created_at: createdAt,
      updated_at: updatedAt,
    },
  ];

  const scenes: SchemaScene[] = [
    {
      id: 'mock-scene-1',
      chapter_id: 'mock-chapter-echo-1',
      order: 1,
      title: 'Cold Open at Pier 17',
      audio_duration: null,
      video_duration: 16,
      content_mode: 'cinematic',
      visual_direction:
        'Begin with wide harbor establish and push in to Ava scanning container IDs through fog.',
      prompt:
        'Neon harbor cold open, Ava in field look, subtle handheld drift, moody teal-orange grade, rainy reflections.',
      location_variant_slug: 'pier-17-container-yard-blue-hour-establishing',
      character_variant_slugs: ['ava-kim-field-reporter'],
      prop_variant_slugs: ['cipher-watch-closed-wristwatch'],
      audio_text:
        'The city calls this dock decommissioned. But every Tuesday at 2:17 a.m., cargo still moves.',
      audio_url:
        'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-01.mp3',
      video_url:
        'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-01.mp4',
      status: 'done',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-scene-2',
      chapter_id: 'mock-chapter-echo-1',
      order: 2,
      title: 'Evidence Locker Pull',
      audio_duration: null,
      video_duration: 18,
      content_mode: 'narrative',
      visual_direction:
        'Cut to controlled archive inserts and close-up watch handling under practical desk light.',
      prompt:
        'Narrative investigation beat, archive vault inserts, precise hand movements, realistic institutional ambience.',
      location_variant_slug: 'pier-17-container-yard-blue-hour-establishing',
      character_variant_slugs: ['ava-kim-studio-intro'],
      prop_variant_slugs: ['cipher-watch-closed-wristwatch'],
      audio_text:
        'The watch face was never tracking time. It was tracking transfer windows.',
      audio_url:
        'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-02.mp3',
      video_url:
        'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-02.mp4',
      status: 'in_progress',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-scene-3',
      chapter_id: 'mock-chapter-echo-1',
      order: 3,
      title: 'Pattern Match',
      audio_duration: null,
      video_duration: 20,
      content_mode: 'hybrid',
      visual_direction:
        'Intercut voiceover narration with macro inserts of bezel mechanics and timeline overlays.',
      prompt:
        'Hybrid montage of watch mechanism and shipment board overlays, slow push-ins, documentary-noir look.',
      location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
      character_variant_slugs: ['ava-kim-studio-intro'],
      prop_variant_slugs: ['cipher-watch-open-microfilm-mechanism'],
      audio_text:
        'Every notch aligned with a vanished shipment logged under a false maintenance ticket.',
      audio_url:
        'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-03.mp3',
      video_url:
        'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-03.mp4',
      status: 'ready',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-scene-4',
      chapter_id: 'mock-chapter-echo-1',
      order: 4,
      title: 'Searchlight Interruption',
      audio_duration: null,
      video_duration: 14,
      content_mode: 'cinematic',
      visual_direction:
        'Hard cut back to dock as searchlights sweep fog and force abrupt movement off-route.',
      prompt:
        'High-tension pursuit beat under rotating searchlights, long-lens compression, wet ground reflections.',
      location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
      character_variant_slugs: ['ava-kim-field-reporter'],
      prop_variant_slugs: ['cipher-watch-open-microfilm-mechanism'],
      audio_text:
        'By the time the lights found us, the copy had already left the pier.',
      audio_url:
        'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-04.mp3',
      video_url:
        'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-04.mp4',
      status: 'failed',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-scene-5',
      chapter_id: 'mock-chapter-echo-2',
      order: 1,
      title: 'Recap Signal Sweep',
      audio_duration: null,
      video_duration: 11,
      content_mode: 'narrative',
      visual_direction:
        'Brief timeline recap over surveillance stills with one moving camera pass.',
      prompt:
        'Recap montage with evidence board overlays, restrained camera motion, investigative tone.',
      location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
      character_variant_slugs: ['ava-kim-studio-intro'],
      prop_variant_slugs: ['cipher-watch-open-microfilm-mechanism'],
      audio_text:
        'We traced one relay. The next signal appears before sunrise, outside the normal route.',
      audio_url: null,
      video_url: null,
      status: 'draft',
      created_at: createdAt,
      updated_at: updatedAt,
    },
    {
      id: 'mock-scene-6',
      chapter_id: 'mock-chapter-echo-2',
      order: 2,
      title: 'Dawn Hand-off Checkpoint',
      audio_duration: null,
      video_duration: null,
      content_mode: 'cinematic',
      visual_direction:
        'Low-angle dawn sweep as two unmarked vans exchange parcels under low light.',
      prompt:
        'Cinematic dawn hand-off, long-lens compression, subtle rain haze, high tension.',
      location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
      character_variant_slugs: ['ava-kim-field-reporter'],
      prop_variant_slugs: ['cipher-watch-open-microfilm-mechanism'],
      audio_text:
        'The drop changed location, but the timing code stayed the same.',
      audio_url: null,
      video_url: null,
      status: 'ready',
      created_at: createdAt,
      updated_at: updatedAt,
    },
  ];

  return {
    projects: [project, secondaryProject],
    videoList: [video, secondaryVideo],
    assets,
    variants,
    chapters,
    scenes,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Inspector route intentionally renders the full schema hierarchy in one review surface.
export default async function SchemaInspectorPage({ searchParams }: PageProps) {
  const supabase = await createClient('studio');
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const params = await searchParams;
  const requestedProjectId = getFirstParam(params.projectId);
  const requestedVideoId = getFirstParam(params.videoId);
  const rawModeParam = getFirstParam(params.mode);
  const requestedMode = parseModeParam(params.mode);
  const modeForLinks = requestedMode === 'auto' ? undefined : requestedMode;

  let inspectorMode: InspectorMode = requestedMode === 'mock' ? 'mock' : 'real';
  let inspectorNotice: string | null = null;
  let loadError: string | null = null;

  let projects: SchemaProject[] = [];
  let videoList: SchemaVideo[] = [];
  let assets: SchemaVideoAsset[] = [];
  let variants: SchemaVideoAssetVariant[] = [];
  let chapters: SchemaChapter[] = [];
  let scenes: SchemaScene[] = [];

  let selectedProject: SchemaProject | null = null;
  let selectedVideo: SchemaVideo | null = null;

  const applyMockData = (reason: string) => {
    const mockData = createMockInspectorData(user.id);

    inspectorMode = 'mock';
    inspectorNotice = reason;
    loadError = null;

    projects = mockData.projects;
    selectedProject =
      projects.find((project) => project.id === requestedProjectId) ??
      projects[0] ??
      null;

    const selectedProjectId = selectedProject?.id;
    videoList = selectedProjectId
      ? mockData.videoList.filter(
          (video) => video.project_id === selectedProjectId
        )
      : [];

    selectedVideo =
      videoList.find((video) => video.id === requestedVideoId) ??
      videoList[0] ??
      null;

    const selectedVideoId = selectedVideo?.id;
    const selectedVideoProjectId = selectedVideo?.project_id;
    assets = selectedVideoProjectId
      ? mockData.assets.filter(
          (asset) => asset.project_id === selectedVideoProjectId
        )
      : [];

    const selectedAssetIds = new Set(assets.map((asset) => asset.id));
    variants = selectedVideoId
      ? mockData.variants.filter((variant) =>
          selectedAssetIds.has(variant.asset_id)
        )
      : [];

    chapters = selectedVideoId
      ? mockData.chapters.filter(
          (chapter) => chapter.video_id === selectedVideoId
        )
      : [];

    const chapterIds = new Set(chapters.map((chapter) => chapter.id));
    scenes = mockData.scenes.filter((scene) =>
      chapterIds.has(scene.chapter_id)
    );
  };

  if (requestedMode === 'mock') {
    applyMockData(
      rawModeParam
        ? 'Mock mode forced via ?mode=mock'
        : 'Mock-first default for UI review. Switch to ?mode=real only after fake-data sign-off.'
    );
  } else {
    const queryErrors: Array<{ source: string; error: QueryErrorLike }> = [];

    const { data: projectsData, error: projectsError } = await supabase
      .from('projects')
      .select('id, user_id, name, description, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (projectsError) {
      queryErrors.push({ source: 'projects', error: projectsError });
    }

    projects = (projectsData ?? []) as SchemaProject[];
    selectedProject =
      projects.find((project) => project.id === requestedProjectId) ??
      projects[0] ??
      null;

    const { data: videoData, error: videoError } = selectedProject
      ? await supabase
          .from('videos')
          .select(
            'id, project_id, user_id, name, genre, tone, bible, content_mode, language, aspect_ratio, video_model, image_model, voice_id, tts_speed, visual_style, creative_brief, plan_status, created_at, updated_at'
          )
          .eq('project_id', selectedProject.id)
          .order('created_at', { ascending: true })
      : { data: [], error: null };

    if (videoError) {
      queryErrors.push({ source: 'video', error: videoError });
    }

    videoList = (videoData ?? []) as SchemaVideo[];
    selectedVideo =
      videoList.find((video) => video.id === requestedVideoId) ??
      videoList[0] ??
      null;

    const { data: assetsData, error: assetsError } = selectedVideo
      ? await supabase
          .from('project_assets')
          .select(
            'id, project_id, type, name, slug, description, sort_order, created_at, updated_at'
          )
          .eq('project_id', selectedVideo.project_id)
          .order('type', { ascending: true })
          .order('sort_order', { ascending: true })
      : { data: [], error: null };

    if (assetsError) {
      queryErrors.push({ source: 'project_assets', error: assetsError });
    }

    assets = (assetsData ?? []) as SchemaVideoAsset[];
    const assetIds = assets.map((asset) => asset.id);

    const { data: variantsData, error: variantsError } = assetIds.length
      ? await supabase
          .from('project_asset_variants')
          .select(
            'id, asset_id, slug, name, prompt, image_url, is_main, where_to_use, reasoning, created_at, updated_at'
          )
          .in('asset_id', assetIds)
          .order('created_at', { ascending: true })
      : { data: [], error: null };

    if (variantsError) {
      queryErrors.push({
        source: 'project_asset_variants',
        error: variantsError,
      });
    }

    variants = (variantsData ?? []) as SchemaVideoAssetVariant[];

    const { data: chaptersData, error: chaptersError } = selectedVideo
      ? await supabase
          .from('chapters')
          .select(
            'id, video_id, order, title, synopsis, audio_content, visual_outline, asset_variant_map, plan_json, status, created_at, updated_at'
          )
          .eq('video_id', selectedVideo.id)
          .order('order', { ascending: true })
      : { data: [], error: null };

    if (chaptersError) {
      queryErrors.push({ source: 'chapters', error: chaptersError });
    }

    chapters = (chaptersData ?? []) as SchemaChapter[];
    const chapterIds = chapters.map((chapter) => chapter.id);

    const { data: scenesData, error: scenesError } = chapterIds.length
      ? await supabase
          .from('scenes')
          .select(
            'id, chapter_id, order, title, audio_duration, video_duration, content_mode, visual_direction, prompt, location_variant_slug, character_variant_slugs, prop_variant_slugs, audio_text, audio_url, video_url, status, created_at, updated_at'
          )
          .in('chapter_id', chapterIds)
          .order('chapter_id', { ascending: true })
          .order('order', { ascending: true })
      : { data: [], error: null };

    if (scenesError) {
      queryErrors.push({ source: 'scenes', error: scenesError });
    }

    scenes = (scenesData ?? []) as SchemaScene[];

    const hasSchemaIssues = queryErrors.some(({ error }) =>
      isSchemaCompatibilityError(error)
    );

    if (requestedMode === 'auto' && hasSchemaIssues) {
      applyMockData(
        'Auto fallback: schema mismatch detected, showing mock data.'
      );
    } else {
      inspectorMode = 'real';
      inspectorNotice =
        requestedMode === 'real'
          ? 'Real mode forced via ?mode=real'
          : 'Showing live database data.';

      if (queryErrors.length > 0) {
        loadError = queryErrors
          .map(
            ({ source, error }) =>
              `${source}: ${error.code ?? 'unknown'} ${error.message ?? 'Unknown error'}`
          )
          .join(' | ');
      }
    }
  }

  const variantsByAssetId = new Map<string, SchemaVideoAssetVariant[]>();
  for (const variant of variants) {
    const list = variantsByAssetId.get(variant.asset_id) ?? [];
    list.push(variant);
    variantsByAssetId.set(variant.asset_id, list);
  }

  const scenesByChapterId = new Map<string, SchemaScene[]>();
  for (const scene of scenes) {
    const list = scenesByChapterId.get(scene.chapter_id) ?? [];
    list.push(scene);
    scenesByChapterId.set(scene.chapter_id, list);
  }

  const groupedAssets = {
    character: assets.filter((asset) => asset.type === 'character'),
    location: assets.filter((asset) => asset.type === 'location'),
    prop: assets.filter((asset) => asset.type === 'prop'),
  };

  const assetById = new Map<string, SchemaVideoAsset>();
  for (const asset of assets) {
    assetById.set(asset.id, asset);
  }

  const variantBySlug = new Map<string, SchemaVideoAssetVariant>();
  for (const variant of variants) {
    variantBySlug.set(variant.slug, variant);
  }

  const modeProjectId = selectedProject?.id ?? requestedProjectId ?? undefined;
  const modeVideoId = selectedVideo?.id ?? requestedVideoId ?? undefined;

  const chapterStatusCounts = countByStatus(
    chapters.map((chapter) => chapter.status)
  );
  const sceneStatusCounts = countByStatus(scenes.map((scene) => scene.status));

  const chapterStatusOrder: ChapterStatus[] = [
    'draft',
    'ready',
    'in_progress',
    'done',
  ];
  const sceneStatusOrder: SceneStatus[] = [
    'draft',
    'ready',
    'in_progress',
    'done',
    'failed',
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Schema Reset Inspector</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only review surface for the locked hierarchy: Project → Video →
          VideoAssets → VideoAssetVariants → Chapters → Scenes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review guide (MVP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <p>
            Validate naming, placement, grouping, and JSON shape. Focus this
            pass on clearer core model fields, variant identity, and canonical
            variant-slug refs.
          </p>

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Keep</Badge>
            <Badge variant="outline">Rename</Badge>
            <Badge variant="outline">Move</Badge>
            <Badge variant="outline">Remove</Badge>
            <Badge variant="outline">Missing</Badge>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded border border-border/50 p-2">
              <p className="font-medium text-foreground">Review order</p>
              <p className="mt-1">
                Product shell pass (dashboard/video/assets/roadmap) →
                field-level schema inspector → JSON review checks.
              </p>
            </div>
            <div className="rounded border border-border/50 p-2">
              <p className="font-medium text-foreground">Presentation check</p>
              <p className="mt-1">
                Confirm each section separates content fields from system
                metadata (IDs, timestamps, status).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <a
              href="#product-shell-review"
              className="rounded border border-border px-2 py-1 hover:bg-muted/40"
            >
              Product shell
            </a>
            <a
              href="#project-review"
              className="rounded border border-border px-2 py-1 hover:bg-muted/40"
            >
              Project
            </a>
            <a
              href="#video-review"
              className="rounded border border-border px-2 py-1 hover:bg-muted/40"
            >
              Video
            </a>
            <a
              href="#assets-review"
              className="rounded border border-border px-2 py-1 hover:bg-muted/40"
            >
              Assets & variants
            </a>
            <a
              href="#chapters-review"
              className="rounded border border-border px-2 py-1 hover:bg-muted/40"
            >
              Chapters & scenes
            </a>
          </div>
        </CardContent>
      </Card>

      <Card
        className={
          inspectorMode === 'mock'
            ? 'border-amber-500/40 bg-amber-500/5'
            : 'border-emerald-500/30 bg-emerald-500/5'
        }
      >
        <CardHeader>
          <CardTitle className="text-base">Data source mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant={inspectorMode === 'mock' ? 'default' : 'outline'}>
              Mode: {inspectorMode.toUpperCase()}
            </Badge>
            <Badge variant="outline">
              {inspectorMode === 'mock'
                ? 'Fixture data (read-only)'
                : 'Live database (read-only)'}
            </Badge>
          </div>

          {inspectorNotice ? (
            <p className="text-xs text-muted-foreground">{inspectorNotice}</p>
          ) : null}

          {inspectorMode === 'mock' ? (
            <p className="text-xs text-muted-foreground">
              Mock mode is the default for this UI-first review pass. Validate
              hierarchy and field placement here first; only then switch to real
              mode for endpoint verification.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Real mode reads live rows from studio tables and keeps the
              inspector read-only.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Link
              href={buildInspectorHref({
                mode: 'mock',
                projectId: modeProjectId,
                videoId: modeVideoId,
              })}
              className="rounded border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              Use mock mode
            </Link>
            <Link
              href={buildInspectorHref({
                mode: 'real',
                projectId: modeProjectId,
                videoId: modeVideoId,
              })}
              className="rounded border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              Use real mode
            </Link>
            <Link
              href={buildInspectorHref({
                mode: 'auto',
                projectId: modeProjectId,
                videoId: modeVideoId,
              })}
              className="rounded border border-border px-3 py-1.5 text-xs transition-colors hover:bg-muted/40"
            >
              Use auto mode
            </Link>
          </div>
        </CardContent>
      </Card>

      {loadError ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Query warning</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">{loadError}</p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hierarchy summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Projects: {projects.length}</Badge>
            <Badge variant="outline">Video: {videoList.length}</Badge>
            <Badge variant="outline">Assets: {assets.length}</Badge>
            <Badge variant="outline">Variants: {variants.length}</Badge>
            <Badge variant="outline">Chapters: {chapters.length}</Badge>
            <Badge variant="outline">Scenes: {scenes.length}</Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            {chapterStatusOrder.map((status) => (
              <Badge key={`chapter-status-${status}`} variant="outline">
                chapters.{status}: {chapterStatusCounts[status] ?? 0}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {sceneStatusOrder.map((status) => (
              <Badge key={`scene-status-${status}`} variant="outline">
                scenes.{status}: {sceneStatusCounts[status] ?? 0}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedProject ? (
        <section id="product-shell-review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Product shell review (UI-first, fake-data-first)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded border border-border/50 bg-muted/10 p-3 text-xs text-muted-foreground">
                This is the primary review surface before API endpoint review:
                dashboard-style project/video cards plus asset + roadmap shells
                rendered from mock-first inspector data.
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Dashboard shell • Projects
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {projects.map((project) => (
                    <Link
                      key={`product-shell-project-${project.id}`}
                      href={buildInspectorHref({
                        mode: modeForLinks,
                        projectId: project.id,
                      })}
                      className={`rounded-lg border p-3 transition-colors ${
                        selectedProject?.id === project.id
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <p className="text-sm font-medium">{project.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {project.description ?? 'No description'}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="outline">id: {project.id}</Badge>
                        <Badge variant="outline">
                          updated: {project.updated_at}
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Video shell
                </p>
                {videoList.length === 0 ? (
                  <div className="rounded border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
                    No video in this project.
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {videoList.map((video) => (
                      <Link
                        key={`product-shell-video-${video.id}`}
                        href={buildInspectorHref({
                          mode: modeForLinks,
                          projectId: modeProjectId,
                          videoId: video.id,
                        })}
                        className={`rounded-xl border p-4 transition-colors ${
                          selectedVideo?.id === video.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{video.name}</p>
                          <Badge variant="outline">{video.content_mode}</Badge>
                          <Badge variant="outline">{video.plan_status}</Badge>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {video.bible ?? 'No bible'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>voice: {video.voice_id ?? '—'}</span>
                          <span>video: {video.video_model ?? '—'}</span>
                          <span>image: {video.image_model ?? '—'}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {selectedVideo ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2 rounded-lg border border-border/60 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Assets panel shell
                    </p>
                    {(['character', 'location', 'prop'] as const).map(
                      (type) => (
                        <details
                          key={`product-shell-assets-${type}`}
                          open
                          className="rounded border border-border/40 p-2"
                        >
                          <summary className="cursor-pointer text-xs font-medium capitalize">
                            {type}s ({groupedAssets[type].length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {groupedAssets[type].length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No {type} assets.
                              </p>
                            ) : (
                              groupedAssets[type].map((asset) => {
                                const assetVariants =
                                  variantsByAssetId.get(asset.id) ?? [];
                                const previewImage =
                                  assetVariants.find(
                                    (variant) => variant.image_url
                                  )?.image_url ?? null;

                                return (
                                  <div
                                    key={`product-shell-asset-${asset.id}`}
                                    className="rounded border border-border/40 bg-muted/10 p-2"
                                  >
                                    <div className="flex gap-2">
                                      {previewImage ? (
                                        <img
                                          src={previewImage}
                                          alt={`${asset.name} preview`}
                                          className="size-10 rounded object-cover border border-border/40"
                                        />
                                      ) : (
                                        <div className="flex size-10 items-center justify-center rounded border border-border/40 bg-muted/30 text-base">
                                          {getAssetTypeEmoji(asset.type)}
                                        </div>
                                      )}
                                      <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-medium">
                                          {asset.name}
                                        </p>
                                        <p className="line-clamp-2 text-[11px] text-muted-foreground">
                                          {asset.description ??
                                            'No description'}
                                        </p>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                          <Badge variant="outline">
                                            slug: {asset.slug}
                                          </Badge>
                                          <Badge variant="outline">
                                            variants: {assetVariants.length}
                                          </Badge>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </details>
                      )
                    )}
                  </div>

                  <div className="space-y-2 rounded-lg border border-border/60 p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Roadmap shell (chapters + scenes)
                    </p>
                    {chapters.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No chapters.
                      </p>
                    ) : (
                      chapters.map((chapter) => {
                        const chapterScenes =
                          scenesByChapterId.get(chapter.id) ?? [];
                        return (
                          <details
                            key={`product-shell-chapter-${chapter.id}`}
                            open
                            className="rounded border border-border/40 p-2"
                          >
                            <summary className="cursor-pointer text-xs font-medium">
                              Chapter {chapter.order} •{' '}
                              {chapter.title ?? 'Untitled'}
                            </summary>
                            <div className="mt-2 space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <Badge
                                  className={getStatusBadgeClass(
                                    chapter.status
                                  )}
                                >
                                  {chapter.status}
                                </Badge>
                                <Badge variant="outline">
                                  scenes: {chapterScenes.length}
                                </Badge>
                                <Badge variant="outline">
                                  assets:{' '}
                                  {
                                    Object.keys(chapter.asset_variant_map)
                                      .length
                                  }
                                </Badge>
                              </div>
                              {chapterScenes.length === 0 ? (
                                <p className="text-[11px] text-muted-foreground">
                                  No scenes for this chapter.
                                </p>
                              ) : (
                                chapterScenes.map((scene) => (
                                  <div
                                    key={`product-shell-scene-${scene.id}`}
                                    className="rounded border border-border/30 bg-muted/10 p-2"
                                  >
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="text-xs font-medium">
                                        Scene {scene.order} •{' '}
                                        {scene.title ?? 'Untitled'}
                                      </p>
                                      <Badge
                                        className={getStatusBadgeClass(
                                          scene.status
                                        )}
                                      >
                                        {scene.status}
                                      </Badge>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                      {scene.prompt ?? 'No prompt'}
                                    </p>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {scene.location_variant_slug ? (
                                        <Badge variant="outline">
                                          L:{' '}
                                          {variantBySlug.get(
                                            scene.location_variant_slug
                                          )?.name ??
                                            scene.location_variant_slug}
                                        </Badge>
                                      ) : null}
                                      {scene.character_variant_slugs.map(
                                        (slug) => {
                                          const variant =
                                            variantBySlug.get(slug);
                                          const asset = variant
                                            ? assetById.get(variant.asset_id)
                                            : null;
                                          return (
                                            <Badge
                                              key={`scene-${scene.id}-char-${slug}`}
                                              variant="outline"
                                            >
                                              {(asset?.type ?? 'character')
                                                .slice(0, 1)
                                                .toUpperCase()}
                                              : {variant?.name ?? slug}
                                            </Badge>
                                          );
                                        }
                                      )}
                                      {scene.prop_variant_slugs.map((slug) => {
                                        const variant = variantBySlug.get(slug);
                                        return (
                                          <Badge
                                            key={`scene-${scene.id}-prop-${slug}`}
                                            variant="outline"
                                          >
                                            P: {variant?.name ?? slug}
                                          </Badge>
                                        );
                                      })}
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </details>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project selector</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No projects found for this user.
            </p>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                href={buildInspectorHref({
                  mode: modeForLinks,
                  projectId: project.id,
                })}
                className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                  selectedProject?.id === project.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                {project.name}
              </Link>
            ))
          )}
        </CardContent>
      </Card>

      {selectedProject ? (
        <section id="project-review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project review</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-3">
              <FieldTable
                title="Identity + ownership"
                fields={[
                  { label: 'id', value: selectedProject.id },
                  { label: 'user_id', value: selectedProject.user_id },
                ]}
              />
              <FieldTable
                title="Editable content"
                fields={[
                  { label: 'name', value: selectedProject.name },
                  { label: 'description', value: selectedProject.description },
                ]}
              />
              <FieldTable
                title="System metadata"
                fields={[
                  { label: 'created_at', value: selectedProject.created_at },
                  { label: 'updated_at', value: selectedProject.updated_at },
                ]}
              />
            </CardContent>
          </Card>
        </section>
      ) : null}

      {selectedProject ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Video selector</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {videoList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No video found under selected project.
              </p>
            ) : (
              videoList.map((video) => (
                <Link
                  key={video.id}
                  href={buildInspectorHref({
                    mode: modeForLinks,
                    projectId: modeProjectId,
                    videoId: video.id,
                  })}
                  className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                    selectedVideo?.id === video.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-muted/40'
                  }`}
                >
                  {video.name}
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}

      {selectedVideo ? (
        <section id="video-review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Video review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <FieldTable
                  title="Identity + relation"
                  fields={[
                    { label: 'id', value: selectedVideo.id },
                    { label: 'project_id', value: selectedVideo.project_id },
                    { label: 'user_id', value: selectedVideo.user_id },
                  ]}
                />
                <FieldTable
                  title="Story/content"
                  fields={[
                    { label: 'name', value: selectedVideo.name },
                    { label: 'genre', value: selectedVideo.genre },
                    { label: 'tone', value: selectedVideo.tone },
                    { label: 'bible', value: selectedVideo.bible },
                    {
                      label: 'content_mode',
                      value: selectedVideo.content_mode,
                    },
                    {
                      label: 'visual_style',
                      value: selectedVideo.visual_style,
                    },
                    { label: 'language', value: selectedVideo.language },
                  ]}
                />
                <FieldTable
                  title="Generation defaults + system"
                  fields={[
                    {
                      label: 'aspect_ratio',
                      value: selectedVideo.aspect_ratio,
                    },
                    { label: 'video_model', value: selectedVideo.video_model },
                    { label: 'image_model', value: selectedVideo.image_model },
                    { label: 'voice_id', value: selectedVideo.voice_id },
                    { label: 'tts_speed', value: selectedVideo.tts_speed },
                    { label: 'plan_status', value: selectedVideo.plan_status },
                    { label: 'created_at', value: selectedVideo.created_at },
                    { label: 'updated_at', value: selectedVideo.updated_at },
                  ]}
                />
              </div>

              <div className="rounded border border-border/50 bg-muted/10 p-3 text-xs text-muted-foreground">
                JSON review:{' '}
                <span className="text-foreground">creative_brief</span> is the
                only core planning JSON. Onboarding prompt/chat logs are
                intentionally out of the core schema in this pass.
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <JsonField
                  label="creative_brief"
                  value={selectedVideo.creative_brief}
                />
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {selectedVideo ? (
        <section id="assets-review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Assets + variants review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Assets keep their own slug. Variant slug itself is the canonical
                LLM-facing token used by chapters/scenes.
              </p>

              {(['character', 'location', 'prop'] as const).map((type) => (
                <details
                  key={type}
                  open
                  className="rounded border border-border/50 p-3"
                >
                  <summary className="cursor-pointer text-sm font-medium capitalize">
                    {type}s ({groupedAssets[type].length})
                  </summary>

                  <div className="mt-3 space-y-3">
                    {groupedAssets[type].length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No {type} assets.
                      </p>
                    ) : (
                      groupedAssets[type].map((asset) => {
                        const assetVariants =
                          variantsByAssetId.get(asset.id) ?? [];

                        return (
                          <div
                            key={asset.id}
                            className="space-y-3 rounded border border-border/40 p-3"
                          >
                            <div className="grid gap-4 lg:grid-cols-2">
                              <FieldTable
                                title={`studio.project_assets • ${asset.name} (content)`}
                                fields={[
                                  { label: 'type', value: asset.type },
                                  { label: 'name', value: asset.name },
                                  { label: 'slug', value: asset.slug },
                                  {
                                    label: 'description',
                                    value: asset.description,
                                  },
                                ]}
                              />
                              <FieldTable
                                title={`studio.project_assets • ${asset.name} (system)`}
                                fields={[
                                  { label: 'id', value: asset.id },
                                  {
                                    label: 'project_id',
                                    value: asset.project_id,
                                  },
                                  {
                                    label: 'sort_order',
                                    value: asset.sort_order,
                                  },
                                  {
                                    label: 'created_at',
                                    value: asset.created_at,
                                  },
                                  {
                                    label: 'updated_at',
                                    value: asset.updated_at,
                                  },
                                ]}
                              />
                            </div>

                            <details
                              open
                              className="rounded border border-border/40 p-2"
                            >
                              <summary className="cursor-pointer text-xs font-medium">
                                Variants ({assetVariants.length})
                              </summary>

                              <div className="mt-2 space-y-2">
                                {assetVariants.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No variants for this asset.
                                  </p>
                                ) : (
                                  assetVariants.map((variant) => (
                                    <div
                                      key={variant.id}
                                      className="space-y-2 rounded border border-border/40 bg-muted/10 p-2"
                                    >
                                      <div className="grid gap-4 lg:grid-cols-2">
                                        <FieldTable
                                          title={`studio.project_asset_variants • ${variant.name} (content)`}
                                          fields={[
                                            {
                                              label: 'slug',
                                              value: variant.slug,
                                            },
                                            {
                                              label: 'name',
                                              value: variant.name,
                                            },
                                            {
                                              label: 'prompt',
                                              value: variant.prompt,
                                            },
                                            {
                                              label: 'where_to_use',
                                              value: variant.where_to_use,
                                            },
                                            {
                                              label: 'reasoning',
                                              value: variant.reasoning,
                                            },
                                          ]}
                                        />
                                        <FieldTable
                                          title={`studio.project_asset_variants • ${variant.name} (system)`}
                                          fields={[
                                            { label: 'id', value: variant.id },
                                            {
                                              label: 'asset_id',
                                              value: variant.asset_id,
                                            },
                                            {
                                              label: 'image_url',
                                              value: variant.image_url,
                                            },
                                            {
                                              label: 'is_main',
                                              value: variant.is_main,
                                            },
                                            {
                                              label: 'created_at',
                                              value: variant.created_at,
                                            },
                                            {
                                              label: 'updated_at',
                                              value: variant.updated_at,
                                            },
                                          ]}
                                        />
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            </details>
                          </div>
                        );
                      })
                    )}
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {selectedVideo ? (
        <section id="chapters-review">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Chapters + scenes review
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {chapters.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No chapters found for this video.
                </p>
              ) : (
                chapters.map((chapter) => {
                  const chapterScenes = scenesByChapterId.get(chapter.id) ?? [];
                  const assetMapShape = getAssetVariantMapShapeReview(
                    chapter.asset_variant_map
                  );

                  return (
                    <details
                      key={chapter.id}
                      open
                      className="rounded border border-border/50 p-3"
                    >
                      <summary className="cursor-pointer text-sm font-medium">
                        Chapter {chapter.order} • {chapter.title ?? 'Untitled'}{' '}
                        • {chapterScenes.length} scene(s)
                      </summary>

                      <div className="mt-3 space-y-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <FieldTable
                            title={`studio.chapters • order ${chapter.order} (content)`}
                            fields={[
                              { label: 'title', value: chapter.title },
                              { label: 'synopsis', value: chapter.synopsis },
                              {
                                label: 'audio_content',
                                value: chapter.audio_content,
                              },
                              {
                                label: 'visual_outline',
                                value: chapter.visual_outline,
                              },
                            ]}
                          />
                          <FieldTable
                            title={`studio.chapters • order ${chapter.order} (system)`}
                            fields={[
                              { label: 'id', value: chapter.id },
                              { label: 'video_id', value: chapter.video_id },
                              { label: 'order', value: chapter.order },
                              { label: 'status', value: chapter.status },
                              {
                                label: 'created_at',
                                value: chapter.created_at,
                              },
                              {
                                label: 'updated_at',
                                value: chapter.updated_at,
                              },
                            ]}
                          />
                        </div>

                        <div className="rounded border border-border/50 bg-muted/10 p-3 text-xs text-muted-foreground">
                          <p>
                            asset_variant_map expected keys:{' '}
                            <code>characters</code>, <code>locations</code>,{' '}
                            <code>props</code> (all arrays of
                            <code className="mx-1 rounded bg-muted/30 px-1 py-0.5">
                              project_asset_variants.slug
                            </code>
                            refs).
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge
                              variant={
                                assetMapShape.isValid ? 'outline' : 'default'
                              }
                            >
                              shape:{' '}
                              {assetMapShape.isValid ? 'valid' : 'needs review'}
                            </Badge>
                            {assetMapShape.missingKeys.map((key) => (
                              <Badge
                                key={`${chapter.id}-missing-${key}`}
                                variant="default"
                              >
                                missing: {key}
                              </Badge>
                            ))}
                            {assetMapShape.wrongTypeKeys.map((key) => (
                              <Badge
                                key={`${chapter.id}-wrong-type-${key}`}
                                variant="default"
                              >
                                wrong type: {key}
                              </Badge>
                            ))}
                            {assetMapShape.invalidVariantSlugGroups.map(
                              (key) => (
                                <Badge
                                  key={`${chapter.id}-invalid-key-${key}`}
                                  variant="default"
                                >
                                  invalid variant slug format: {key}
                                </Badge>
                              )
                            )}
                          </div>
                        </div>

                        <div className="grid gap-4 xl:grid-cols-2">
                          <JsonField
                            label="asset_variant_map"
                            value={chapter.asset_variant_map}
                          />
                          <JsonField
                            label="plan_json"
                            value={chapter.plan_json}
                          />
                        </div>

                        <details
                          open
                          className="rounded border border-border/40 p-2"
                        >
                          <summary className="cursor-pointer text-xs font-medium">
                            Scenes ({chapterScenes.length})
                          </summary>

                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Duration semantics: when <code>audio_url</code>{' '}
                              exists, duration resolves from actual audio
                              length. Otherwise it falls back to
                              estimated/manual runtime.
                            </p>
                            {chapterScenes.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No scenes for this chapter.
                              </p>
                            ) : (
                              chapterScenes.map((scene) => (
                                <details
                                  key={scene.id}
                                  className="rounded border border-border/40 bg-muted/10 p-2"
                                >
                                  <summary className="cursor-pointer text-xs font-medium">
                                    Scene {scene.order} •{' '}
                                    {scene.title ?? 'Untitled'}
                                  </summary>

                                  <div className="mt-2 space-y-2">
                                    <div className="grid gap-4 lg:grid-cols-3">
                                      <FieldTable
                                        title={`studio.scenes • order ${scene.order} (content)`}
                                        fields={[
                                          {
                                            label: 'title',
                                            value: scene.title,
                                          },
                                          {
                                            label: 'duration_seconds',
                                            value:
                                              scene.audio_duration ??
                                              scene.video_duration,
                                          },
                                          {
                                            label: 'duration_resolution',
                                            value:
                                              getDurationResolutionLabel(scene),
                                          },
                                          {
                                            label: 'content_mode',
                                            value: scene.content_mode,
                                          },
                                          {
                                            label: 'visual_direction',
                                            value: scene.visual_direction,
                                          },
                                          {
                                            label: 'prompt',
                                            value: scene.prompt,
                                          },
                                          {
                                            label: 'audio_text',
                                            value: scene.audio_text,
                                          },
                                        ]}
                                      />
                                      <FieldTable
                                        title={`studio.scenes • order ${scene.order} (asset refs)`}
                                        fields={[
                                          {
                                            label: 'location_variant_slug',
                                            value: scene.location_variant_slug,
                                          },
                                          {
                                            label: 'character_variant_slugs',
                                            value:
                                              scene.character_variant_slugs,
                                          },
                                          {
                                            label: 'prop_variant_slugs',
                                            value: scene.prop_variant_slugs,
                                          },
                                        ]}
                                      />
                                      <FieldTable
                                        title={`studio.scenes • order ${scene.order} (output + system)`}
                                        fields={[
                                          { label: 'id', value: scene.id },
                                          {
                                            label: 'chapter_id',
                                            value: scene.chapter_id,
                                          },
                                          {
                                            label: 'order',
                                            value: scene.order,
                                          },
                                          {
                                            label: 'audio_url',
                                            value: scene.audio_url,
                                          },
                                          {
                                            label: 'video_url',
                                            value: scene.video_url,
                                          },
                                          {
                                            label: 'status',
                                            value: scene.status,
                                          },
                                          {
                                            label: 'created_at',
                                            value: scene.created_at,
                                          },
                                          {
                                            label: 'updated_at',
                                            value: scene.updated_at,
                                          },
                                        ]}
                                      />
                                    </div>

                                    <div className="grid gap-4 xl:grid-cols-2">
                                      <JsonField
                                        label="character_variant_slugs_raw"
                                        value={scene.character_variant_slugs}
                                      />
                                      <JsonField
                                        label="prop_variant_slugs_raw"
                                        value={scene.prop_variant_slugs}
                                      />
                                    </div>
                                  </div>
                                </details>
                              ))
                            )}
                          </div>
                        </details>
                      </div>
                    </details>
                  );
                })
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
