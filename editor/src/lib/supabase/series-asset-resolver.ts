/**
 * Series Asset Resolver
 *
 * Given a project ID, checks if it belongs to a series (via series_episodes table).
 * If yes, loads all series assets (characters, locations, props) with their variant
 * images and returns maps from normalized name → { url, assetName } for matching
 * against storyboard plan objects/backgrounds.
 *
 * Matching logic:
 * - Normalize both names: lowercase, trim, remove "the ", strip text after "/" or "("
 * - Exact match first, then substring match (either direction)
 * - For variants: prefer finalized → default → first with image
 * - Only return assets that have an actual image URL
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;

const SERIES_ASSETS_BUCKET = 'series-assets';

export interface SeriesAssetEntry {
  url: string;
  assetName: string;
}

export interface SeriesAssetMap {
  characters: Map<string, SeriesAssetEntry>;
  locations: Map<string, SeriesAssetEntry>;
  props: Map<string, SeriesAssetEntry>;
}

/**
 * Normalize an asset name for matching:
 * - lowercase + trim
 * - strip leading "the "
 * - strip everything after "/" or "("
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^the\s+/i, '')
    .replace(/[/(].*/g, '')
    .trim();
}

/**
 * Extract alternate names from parenthesized or slash-separated parts.
 * "Hotel Room (Room 4B)" → ["room 4b"]
 * "The Receptionist / The Watcher" → ["watcher"]
 */
function extractAltNames(name: string): string[] {
  const alts: string[] = [];
  // Parenthesized: "Hotel Room (Room 4B)" → "Room 4B"
  const parenMatch = name.match(/\(([^)]+)\)/);
  if (parenMatch) {
    const alt = parenMatch[1]
      .toLowerCase()
      .trim()
      .replace(/^the\s+/i, '');
    if (alt.length > 1) alts.push(alt);
  }
  // Slash-separated: "A / B" → "B"
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

/**
 * Resolve a single image URL from a variant_image row.
 * If the url field is already an https URL (and not a signed URL), use it directly.
 * Otherwise derive a public URL from the storage_path.
 */
function resolveImageUrl(
  supabase: SupabaseClient,
  img: { url: string | null; storage_path: string | null }
): string | null {
  const url = img.url ?? null;

  // Already a proper public URL (not signed)
  if (url && /^https?:\/\//i.test(url) && !url.includes('/object/sign/')) {
    return url;
  }

  // Try to get public URL from storage_path
  if (img.storage_path) {
    const {
      data: { publicUrl },
    } = supabase.storage
      .from(SERIES_ASSETS_BUCKET)
      .getPublicUrl(img.storage_path);
    if (publicUrl) return publicUrl;
  }

  return null;
}

/**
 * Pick the best image URL from a variant's images list (any image works).
 */
function pickVariantImageUrl(
  supabase: SupabaseClient,
  images: Array<{ url: string | null; storage_path: string | null }>
): string | null {
  for (const img of images) {
    const url = resolveImageUrl(supabase, img);
    if (url) return url;
  }
  return null;
}

/**
 * From a list of variants (with images), pick the best image URL.
 * Priority: finalized → default → first with any image
 */
function pickBestVariantImageUrl(
  supabase: SupabaseClient,
  variants: Array<{
    is_finalized: boolean;
    is_default: boolean;
    series_asset_variant_images: Array<{
      url: string | null;
      storage_path: string | null;
    }>;
  }>
): string | null {
  if (!variants || variants.length === 0) return null;

  // 1. Finalized variant with image
  for (const v of variants) {
    if (v.is_finalized) {
      const url = pickVariantImageUrl(
        supabase,
        v.series_asset_variant_images ?? []
      );
      if (url) return url;
    }
  }

  // 2. Default variant with image
  for (const v of variants) {
    if (v.is_default) {
      const url = pickVariantImageUrl(
        supabase,
        v.series_asset_variant_images ?? []
      );
      if (url) return url;
    }
  }

  // 3. First variant with any image
  for (const v of variants) {
    const url = pickVariantImageUrl(
      supabase,
      v.series_asset_variant_images ?? []
    );
    if (url) return url;
  }

  return null;
}

/**
 * Given a project ID, check if it belongs to a series and resolve all assets.
 * Returns null if the project is not part of any series, or on error.
 *
 * @param supabase - Service-role client with 'studio' schema
 * @param projectId - The project ID to look up
 */
export async function resolveSeriesAssetsForProject(
  supabase: SupabaseClient,
  projectId: string
): Promise<SeriesAssetMap | null> {
  // 1. Find the episode that links this project to a series
  const { data: episode, error: episodeError } = await supabase
    .from('series_episodes')
    .select('series_id')
    .eq('project_id', projectId)
    .maybeSingle();

  if (episodeError) {
    console.warn(
      '[series-asset-resolver] Failed to look up episode:',
      episodeError.message
    );
    return null;
  }

  if (!episode) return null; // Not part of a series

  const seriesId: string = episode.series_id;

  // 2. Load all series assets with their variants and images
  const { data: assets, error: assetsError } = await supabase
    .from('series_assets')
    .select(
      'id, name, type, series_asset_variants (id, is_default, is_finalized, series_asset_variant_images (id, url, storage_path))'
    )
    .eq('series_id', seriesId);

  if (assetsError) {
    console.warn(
      '[series-asset-resolver] Failed to load series assets:',
      assetsError.message
    );
    return null;
  }

  if (!assets || assets.length === 0) return null;

  // 3. Build normalized name maps per asset type
  const characters = new Map<string, SeriesAssetEntry>();
  const locations = new Map<string, SeriesAssetEntry>();
  const props = new Map<string, SeriesAssetEntry>();

  for (const asset of assets) {
    const url = pickBestVariantImageUrl(
      supabase,
      asset.series_asset_variants ?? []
    );
    if (!url) continue; // Skip assets with no resolved image

    const normalizedName = normalizeName(asset.name as string);
    const altNames = extractAltNames(asset.name as string);
    const entry: SeriesAssetEntry = { url, assetName: asset.name as string };

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

/**
 * Try to match an object/background name against a series asset map.
 *
 * Steps:
 * 1. Normalize the input name
 * 2. Exact normalized match in the type's map
 * 3. Substring match in either direction
 * 4. Return null if no match
 *
 * @param assetMap - The resolved series asset map
 * @param objectName - Name from the storyboard plan (object or background)
 * @param type - 'character' | 'location' | 'prop'
 */
export function matchSeriesAsset(
  assetMap: SeriesAssetMap,
  objectName: string,
  type: 'character' | 'location' | 'prop'
): SeriesAssetEntry | null {
  const normalizedInput = normalizeName(objectName);
  if (!normalizedInput) return null;

  const map =
    type === 'character'
      ? assetMap.characters
      : type === 'location'
        ? assetMap.locations
        : assetMap.props;

  // 1. Exact match
  const exact = map.get(normalizedInput);
  if (exact) return exact;

  // 2. Substring match (either direction)
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
