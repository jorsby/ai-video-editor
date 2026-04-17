// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const SERIES_ASSETS_BUCKET = 'video-assets';

export interface ProjectAssetEntry {
  url: string;
  assetName: string;
  variantId: string;
}

export interface ProjectAssetMap {
  characters: Map<string, ProjectAssetEntry>;
  locations: Map<string, ProjectAssetEntry>;
  props: Map<string, ProjectAssetEntry>;
}

export interface ProjectAssetCandidate {
  assetId: string;
  variantId: string;
  assetName: string;
  description: string | null;
  type: 'character' | 'location' | 'prop';
  url: string;
}

export interface ProjectAssetCandidateSet {
  characters: ProjectAssetCandidate[];
  locations: ProjectAssetCandidate[];
  props: ProjectAssetCandidate[];
}

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/[/(].*/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAltNames(name: string): string[] {
  const alts: string[] = [];

  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const alt = parenMatch[1]
      .toLowerCase()
      .trim()
      .replace(/^the\s+/i, '');
    if (alt.length > 1) alts.push(alt);
  }

  const slashParts = name.split('/');
  if (slashParts.length > 1) {
    for (let i = 1; i < slashParts.length; i++) {
      const alt = slashParts[i]
        .toLowerCase()
        .trim()
        .replace(/^the\s+/i, '');
      if (alt.length > 1) alts.push(alt);
    }
  }

  return alts;
}

function resolveImageUrl(
  supabase: SupabaseClient,
  imageUrl: string | null | undefined
): string | null {
  if (!imageUrl) return null;

  if (/^https?:\/\//i.test(imageUrl)) {
    return imageUrl;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(SERIES_ASSETS_BUCKET).getPublicUrl(imageUrl);

  return publicUrl || imageUrl;
}

function pickBestVariantImage(
  supabase: SupabaseClient,
  variants: Array<{
    id: string;
    is_main: boolean;
    image_url: string | null;
  }>
): { url: string; variantId: string } | null {
  if (!variants || variants.length === 0) return null;

  // is_main first, then any with image
  for (const variant of variants) {
    if (variant.is_main) {
      const url = resolveImageUrl(supabase, variant.image_url);
      if (url) return { url, variantId: variant.id };
    }
  }

  for (const variant of variants) {
    const url = resolveImageUrl(supabase, variant.image_url);
    if (url) return { url, variantId: variant.id };
  }

  return null;
}

type AssetType = 'character' | 'location' | 'prop';

const TYPED_SOURCES: Array<{
  type: AssetType;
  parent: 'characters' | 'locations' | 'props';
  variants: 'character_variants' | 'location_variants' | 'prop_variants';
}> = [
  {
    type: 'character',
    parent: 'characters',
    variants: 'character_variants',
  },
  { type: 'location', parent: 'locations', variants: 'location_variants' },
  { type: 'prop', parent: 'props', variants: 'prop_variants' },
];

type RawAssetRow = {
  id: string;
  name: string;
  structured_prompt?: Record<string, unknown> | null;
  use_case?: string | null;
  [variantKey: string]:
    | string
    | Record<string, unknown>
    | null
    | undefined
    | Array<{ id: string; is_main: boolean; image_url: string | null }>;
};

function flattenDescription(
  structured: Record<string, unknown> | null | undefined,
  useCase: string | null | undefined
): string | null {
  const bits: string[] = [];
  if (structured && typeof structured === 'object') {
    for (const v of Object.values(structured)) {
      if (typeof v === 'string' && v.trim()) bits.push(v.trim());
    }
  }
  if (typeof useCase === 'string' && useCase.trim()) bits.push(useCase.trim());
  return bits.length > 0 ? bits.join('. ') : null;
}

async function fetchTypedAssetsForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<Array<RawAssetRow & { type: AssetType }> | null> {
  const results = await Promise.all(
    TYPED_SOURCES.map(async ({ type, parent, variants }) => {
      const { data, error } = await supabase
        .from(parent)
        .select(
          `id, name, structured_prompt, use_case, ${variants}(id, is_main, image_url)`
        )
        .eq('project_id', projectId);
      if (error) {
        console.warn(
          `[project-asset-resolver] Failed to load ${parent}:`,
          error.message
        );
        return [] as Array<RawAssetRow & { type: AssetType }>;
      }
      return (data ?? []).map((row: RawAssetRow) => ({ ...row, type }));
    })
  );
  const merged = results.flat();
  return merged.length > 0 ? merged : null;
}

function extractVariants(
  row: RawAssetRow,
  variantKey: string
): Array<{ id: string; is_main: boolean; image_url: string | null }> {
  const raw = row[variantKey];
  if (!Array.isArray(raw)) return [];
  return raw as Array<{
    id: string;
    is_main: boolean;
    image_url: string | null;
  }>;
}

export async function resolveProjectAssetCandidatesForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectAssetCandidateSet | null> {
  const assets = await fetchTypedAssetsForProject(supabase, projectId);
  if (!assets) return null;

  const candidateSet: ProjectAssetCandidateSet = {
    characters: [],
    locations: [],
    props: [],
  };

  for (const asset of assets) {
    const source = TYPED_SOURCES.find((s) => s.type === asset.type);
    if (!source) continue;

    const variants = extractVariants(asset, source.variants);
    const bestVariantImage = pickBestVariantImage(supabase, variants);
    if (!bestVariantImage) continue;

    const candidate: ProjectAssetCandidate = {
      assetId: String(asset.id),
      variantId: bestVariantImage.variantId,
      assetName: String(asset.name),
      description: flattenDescription(asset.structured_prompt, asset.use_case),
      type: asset.type,
      url: bestVariantImage.url,
    };

    candidateSet[`${asset.type}s` as keyof ProjectAssetCandidateSet].push(
      candidate
    );
  }

  return candidateSet;
}

export async function resolveProjectAssetsForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectAssetMap | null> {
  const assets = await fetchTypedAssetsForProject(supabase, projectId);
  if (!assets) return null;

  const characters = new Map<string, ProjectAssetEntry>();
  const locations = new Map<string, ProjectAssetEntry>();
  const props = new Map<string, ProjectAssetEntry>();

  for (const asset of assets) {
    const source = TYPED_SOURCES.find((s) => s.type === asset.type);
    if (!source) continue;

    const variants = extractVariants(asset, source.variants);
    const bestVariantImage = pickBestVariantImage(supabase, variants);
    if (!bestVariantImage) continue;

    const normalizedName = normalizeName(asset.name as string);
    const altNames = extractAltNames(asset.name as string);
    const entry: ProjectAssetEntry = {
      url: bestVariantImage.url,
      variantId: bestVariantImage.variantId,
      assetName: asset.name as string,
    };

    const targetMap =
      asset.type === 'character'
        ? characters
        : asset.type === 'location'
          ? locations
          : props;

    targetMap.set(normalizedName, entry);
    for (const alt of altNames) {
      if (!targetMap.has(alt)) {
        targetMap.set(alt, entry);
      }
    }
  }

  return { characters, locations, props };
}

export function matchProjectAsset(
  assetMap: ProjectAssetMap,
  objectName: string,
  type: 'character' | 'location' | 'prop'
): ProjectAssetEntry | null {
  const normalizedInput = normalizeName(objectName);
  if (!normalizedInput) return null;

  const map =
    type === 'character'
      ? assetMap.characters
      : type === 'location'
        ? assetMap.locations
        : assetMap.props;

  const exact = map.get(normalizedInput);
  if (exact) return exact;

  for (const [assetNormName, entry] of map) {
    if (
      assetNormName.includes(normalizedInput) ||
      normalizedInput.includes(assetNormName)
    ) {
      return entry;
    }
  }

  return null;
}
