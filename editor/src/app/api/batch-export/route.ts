import { type NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import fs from 'node:fs';
import path from 'node:path';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const presetsPath = path.join(
      process.cwd(),
      '../packages/openvideo/src/animation/presets.ts'
    );
    const presetsContent = fs.readFileSync(presetsPath, 'utf-8');
    const animationKeys = [
      ...presetsContent.matchAll(/animationRegistry\.register\("([^"]+)"/g),
    ].map((m) => m[1]);

    // Also send the data.json template to ensure we always have a clip to render
    const projectTemplatePath = path.join(process.cwd(), 'src/data/data.json');
    const template = JSON.parse(fs.readFileSync(projectTemplatePath, 'utf-8'));

    return NextResponse.json({ success: true, keys: animationKeys, template });
  } catch (error: any) {
    console.error('Batch export GET error:', error);
    return NextResponse.json(
      { success: false, error: 'Operation failed' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const formData = await req.formData();
    const file = formData.get('file') as Blob;
    const filename = formData.get('filename') as string;

    if (!file || !filename) {
      return NextResponse.json(
        { success: false, error: 'Missing file or filename' },
        { status: 400 }
      );
    }

    const exportDir = 'D:\\animations';
    if (!fs.existsSync(exportDir)) {
      fs.mkdirSync(exportDir, { recursive: true });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(exportDir, `${filename}.mp4`);
    fs.writeFileSync(filePath, buffer);

    return NextResponse.json({
      success: true,
      path: filePath,
    });
  } catch (error: any) {
    console.error('Batch export error:', error);
    return NextResponse.json(
      { success: false, error: 'Operation failed' },
      { status: 500 }
    );
  }
}
