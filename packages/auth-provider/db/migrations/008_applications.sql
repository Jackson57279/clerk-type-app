CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    publishable_key VARCHAR(255) UNIQUE NOT NULL,
    secret_key_hash VARCHAR(255),
    allowed_origins TEXT[],
    allowed_redirect_uris TEXT[],
    features JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deleted_at TIMESTAMP
);

CREATE INDEX idx_apps_org ON applications(organization_id);
CREATE INDEX idx_apps_publishable ON applications(publishable_key);
