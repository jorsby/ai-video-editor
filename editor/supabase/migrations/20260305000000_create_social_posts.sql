-- Social accounts: cached mirror of Octupost accounts
CREATE TABLE social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  octupost_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_name TEXT,
  account_username TEXT,
  language TEXT,
  expires_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, octupost_account_id)
);

CREATE INDEX idx_social_accounts_user_id ON social_accounts(user_id);

-- Posts: our own post tracking (replaces Mixpost)
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID,
  caption TEXT,
  media_url TEXT,
  media_type TEXT,
  schedule_type TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  timezone TEXT DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'draft',
  platform_options JSONB DEFAULT '{}',
  tags JSONB DEFAULT '[]',
  workflow_run_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_posts_user_id ON posts(user_id);
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_scheduled_at ON posts(scheduled_at);

-- Post accounts: per-account results for a post
CREATE TABLE post_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  octupost_account_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  platform_post_id TEXT,
  error_message TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_post_accounts_post_id ON post_accounts(post_id);
CREATE INDEX idx_post_accounts_status ON post_accounts(status);

-- Enable RLS
ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_accounts ENABLE ROW LEVEL SECURITY;

-- RLS policies: social_accounts
CREATE POLICY "Users can view their own social accounts"
  ON social_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own social accounts"
  ON social_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own social accounts"
  ON social_accounts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own social accounts"
  ON social_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- RLS policies: posts
CREATE POLICY "Users can view their own posts"
  ON posts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own posts"
  ON posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own posts"
  ON posts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own posts"
  ON posts FOR DELETE
  USING (auth.uid() = user_id);

-- RLS policies: post_accounts (access through post ownership)
CREATE POLICY "Users can view their own post accounts"
  ON post_accounts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM posts WHERE posts.id = post_accounts.post_id AND posts.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert their own post accounts"
  ON post_accounts FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM posts WHERE posts.id = post_accounts.post_id AND posts.user_id = auth.uid()
  ));

CREATE POLICY "Users can update their own post accounts"
  ON post_accounts FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM posts WHERE posts.id = post_accounts.post_id AND posts.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM posts WHERE posts.id = post_accounts.post_id AND posts.user_id = auth.uid()
  ));

CREATE POLICY "Users can delete their own post accounts"
  ON post_accounts FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM posts WHERE posts.id = post_accounts.post_id AND posts.user_id = auth.uid()
  ));
