import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { WorkflowPage } from '@/components/workflow/workflow-page';

export default async function WorkflowRoute({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { projectId } = await params;
  return <WorkflowPage projectId={projectId} />;
}
