export interface WorkflowRun {
  id: string;
  project_id: string | null;
  schedule_type: 'now' | 'scheduled';
  base_date: string | null; // YYYY-MM-DD — the date the user originally picked
  base_time: string | null; // HH:mm — the time the user originally picked (before stagger)
  timezone: string | null;
  created_at: string;
  lanes: WorkflowRunLane[];
}

export interface WorkflowRunLane {
  id: string;
  workflow_run_id: string;
  language: string;
  mixpost_uuid: string | null;
  status:
    | 'pending'
    | 'uploading'
    | 'creating'
    | 'publishing'
    | 'scheduled'
    | 'published'
    | 'partial'
    | 'failed';
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
