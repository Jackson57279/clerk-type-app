import { randomBytes } from "crypto";

const TOKEN_BYTES = 32;

export function generateSecureToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}
