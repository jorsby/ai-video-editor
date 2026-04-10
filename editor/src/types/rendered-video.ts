export interface RenderedVideo {
  id: string;
  project_id: string;
  user_id: string;
  url: string;
  file_size: number | null;
  duration: number | null;
  resolution: string | null;
  type: 'video' | 'short';
  parent_id: string | null;
  virality_score: number | null;
  segment_title: string | null;
  created_at: string;
}
