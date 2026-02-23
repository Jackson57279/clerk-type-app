CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    logo_url TEXT,
    primary_color VARCHAR(7),
    favicon_url TEXT,
    max_members INTEGER,
    allowed_domains TEXT[],
    require_email_verification BOOLEAN DEFAULT TRUE,
    saml_enabled BOOLEAN DEFAULT FALSE,
    saml_config JSONB,
    scim_enabled BOOLEAN DEFAULT FALSE,
    scim_token_hash VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE INDEX idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;
