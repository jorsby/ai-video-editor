-- Series generation jobs (stores prompts per request)
create table if not exists studio.series_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references studio.series(id) on delete cascade,
  request_id text not null unique,
  type text not null,
  prompt text,
  model text,
  config jsonb,
  created_at timestamptz default now()
);

alter table studio.series_generation_jobs enable row level security;

-- Allow series owner to select/insert
create policy "series_generation_jobs_select_own"
  on studio.series_generation_jobs
  for select
  using (
    exists (
      select 1
      from studio.series s
      where s.id = series_generation_jobs.series_id
        and s.user_id = auth.uid()
    )
  );

create policy "series_generation_jobs_insert_own"
  on studio.series_generation_jobs
  for insert
  with check (
    exists (
      select 1
      from studio.series s
      where s.id = series_generation_jobs.series_id
        and s.user_id = auth.uid()
    )
  );
