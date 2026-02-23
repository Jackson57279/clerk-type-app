import { randomBytes } from "crypto";

export const SECURE_TOKEN_BYTES = 32;

export function generateSecureToken(): string {
  return randomBytes(SECURE_TOKEN_BYTES).toString("hex");
}
