import { createClient } from '@/lib/supabase/server';
import {
  addCharacterImage,
  deleteCharacterImage,
  getCharacter,
  type CharacterImageAngle,
  type CharacterImageKind,
} from '@/lib/supabase/character-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = { params: Promise<{ id: string }> };

const VALID_ANGLES: CharacterImageAngle[] = [
  'front',
  'left_profile',
  'right_profile',
  'three_quarter_left',
  'three_quarter_right',
  'back',
];

const VALID_KINDS: CharacterImageKind[] = [
  'frontal',
  'reference',
  'video_reference',
];

// POST /api/characters/[id]/images — upload an image for a character
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id: characterId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify character ownership
    const character = await getCharacter(supabase, characterId, user.id);
    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const angle = formData.get('angle') as string;
    const kind = (formData.get('kind') as string) || 'reference';

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (!VALID_ANGLES.includes(angle as CharacterImageAngle)) {
      return NextResponse.json(
        { error: `Invalid angle. Must be one of: ${VALID_ANGLES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!VALID_KINDS.includes(kind as CharacterImageKind)) {
      return NextResponse.json(
        { error: `Invalid kind. Must be one of: ${VALID_KINDS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate: frontal kind must be front angle
    if (kind === 'frontal' && angle !== 'front') {
      return NextResponse.json(
        { error: 'Frontal images must have front angle' },
        { status: 400 }
      );
    }

    // Upload to storage
    const ext = file.name.split('.').pop() || 'png';
    const filename = `${angle}_${kind}_${Date.now()}.${ext}`;
    const storagePath = `${user.id}/${characterId}/${filename}`;

    const buffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('character-assets')
      .upload(storagePath, buffer, {
        contentType: file.type || 'image/png',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    // Get signed URL (private bucket)
    const { data: signedData } = await supabase.storage
      .from('character-assets')
      .createSignedUrl(storagePath, 60 * 60 * 24 * 365); // 1 year

    const url = signedData?.signedUrl ?? storagePath;

    const image = await addCharacterImage(supabase, {
      character_id: characterId,
      angle: angle as CharacterImageAngle,
      kind: kind as CharacterImageKind,
      url,
      storage_path: storagePath,
      source: 'upload',
    });

    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    console.error('Upload character image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/characters/[id]/images — delete a character image
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id: characterId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify character ownership
    const character = await getCharacter(supabase, characterId, user.id);
    if (!character) {
      return NextResponse.json(
        { error: 'Character not found' },
        { status: 404 }
      );
    }

    const body = await req.json();
    const imageId = body.image_id;

    if (!imageId || typeof imageId !== 'string') {
      return NextResponse.json(
        { error: 'image_id is required' },
        { status: 400 }
      );
    }

    // Find the image to get storage path
    const image = character.character_images.find((img) => img.id === imageId);

    if (!image) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 });
    }

    // Delete from storage
    if (image.storage_path) {
      await supabase.storage
        .from('character-assets')
        .remove([image.storage_path]);
    }

    // Delete DB record
    await deleteCharacterImage(supabase, imageId, characterId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete character image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
