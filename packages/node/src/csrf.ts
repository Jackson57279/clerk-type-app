import { timingSafeEqual } from "crypto";

export const DEFAULT_CSRF_COOKIE_NAME = "csrf";
export const DEFAULT_CSRF_HEADER_NAME = "X-CSRF-Token";

export interface CsrfMiddlewareOptions {
  cookieName?: string;
  headerName?: string;
  methodsToProtect?: string[];
}

export type GetHeader = (name: string) => string | undefined;

function getCsrfTokenFromCookieHeader(
  cookieHeader: string | undefined,
  cookieName: string
): string | undefined {
  if (cookieHeader === undefined || cookieHeader.length === 0) {
    return undefined;
  }
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const name = pair.slice(0, eq).trim();
    if (name === cookieName) {
      return pair.slice(eq + 1).trim();
    }
  }
  return undefined;
}

function getSubmittedToken(getHeader: GetHeader, headerName: string): string | undefined {
  const value = getHeader(headerName);
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function verifyDoubleSubmit(
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

export function verifyCsrfRequest(
  cookieHeader: string | undefined,
  getHeader: GetHeader,
  options: CsrfMiddlewareOptions = {}
): boolean {
  const cookieName = options.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;
  const headerName = options.headerName ?? DEFAULT_CSRF_HEADER_NAME;
  const cookieToken = getCsrfTokenFromCookieHeader(cookieHeader, cookieName);
  const submittedToken = getSubmittedToken(getHeader, headerName);
  return verifyDoubleSubmit(cookieToken, submittedToken);
}
