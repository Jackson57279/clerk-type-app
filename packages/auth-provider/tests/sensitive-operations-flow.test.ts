import { describe, it, expect, vi } from "vitest";
import { ConfirmationRequiredError } from "../src/double-opt-in.js";
import { SENSITIVE_OPERATIONS } from "../src/double-opt-in.js";
import type { SensitiveOperationType } from "../src/double-opt-in.js";
import {
  SENSITIVE_OPERATION_LABELS,
  requestSensitiveOperation,
  executeSensitiveOperation,
} from "../src/sensitive-operations-flow.js";

const SECRET = "test-secret";

describe("SENSITIVE_OPERATION_LABELS", () => {
  it("has a human-readable label for every sensitive operation", () => {
    for (const op of SENSITIVE_OPERATIONS) {
      expect(SENSITIVE_OPERATION_LABELS[op as SensitiveOperationType]).toBeDefined();
      expect(typeof SENSITIVE_OPERATION_LABELS[op as SensitiveOperationType]).toBe(
        "string"
      );
      expect(SENSITIVE_OPERATION_LABELS[op as SensitiveOperationType].length).toBeGreaterThan(0);
    }
  });
});

describe("requestSensitiveOperation", () => {
  it("returns token, confirmation link, expiresAt, and sent: false when sendEmail omitted", async () => {
    const result = await requestSensitiveOperation({
      operation: "change_email",
      userId: "u1",
      email: "u@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
    });
    expect(result.token).toBeDefined();
    expect(result.token.split(".")).toHaveLength(3);
    expect(result.confirmationLink).toContain(result.token);
    expect(result.confirmationLink).toMatch(/^https:\/\/app\.example\.com\/confirm\?token=/);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.sent).toBe(false);
  });

  it("returns sent: true when sendEmail is provided and called", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const result = await requestSensitiveOperation({
      operation: "change_password",
      userId: "u2",
      email: "u2@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      sendEmail,
    });
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "u2@example.com",
        html: expect.any(String),
        text: expect.any(String),
      })
    );
    expect(sendEmail.mock.calls[0][0].html).toContain(
      SENSITIVE_OPERATION_LABELS.change_password
    );
  });

  it("includes operationParams in token and uses custom ttlMs", async () => {
    const result = await requestSensitiveOperation({
      operation: "change_email",
      userId: "u1",
      email: "old@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      operationParams: { newEmail: "new@example.com" },
      ttlMs: 5 * 60 * 1000,
    });
    expect(result.expiresAt).toBeGreaterThanOrEqual(
      Date.now() + 5 * 60 * 1000 - 2000
    );
    expect(result.expiresAt).toBeLessThanOrEqual(
      Date.now() + 5 * 60 * 1000 + 2000
    );
  });
});

describe("executeSensitiveOperation", () => {
  const context = {
    userId: "u1",
    email: "u@example.com",
    operation: "change_email" as SensitiveOperationType,
  };

  it("runs action with verified payload when token is valid", async () => {
    const { token } = (
      await requestSensitiveOperation({
        operation: "change_email",
        userId: context.userId,
        email: context.email,
        secret: SECRET,
        buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      })
    );
    const action = vi.fn().mockResolvedValue({ done: true });
    const out = await executeSensitiveOperation(
      "change_email",
      token,
      context,
      SECRET,
      action
    );
    expect(out).toEqual({ done: true });
    expect(action).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        email: "u@example.com",
        operation: "change_email",
      })
    );
  });

  it("throws ConfirmationRequiredError when token is undefined", async () => {
    const action = vi.fn();
    await expect(
      executeSensitiveOperation(
        "change_email",
        undefined,
        context,
        SECRET,
        action
      )
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(action).not.toHaveBeenCalled();
  });

  it("throws ConfirmationRequiredError when token is invalid", async () => {
    const action = vi.fn();
    await expect(
      executeSensitiveOperation(
        "change_email",
        "invalid.token.here",
        context,
        SECRET,
        action
      )
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(action).not.toHaveBeenCalled();
  });

  it("throws ConfirmationRequiredError when token user does not match context", async () => {
    const { token } = (
      await requestSensitiveOperation({
        operation: "change_email",
        userId: "other-user",
        email: "other@example.com",
        secret: SECRET,
        buildConfirmLink: (t) => `?token=${t}`,
      })
    );
    const action = vi.fn();
    await expect(
      executeSensitiveOperation("change_email", token, context, SECRET, action)
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(action).not.toHaveBeenCalled();
  });

  it("works for all sensitive operation types", async () => {
    for (const op of SENSITIVE_OPERATIONS) {
      const ctx = {
        userId: "u1",
        email: "e@x.com",
        operation: op as SensitiveOperationType,
      };
      const { token } = await requestSensitiveOperation({
        operation: op as SensitiveOperationType,
        userId: ctx.userId,
        email: ctx.email,
        secret: SECRET,
        buildConfirmLink: (t) => `https://x.com/c?token=${t}`,
      });
      const action = vi.fn().mockResolvedValue(undefined);
      await executeSensitiveOperation(op as SensitiveOperationType, token, ctx, SECRET, action);
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ operation: op })
      );
    }
  });
});
