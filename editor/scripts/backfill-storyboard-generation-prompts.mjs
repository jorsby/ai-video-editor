#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

function readArg(name) {
  const pref = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

const apply = process.argv.includes('--apply');
const storyboardId = readArg('storyboard-id');

if (!storyboardId) {
  console.error('Usage: node editor/scripts/backfill-storyboard-generation-prompts.mjs --storyboard-id=<uuid> [--apply]');
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { db: { schema: 'studio' } });

function toPromptText(scene) {
  if (Array.isArray(scene.multi_prompt)) {
    const valid = scene.multi_prompt
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);

    if (valid.length > 0) {
      return valid.join(' | ');
    }
  }

  if (typeof scene.prompt === 'string' && scene.prompt.trim()) {
    return scene.prompt.trim();
  }

  return '';
}

function buildObjectPrompt(objectName, description, sceneCue) {
  const safeName = objectName?.trim() || 'Unnamed object';
  const safeDescription = description?.trim() ? ` ${description.trim()}` : '';

  return [
    'Generate ONE standalone reusable visual asset.',
    `Asset name: ${safeName}.${safeDescription}`,
    'Render a single isolated subject on a transparent background (alpha), no text, no watermark, no background scene.',
    'Keep full subject visible with clean cutout edges, no floor shadow, and high detail for reuse across scenes.',
    sceneCue ? `Story context for visual consistency:\n${sceneCue.slice(0, 420)}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildBackgroundPrompt(backgroundName, sceneCue) {
  const safeName = backgroundName?.trim() || 'Scene background';

  return [
    'Generate ONE reusable cinematic background plate.',
    `Background name: ${safeName}.`,
    'No people, no text, no watermark.',
    'Use neutral baseline lighting so this background can be reused in different scene lighting conditions.',
    sceneCue
      ? `Story context for composition and mood (do not hardcode time/weather in identity):\n${sceneCue.slice(0, 420)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function main() {
  const { data: scenes, error: scenesError } = await supabase
    .from('scenes')
    .select('id, order, prompt, multi_prompt')
    .eq('storyboard_id', storyboardId)
    .order('order', { ascending: true });

  if (scenesError) {
    console.error('Failed to load scenes:', scenesError.message);
    process.exit(1);
  }

  const sceneById = new Map((scenes ?? []).map((scene) => [scene.id, scene]));
  const sceneIds = Array.from(sceneById.keys());

  if (sceneIds.length === 0) {
    console.log(JSON.stringify({ storyboardId, scenes: 0, updates: 0 }, null, 2));
    return;
  }

  const { data: objects, error: objectsError } = await supabase
    .from('objects')
    .select('id, scene_id, name, description, generation_prompt, series_asset_variant_id')
    .in('scene_id', sceneIds);

  if (objectsError) {
    console.error('Failed to load objects:', objectsError.message);
    process.exit(1);
  }

  const { data: backgrounds, error: backgroundsError } = await supabase
    .from('backgrounds')
    .select('id, scene_id, name, generation_prompt, series_asset_variant_id')
    .in('scene_id', sceneIds);

  if (backgroundsError) {
    console.error('Failed to load backgrounds:', backgroundsError.message);
    process.exit(1);
  }

  const objectUpdates = [];
  for (const object of objects ?? []) {
    const hasPrompt = typeof object.generation_prompt === 'string' && object.generation_prompt.trim().length > 0;
    if (hasPrompt) continue;

    const scene = sceneById.get(object.scene_id);
    const sceneCue = scene ? toPromptText(scene) : '';
    const prompt = buildObjectPrompt(object.name, object.description, sceneCue);

    objectUpdates.push({ id: object.id, prompt });
  }

  const backgroundUpdates = [];
  for (const background of backgrounds ?? []) {
    const hasPrompt =
      typeof background.generation_prompt === 'string' &&
      background.generation_prompt.trim().length > 0;

    if (hasPrompt) continue;

    const scene = sceneById.get(background.scene_id);
    const sceneCue = scene ? toPromptText(scene) : '';
    const fallbackName = scene ? `Scene ${Number(scene.order) + 1} Background` : 'Scene background';
    const prompt = buildBackgroundPrompt(background.name ?? fallbackName, sceneCue);

    backgroundUpdates.push({ id: background.id, prompt });
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          storyboardId,
          dryRun: true,
          scenes: sceneIds.length,
          objectPromptUpdates: objectUpdates.length,
          backgroundPromptUpdates: backgroundUpdates.length,
        },
        null,
        2
      )
    );
    return;
  }

  let objectUpdated = 0;
  for (const row of objectUpdates) {
    const { error } = await supabase
      .from('objects')
      .update({ generation_prompt: row.prompt })
      .eq('id', row.id);

    if (!error) objectUpdated += 1;
  }

  let backgroundUpdated = 0;
  for (const row of backgroundUpdates) {
    const { error } = await supabase
      .from('backgrounds')
      .update({ generation_prompt: row.prompt })
      .eq('id', row.id);

    if (!error) backgroundUpdated += 1;
  }

  console.log(
    JSON.stringify(
      {
        storyboardId,
        dryRun: false,
        scenes: sceneIds.length,
        objectPromptUpdates: objectUpdates.length,
        objectUpdated,
        backgroundPromptUpdates: backgroundUpdates.length,
        backgroundUpdated,
      },
      null,
      2
    )
  );
}

await main();
