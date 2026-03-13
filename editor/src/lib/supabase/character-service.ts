/**
 * Character Hub service — CRUD for characters, images, and project bindings.
 * Uses admin (service-role) client for API routes.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type CharacterImageAngle =
  | 'front'
  | 'left_profile'
  | 'right_profile'
  | 'three_quarter_left'
  | 'three_quarter_right'
  | 'back';

export type CharacterImageKind = 'frontal' | 'reference' | 'video_reference';

export type CharacterImageSource = 'upload' | 'generated' | 'imported';

export type ProjectCharacterRole = 'main' | 'supporting' | 'extra';

export interface Character {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface CharacterImage {
  id: string;
  character_id: string;
  angle: CharacterImageAngle;
  kind: CharacterImageKind;
  url: string | null;
  storage_path: string;
  source: CharacterImageSource;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CharacterWithImages extends Character {
  character_images: CharacterImage[];
}

export interface ProjectCharacter {
  id: string;
  project_id: string;
  character_id: string;
  element_index: number;
  role: ProjectCharacterRole;
  description_snapshot: string | null;
  resolved_image_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface ProjectCharacterWithDetails extends ProjectCharacter {
  characters: CharacterWithImages;
}

// ── Kling Adapter ────────────────────────────────────────────────────────────

export interface KlingElementPayload {
  frontal_image_url: string;
  reference_image_urls: string[];
}

/**
 * Resolve a character's images into the format Kling O3 expects.
 * Returns { frontal_image_url, reference_image_urls[] } for the elements array.
 *
 * Priority:
 * - frontal: the image with kind='frontal' (falls back to first 'front' angle reference)
 * - reference: up to 3 images with kind='reference', different angles preferred
 */
export function resolveForKling(
  images: CharacterImage[]
): KlingElementPayload | null {
  // Find frontal image
  const frontalImage =
    images.find((img) => img.kind === 'frontal' && img.url) ??
    images.find((img) => img.angle === 'front' && img.url);

  if (!frontalImage?.url) return null;

  // Collect reference images (non-frontal, non-video, with URLs)
  const referenceImages = images
    .filter(
      (img) => img.id !== frontalImage.id && img.kind === 'reference' && img.url
    )
    .slice(0, 3); // Kling max 3 reference_image_urls

  return {
    frontal_image_url: frontalImage.url,
    reference_image_urls:
      referenceImages.length > 0
        ? referenceImages.map((img) => img.url!)
        : [frontalImage.url], // fallback: use frontal as reference too
  };
}

/**
 * Resolve all project characters for a project into Kling element payloads.
 * Returns elements sorted by element_index.
 */
export function resolveProjectCharactersForKling(
  projectCharacters: ProjectCharacterWithDetails[]
): KlingElementPayload[] {
  return projectCharacters
    .sort((a, b) => a.element_index - b.element_index)
    .map((pc) => resolveForKling(pc.characters.character_images))
    .filter((payload): payload is KlingElementPayload => payload !== null);
}

// ── Character CRUD ───────────────────────────────────────────────────────────

type SupabaseClient = ReturnType<typeof import('./admin').createServiceClient>;

export async function listCharacters(
  supabase: SupabaseClient,
  userId: string
): Promise<CharacterWithImages[]> {
  const { data, error } = await supabase
    .from('characters')
    .select('*, character_images (*)')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to list characters: ${error.message}`);
  return data ?? [];
}

export async function getCharacter(
  supabase: SupabaseClient,
  characterId: string,
  userId: string
): Promise<CharacterWithImages | null> {
  const { data, error } = await supabase
    .from('characters')
    .select('*, character_images (*)')
    .eq('id', characterId)
    .eq('user_id', userId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`Failed to get character: ${error.message}`);
  }
  return data;
}

export async function createCharacter(
  supabase: SupabaseClient,
  userId: string,
  input: { name: string; description?: string; tags?: string[] }
): Promise<Character> {
  const { data, error } = await supabase
    .from('characters')
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      tags: input.tags ?? [],
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create character: ${error.message}`);
  return data;
}

export async function updateCharacter(
  supabase: SupabaseClient,
  characterId: string,
  userId: string,
  input: { name?: string; description?: string; tags?: string[] }
): Promise<Character> {
  const { data, error } = await supabase
    .from('characters')
    .update(input)
    .eq('id', characterId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update character: ${error.message}`);
  return data;
}

export async function deleteCharacter(
  supabase: SupabaseClient,
  characterId: string,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('characters')
    .delete()
    .eq('id', characterId)
    .eq('user_id', userId);

  if (error) throw new Error(`Failed to delete character: ${error.message}`);
}

// ── Character Image CRUD ─────────────────────────────────────────────────────

export async function addCharacterImage(
  supabase: SupabaseClient,
  input: {
    character_id: string;
    angle: CharacterImageAngle;
    kind: CharacterImageKind;
    url: string;
    storage_path: string;
    source: CharacterImageSource;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<CharacterImage> {
  const { data, error } = await supabase
    .from('character_images')
    .insert({
      character_id: input.character_id,
      angle: input.angle,
      kind: input.kind,
      url: input.url,
      storage_path: input.storage_path,
      source: input.source,
      width: input.width ?? null,
      height: input.height ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add character image: ${error.message}`);
  return data;
}

export async function deleteCharacterImage(
  supabase: SupabaseClient,
  imageId: string,
  characterId: string
): Promise<void> {
  const { error } = await supabase
    .from('character_images')
    .delete()
    .eq('id', imageId)
    .eq('character_id', characterId);

  if (error)
    throw new Error(`Failed to delete character image: ${error.message}`);
}

// ── Project Character Binding ────────────────────────────────────────────────

export async function bindCharacterToProject(
  supabase: SupabaseClient,
  input: {
    project_id: string;
    character_id: string;
    element_index: number;
    role?: ProjectCharacterRole;
  }
): Promise<ProjectCharacter> {
  // Fetch character + images for snapshot
  const { data: character, error: charError } = await supabase
    .from('characters')
    .select('*, character_images (*)')
    .eq('id', input.character_id)
    .single();

  if (charError || !character) throw new Error('Character not found');

  const imageIds = (character.character_images || []).map(
    (img: CharacterImage) => img.id
  );

  const { data, error } = await supabase
    .from('project_characters')
    .insert({
      project_id: input.project_id,
      character_id: input.character_id,
      element_index: input.element_index,
      role: input.role ?? 'main',
      description_snapshot: character.description,
      resolved_image_ids: imageIds,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to bind character: ${error.message}`);
  return data;
}

export async function unbindCharacterFromProject(
  supabase: SupabaseClient,
  projectId: string,
  characterId: string
): Promise<void> {
  const { error } = await supabase
    .from('project_characters')
    .delete()
    .eq('project_id', projectId)
    .eq('character_id', characterId);

  if (error) throw new Error(`Failed to unbind character: ${error.message}`);
}

export async function getProjectCharacters(
  supabase: SupabaseClient,
  projectId: string
): Promise<ProjectCharacterWithDetails[]> {
  const { data, error } = await supabase
    .from('project_characters')
    .select('*, characters (*, character_images (*))')
    .eq('project_id', projectId)
    .order('element_index', { ascending: true });

  if (error)
    throw new Error(`Failed to get project characters: ${error.message}`);
  return data ?? [];
}

// ── Import from Project ──────────────────────────────────────────────────────

/**
 * Import an object from an existing project scene into the character library.
 * Creates a character + frontal image from the object's final_url.
 */
export async function importCharacterFromObject(
  supabase: SupabaseClient,
  userId: string,
  input: {
    object_id: string;
    name: string;
    description?: string;
    tags?: string[];
  }
): Promise<CharacterWithImages> {
  // Fetch the object
  const { data: obj, error: objError } = await supabase
    .from('objects')
    .select('id, name, description, final_url')
    .eq('id', input.object_id)
    .single();

  if (objError || !obj) throw new Error('Object not found');

  if (!obj.final_url)
    throw new Error('Object has no final image — generate it first');

  // Create the character
  const character = await createCharacter(supabase, userId, {
    name: input.name || obj.name || 'Unnamed Character',
    description: input.description ?? obj.description ?? null,
    tags: input.tags ?? [],
  });

  // Upload the object's image to character storage
  const storagePath = `${userId}/${character.id}/frontal.png`;

  // Download the object image and re-upload to character bucket
  const imageResponse = await fetch(obj.final_url);
  const imageBuffer = await imageResponse.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from('character-assets')
    .upload(storagePath, imageBuffer, {
      contentType: 'image/png',
      upsert: true,
    });

  if (uploadError) {
    // Clean up the created character if upload fails
    await deleteCharacter(supabase, character.id, userId);
    throw new Error(`Failed to upload image: ${uploadError.message}`);
  }

  // Get public URL
  const {
    data: { publicUrl },
  } = supabase.storage.from('character-assets').getPublicUrl(storagePath);

  // Create the frontal image record
  const image = await addCharacterImage(supabase, {
    character_id: character.id,
    angle: 'front',
    kind: 'frontal',
    url: publicUrl,
    storage_path: storagePath,
    source: 'imported',
  });

  // Link the original object to the new character
  await supabase
    .from('objects')
    .update({ character_id: character.id })
    .eq('id', input.object_id);

  return {
    ...character,
    character_images: [image],
  };
}
