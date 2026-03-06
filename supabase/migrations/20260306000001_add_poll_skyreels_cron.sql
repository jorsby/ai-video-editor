-- Poll every 15 seconds for SkyReels task completion
SELECT cron.schedule(
  'poll-skyreels',
  '15 seconds',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/poll-skyreels',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
