import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key, { db: { schema: 'studio' } });
const sceneId = 'bed83bbf-9113-4e35-bc25-64afd723b2ce';
const background = {
  grid_image_id: 'd5ac16ba-5218-40c3-b121-2d475d6b63e9',
  grid_position: 0,
  name: 'Mekke Ev İçi',
  url: 'https://lmounotqnrspwuvcoemk.supabase.co/storage/v1/object/public/series-assets/generated/12753c29-711b-466f-bfa6-891c210bb19c/1774545835317_poll.jpg',
  final_url: 'https://lmounotqnrspwuvcoemk.supabase.co/storage/v1/object/public/series-assets/generated/12753c29-711b-466f-bfa6-891c210bb19c/1774545835317_poll.jpg',
  status: 'success',
  scene_id: sceneId,
  series_asset_variant_id: '12753c29-711b-466f-bfa6-891c210bb19c',
  generation_prompt: 'Mekke Ev İçi. Empty historical 7th-century Arabian environment background, no people, no animals. Cinematic establishing shot, clean readability, warm earth tones, dramatic natural light, high detail, realistic. No text, no watermark.',
  generation_meta: {}
};
const objectRow = {
  grid_image_id: 'd5ac16ba-5218-40c3-b121-2d475d6b63e9',
  grid_position: 0,
  name: 'Hz. Ali',
  description: null,
  url: 'https://lmounotqnrspwuvcoemk.supabase.co/storage/v1/object/public/series-assets/generated/92a34d3d-4d3b-45c0-aebe-971a4db7cc38/1774415453964_kie_single.png',
  final_url: 'https://lmounotqnrspwuvcoemk.supabase.co/storage/v1/object/public/series-assets/generated/92a34d3d-4d3b-45c0-aebe-971a4db7cc38/1774415453964_kie_single.png',
  status: 'success',
  scene_id: sceneId,
  scene_order: 0,
  character_id: null,
  series_asset_variant_id: '92a34d3d-4d3b-45c0-aebe-971a4db7cc38',
  generation_prompt: 'Front-facing full-body character, isolated cutout on transparent background (alpha), no text, clean edges. 20li yaşlarda, genç, güçlü, cesur bakışlı genç adam. Koyu yeşil hırka, beyaz thobe, sarık. Kararlı yüz ifadesi. 7. yüzyıl Arap Yarımadası. Realistic cinematic style, warm earth tones.',
  generation_meta: {}
};
const voiceoverPatch = {
  status: 'success',
  audio_url: 'https://tempfile.aiquickdraw.com/f/2a6d41cfc785976ba96faa8359a11ae6_1774548984_pdtuqphj.mp3',
  duration: 5.799125,
  language: 'tr'
};
const { data: bgExisting } = await db.from('backgrounds').select('id').eq('scene_id', sceneId);
if (!bgExisting || bgExisting.length === 0) {
  const { error } = await db.from('backgrounds').insert(background);
  if (error) throw error;
}
const { data: objExisting } = await db.from('objects').select('id').eq('scene_id', sceneId);
if (!objExisting || objExisting.length === 0) {
  const { error } = await db.from('objects').insert(objectRow);
  if (error) throw error;
}
const { error: voErr } = await db.from('voiceovers').update(voiceoverPatch).eq('scene_id', sceneId);
if (voErr) throw voErr;
const { data: sceneCheck, error: sceneErr } = await db.from('scenes').select('id, order, video_status, backgrounds(*), objects(*), voiceovers(*)').eq('id', sceneId).single();
if (sceneErr) throw sceneErr;
console.log(JSON.stringify(sceneCheck, null, 2));
