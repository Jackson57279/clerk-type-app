export interface HipaaBaaConfig {
  baaAvailable: boolean;
}

export function isBaaAvailable(config: HipaaBaaConfig): boolean {
  return config.baaAvailable === true;
}

export function getHipaaComplianceStatus(config: HipaaBaaConfig): {
  baaAvailable: boolean;
} {
  return {
    baaAvailable: isBaaAvailable(config),
  };
}
