import { describe, it, expect } from "vitest";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "../src/password-reset.js";
import {
  createMagicLinkToken,
  verifyMagicLinkToken,
} from "../src/magic-link.js";
import {
  createEmailVerificationToken,
  verifyEmailVerificationToken,
} from "../src/email-verification.js";
import {
  createConfirmationToken,
  verifyConfirmationToken,
} from "../src/double-opt-in.js";

const SECRET = "test-secret-key";

describe("single-use: token invalidated after use", () => {
  it("password reset token is invalid after first verify (default store)", () => {
    const { token } = createPasswordResetToken(
      { userId: "u1", email: "u@x.com" },
      SECRET
    );
    expect(verifyPasswordResetToken(token, SECRET)).not.toBeNull();
    expect(verifyPasswordResetToken(token, SECRET)).toBeNull();
  });

  it("magic link token is invalid after first verify (default store)", () => {
    const { token } = createMagicLinkToken({ email: "u@x.com" }, SECRET);
    expect(verifyMagicLinkToken(token, SECRET)).not.toBeNull();
    expect(verifyMagicLinkToken(token, SECRET)).toBeNull();
  });

  it("email verification token is invalid after first verify (default store)", () => {
    const { token } = createEmailVerificationToken(
      { userId: "u1", email: "u@x.com" },
      SECRET
    );
    expect(verifyEmailVerificationToken(token, SECRET)).not.toBeNull();
    expect(verifyEmailVerificationToken(token, SECRET)).toBeNull();
  });

  it("confirmation token is invalid after first verify (default store)", () => {
    const { token } = createConfirmationToken(
      { userId: "u1", email: "u@x.com", operation: "change_email" },
      SECRET
    );
    expect(verifyConfirmationToken(token, SECRET)).not.toBeNull();
    expect(verifyConfirmationToken(token, SECRET)).toBeNull();
  });
});
