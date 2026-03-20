import { EditPostPage } from '@/components/post/edit-post-page';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function EditPostRoute({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { uuid } = await params;

  return <EditPostPage postId={uuid} />;
}
