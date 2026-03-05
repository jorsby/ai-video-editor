import { createClient } from '@/lib/supabase/client';
import type { WorkflowRun, WorkflowRunLane } from '@/types/workflow-run';

export async function createWorkflowRun(data: {
  project_id: string;
  schedule_type: 'now' | 'scheduled';
  base_date?: string;
  base_time?: string;
  timezone?: string;
}): Promise<string> {
  const supabase = createClient('social_auth');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: row, error } = await supabase
    .from('workflow_runs')
    .insert({
      user_id: user.id,
      project_id: data.project_id || null,
      schedule_type: data.schedule_type,
      base_date: data.base_date || null,
      base_time: data.base_time || null,
      timezone: data.timezone || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return row.id as string;
}

export async function createWorkflowRunLane(data: {
  workflow_run_id: string;
  language: string;
}): Promise<string> {
  const supabase = createClient('social_auth');

  const { data: row, error } = await supabase
    .from('workflow_run_lanes')
    .insert({
      workflow_run_id: data.workflow_run_id,
      language: data.language,
    })
    .select('id')
    .single();

  if (error) throw error;
  return row.id as string;
}

export async function updateWorkflowRunLane(
  laneId: string,
  updates: {
    mixpost_uuid?: string;
    post_id?: string;
    status?: WorkflowRunLane['status'];
    error_message?: string;
  }
): Promise<void> {
  const supabase = createClient('social_auth');

  const { error } = await supabase
    .from('workflow_run_lanes')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', laneId);

  if (error) throw error;
}

export async function getWorkflowRunsByMonth(monthDate: Date): Promise<WorkflowRun[]> {
  const supabase = createClient('social_auth');

  const year = monthDate.getFullYear();
  const month = String(monthDate.getMonth() + 1).padStart(2, '0');
  const monthStart = `${year}-${month}-01`;
  // First day of next month
  const nextMonth = new Date(year, monthDate.getMonth() + 1, 1);
  const nextYear = nextMonth.getFullYear();
  const nextMonthStr = String(nextMonth.getMonth() + 1).padStart(2, '0');
  const monthEnd = `${nextYear}-${nextMonthStr}-01`;

  const { data, error } = await supabase
    .from('workflow_runs')
    .select(`
      *,
      lanes:workflow_run_lanes (*)
    `)
    .or(
      `and(schedule_type.eq.scheduled,base_date.gte.${monthStart},base_date.lt.${monthEnd}),` +
      `and(schedule_type.eq.now,created_at.gte.${monthStart},created_at.lt.${monthEnd})`
    )
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []) as WorkflowRun[];
}
