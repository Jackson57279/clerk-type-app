import { describe, it, expect, vi } from "vitest";
import {
  recordAuditCompleted,
  getLastAudit,
  getNextAuditDueDate,
  isAuditDue,
  type Soc2AuditRecord,
  type Soc2AuditStore,
} from "../src/soc2-annual-audit.js";

function createMemoryAuditStore(): Soc2AuditStore {
  let latest: Soc2AuditRecord | null = null;
  return {
    save: vi.fn(async (record: Soc2AuditRecord) => {
      latest = record;
    }),
    getLatest: vi.fn(async () => latest),
  };
}

describe("recordAuditCompleted", () => {
  it("saves record and returns it with createdAt", async () => {
    const store = createMemoryAuditStore();
    const input = {
      id: "audit-1",
      completedAt: "2025-01-15T00:00:00.000Z",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      auditor: "Acme Auditors",
      result: "passed" as const,
    };
    const result = await recordAuditCompleted(input, store);
    expect(result.id).toBe(input.id);
    expect(result.completedAt).toBe(input.completedAt);
    expect(result.periodStart).toBe(input.periodStart);
    expect(result.periodEnd).toBe(input.periodEnd);
    expect(result.auditor).toBe(input.auditor);
    expect(result.result).toBe("passed");
    expect(result.createdAt).toBeDefined();
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-1", result: "passed" })
    );
  });

  it("allows optional auditor", async () => {
    const store = createMemoryAuditStore();
    const input = {
      id: "audit-2",
      completedAt: "2025-02-01T00:00:00.000Z",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "qualified" as const,
    };
    const result = await recordAuditCompleted(input, store);
    expect(result.auditor).toBeUndefined();
    expect(result.result).toBe("qualified");
  });

  it("accepts failed result", async () => {
    const store = createMemoryAuditStore();
    const input = {
      id: "audit-3",
      completedAt: "2025-03-01T00:00:00.000Z",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      auditor: "Strict Auditors",
      result: "failed" as const,
    };
    const result = await recordAuditCompleted(input, store);
    expect(result.result).toBe("failed");
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audit-3", result: "failed" })
    );
  });
});

describe("getLastAudit", () => {
  it("returns null when no audit recorded", async () => {
    const store = createMemoryAuditStore();
    const result = await getLastAudit(store);
    expect(result).toBeNull();
  });

  it("returns latest audit after one is recorded", async () => {
    const store = createMemoryAuditStore();
    await recordAuditCompleted(
      {
        id: "audit-1",
        completedAt: "2025-01-15T00:00:00.000Z",
        periodStart: "2024-01-01",
        periodEnd: "2024-12-31",
        result: "passed",
      },
      store
    );
    const result = await getLastAudit(store);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("audit-1");
    expect(result!.completedAt).toBe("2025-01-15T00:00:00.000Z");
  });
});

describe("getNextAuditDueDate", () => {
  it("returns date 12 months after completedAt by default", () => {
    const lastAudit: Soc2AuditRecord = {
      id: "a1",
      completedAt: "2025-01-15T00:00:00.000Z",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed",
      createdAt: "2025-01-15T00:00:00.000Z",
    };
    const next = getNextAuditDueDate(lastAudit);
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth()).toBe(0);
    expect(next.getUTCDate()).toBe(15);
  });

  it("respects custom annual interval in months", () => {
    const lastAudit: Soc2AuditRecord = {
      id: "a1",
      completedAt: "2025-06-01T00:00:00.000Z",
      periodStart: "2024-06-01",
      periodEnd: "2025-05-31",
      result: "passed",
      createdAt: "2025-06-01T00:00:00.000Z",
    };
    const next = getNextAuditDueDate(lastAudit, 12);
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth()).toBe(5);
  });
});

describe("isAuditDue", () => {
  it("returns true when no last audit", () => {
    expect(isAuditDue(null, new Date())).toBe(true);
  });

  it("returns false when asOf is before next due date", () => {
    const lastAudit: Soc2AuditRecord = {
      id: "a1",
      completedAt: "2025-01-15T00:00:00.000Z",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed",
      createdAt: "2025-01-15T00:00:00.000Z",
    };
    const asOf = new Date("2025-06-01T00:00:00.000Z");
    expect(isAuditDue(lastAudit, asOf)).toBe(false);
  });

  it("returns true when asOf is on or after next due date", () => {
    const lastAudit: Soc2AuditRecord = {
      id: "a1",
      completedAt: "2025-01-15T00:00:00.000Z",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed",
      createdAt: "2025-01-15T00:00:00.000Z",
    };
    const asOf = new Date("2026-01-15T00:00:00.000Z");
    expect(isAuditDue(lastAudit, asOf)).toBe(true);
  });

  it("returns true when asOf is past due", () => {
    const lastAudit: Soc2AuditRecord = {
      id: "a1",
      completedAt: "2024-01-15T00:00:00.000Z",
      periodStart: "2023-01-01",
      periodEnd: "2023-12-31",
      result: "passed",
      createdAt: "2024-01-15T00:00:00.000Z",
    };
    const asOf = new Date("2025-06-01T00:00:00.000Z");
    expect(isAuditDue(lastAudit, asOf)).toBe(true);
  });
});
