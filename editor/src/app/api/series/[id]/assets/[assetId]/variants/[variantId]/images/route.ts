import { createClient } from '@/lib/supabase/server';
import {
  addVariantImage,
  deleteVariantImage,
  getSeries,
} from '@/lib/supabase/series-service';
import { type NextRequest, NextResponse } from 'next/server';

type RouteContext = {
  params: Promise<{
    id: string;
    assetId: string;
    variantId: string;
  }>;
};

// POST /api/series/[id]/assets/[assetId]/variants/[variantId]/images
// Expects multipart/form-data with "file" field
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id, variantId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await getSeries(supabase, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const angle = (formData.get('angle') as string) || 'front';
    const kind = (formData.get('kind') as string) || 'reference';

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const ext = file.name.split('.').pop() ?? 'jpg';
    const fileName = `${Date.now()}.${ext}`;
    const storagePath = `${user.id}/${id}/${variantId}/${fileName}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('series-assets')
      .upload(storagePath, arrayBuffer, {
        contentType: file.type || 'image/jpeg',
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from('series-assets').getPublicUrl(storagePath);

    const image = await addVariantImage(supabase, {
      variant_id: variantId,
      angle: angle as Parameters<typeof addVariantImage>[1]['angle'],
      kind: kind as Parameters<typeof addVariantImage>[1]['kind'],
      url: publicUrl,
      storage_path: storagePath,
      source: 'upload',
    });

    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    console.error('Upload variant image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE /api/series/[id]/assets/[assetId]/variants/[variantId]/images?imageId=xxx
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const { id, variantId } = await context.params;
    const supabase = await createClient('studio');
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const series = await getSeries(supabase, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const imageId = searchParams.get('imageId');
    const storagePath = searchParams.get('storagePath');

    if (!imageId) {
      return NextResponse.json(
        { error: 'imageId is required' },
        { status: 400 }
      );
    }

    // Remove from storage if path provided
    if (storagePath) {
      await supabase.storage.from('series-assets').remove([storagePath]);
    }

    await deleteVariantImage(supabase, imageId, variantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete variant image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
