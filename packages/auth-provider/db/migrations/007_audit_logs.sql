CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    event_id VARCHAR(255) UNIQUE NOT NULL,
    actor_type VARCHAR(50),
    actor_id UUID,
    actor_email VARCHAR(255),
    target_type VARCHAR(50),
    target_id UUID,
    ip_address INET,
    user_agent TEXT,
    organization_id UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_logs_initial PARTITION OF audit_logs
    FOR VALUES FROM ('2020-01-01') TO ('2030-01-01');

CREATE INDEX idx_audit_org ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_user ON audit_logs(actor_id, created_at);
CREATE INDEX idx_audit_event ON audit_logs(event_type, created_at);
