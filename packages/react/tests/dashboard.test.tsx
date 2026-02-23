import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Dashboard } from "../src/dashboard.js";

describe("Dashboard", () => {
  it("renders sidebar with navigation links", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard")).toBeTruthy();
    expect(screen.getByTestId("dashboard-sidebar")).toBeTruthy();
    expect(screen.getByTestId("dashboard-nav-overview")).toBeTruthy();
    expect(screen.getByTestId("dashboard-nav-users")).toBeTruthy();
    expect(screen.getByTestId("dashboard-nav-organizations")).toBeTruthy();
    expect(screen.getByTestId("dashboard-nav-settings")).toBeTruthy();
  });

  it("shows overview by default with metric cards", () => {
    render(<Dashboard />);
    expect(screen.getByTestId("dashboard-overview")).toBeTruthy();
    expect(screen.getByTestId("dashboard-overview-title").textContent).toBe("Overview");
    expect(screen.getByTestId("dashboard-metric-active-users")).toBeTruthy();
    expect(screen.getByTestId("dashboard-metric-login-activity")).toBeTruthy();
    expect(screen.getByTestId("dashboard-metric-security-events")).toBeTruthy();
    expect(screen.getByTestId("dashboard-metric-organizations")).toBeTruthy();
  });

  it("displays overview metrics when provided", () => {
    render(
      <Dashboard
        overviewMetrics={{
          activeUsers: 42,
          loginActivityLabel: "Last 24h",
          securityEventsCount: 3,
          organizationCount: 10,
        }}
      />
    );
    expect(screen.getByTestId("dashboard-metric-active-users-value").textContent).toBe("42");
    expect(screen.getByTestId("dashboard-metric-login-activity-value").textContent).toBe("Last 24h");
    expect(screen.getByTestId("dashboard-metric-security-events-value").textContent).toBe("3");
    expect(screen.getByTestId("dashboard-metric-organizations-value").textContent).toBe("10");
  });

  it("switches to Users section when Users nav is clicked", () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("dashboard-nav-users"));
    expect(screen.getByTestId("dashboard-users")).toBeTruthy();
    expect(screen.getByTestId("dashboard-users-title").textContent).toBe("User Management");
    expect(screen.getByTestId("dashboard-users-placeholder")).toBeTruthy();
  });

  it("switches to Organizations section when Organizations nav is clicked", () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("dashboard-nav-organizations"));
    expect(screen.getByTestId("dashboard-organizations")).toBeTruthy();
    expect(screen.getByTestId("dashboard-organizations-title").textContent).toBe("Organizations");
  });

  it("switches to Settings section when Settings nav is clicked", () => {
    render(<Dashboard />);
    fireEvent.click(screen.getByTestId("dashboard-nav-settings"));
    expect(screen.getByTestId("dashboard-settings")).toBeTruthy();
    expect(screen.getByTestId("dashboard-settings-title").textContent).toBe("Settings");
  });

  it("calls onSectionChange when nav is clicked when provided", () => {
    const onSectionChange = vi.fn();
    render(<Dashboard onSectionChange={onSectionChange} />);
    fireEvent.click(screen.getByTestId("dashboard-nav-users"));
    expect(onSectionChange).toHaveBeenCalledWith("users");
  });

  it("respects controlled activeSection", () => {
    render(<Dashboard activeSection="settings" />);
    expect(screen.getByTestId("dashboard-settings")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-overview")).toBeNull();
  });
});
