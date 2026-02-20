import { PostPage } from '@/components/post/post-page';

export default async function PostRoute({
  params,
}: {
  params: Promise<{ renderedVideoId: string }>;
}) {
  const { renderedVideoId } = await params;

  return <PostPage renderedVideoId={renderedVideoId} />;
}
