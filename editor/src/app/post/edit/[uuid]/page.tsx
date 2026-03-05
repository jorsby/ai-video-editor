import { EditPostPage } from '@/components/post/edit-post-page';

export default async function EditPostRoute({
  params,
}: {
  params: Promise<{ uuid: string }>;
}) {
  const { uuid } = await params;

  return <EditPostPage postId={uuid} />;
}
