import { type NextRequest, NextResponse } from 'next/server';
import { getUserOrApiKey } from '@/lib/auth/get-user-or-api-key';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const SAMPLE_PROJECT_NAME = 'Schema Inspector Review: Neon Backroads';
const SAMPLE_SERIES_NAME = 'Neon Backroads: Casefile Echo';

type AssetType = 'character' | 'location' | 'prop';

type AssetVariantSeed = {
  name: string;
  prompt: string;
  image_url: string;
  is_main: boolean;
  where_to_use: string;
  reasoning: string;
};

type AssetSeed = {
  type: AssetType;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  variants: AssetVariantSeed[];
};

const SAMPLE_ASSETS: AssetSeed[] = [
  {
    type: 'character',
    name: 'Ava Kim',
    slug: 'ava-kim',
    description:
      'Reluctant investigative host. Sharp eye for inconsistencies, dry humor, and a calm on-camera delivery even under pressure.',
    sort_order: 10,
    variants: [
      {
        name: 'Studio Intro',
        prompt:
          'Asian woman in her late 20s with short black bob haircut, charcoal blazer over cream turtleneck, subtle cinematic key light, modern investigative newsroom set, realistic skin texture, 35mm depth of field',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/ava-kim-studio-intro.jpg',
        is_main: true,
        where_to_use:
          'Opening monologues, recap moments, and direct-to-camera narration.',
        reasoning:
          'Neutral wardrobe and controlled lighting keep visual continuity across episode intros.',
      },
      {
        name: 'Field Reporter',
        prompt:
          'Same woman on rainy neon-lit street, dark weatherproof jacket, in-ear monitor, practical backlight from storefront signs, handheld documentary framing, cinematic realism',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/ava-kim-field-reporter.jpg',
        is_main: false,
        where_to_use:
          'On-location scenes, tense discovery beats, and transitions between locations.',
        reasoning:
          'Adds urgency and environmental context while preserving the same identity traits.',
      },
    ],
  },
  {
    type: 'character',
    name: 'Marcus Vale',
    slug: 'marcus-vale',
    description:
      'Former city archivist turned anonymous source. Precise, guarded, and always one step ahead of surveillance.',
    sort_order: 20,
    variants: [
      {
        name: 'Archive Worker',
        prompt:
          'Man in mid-30s, warm brown skin, wireframe glasses, rolled-up shirt sleeves, gloves handling old records, tungsten desk lamp, archival room with steel shelves, cinematic realism',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/marcus-vale-archive-worker.jpg',
        is_main: true,
        where_to_use:
          'Flashbacks, evidence review scenes, and explanatory dialogue moments.',
        reasoning:
          'Grounds Marcus in his professional past and clarifies why he has insider access.',
      },
      {
        name: 'Anonymous Source',
        prompt:
          'Same man in dim parking structure, hoodie and messenger bag, side-lit face, shallow depth of field, tense noir mood, realistic cinematic frame',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/marcus-vale-anonymous-source.jpg',
        is_main: false,
        where_to_use:
          'Secret handoff scenes, threat moments, and cliffhanger reveals.',
        reasoning:
          'Visually communicates risk and secrecy without changing character identity.',
      },
    ],
  },
  {
    type: 'location',
    name: 'Pier 17 Container Yard',
    slug: 'pier-17-container-yard',
    description:
      'Foggy industrial dock with stacked containers, sodium lights, and long reflective puddles after rain.',
    sort_order: 30,
    variants: [
      {
        name: 'Blue Hour Establishing',
        prompt:
          'Wide cinematic shot of industrial harbor at blue hour, stacked containers, distant crane silhouettes, wet asphalt reflections, volumetric fog, realistic 4k film look',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/pier-17-blue-hour.jpg',
        is_main: true,
        where_to_use:
          'Episode cold opens and scene transitions into field investigation.',
        reasoning:
          'Reliable establishing frame that orients viewers quickly in recurring episodes.',
      },
      {
        name: 'Night Searchlight Pass',
        prompt:
          'Same harbor at night with rotating security searchlight beams, stronger fog, high contrast pools of light, cinematic thriller composition',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/pier-17-searchlight-night.jpg',
        is_main: false,
        where_to_use:
          'High-risk pursuit scenes, surveillance beats, and escalating tension moments.',
        reasoning:
          'Adds danger and motion cues while keeping the same physical location.',
      },
    ],
  },
  {
    type: 'location',
    name: 'City Records Vault',
    slug: 'city-records-vault',
    description:
      'Sub-basement records room with compact shelving, aged documents, and strict badge-locked access.',
    sort_order: 40,
    variants: [
      {
        name: 'Lit Catalog Aisle',
        prompt:
          'Narrow archive aisle with compact shelves, labeled boxes, soft overhead fluorescent light, subtle dust particles, realistic institutional environment',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/city-records-vault-catalog-aisle.jpg',
        is_main: true,
        where_to_use:
          'Research scenes where dialogue and object details need high readability.',
        reasoning:
          'Balanced exposure helps legibility for papers, IDs, and evidence props.',
      },
      {
        name: 'Emergency Power Mode',
        prompt:
          'Same archive vault under emergency red backup lights, deeper shadows, warning LEDs, cinematic suspense framing',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/city-records-vault-emergency-power.jpg',
        is_main: false,
        where_to_use:
          'Power-failure twists, alarm-triggered beats, and deadline-pressure moments.',
        reasoning:
          'Creates immediate tonal shift without introducing a brand new set.',
      },
    ],
  },
  {
    type: 'prop',
    name: 'Cipher Watch',
    slug: 'cipher-watch',
    description:
      'Modified analog wristwatch hiding a rotating microfilm key under the bezel.',
    sort_order: 50,
    variants: [
      {
        name: 'Closed Wristwatch',
        prompt:
          'Close-up product-style shot of vintage steel wristwatch on dark matte surface, engraved bezel, subtle scratches, cinematic practical highlights',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/cipher-watch-closed.jpg',
        is_main: true,
        where_to_use:
          'General continuity shots when the watch is present but unopened.',
        reasoning:
          'Defines the baseline silhouette and material properties for prop continuity.',
      },
      {
        name: 'Open Microfilm Mechanism',
        prompt:
          'Macro shot of same wristwatch with bezel opened to reveal hidden microfilm key, precise mechanical details, shallow depth of field, noir lighting',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/cipher-watch-open.jpg',
        is_main: false,
        where_to_use:
          'Reveal moments, clue decoding scenes, and episode turning points.',
        reasoning:
          'Makes the hidden mechanism explicit for story clarity during reveals.',
      },
    ],
  },
  {
    type: 'prop',
    name: 'Casefile Echo-9 Dossier',
    slug: 'casefile-echo-9-dossier',
    description:
      'Redacted folder containing timeline photos, transaction maps, and witness annotations.',
    sort_order: 60,
    variants: [
      {
        name: 'Sealed Folder Exterior',
        prompt:
          'Aged kraft dossier folder with stamped label ECHO-9, red evidence tape, overhead desk lamp vignette, high-detail paper texture',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/echo-9-dossier-sealed.jpg',
        is_main: true,
        where_to_use:
          'Teases, transition inserts, and setup beats before information is revealed.',
        reasoning:
          'Builds anticipation while maintaining mystery around dossier contents.',
      },
      {
        name: 'Spread Evidence Layout',
        prompt:
          'Same dossier opened on metal table with pinned photos, map printouts, handwritten notes, directional practical lighting, cinematic top-down composition',
        image_url:
          'https://cdn.octupost.dev/samples/schema-inspector/variants/echo-9-dossier-open-layout.jpg',
        is_main: false,
        where_to_use:
          'Investigation breakdowns and explanatory narration sections.',
        reasoning:
          'Supports visual storytelling when Ava connects multiple evidence threads.',
      },
    ],
  },
];

type SceneSeed = {
  order: number;
  title: string;
  duration: number;
  content_mode: 'narrative' | 'cinematic' | 'hybrid';
  visual_direction: string;
  prompt: string;
  location_variant_slug: string;
  character_variant_slugs: string[];
  prop_variant_slugs: string[];
  audio_text: string;
  audio_url: string;
  video_url: string;
  status: 'draft' | 'ready' | 'in_progress' | 'done' | 'failed';
};

type EpisodeSeed = {
  order: number;
  title: string;
  synopsis: string;
  audio_content: string;
  visual_outline: string;
  asset_variant_map: {
    characters: string[];
    locations: string[];
    props: string[];
  };
  plan_json: Record<string, unknown>;
  status: 'draft' | 'ready' | 'in_progress' | 'done';
  scenes: SceneSeed[];
};

import { slugify as toSlug } from '@/lib/utils/slugify';

function toVariantSlug(assetSlug: string, variantName: string) {
  return toSlug(`${assetSlug}-${variantName}`);
}

const SHARED_VARIANT_MAP = {
  characters: [
    'ava-kim-studio-intro',
    'ava-kim-field-reporter',
    'marcus-vale-archive-worker',
    'marcus-vale-anonymous-source',
  ],
  locations: [
    'pier-17-container-yard-blue-hour-establishing',
    'pier-17-container-yard-night-searchlight-pass',
    'city-records-vault-lit-catalog-aisle',
    'city-records-vault-emergency-power-mode',
  ],
  props: [
    'cipher-watch-closed-wristwatch',
    'cipher-watch-open-microfilm-mechanism',
    'casefile-echo-9-dossier-sealed-folder-exterior',
    'casefile-echo-9-dossier-spread-evidence-layout',
  ],
};

const SAMPLE_EPISODES: EpisodeSeed[] = [
  {
    order: 1,
    title: 'Episode 1 — Echo at Pier 17',
    synopsis:
      'Ava and Marcus connect a hidden watch mechanism to unauthorized harbor shipments and expose the first thread of Casefile Echo.',
    audio_content:
      'Voiceover alternates between Ava narration and short quoted lines from Marcus. Tempo escalates from investigative calm to urgency by final beat.',
    visual_outline:
      'Scene 1 establishes dock tension, Scene 2 reveals vault breach, Scene 3 decodes device, Scene 4 ends with interrupted escape.',
    asset_variant_map: SHARED_VARIANT_MAP,
    plan_json: {
      structure: {
        hook: 'Suspicious movement at a dead port.',
        reveal: 'A hidden timing key encoded in a watch bezel.',
        cliffhanger:
          'Searchlights activate before data can be extracted cleanly.',
      },
      scene_objectives: [
        {
          order: 1,
          objective: 'Prove Pier 17 is active despite official closure.',
          primary_assets: {
            characters: ['ava-kim-field-reporter'],
            locations: ['pier-17-container-yard-blue-hour-establishing'],
            props: ['cipher-watch-closed-wristwatch'],
          },
        },
        {
          order: 2,
          objective: 'Reveal Marcus broke protocol to obtain dossier access.',
          primary_assets: {
            characters: ['marcus-vale-archive-worker'],
            locations: ['city-records-vault-lit-catalog-aisle'],
            props: ['casefile-echo-9-dossier-sealed-folder-exterior'],
          },
        },
        {
          order: 3,
          objective: 'Link watch mechanism to shipment timing pattern.',
          primary_assets: {
            characters: ['ava-kim-studio-intro', 'marcus-vale-archive-worker'],
            locations: ['city-records-vault-emergency-power-mode'],
            props: [
              'cipher-watch-open-microfilm-mechanism',
              'casefile-echo-9-dossier-spread-evidence-layout',
            ],
          },
        },
        {
          order: 4,
          objective: 'Exit under pressure and set up episode continuation.',
          primary_assets: {
            characters: [
              'ava-kim-field-reporter',
              'marcus-vale-anonymous-source',
            ],
            locations: ['pier-17-container-yard-night-searchlight-pass'],
            props: ['casefile-echo-9-dossier-sealed-folder-exterior'],
          },
        },
      ],
      generation_config: {
        default_fps: 24,
        color_profile: 'cinematic-noir-v1',
        narration_mix_level: -8,
      },
    },
    status: 'in_progress',
    scenes: [
      {
        order: 1,
        title: 'Cold Open at Pier 17',
        duration: 16,
        content_mode: 'cinematic',
        visual_direction:
          'Start with a wide foggy establish, push in to Ava scanning container IDs while distant sirens echo.',
        prompt:
          'Cinematic thriller cold open, neon harbor at night, Ava Kim in field reporter look walking between wet shipping containers, subtle handheld camera drift, moody teal-orange grade, realistic rain reflections.',
        location_variant_slug: 'pier-17-container-yard-blue-hour-establishing',
        character_variant_slugs: ['ava-kim-field-reporter'],
        prop_variant_slugs: ['cipher-watch-closed-wristwatch'],
        audio_text:
          'The city calls this dock decommissioned. But every Tuesday at 2:17 a.m., someone still moves cargo through Pier 17.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-01.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-01.mp4',
        status: 'done',
      },
      {
        order: 2,
        title: 'Marcus Breaks Protocol',
        duration: 18,
        content_mode: 'narrative',
        visual_direction:
          'Contrast orderly archive rows with Marcus hurriedly pulling restricted binders, then glancing at security cameras.',
        prompt:
          'Narrative drama scene inside city records vault, Marcus Vale archive worker look, medium and close coverage, cool fluorescent lighting, evidence folder opened under desk lamp, cinematic realism.',
        location_variant_slug: 'city-records-vault-lit-catalog-aisle',
        character_variant_slugs: ['marcus-vale-archive-worker'],
        prop_variant_slugs: ['casefile-echo-9-dossier-sealed-folder-exterior'],
        audio_text:
          'Marcus knew the folder should have been sealed for another decade. He opened it anyway.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-02.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-02.mp4',
        status: 'in_progress',
      },
      {
        order: 3,
        title: 'Encrypted Timestamp Match',
        duration: 20,
        content_mode: 'hybrid',
        visual_direction:
          'Intercut Ava voiceover with close-up inserts of the cipher watch mechanism and annotated timeline boards.',
        prompt:
          'Hybrid investigative montage, close-up macro watch mechanism reveal, dossier evidence spread, slow cinematic push-ins mixed with narrative overlays, realistic film grain.',
        location_variant_slug: 'city-records-vault-emergency-power-mode',
        character_variant_slugs: [
          'ava-kim-studio-intro',
          'marcus-vale-archive-worker',
        ],
        prop_variant_slugs: [
          'cipher-watch-open-microfilm-mechanism',
          'casefile-echo-9-dossier-spread-evidence-layout',
        ],
        audio_text:
          'The watch face was not tracking time. It was tracking transfers.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-03.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-03.mp4',
        status: 'ready',
      },
      {
        order: 4,
        title: 'Searchlight Interruption',
        duration: 14,
        content_mode: 'cinematic',
        visual_direction:
          'Hard cut back to pier with searchlights sweeping through fog while Ava and Marcus split directions to avoid patrols.',
        prompt:
          'High-tension cinematic chase beat at Pier 17 under rotating searchlights, Ava and Marcus sprint through fog, long-lens compression, dramatic contrast, wet ground reflections.',
        location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
        character_variant_slugs: [
          'ava-kim-field-reporter',
          'marcus-vale-anonymous-source',
        ],
        prop_variant_slugs: ['casefile-echo-9-dossier-sealed-folder-exterior'],
        audio_text:
          'By the time the searchlights found us, the tape was already copied.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-scene-04.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-scene-04.mp4',
        status: 'failed',
      },
    ],
  },
  {
    order: 2,
    title: 'Episode 2 — The Archive Leak',
    synopsis:
      'A leaked maintenance log ties Marcus’s archive access to a second harbor operator, forcing Ava to widen the case.',
    audio_content:
      'More explanatory narration, quieter tension, and one deliberate mid-episode reveal line from Marcus.',
    visual_outline:
      'Scenes move from newsroom setup to archive conflict to evidence spread to an outbound lead.',
    asset_variant_map: SHARED_VARIANT_MAP,
    plan_json: {
      structure: {
        hook: 'A maintenance entry should not exist in public records.',
        reveal: 'Marcus was watched before he opened the file.',
        cliffhanger: 'A second operator name appears in the leak.',
      },
      scene_objectives: [
        {
          order: 1,
          objective: 'Frame the leak as deliberate, not accidental.',
        },
        {
          order: 2,
          objective: 'Show Marcus under pressure inside the archive.',
        },
        {
          order: 3,
          objective: 'Lay out the evidence chain clearly for the audience.',
        },
        { order: 4, objective: 'Point the investigation back toward Pier 17.' },
      ],
    },
    status: 'ready',
    scenes: [
      {
        order: 1,
        title: 'Newsroom Reframe',
        duration: 15,
        content_mode: 'narrative',
        visual_direction:
          'Direct-to-camera framing from Ava, then quick inserts of marked-up case materials.',
        prompt:
          'Investigative newsroom narration with Ava Kim studio intro look, desk evidence inserts, clean documentary framing.',
        location_variant_slug: 'city-records-vault-lit-catalog-aisle',
        character_variant_slugs: ['ava-kim-studio-intro'],
        prop_variant_slugs: ['casefile-echo-9-dossier-spread-evidence-layout'],
        audio_text:
          'Someone wanted this leak found. The question was whether they wanted us to survive it.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep2-scene-01.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep2-scene-01.mp4',
        status: 'done',
      },
      {
        order: 2,
        title: 'Restricted Shelf',
        duration: 17,
        content_mode: 'cinematic',
        visual_direction:
          'Marcus checks badge access, hears movement, then grabs the maintenance ledger anyway.',
        prompt:
          'Suspense scene in archive aisle, Marcus Vale archive worker look, practical overhead lighting, tense glances toward security camera.',
        location_variant_slug: 'city-records-vault-lit-catalog-aisle',
        character_variant_slugs: ['marcus-vale-archive-worker'],
        prop_variant_slugs: ['casefile-echo-9-dossier-sealed-folder-exterior'],
        audio_text:
          'If the ledger disappeared after tonight, Marcus wanted proof it had existed at all.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep2-scene-02.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep2-scene-02.mp4',
        status: 'ready',
      },
      {
        order: 3,
        title: 'Operator Name Match',
        duration: 19,
        content_mode: 'hybrid',
        visual_direction:
          'Top-down evidence layout mixed with Ava VO and redacted names sharpening into focus.',
        prompt:
          'Hybrid evidence analysis montage with dossier spread, watch detail inserts, cinematic top-down table composition.',
        location_variant_slug: 'city-records-vault-emergency-power-mode',
        character_variant_slugs: ['ava-kim-studio-intro'],
        prop_variant_slugs: [
          'casefile-echo-9-dossier-spread-evidence-layout',
          'cipher-watch-open-microfilm-mechanism',
        ],
        audio_text:
          'The shipping times were not random. They lined up with a maintenance crew that officially did not exist.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep2-scene-03.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep2-scene-03.mp4',
        status: 'ready',
      },
      {
        order: 4,
        title: 'Return to the Dock',
        duration: 13,
        content_mode: 'cinematic',
        visual_direction:
          'Cut from files to wet asphalt, blue-hour fog, and the sense that someone arrived before Ava.',
        prompt:
          'Moody harbor return scene at Pier 17 blue hour, Ava field reporter look, quiet dread, slick reflections, cinematic realism.',
        location_variant_slug: 'pier-17-container-yard-blue-hour-establishing',
        character_variant_slugs: ['ava-kim-field-reporter'],
        prop_variant_slugs: ['cipher-watch-closed-wristwatch'],
        audio_text:
          'By sunrise, the dock looked empty again. That was how we knew we were close.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep2-scene-04.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep2-scene-04.mp4',
        status: 'draft',
      },
    ],
  },
  {
    order: 3,
    title: 'Episode 3 — Searchlight Run',
    synopsis:
      'The team tries to copy shipment records from the dock perimeter before security locks the area down.',
    audio_content:
      'Fast narration with sparse dialogue; scene rhythm is driven by movement and interruption.',
    visual_outline:
      'Night return, perimeter breach, evidence capture, and split escape.',
    asset_variant_map: SHARED_VARIANT_MAP,
    plan_json: {
      structure: {
        hook: 'Security is already active before the team arrives.',
        reveal: 'The copied records show a third route, not just Pier 17.',
        cliffhanger: 'Ava and Marcus separate under pursuit.',
      },
      scene_objectives: [
        { order: 1, objective: 'Raise threat level immediately.' },
        { order: 2, objective: 'Show the breach and data capture attempt.' },
        { order: 3, objective: 'Reveal the route expansion.' },
        { order: 4, objective: 'End on pursuit and separation.' },
      ],
    },
    status: 'draft',
    scenes: [
      {
        order: 1,
        title: 'Perimeter Lights',
        duration: 14,
        content_mode: 'cinematic',
        visual_direction:
          'Searchlights sweep before anyone crosses the fence line.',
        prompt:
          'Night harbor surveillance scene with rotating searchlights and dense fog, empty industrial dock, thriller tone.',
        location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
        character_variant_slugs: ['ava-kim-field-reporter'],
        prop_variant_slugs: ['cipher-watch-closed-wristwatch'],
        audio_text:
          'They had upgraded security. That meant someone knew the records mattered.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep3-scene-01.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep3-scene-01.mp4',
        status: 'draft',
      },
      {
        order: 2,
        title: 'Fence Gap Entry',
        duration: 16,
        content_mode: 'cinematic',
        visual_direction:
          'Tight low-angle movement through fencing, handheld urgency, minimal spoken lines.',
        prompt:
          'Dock infiltration scene with Ava and Marcus moving through fence gap, wet ground, handheld cinematic thriller framing.',
        location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
        character_variant_slugs: [
          'ava-kim-field-reporter',
          'marcus-vale-anonymous-source',
        ],
        prop_variant_slugs: ['casefile-echo-9-dossier-sealed-folder-exterior'],
        audio_text: 'Marcus only said two words: keep moving.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep3-scene-02.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep3-scene-02.mp4',
        status: 'draft',
      },
      {
        order: 3,
        title: 'Route Sheet Capture',
        duration: 18,
        content_mode: 'hybrid',
        visual_direction:
          'Close-up evidence inserts with compressed time while Ava narrates the meaning of the routes.',
        prompt:
          'Evidence capture montage at harbor workstation, dossier inserts, route sheets, practical sodium lighting, hybrid documentary style.',
        location_variant_slug: 'pier-17-container-yard-blue-hour-establishing',
        character_variant_slugs: ['ava-kim-field-reporter'],
        prop_variant_slugs: ['casefile-echo-9-dossier-spread-evidence-layout'],
        audio_text:
          'The routes connected three cities. Pier 17 was only the middle point.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep3-scene-03.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep3-scene-03.mp4',
        status: 'draft',
      },
      {
        order: 4,
        title: 'Split Escape',
        duration: 15,
        content_mode: 'cinematic',
        visual_direction:
          'Cross-cut Ava and Marcus fleeing in opposite directions through light and fog.',
        prompt:
          'Split pursuit scene at industrial dock, long-lens panic, searchlights through fog, noir chase mood.',
        location_variant_slug: 'pier-17-container-yard-night-searchlight-pass',
        character_variant_slugs: [
          'ava-kim-field-reporter',
          'marcus-vale-anonymous-source',
        ],
        prop_variant_slugs: ['cipher-watch-closed-wristwatch'],
        audio_text:
          'We ran in opposite directions so at least one of us might keep the copy.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep3-scene-04.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep3-scene-04.mp4',
        status: 'draft',
      },
    ],
  },
  {
    order: 4,
    title: 'Episode 4 — Rain Signal',
    synopsis:
      'A coded weather alert reveals who is coordinating the shipments and pushes the season arc into the next investigation.',
    audio_content:
      'Measured narration returns, with a final reveal that feels investigative rather than action-driven.',
    visual_outline:
      'Recovery, decode, identity reveal, and a closing teaser for the next route.',
    asset_variant_map: SHARED_VARIANT_MAP,
    plan_json: {
      structure: {
        hook: 'After the chase, the only clue left is a weather alert.',
        reveal: 'The weather code identifies the coordinator behind Echo-9.',
        cliffhanger: 'The next shipment is not headed to the harbor at all.',
      },
      scene_objectives: [
        {
          order: 1,
          objective: 'Reset after pursuit and reframe the investigation.',
        },
        { order: 2, objective: 'Decode the weather pattern signal.' },
        { order: 3, objective: 'Name the coordinator behind the transfers.' },
        { order: 4, objective: 'Point toward the next episode/arc.' },
      ],
    },
    status: 'draft',
    scenes: [
      {
        order: 1,
        title: 'Safehouse Reset',
        duration: 14,
        content_mode: 'narrative',
        visual_direction:
          'Calmer interior energy, damp clothing, dossier and watch placed under one lamp.',
        prompt:
          'Post-chase reset scene, Ava and Marcus regroup in dim safehouse, practical lamp lighting, grounded investigative tone.',
        location_variant_slug: 'city-records-vault-lit-catalog-aisle',
        character_variant_slugs: [
          'ava-kim-studio-intro',
          'marcus-vale-anonymous-source',
        ],
        prop_variant_slugs: [
          'cipher-watch-open-microfilm-mechanism',
          'casefile-echo-9-dossier-spread-evidence-layout',
        ],
        audio_text:
          'The mistake was assuming the route data was the message. It was only the envelope.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep4-scene-01.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep4-scene-01.mp4',
        status: 'draft',
      },
      {
        order: 2,
        title: 'Weather Code Decode',
        duration: 17,
        content_mode: 'hybrid',
        visual_direction:
          'Overlay weather bulletin typography with timeline and watch inserts.',
        prompt:
          'Weather-code decoding montage with overlays, watch details, dossier spread, investigative thriller visual language.',
        location_variant_slug: 'city-records-vault-emergency-power-mode',
        character_variant_slugs: ['ava-kim-studio-intro'],
        prop_variant_slugs: [
          'cipher-watch-open-microfilm-mechanism',
          'casefile-echo-9-dossier-spread-evidence-layout',
        ],
        audio_text:
          'Rainfall totals, wind direction, port closure notices. It was all a schedule disguised as weather.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep4-scene-02.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep4-scene-02.mp4',
        status: 'draft',
      },
      {
        order: 3,
        title: 'Coordinator Identified',
        duration: 18,
        content_mode: 'narrative',
        visual_direction:
          'Slow confidence build as the redacted name is matched to archive and dock records.',
        prompt:
          'Investigative reveal scene, Ava presenting matched records, restrained noir tone, evidence-led storytelling.',
        location_variant_slug: 'city-records-vault-lit-catalog-aisle',
        character_variant_slugs: [
          'ava-kim-studio-intro',
          'marcus-vale-archive-worker',
        ],
        prop_variant_slugs: ['casefile-echo-9-dossier-sealed-folder-exterior'],
        audio_text:
          'The coordinator was never hidden. She was indexed under maintenance and buried in plain sight.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep4-scene-03.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep4-scene-03.mp4',
        status: 'draft',
      },
      {
        order: 4,
        title: 'Next Route Tease',
        duration: 12,
        content_mode: 'cinematic',
        visual_direction:
          'Close on a new route marker while harbor noise fades into distant train sound.',
        prompt:
          'Short closing teaser with dossier insert and atmospheric route transition, cinematic investigative cliffhanger.',
        location_variant_slug: 'pier-17-container-yard-blue-hour-establishing',
        character_variant_slugs: ['ava-kim-field-reporter'],
        prop_variant_slugs: ['casefile-echo-9-dossier-sealed-folder-exterior'],
        audio_text:
          'Pier 17 was only the midpoint. The next route started inland.',
        audio_url:
          'https://cdn.octupost.dev/samples/schema-inspector/audio/echo-9-ep4-scene-04.mp3',
        video_url:
          'https://cdn.octupost.dev/samples/schema-inspector/video/echo-9-ep4-scene-04.mp4',
        status: 'draft',
      },
    ],
  },
];

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Schema inspector seed route is disabled in production.' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    route: '/api/dev/schema-inspector/seed',
    method: 'POST',
    description:
      'Rebuilds a full dev-only sample dataset for the schema reset inspector using your authenticated user id.',
    sampleProjectName: SAMPLE_PROJECT_NAME,
    sampleSeriesName: SAMPLE_SERIES_NAME,
    usage: {
      fetch: "fetch('/api/dev/schema-inspector/seed', { method: 'POST' })",
      curl: "curl -X POST http://localhost:3000/api/dev/schema-inspector/seed -H 'Cookie: <your session cookies>'",
    },
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Seed route intentionally performs one ordered, review-focused data write across the full hierarchy.
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Schema inspector seed route is disabled in production.' },
      { status: 404 }
    );
  }

  const user = await getUserOrApiKey(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await createAdminClient('studio');

  const { error: cleanupError } = await supabase
    .from('projects')
    .delete()
    .eq('user_id', user.id)
    .eq('name', SAMPLE_PROJECT_NAME);

  if (cleanupError) {
    return NextResponse.json(
      {
        error: 'Failed to clear previous sample dataset.',
        details: cleanupError.message,
      },
      { status: 500 }
    );
  }

  const { data: projectRow, error: projectError } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: SAMPLE_PROJECT_NAME,
      description:
        'Dev-only review dataset for schema reset inspector. Contains one full hierarchy with rich JSON and mixed statuses.',
    })
    .select('id, name')
    .single();

  if (projectError || !projectRow) {
    return NextResponse.json(
      {
        error: 'Failed to create sample project.',
        details: projectError?.message ?? 'Missing inserted project row.',
      },
      { status: 500 }
    );
  }

  const { data: seriesRow, error: seriesError } = await supabase
    .from('series')
    .insert({
      project_id: projectRow.id,
      user_id: user.id,
      name: SAMPLE_SERIES_NAME,
      genre: 'Investigative thriller',
      tone: 'Noir, urgent, and emotionally restrained',
      bible:
        'Casefile Echo follows investigative host Ava Kim as she reopens abandoned municipal corruption cases through leaked archives and anonymous sources.',
      content_mode: 'hybrid',
      language: 'en-US',
      aspect_ratio: '9:16',
      video_model: 'kling-v2.1-reference',
      image_model: 'flux-dev-cinematic-v3',
      voice_id: 'alloy-investigative-neutral',
      tts_speed: 1.03,
      visual_style:
        'Neon noir documentary realism with practical lighting, damp textures, and restrained color contrast.',
      plan_status: 'finalized',
      creative_brief: {
        version: 3,
        logline:
          'A leaked timing device links nighttime harbor shipments to a buried city records operation.',
        objective:
          'Deliver one short-form investigative episode that introduces Ava, Marcus, the Echo-9 dossier, and the cipher watch mechanism.',
        target_runtime_seconds: 68,
        recurring_motifs: [
          'rain on metal',
          'searchlight sweeps',
          'paper trail overlays',
        ],
        pacing_notes: {
          cold_open_seconds: 16,
          evidence_reveal_seconds: 38,
          cliffhanger_seconds: 14,
        },
        episode_beats: [
          {
            order: 1,
            beat: 'Ava confirms active movement at a supposedly inactive dock.',
          },
          {
            order: 2,
            beat: 'Marcus risks his access by opening restricted records.',
          },
          {
            order: 3,
            beat: 'The watch mechanism decodes shipment timing patterns.',
          },
          {
            order: 4,
            beat: 'Security sweep interrupts and sets up next episode stakes.',
          },
        ],
        risk_flags: {
          legal_review_required: true,
          names_fictionalized: true,
          sensitive_locations_masked: true,
        },
      },
    })
    .select('id, name')
    .single();

  if (seriesError || !seriesRow) {
    return NextResponse.json(
      {
        error: 'Failed to create sample series.',
        details: seriesError?.message ?? 'Missing inserted series row.',
      },
      { status: 500 }
    );
  }

  const { data: insertedAssets, error: assetsError } = await supabase
    .from('series_assets')
    .insert(
      SAMPLE_ASSETS.map((asset) => ({
        series_id: seriesRow.id,
        type: asset.type,
        name: asset.name,
        slug: asset.slug,
        description: asset.description,
        sort_order: asset.sort_order,
      }))
    )
    .select('id, slug, type');

  if (assetsError || !insertedAssets) {
    return NextResponse.json(
      {
        error: 'Failed to create sample assets.',
        details: assetsError?.message ?? 'No asset rows inserted.',
      },
      { status: 500 }
    );
  }

  const assetIdBySlug = new Map(
    insertedAssets.map((asset) => [asset.slug, asset.id] as const)
  );

  const variantRows = SAMPLE_ASSETS.flatMap((asset) => {
    const assetId = assetIdBySlug.get(asset.slug);
    if (!assetId) return [];

    return asset.variants.map((variant) => {
      const variantSlug = toVariantSlug(asset.slug, variant.name);

      return {
        asset_id: assetId,
        slug: variantSlug,
        name: variant.name,
        prompt: variant.prompt,
        image_url: variant.image_url,
        is_main: variant.is_main,
        where_to_use: variant.where_to_use,
        reasoning: variant.reasoning,
      };
    });
  });

  const { data: insertedVariants, error: variantsError } = await supabase
    .from('series_asset_variants')
    .insert(variantRows)
    .select('id');

  if (variantsError || !insertedVariants) {
    return NextResponse.json(
      {
        error: 'Failed to create sample asset variants.',
        details: variantsError?.message ?? 'No variant rows inserted.',
      },
      { status: 500 }
    );
  }

  const { data: insertedEpisodeRows, error: episodesError } = await supabase
    .from('episodes')
    .insert(
      SAMPLE_EPISODES.map((episode) => ({
        series_id: seriesRow.id,
        order: episode.order,
        title: episode.title,
        synopsis: episode.synopsis,
        audio_content: episode.audio_content,
        visual_outline: episode.visual_outline,
        asset_variant_map: episode.asset_variant_map,
        plan_json: episode.plan_json,
        status: episode.status,
      }))
    )
    .select('id, title, order');

  if (episodesError || !insertedEpisodeRows) {
    return NextResponse.json(
      {
        error: 'Failed to create sample episodes.',
        details: episodesError?.message ?? 'Missing inserted episode rows.',
      },
      { status: 500 }
    );
  }

  const episodeIdByOrder = new Map(
    insertedEpisodeRows.map((episode) => [episode.order, episode.id] as const)
  );

  const sceneRows = SAMPLE_EPISODES.flatMap((episode) => {
    const episodeId = episodeIdByOrder.get(episode.order);
    if (!episodeId) return [];

    return episode.scenes.map((scene) => ({
      episode_id: episodeId,
      order: scene.order,
      title: scene.title,
      video_duration: scene.duration ?? null,
      content_mode: scene.content_mode,
      visual_direction: scene.visual_direction,
      prompt: scene.prompt,
      location_variant_slug: scene.location_variant_slug,
      character_variant_slugs: scene.character_variant_slugs,
      prop_variant_slugs: scene.prop_variant_slugs,
      audio_text: scene.audio_text,
      audio_url: scene.audio_url,
      video_url: scene.video_url,
      status: scene.status,
    }));
  });

  const { data: insertedScenes, error: scenesError } = await supabase
    .from('scenes')
    .insert(sceneRows)
    .select('id');

  if (scenesError || !insertedScenes) {
    return NextResponse.json(
      {
        error: 'Failed to create sample scenes.',
        details: scenesError?.message ?? 'No scene rows inserted.',
      },
      { status: 500 }
    );
  }

  const primaryEpisode = insertedEpisodeRows.find(
    (episode) => episode.order === 1
  );

  return NextResponse.json({
    ok: true,
    summary: {
      projectName: SAMPLE_PROJECT_NAME,
      seriesName: SAMPLE_SERIES_NAME,
      assets: insertedAssets.length,
      variants: insertedVariants.length,
      episodes: insertedEpisodeRows.length,
      scenes: insertedScenes.length,
    },
    ids: {
      projectId: projectRow.id,
      seriesId: seriesRow.id,
      episodeId: primaryEpisode?.id ?? insertedEpisodeRows[0]?.id ?? null,
      episodeIds: insertedEpisodeRows.map((episode) => episode.id),
    },
    hint: `Open /dev/schema-inspector?projectId=${projectRow.id}&seriesId=${seriesRow.id}`,
  });
}
