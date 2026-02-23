CREATE TABLE webauthn_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    credential_id BYTEA NOT NULL,
    public_key BYTEA NOT NULL,
    sign_count INTEGER DEFAULT 0,
    attestation_type VARCHAR(50),
    aaguid UUID,
    friendly_name VARCHAR(255),
    device_type VARCHAR(50),
    is_synced BOOLEAN DEFAULT FALSE,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, credential_id)
);

CREATE INDEX idx_webauthn_user ON webauthn_credentials(user_id);
