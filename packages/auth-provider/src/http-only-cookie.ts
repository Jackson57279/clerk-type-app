export interface SessionCookieOptions {
  maxAgeSeconds?: number;
  path?: string;
}

const SESSION_ATTRS = "HttpOnly; Secure; SameSite=Strict";

function cookieSegment(name: string, value: string): string {
  return `${name}=${value}`;
}

export function buildSessionCookie(
  name: string,
  value: string,
  options: SessionCookieOptions = {}
): string {
  const parts = [cookieSegment(name, value), SESSION_ATTRS];
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options.path !== undefined) {
    parts.push(`Path=${options.path}`);
  }
  return parts.join("; ");
}

export function buildClearSessionCookie(name: string, path?: string): string {
  const parts = [cookieSegment(name, ""), "Max-Age=0", SESSION_ATTRS];
  if (path !== undefined) {
    parts.push(`Path=${path}`);
  }
  return parts.join("; ");
}
