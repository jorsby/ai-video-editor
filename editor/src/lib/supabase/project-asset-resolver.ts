// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const SERIES_ASSETS_BUCKET = 'series-assets';

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
    is_finalized?: boolean | null;
    is_main: boolean;
    image_url: string | null;
  }>
): { url: string; variantId: string } | null {
  if (!variants || variants.length === 0) return null;

  for (const variant of variants) {
    if (variant.is_finalized) {
      const url = resolveImageUrl(supabase, variant.image_url);
      if (url) return { url, variantId: variant.id };
    }
  }

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

export async function resolveProjectAssetCandidatesForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectAssetCandidateSet | null> {
  const { data: assets, error: assetsError } = await supabase
    .from('project_assets')
    .select(
      'id, name, type, description, project_asset_variants (id, is_main, is_finalized, image_url)'
    )
    .eq('project_id', projectId);

  if (assetsError) {
    console.warn(
      '[project-asset-resolver] Failed to load project assets for candidates:',
      assetsError.message
    );
    return null;
  }

  if (!assets || assets.length === 0) return null;

  const candidateSet: ProjectAssetCandidateSet = {
    characters: [],
    locations: [],
    props: [],
  };

  for (const asset of assets) {
    const bestVariantImage = pickBestVariantImage(
      supabase,
      asset.project_asset_variants ?? []
    );
    if (!bestVariantImage) continue;

    const candidate: ProjectAssetCandidate = {
      assetId: String(asset.id),
      variantId: bestVariantImage.variantId,
      assetName: String(asset.name),
      description:
        typeof asset.description === 'string' ? asset.description : null,
      type:
        asset.type === 'character'
          ? 'character'
          : asset.type === 'location'
            ? 'location'
            : 'prop',
      url: bestVariantImage.url,
    };

    if (candidate.type === 'character') {
      candidateSet.characters.push(candidate);
    } else if (candidate.type === 'location') {
      candidateSet.locations.push(candidate);
    } else {
      candidateSet.props.push(candidate);
    }
  }

  return candidateSet;
}

export async function resolveProjectAssetsForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectAssetMap | null> {
  const { data: assets, error: assetsError } = await supabase
    .from('project_assets')
    .select(
      'id, name, type, project_asset_variants (id, is_main, is_finalized, image_url)'
    )
    .eq('project_id', projectId);

  if (assetsError) {
    console.warn(
      '[project-asset-resolver] Failed to load project assets:',
      assetsError.message
    );
    return null;
  }

  if (!assets || assets.length === 0) return null;

  const characters = new Map<string, ProjectAssetEntry>();
  const locations = new Map<string, ProjectAssetEntry>();
  const props = new Map<string, ProjectAssetEntry>();

  for (const asset of assets) {
    const bestVariantImage = pickBestVariantImage(
      supabase,
      asset.project_asset_variants ?? []
    );
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
