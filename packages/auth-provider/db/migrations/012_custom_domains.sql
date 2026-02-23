ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS custom_domains TEXT[] DEFAULT '{}';
