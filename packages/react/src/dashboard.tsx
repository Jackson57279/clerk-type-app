import { useState } from "react";

const SIDEBAR_STYLE: React.CSSProperties = {
  width: "220px",
  minHeight: "100vh",
  borderRight: "1px solid #e5e7eb",
  padding: "1rem 0",
  backgroundColor: "#f9fafb",
};

const NAV_ITEM_STYLE: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.5rem 1rem",
  border: "none",
  backgroundColor: "transparent",
  textAlign: "left",
  cursor: "pointer",
  fontSize: "0.875rem",
  color: "#374151",
};

const NAV_ITEM_ACTIVE_STYLE: React.CSSProperties = {
  ...NAV_ITEM_STYLE,
  fontWeight: 600,
  backgroundColor: "#e5e7eb",
  color: "#111827",
};

const MAIN_STYLE: React.CSSProperties = {
  flex: 1,
  padding: "1.5rem",
  minHeight: "100vh",
};

const CARD_STYLE: React.CSSProperties = {
  padding: "1rem 1.25rem",
  borderRadius: "8px",
  border: "1px solid #e5e7eb",
  backgroundColor: "#fff",
};

const GRID_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
  gap: "1rem",
};

const TABLE_HEAD_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  borderBottom: "2px solid #e5e7eb",
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#6b7280",
};

const TABLE_CELL_STYLE: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "0.875rem",
};

export type DashboardSection = "overview" | "users" | "organizations" | "settings";

export interface DashboardOverviewMetrics {
  activeUsers?: number;
  loginActivityLabel?: string;
  securityEventsCount?: number;
  organizationCount?: number;
}

export interface DashboardUserSummary {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}

export interface DashboardUserManagementProps {
  users: DashboardUserSummary[];
  loading?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  onUserDelete?: (userId: string) => void;
}

export interface DashboardOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  memberCount?: number;
  ssoEnabled?: boolean;
}

export interface DashboardOrganizationManagementProps {
  organizations: DashboardOrganizationSummary[];
  loading?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  onViewMembers?: (organizationId: string) => void;
  onManageSettings?: (organizationId: string) => void;
  onTransferOwnership?: (organizationId: string) => void;
}

export interface DashboardProps {
  overviewMetrics?: DashboardOverviewMetrics;
  activeSection?: DashboardSection;
  onSectionChange?: (section: DashboardSection) => void;
  userManagement?: DashboardUserManagementProps;
  organizationManagement?: DashboardOrganizationManagementProps;
}

const DEFAULT_METRICS: DashboardOverviewMetrics = {
  activeUsers: 0,
  loginActivityLabel: "No data",
  securityEventsCount: 0,
  organizationCount: 0,
};

export function Dashboard(props: DashboardProps) {
  const {
    overviewMetrics = DEFAULT_METRICS,
    activeSection: controlledSection,
    onSectionChange,
    userManagement,
    organizationManagement,
  } = props;
  const [internalSection, setInternalSection] = useState<DashboardSection>("overview");
  const activeSection = controlledSection ?? internalSection;
  const setSection = (s: DashboardSection) => {
    if (onSectionChange) onSectionChange(s);
    else setInternalSection(s);
  };

  const metrics = { ...DEFAULT_METRICS, ...overviewMetrics };

  return (
    <div data-testid="dashboard" style={{ display: "flex" }}>
      <nav data-testid="dashboard-sidebar" style={SIDEBAR_STYLE} aria-label="Dashboard navigation">
        <button
          type="button"
          data-testid="dashboard-nav-overview"
          style={activeSection === "overview" ? NAV_ITEM_ACTIVE_STYLE : NAV_ITEM_STYLE}
          onClick={() => setSection("overview")}
        >
          Overview
        </button>
        <button
          type="button"
          data-testid="dashboard-nav-users"
          style={activeSection === "users" ? NAV_ITEM_ACTIVE_STYLE : NAV_ITEM_STYLE}
          onClick={() => setSection("users")}
        >
          Users
        </button>
        <button
          type="button"
          data-testid="dashboard-nav-organizations"
          style={activeSection === "organizations" ? NAV_ITEM_ACTIVE_STYLE : NAV_ITEM_STYLE}
          onClick={() => setSection("organizations")}
        >
          Organizations
        </button>
        <button
          type="button"
          data-testid="dashboard-nav-settings"
          style={activeSection === "settings" ? NAV_ITEM_ACTIVE_STYLE : NAV_ITEM_STYLE}
          onClick={() => setSection("settings")}
        >
          Settings
        </button>
      </nav>
      <main data-testid="dashboard-main" style={MAIN_STYLE}>
        {activeSection === "overview" && (
          <section data-testid="dashboard-overview">
            <h1 data-testid="dashboard-overview-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>
              Overview
            </h1>
            <div data-testid="dashboard-overview-metrics" style={GRID_STYLE}>
              <div data-testid="dashboard-metric-active-users" style={CARD_STYLE}>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
                  Active users
                </div>
                <div data-testid="dashboard-metric-active-users-value" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                  {metrics.activeUsers}
                </div>
              </div>
              <div data-testid="dashboard-metric-login-activity" style={CARD_STYLE}>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
                  Login activity
                </div>
                <div data-testid="dashboard-metric-login-activity-value" style={{ fontSize: "1rem" }}>
                  {metrics.loginActivityLabel}
                </div>
              </div>
              <div data-testid="dashboard-metric-security-events" style={CARD_STYLE}>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
                  Security events
                </div>
                <div data-testid="dashboard-metric-security-events-value" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                  {metrics.securityEventsCount}
                </div>
              </div>
              <div data-testid="dashboard-metric-organizations" style={CARD_STYLE}>
                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.25rem" }}>
                  Organizations
                </div>
                <div data-testid="dashboard-metric-organizations-value" style={{ fontSize: "1.5rem", fontWeight: 600 }}>
                  {metrics.organizationCount}
                </div>
              </div>
            </div>
          </section>
        )}
        {activeSection === "users" && (
          <section data-testid="dashboard-users">
            <h1 data-testid="dashboard-users-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>
              User Management
            </h1>
            {userManagement ? (
              <>
                {userManagement.onSearchChange && (
                  <input
                    type="search"
                    data-testid="dashboard-users-search"
                    placeholder="Search by email or name"
                    value={userManagement.search ?? ""}
                    onChange={(e) => userManagement.onSearchChange?.(e.target.value)}
                    style={{
                      marginBottom: "1rem",
                      padding: "0.5rem 0.75rem",
                      width: "100%",
                      maxWidth: "320px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                    }}
                  />
                )}
                {userManagement.loading ? (
                  <p data-testid="dashboard-users-loading">Loading users…</p>
                ) : userManagement.users.length === 0 ? (
                  <p data-testid="dashboard-users-empty">No users found.</p>
                ) : (
                  <div data-testid="dashboard-users-list" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={TABLE_HEAD_STYLE}>Email</th>
                          <th style={TABLE_HEAD_STYLE}>Name</th>
                          <th style={TABLE_HEAD_STYLE}>Status</th>
                          {userManagement.onUserDelete ? (
                            <th style={TABLE_HEAD_STYLE} aria-label="Actions" />
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {userManagement.users.map((u) => (
                          <tr key={u.id} data-testid={`dashboard-user-row-${u.id}`}>
                            <td style={TABLE_CELL_STYLE}>{u.email}</td>
                            <td style={TABLE_CELL_STYLE}>
                              {(u.name ?? [u.firstName, u.lastName].filter(Boolean).join(" ")) || "—"}
                            </td>
                            <td style={TABLE_CELL_STYLE}>{u.active !== false ? "Active" : "Inactive"}</td>
                            {userManagement.onUserDelete ? (
                              <td style={TABLE_CELL_STYLE}>
                                <button
                                  type="button"
                                  data-testid={`dashboard-user-delete-${u.id}`}
                                  onClick={() => userManagement.onUserDelete?.(u.id)}
                                  style={{
                                    padding: "0.25rem 0.5rem",
                                    fontSize: "0.8125rem",
                                    color: "#b91c1c",
                                    border: "1px solid #fecaca",
                                    borderRadius: "4px",
                                    background: "#fef2f2",
                                    cursor: "pointer",
                                  }}
                                >
                                  Delete
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p data-testid="dashboard-users-placeholder">Search, filter, and manage users.</p>
            )}
          </section>
        )}
        {activeSection === "organizations" && (
          <section data-testid="dashboard-organizations">
            <h1 data-testid="dashboard-organizations-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>
              Organization Management
            </h1>
            {organizationManagement ? (
              <>
                {organizationManagement.onSearchChange && (
                  <input
                    type="search"
                    data-testid="dashboard-organizations-search"
                    placeholder="Search by name or slug"
                    value={organizationManagement.search ?? ""}
                    onChange={(e) => organizationManagement.onSearchChange?.(e.target.value)}
                    style={{
                      marginBottom: "1rem",
                      padding: "0.5rem 0.75rem",
                      width: "100%",
                      maxWidth: "320px",
                      border: "1px solid #e5e7eb",
                      borderRadius: "6px",
                    }}
                  />
                )}
                {organizationManagement.loading ? (
                  <p data-testid="dashboard-organizations-loading">Loading organizations…</p>
                ) : organizationManagement.organizations.length === 0 ? (
                  <p data-testid="dashboard-organizations-empty">No organizations found.</p>
                ) : (
                  <div data-testid="dashboard-organizations-list" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={TABLE_HEAD_STYLE}>Name</th>
                          <th style={TABLE_HEAD_STYLE}>Slug</th>
                          <th style={TABLE_HEAD_STYLE}>Members</th>
                          <th style={TABLE_HEAD_STYLE}>SSO</th>
                          {(organizationManagement.onViewMembers ||
                            organizationManagement.onManageSettings ||
                            organizationManagement.onTransferOwnership) ? (
                            <th style={TABLE_HEAD_STYLE} aria-label="Actions" />
                          ) : null}
                        </tr>
                      </thead>
                      <tbody>
                        {organizationManagement.organizations.map((org) => (
                          <tr key={org.id} data-testid={`dashboard-organization-row-${org.id}`}>
                            <td style={TABLE_CELL_STYLE}>{org.name}</td>
                            <td style={TABLE_CELL_STYLE}>{org.slug}</td>
                            <td style={TABLE_CELL_STYLE}>
                              {org.memberCount !== undefined ? String(org.memberCount) : "—"}
                            </td>
                            <td style={TABLE_CELL_STYLE}>{org.ssoEnabled ? "Yes" : "No"}</td>
                            {(organizationManagement.onViewMembers ||
                              organizationManagement.onManageSettings ||
                              organizationManagement.onTransferOwnership) ? (
                              <td style={TABLE_CELL_STYLE}>
                                {organizationManagement.onViewMembers && (
                                  <button
                                    type="button"
                                    data-testid={`dashboard-organization-members-${org.id}`}
                                    onClick={() => organizationManagement.onViewMembers?.(org.id)}
                                    style={{
                                      marginRight: "0.5rem",
                                      padding: "0.25rem 0.5rem",
                                      fontSize: "0.8125rem",
                                      border: "1px solid #e5e7eb",
                                      borderRadius: "4px",
                                      background: "#fff",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Members
                                  </button>
                                )}
                                {organizationManagement.onManageSettings && (
                                  <button
                                    type="button"
                                    data-testid={`dashboard-organization-settings-${org.id}`}
                                    onClick={() => organizationManagement.onManageSettings?.(org.id)}
                                    style={{
                                      marginRight: "0.5rem",
                                      padding: "0.25rem 0.5rem",
                                      fontSize: "0.8125rem",
                                      border: "1px solid #e5e7eb",
                                      borderRadius: "4px",
                                      background: "#fff",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Settings
                                  </button>
                                )}
                                {organizationManagement.onTransferOwnership && (
                                  <button
                                    type="button"
                                    data-testid={`dashboard-organization-transfer-${org.id}`}
                                    onClick={() => organizationManagement.onTransferOwnership?.(org.id)}
                                    style={{
                                      padding: "0.25rem 0.5rem",
                                      fontSize: "0.8125rem",
                                      color: "#b91c1c",
                                      border: "1px solid #fecaca",
                                      borderRadius: "4px",
                                      background: "#fef2f2",
                                      cursor: "pointer",
                                    }}
                                  >
                                    Transfer
                                  </button>
                                )}
                              </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <p data-testid="dashboard-organizations-placeholder">View and manage organizations.</p>
            )}
          </section>
        )}
        {activeSection === "settings" && (
          <section data-testid="dashboard-settings">
            <h1 data-testid="dashboard-settings-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>
              Settings
            </h1>
            <p data-testid="dashboard-settings-placeholder">Application configuration and security policies.</p>
          </section>
        )}
      </main>
    </div>
  );
}
