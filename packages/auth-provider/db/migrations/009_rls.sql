ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_isolation ON users
    FOR ALL
    USING (id = current_setting('app.current_user_id', true)::UUID);

CREATE POLICY org_membership_isolation ON organization_memberships
    FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id
            FROM organization_memberships
            WHERE user_id = current_setting('app.current_user_id', true)::UUID
        )
    );
