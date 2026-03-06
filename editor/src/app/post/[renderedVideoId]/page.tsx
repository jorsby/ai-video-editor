import { PostPage } from '@/components/post/post-page';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function PostRoute({
  params,
}: {
  params: Promise<{ renderedVideoId: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { renderedVideoId } = await params;

  return <PostPage renderedVideoId={renderedVideoId} />;
}
