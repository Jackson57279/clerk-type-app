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

export type DashboardSection = "overview" | "users" | "organizations" | "settings";

export interface DashboardOverviewMetrics {
  activeUsers?: number;
  loginActivityLabel?: string;
  securityEventsCount?: number;
  organizationCount?: number;
}

export interface DashboardProps {
  overviewMetrics?: DashboardOverviewMetrics;
  activeSection?: DashboardSection;
  onSectionChange?: (section: DashboardSection) => void;
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
            <p data-testid="dashboard-users-placeholder">Search, filter, and manage users.</p>
          </section>
        )}
        {activeSection === "organizations" && (
          <section data-testid="dashboard-organizations">
            <h1 data-testid="dashboard-organizations-title" style={{ marginTop: 0, fontSize: "1.25rem" }}>
              Organizations
            </h1>
            <p data-testid="dashboard-organizations-placeholder">View and manage organizations.</p>
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
