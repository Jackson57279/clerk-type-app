import { describe, it, expect, vi } from "vitest";
import { ConfirmationRequiredError } from "../src/double-opt-in.js";
import { SENSITIVE_OPERATIONS } from "../src/double-opt-in.js";
import type { SensitiveOperationType } from "../src/double-opt-in.js";
import {
  SENSITIVE_OPERATION_LABELS,
  requestSensitiveOperation,
  executeSensitiveOperation,
  isRequestSensitiveOperationSuccess,
} from "../src/sensitive-operations-flow.js";
import { createMemoryResendStore } from "../src/resend-policy.js";

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
    if (!isRequestSensitiveOperationSuccess(result)) throw new Error("expected success");
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
    if (!isRequestSensitiveOperationSuccess(result)) throw new Error("expected success");
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "u2@example.com",
        html: expect.any(String),
        text: expect.any(String),
      })
    );
    const firstCall = sendEmail.mock.calls[0];
    expect(firstCall?.[0]?.html).toContain(
      SENSITIVE_OPERATION_LABELS.change_password
    );
  });

  it("uses custom branding (logo, colors) in sent email when sendEmail provided", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const result = await requestSensitiveOperation({
      operation: "change_email",
      userId: "u1",
      email: "u@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      sendEmail,
      branding: {
        logoUrl: "https://cdn.example.com/logo.png",
        primaryColor: "#059669",
        companyName: "Acme",
      },
    });
    if (!isRequestSensitiveOperationSuccess(result)) throw new Error("expected success");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload?.html).toContain("https://cdn.example.com/logo.png");
    expect(payload?.html).toContain("#059669");
  });

  it("uses custom htmlTemplate and textTemplate when provided", async () => {
    const sendEmail = vi.fn().mockResolvedValue(undefined);
    const result = await requestSensitiveOperation({
      operation: "change_password",
      userId: "u1",
      email: "u@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      sendEmail,
      htmlTemplate: "<p>Confirm: {{confirmationLink}} {{operation}}</p>",
      textTemplate: "Confirm: {{confirmationLink}} {{operation}}",
    });
    if (!isRequestSensitiveOperationSuccess(result)) throw new Error("expected success");
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const payload = sendEmail.mock.calls[0]?.[0];
    expect(payload?.html).toContain("Confirm:");
    expect(payload?.html).toContain("change password");
    expect(payload?.html).not.toContain("{{confirmationLink}}");
    expect(payload?.text).toContain("Confirm:");
    expect(payload?.text).not.toContain("{{operation}}");
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
    if (!isRequestSensitiveOperationSuccess(result)) throw new Error("expected success");
    expect(result.expiresAt).toBeGreaterThanOrEqual(
      Date.now() + 5 * 60 * 1000 - 2000
    );
    expect(result.expiresAt).toBeLessThanOrEqual(
      Date.now() + 5 * 60 * 1000 + 2000
    );
  });

  it("returns resendBlocked with retryAfterSeconds when resend policy blocks", async () => {
    const store = createMemoryResendStore();
    const baseMs = 100;
    const first = await requestSensitiveOperation({
      operation: "change_email",
      userId: "u1",
      email: "u@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      resendPolicyStore: store,
      resendPolicyOptions: { baseDelayMs: baseMs, maxDelayMs: 10_000 },
    });
    if (!isRequestSensitiveOperationSuccess(first)) throw new Error("expected success");

    const second = await requestSensitiveOperation({
      operation: "change_email",
      userId: "u1",
      email: "u@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      resendPolicyStore: store,
      resendPolicyOptions: { baseDelayMs: baseMs, maxDelayMs: 10_000 },
    });
    expect(isRequestSensitiveOperationSuccess(second)).toBe(false);
    expect("resendBlocked" in second).toBe(true);
    if ("resendBlocked" in second) {
      expect(second.resendBlocked.retryAfterSeconds).toBeGreaterThan(0);
    }
    expect(second.sent).toBe(false);
  });

  it("allows resend after backoff delay when using resend policy", async () => {
    const store = createMemoryResendStore();
    const baseMs = 50;
    await requestSensitiveOperation({
      operation: "change_password",
      userId: "u2",
      email: "u2@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      resendPolicyStore: store,
      resendPolicyOptions: { baseDelayMs: baseMs },
    });
    const blocked = await requestSensitiveOperation({
      operation: "change_password",
      userId: "u2",
      email: "u2@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      resendPolicyStore: store,
      resendPolicyOptions: { baseDelayMs: baseMs },
    });
    expect(isRequestSensitiveOperationSuccess(blocked)).toBe(false);

    await new Promise((r) => setTimeout(r, baseMs + 20));
    const allowed = await requestSensitiveOperation({
      operation: "change_password",
      userId: "u2",
      email: "u2@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
      resendPolicyStore: store,
      resendPolicyOptions: { baseDelayMs: baseMs },
    });
    if (!isRequestSensitiveOperationSuccess(allowed)) throw new Error("expected success");
  });
});

describe("double-opt-in required for sensitive operations", () => {
  it("sensitive operations cannot be executed without a valid confirmation token", async () => {
    const context = {
      userId: "u1",
      email: "u@example.com",
      operation: "delete_account" as SensitiveOperationType,
    };
    const action = vi.fn().mockResolvedValue(undefined);
    await expect(
      executeSensitiveOperation("delete_account", undefined, context, SECRET, action)
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(action).not.toHaveBeenCalled();
  });

  it("every sensitive operation type requires double-opt-in (rejects execution without token)", async () => {
    for (const operation of SENSITIVE_OPERATIONS) {
      const context = {
        userId: "u1",
        email: "u@example.com",
        operation: operation as SensitiveOperationType,
      };
      const action = vi.fn().mockResolvedValue(undefined);
      await expect(
        executeSensitiveOperation(operation, undefined, context, SECRET, action)
      ).rejects.toThrow(ConfirmationRequiredError);
      expect(action).not.toHaveBeenCalled();
    }
  });

  it("sensitive operation executes only after request and with token from confirmation link", async () => {
    const context = {
      userId: "u1",
      email: "u@example.com",
      operation: "change_password" as SensitiveOperationType,
    };
    const req = await requestSensitiveOperation({
      operation: "change_password",
      userId: context.userId,
      email: context.email,
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
    });
    if (!isRequestSensitiveOperationSuccess(req)) throw new Error("expected success");
    const action = vi.fn().mockResolvedValue({ updated: true });
    const out = await executeSensitiveOperation(
      "change_password",
      req.token,
      context,
      SECRET,
      action
    );
    expect(out).toEqual({ updated: true });
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", email: "u@example.com", operation: "change_password" })
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
    const req = await requestSensitiveOperation({
      operation: "change_email",
      userId: context.userId,
      email: context.email,
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
    });
    if (!isRequestSensitiveOperationSuccess(req)) throw new Error("expected success");
    const token = req.token;
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
    const req = await requestSensitiveOperation({
      operation: "change_email",
      userId: "other-user",
      email: "other@example.com",
      secret: SECRET,
      buildConfirmLink: (t) => `?token=${t}`,
    });
    if (!isRequestSensitiveOperationSuccess(req)) throw new Error("expected success");
    const token = req.token;
    const action = vi.fn();
    await expect(
      executeSensitiveOperation("change_email", token, context, SECRET, action)
    ).rejects.toThrow(ConfirmationRequiredError);
    expect(action).not.toHaveBeenCalled();
  });

  it("single-use: confirmation token invalidated after use (second execute throws)", async () => {
    const req = await requestSensitiveOperation({
      operation: "change_email",
      userId: context.userId,
      email: context.email,
      secret: SECRET,
      buildConfirmLink: (t) => `https://app.example.com/confirm?token=${t}`,
    });
    if (!isRequestSensitiveOperationSuccess(req)) throw new Error("expected success");
    const token = req.token;
    const action = vi.fn().mockResolvedValue({ done: true });
    await executeSensitiveOperation("change_email", token, context, SECRET, action);
    expect(action).toHaveBeenCalledTimes(1);
    await expect(
      executeSensitiveOperation("change_email", token, context, SECRET, vi.fn())
    ).rejects.toThrow(ConfirmationRequiredError);
  });

  it("works for all sensitive operation types", async () => {
    for (const op of SENSITIVE_OPERATIONS) {
      const ctx = {
        userId: "u1",
        email: "e@x.com",
        operation: op as SensitiveOperationType,
      };
      const req = await requestSensitiveOperation({
        operation: op as SensitiveOperationType,
        userId: ctx.userId,
        email: ctx.email,
        secret: SECRET,
        buildConfirmLink: (t) => `https://x.com/c?token=${t}`,
      });
      if (!isRequestSensitiveOperationSuccess(req)) throw new Error("expected success");
      const token = req.token;
      const action = vi.fn().mockResolvedValue(undefined);
      await executeSensitiveOperation(op as SensitiveOperationType, token, ctx, SECRET, action);
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({ operation: op })
      );
    }
  });
});
