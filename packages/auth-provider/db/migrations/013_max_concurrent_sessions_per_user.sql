ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS max_concurrent_sessions_per_user INTEGER;
