import type { SecureContextOptions } from "node:tls";

export const TLS_MIN_VERSION = "TLSv1.3" as const;

const TLS_OPTIONS: SecureContextOptions = {
  minVersion: TLS_MIN_VERSION,
};

export function getServerTlsOptions(): SecureContextOptions {
  return { ...TLS_OPTIONS };
}

export function getClientTlsOptions(): SecureContextOptions {
  return { ...TLS_OPTIONS };
}
