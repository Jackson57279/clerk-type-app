export const DEFAULT_LINK_TTL_MS = 15 * 60 * 1000;

export const DEFAULT_LINK_TOKEN_PARAM = "token";

export interface BuildJwtLinkOptions {
  paramName?: string;
}

export function buildJwtLink(
  baseUrl: string,
  jwtToken: string,
  options: BuildJwtLinkOptions = {}
): string {
  const param = options.paramName ?? DEFAULT_LINK_TOKEN_PARAM;
  const hashIndex = baseUrl.indexOf("#");
  const beforeHash = hashIndex >= 0 ? baseUrl.slice(0, hashIndex) : baseUrl;
  const afterHash = hashIndex >= 0 ? baseUrl.slice(hashIndex) : "";
  const sep = beforeHash.includes("?") ? "&" : "?";
  return `${beforeHash}${sep}${param}=${encodeURIComponent(jwtToken)}${afterHash}`;
}

export interface ParseJwtFromLinkOptions {
  paramName?: string;
}

export function parseJwtFromLink(
  url: string,
  options: ParseJwtFromLinkOptions = {}
): string | null {
  const param = options.paramName ?? DEFAULT_LINK_TOKEN_PARAM;
  try {
    const u = new URL(url, "https://placeholder");
    const value = u.searchParams.get(param);
    if (value == null || value === "") return null;
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
