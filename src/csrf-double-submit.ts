import { timingSafeEqual } from "crypto";
import { generateSecureToken } from "./secure-token.js";

export interface CsrfCookieOptions {
  maxAgeSeconds?: number;
  path?: string;
}

const CSRF_ATTRS = "Secure; SameSite=Strict";

function cookieSegment(name: string, value: string): string {
  return `${name}=${value}`;
}

export function generateCsrfToken(): string {
  return generateSecureToken();
}

export function buildCsrfCookie(
  name: string,
  token: string,
  options: CsrfCookieOptions = {}
): string {
  const parts = [cookieSegment(name, token), CSRF_ATTRS];
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`);
  }
  return parts.join("; ");
}

export function verifyCsrfDoubleSubmit(
  cookieToken: string | undefined,
  submittedToken: string | undefined
): boolean {
  if (cookieToken === undefined || submittedToken === undefined) {
    return false;
  }
  if (cookieToken.length === 0 || submittedToken.length === 0) {
    return false;
  }
  if (cookieToken.length !== submittedToken.length) {
    return false;
  }
  const a = Buffer.from(cookieToken, "utf8");
  const b = Buffer.from(submittedToken, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
