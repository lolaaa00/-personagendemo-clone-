-- Migration to add social posting analytics, external platform IDs, and generation token cost fields to posts table.

-- Add external_id column to track publication reference IDs from Composio (message ID, tweet ID, etc.)
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Add analytics column to hold real-time views, likes, comments, shares, etc.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS analytics JSONB DEFAULT '{"views": 0, "likes": 0, "comments": 0, "shares": 0}'::jsonb;

-- Add token_usage column to track Gemini token costs during the post generation
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS token_usage INT DEFAULT 0;

-- Add token_cost column to track exact dollar costs calculated based on token counts
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS token_cost NUMERIC(10, 6) DEFAULT 0.000000;
