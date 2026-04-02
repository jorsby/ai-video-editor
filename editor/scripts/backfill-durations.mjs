#!/usr/bin/env node
/**
 * Backfill audio_duration and video_duration for existing scenes.
 *
 * Re-probes every scene that has an audio_url or video_url,
 * writing the actual duration (2 decimal places) to the DB.
 *
 * Usage: node scripts/backfill-durations.mjs [--dry-run]
 */

import { createClient } from '@supabase/supabase-js';
import { parseBuffer } from 'music-metadata';

const DRY_RUN = process.argv.includes('--dry-run');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: 'studio' } }
);

function guessMimeType(url) {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.mp4')) return 'video/mp4';
  if (path.endsWith('.wav')) return 'audio/wav';
  if (path.endsWith('.ogg')) return 'audio/ogg';
  if (path.endsWith('.webm')) return 'video/webm';
  if (path.endsWith('.m4a')) return 'audio/mp4';
  if (path.endsWith('.aac')) return 'audio/aac';
  if (path.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

async function probeDuration(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = new Uint8Array(ab);
    const ct = res.headers.get('content-type') ?? '';
    const mime = ct && !ct.includes('octet-stream') ? ct.split(';')[0].trim() : guessMimeType(url);
    const meta = await parseBuffer(buf, { mimeType: mime });
    const dur = meta.format.duration;
    if (typeof dur === 'number' && dur > 0 && Number.isFinite(dur)) {
      return Math.round(dur * 100) / 100;
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Backfill durations${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

  // Fetch all scenes with any media URL
  const { data: scenes, error } = await supabase
    .from('scenes')
    .select('id, audio_url, audio_duration, video_url, video_duration')
    .or('audio_url.not.is.null,video_url.not.is.null');

  if (error) {
    console.error('Failed to fetch scenes:', error.message);
    process.exit(1);
  }

  console.log(`Found ${scenes.length} scenes with media URLs\n`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const scene of scenes) {
    const updates = {};

    // Probe audio if URL exists
    if (scene.audio_url) {
      const dur = await probeDuration(scene.audio_url);
      if (dur != null) {
        updates.audio_duration = dur;
        console.log(`  [audio] ${scene.id}: ${scene.audio_duration ?? 'NULL'} → ${dur}`);
      } else {
        console.log(`  [audio] ${scene.id}: probe FAILED (URL may be expired)`);
        failed++;
      }
    }

    // Probe video if URL exists
    if (scene.video_url) {
      const dur = await probeDuration(scene.video_url);
      if (dur != null) {
        updates.video_duration = dur;
        console.log(`  [video] ${scene.id}: ${scene.video_duration ?? 'NULL'} → ${dur}`);
      } else {
        console.log(`  [video] ${scene.id}: probe FAILED (URL may be expired)`);
        failed++;
      }
    }

    if (Object.keys(updates).length > 0) {
      if (!DRY_RUN) {
        const { error: updateErr } = await supabase
          .from('scenes')
          .update(updates)
          .eq('id', scene.id);
        if (updateErr) {
          console.log(`  ❌ DB update failed for ${scene.id}: ${updateErr.message}`);
          failed++;
          continue;
        }
      }
      updated++;
      console.log(`  ✅ ${scene.id} updated${DRY_RUN ? ' (dry run)' : ''}`);
    } else {
      skipped++;
    }
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped (no URL), ${failed} failed`);
}

main();
