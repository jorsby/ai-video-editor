#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function readArg(name) {
  const pref = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

const apply = process.argv.includes('--apply');
const seriesId = readArg('series-id');

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { db: { schema: 'studio' } });

const LOCATION_HINTS = [
  'mekke',
  'medine',
  'magara',
  'mağara',
  'cadir',
  'çadır',
  'meydan',
  'yerlesim',
  'yerleşim',
  'yol',
  'oda',
  'ev',
  'route',
  'road',
  'street',
  'alley',
  'cave',
  'tent',
  'square',
  'interior',
  'exterior',
  'location',
];

const PROP_HINTS = [
  'kilic',
  'kılıç',
  'deve',
  'at',
  'sword',
  'camel',
  'horse',
  'scroll',
  'props',
  'prop',
  'tulum',
  'heyb',
  'weapon',
  'bag',
];

function normalize(text) {
  return String(text ?? '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .toLowerCase();
}

function includesAny(value, hints) {
  return hints.some((hint) => value.includes(hint));
}

function suggestType(asset) {
  // Safe mode: only infer when type is missing/invalid.
  // We do NOT override existing valid types automatically.
  const currentType = typeof asset.type === 'string' ? asset.type : null;
  if (currentType === 'character' || currentType === 'location' || currentType === 'prop') {
    return currentType;
  }

  if (asset.character_id) return 'character';

  const haystack = normalize(
    [asset.name, asset.description, ...(asset.tags ?? [])].filter(Boolean).join(' ')
  );

  if (includesAny(haystack, LOCATION_HINTS)) return 'location';
  if (includesAny(haystack, PROP_HINTS)) return 'prop';
  return 'prop';
}

async function main() {
  let query = supabase
    .from('series_assets')
    .select('id, series_id, name, description, type, tags, character_id')
    .order('created_at', { ascending: true })
    .limit(5000);

  if (seriesId) {
    query = query.eq('series_id', seriesId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to load series_assets:', error.message);
    process.exit(1);
  }

  const assets = data ?? [];
  const changes = [];

  for (const asset of assets) {
    const nextType = suggestType(asset);
    if (nextType !== asset.type) {
      changes.push({
        id: asset.id,
        name: asset.name,
        current_type: asset.type,
        suggested_type: nextType,
      });
    }
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          seriesId: seriesId ?? 'all',
          scanned: assets.length,
          proposedUpdates: changes.length,
          sample: changes.slice(0, 20),
        },
        null,
        2
      )
    );
    return;
  }

  let updated = 0;
  for (const change of changes) {
    const { error: updateError } = await supabase
      .from('series_assets')
      .update({ type: change.suggested_type })
      .eq('id', change.id);

    if (updateError) {
      console.error(
        `Failed to update ${change.id} (${change.name}):`,
        updateError.message
      );
      continue;
    }

    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        seriesId: seriesId ?? 'all',
        scanned: assets.length,
        proposedUpdates: changes.length,
        updated,
      },
      null,
      2
    )
  );
}

await main();
