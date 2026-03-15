-- Series onboarding columns for AI-powered series planning flow
ALTER TABLE studio.series ADD COLUMN IF NOT EXISTS plan_draft JSONB;
ALTER TABLE studio.series ADD COLUMN IF NOT EXISTS onboarding_messages JSONB NOT NULL DEFAULT '[]';
ALTER TABLE studio.series ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'draft'; -- draft | finalized
