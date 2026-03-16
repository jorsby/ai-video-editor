import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { validateApiKey } from '@/lib/auth/api-key';
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
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = createServiceClient('studio');

    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { data: variant } = await dbClient
      .from('series_asset_variants')
      .select('*')
      .eq('id', variantId)
      .single();

    if (variant?.is_finalized) {
      return NextResponse.json(
        { error: 'Variant is finalized and cannot be modified' },
        { status: 409 }
      );
    }

    const { count: usageCount } = await dbClient
      .from('episode_asset_variants')
      .select('*', { count: 'exact', head: true })
      .eq('variant_id', variantId);

    if ((usageCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Variant is already used in one or more episodes and cannot be modified',
        },
        { status: 409 }
      );
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
    const { error: uploadError } = await dbClient.storage
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
    } = dbClient.storage.from('series-assets').getPublicUrl(storagePath);

    const image = await addVariantImage(dbClient, {
      variant_id: variantId,
      angle: angle as Parameters<typeof addVariantImage>[1]['angle'],
      kind: kind as Parameters<typeof addVariantImage>[1]['kind'],
      url: publicUrl ?? storagePath,
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
      data: { user: sessionUser },
    } = await supabase.auth.getUser();

    const apiKeyResult = !sessionUser ? validateApiKey(req) : { valid: false };
    const user =
      sessionUser ??
      (apiKeyResult.valid && apiKeyResult.userId
        ? { id: apiKeyResult.userId }
        : null);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const dbClient = createServiceClient('studio');

    const series = await getSeries(dbClient, id, user.id);
    if (!series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    const { data: variant } = await dbClient
      .from('series_asset_variants')
      .select('*')
      .eq('id', variantId)
      .single();

    if (variant?.is_finalized) {
      return NextResponse.json(
        { error: 'Variant is finalized and cannot be modified' },
        { status: 409 }
      );
    }

    const { count: usageCount } = await dbClient
      .from('episode_asset_variants')
      .select('*', { count: 'exact', head: true })
      .eq('variant_id', variantId);

    if ((usageCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            'Variant is already used in one or more episodes and cannot be modified',
        },
        { status: 409 }
      );
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
      await dbClient.storage.from('series-assets').remove([storagePath]);
    }

    await deleteVariantImage(dbClient, imageId, variantId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete variant image error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
