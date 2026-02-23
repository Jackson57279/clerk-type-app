import type { Request, Response, NextFunction } from "express";

export interface SecurityHeadersOptions {
  strictTransportSecurity?: string | false;
  contentSecurityPolicy?: string | false;
  xFrameOptions?: string;
  xContentTypeOptions?: string;
  referrerPolicy?: string;
  permissionsPolicy?: string;
}

const DEFAULTS: Required<Omit<SecurityHeadersOptions, "strictTransportSecurity" | "contentSecurityPolicy">> = {
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
};

export function securityHeadersMiddleware(options: SecurityHeadersOptions = {}) {
  const xFrameOptions = options.xFrameOptions ?? DEFAULTS.xFrameOptions;
  const xContentTypeOptions = options.xContentTypeOptions ?? DEFAULTS.xContentTypeOptions;
  const referrerPolicy = options.referrerPolicy ?? DEFAULTS.referrerPolicy;
  const permissionsPolicy = options.permissionsPolicy ?? DEFAULTS.permissionsPolicy;
  const hsts = options.strictTransportSecurity;
  const csp = options.contentSecurityPolicy;

  return function middleware(_req: Request, res: Response, next: NextFunction): void {
    res.setHeader("X-Content-Type-Options", xContentTypeOptions);
    res.setHeader("X-Frame-Options", xFrameOptions);
    res.setHeader("Referrer-Policy", referrerPolicy);
    res.setHeader("Permissions-Policy", permissionsPolicy);
    if (hsts !== false && hsts !== undefined) {
      res.setHeader("Strict-Transport-Security", hsts);
    }
    if (csp !== false && csp !== undefined) {
      res.setHeader("Content-Security-Policy", csp);
    }
    next();
  };
}
