import { describe, it, expect, vi } from "vitest";
import {
  recordInternalAuditCompleted,
  getLastInternalAudit,
  getNextReviewDueDate,
  isReviewDue,
  type Iso27001AuditRecord,
  type Iso27001AuditStore,
} from "../src/iso27001.js";

function createMemoryAuditStore(): Iso27001AuditStore {
  let latest: Iso27001AuditRecord | null = null;
  return {
    save: vi.fn(async (record: Iso27001AuditRecord) => {
      latest = record;
    }),
    getLatest: vi.fn(async () => latest),
  };
}

describe("recordInternalAuditCompleted", () => {
  it("saves record and returns it with createdAt", async () => {
    const store = createMemoryAuditStore();
    const input = {
      id: "iso-audit-1",
      completedAt: "2025-01-15T00:00:00.000Z",
      scope: "ISMS Annex A",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed" as const,
      certificationBody: "Acme Cert",
    };
    const result = await recordInternalAuditCompleted(input, store);
    expect(result.id).toBe(input.id);
    expect(result.completedAt).toBe(input.completedAt);
    expect(result.scope).toBe(input.scope);
    expect(result.periodStart).toBe(input.periodStart);
    expect(result.periodEnd).toBe(input.periodEnd);
    expect(result.result).toBe("passed");
    expect(result.certificationBody).toBe("Acme Cert");
    expect(result.createdAt).toBeDefined();
    expect(store.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: "iso-audit-1", result: "passed" })
    );
  });

  it("allows optional certificationBody", async () => {
    const store = createMemoryAuditStore();
    const input = {
      id: "iso-audit-2",
      completedAt: "2025-02-01T00:00:00.000Z",
      scope: "Internal ISMS",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "observation" as const,
    };
    const result = await recordInternalAuditCompleted(input, store);
    expect(result.certificationBody).toBeUndefined();
    expect(result.result).toBe("observation");
  });

  it("accepts nonconformity result", async () => {
    const store = createMemoryAuditStore();
    const input = {
      id: "iso-audit-3",
      completedAt: "2025-03-01T00:00:00.000Z",
      scope: "ISMS",
      periodStart: "2024-06-01",
      periodEnd: "2025-05-31",
      result: "nonconformity" as const,
    };
    const result = await recordInternalAuditCompleted(input, store);
    expect(result.result).toBe("nonconformity");
  });
});

describe("getLastInternalAudit", () => {
  it("returns null when no audit recorded", async () => {
    const store = createMemoryAuditStore();
    const result = await getLastInternalAudit(store);
    expect(result).toBeNull();
  });

  it("returns latest audit after one is recorded", async () => {
    const store = createMemoryAuditStore();
    await recordInternalAuditCompleted(
      {
        id: "iso-audit-1",
        completedAt: "2025-01-15T00:00:00.000Z",
        scope: "ISMS Annex A",
        periodStart: "2024-01-01",
        periodEnd: "2024-12-31",
        result: "passed",
      },
      store
    );
    const result = await getLastInternalAudit(store);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("iso-audit-1");
    expect(result!.completedAt).toBe("2025-01-15T00:00:00.000Z");
    expect(result!.scope).toBe("ISMS Annex A");
  });
});

describe("getNextReviewDueDate", () => {
  it("returns date 12 months after completedAt by default", () => {
    const lastAudit: Iso27001AuditRecord = {
      id: "a1",
      completedAt: "2025-01-15T00:00:00.000Z",
      scope: "ISMS",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed",
      createdAt: "2025-01-15T00:00:00.000Z",
    };
    const next = getNextReviewDueDate(lastAudit);
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth()).toBe(0);
    expect(next.getUTCDate()).toBe(15);
  });

  it("respects custom interval in months", () => {
    const lastAudit: Iso27001AuditRecord = {
      id: "a1",
      completedAt: "2025-06-01T00:00:00.000Z",
      scope: "ISMS",
      periodStart: "2024-06-01",
      periodEnd: "2025-05-31",
      result: "passed",
      createdAt: "2025-06-01T00:00:00.000Z",
    };
    const next = getNextReviewDueDate(lastAudit, 6);
    expect(next.getUTCFullYear()).toBe(2025);
    expect(next.getUTCMonth()).toBe(11);
  });
});

describe("isReviewDue", () => {
  it("returns true when no last audit", () => {
    expect(isReviewDue(null, new Date())).toBe(true);
  });

  it("returns false when asOf is before next due date", () => {
    const lastAudit: Iso27001AuditRecord = {
      id: "a1",
      completedAt: "2025-01-15T00:00:00.000Z",
      scope: "ISMS",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed",
      createdAt: "2025-01-15T00:00:00.000Z",
    };
    const asOf = new Date("2025-06-01T00:00:00.000Z");
    expect(isReviewDue(lastAudit, asOf)).toBe(false);
  });

  it("returns true when asOf is on or after next due date", () => {
    const lastAudit: Iso27001AuditRecord = {
      id: "a1",
      completedAt: "2025-01-15T00:00:00.000Z",
      scope: "ISMS",
      periodStart: "2024-01-01",
      periodEnd: "2024-12-31",
      result: "passed",
      createdAt: "2025-01-15T00:00:00.000Z",
    };
    const asOf = new Date("2026-01-15T00:00:00.000Z");
    expect(isReviewDue(lastAudit, asOf)).toBe(true);
  });

  it("returns true when asOf is past due", () => {
    const lastAudit: Iso27001AuditRecord = {
      id: "a1",
      completedAt: "2024-01-15T00:00:00.000Z",
      scope: "ISMS",
      periodStart: "2023-01-01",
      periodEnd: "2023-12-31",
      result: "passed",
      createdAt: "2024-01-15T00:00:00.000Z",
    };
    const asOf = new Date("2025-06-01T00:00:00.000Z");
    expect(isReviewDue(lastAudit, asOf)).toBe(true);
  });
});
