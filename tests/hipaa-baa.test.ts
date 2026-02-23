import { describe, it, expect } from "vitest";
import {
  isBaaAvailable,
  getHipaaComplianceStatus,
  type HipaaBaaConfig,
} from "../src/hipaa-baa.js";

describe("isBaaAvailable", () => {
  it("returns true when baaAvailable is true", () => {
    const config: HipaaBaaConfig = { baaAvailable: true };
    expect(isBaaAvailable(config)).toBe(true);
  });

  it("returns false when baaAvailable is false", () => {
    const config: HipaaBaaConfig = { baaAvailable: false };
    expect(isBaaAvailable(config)).toBe(false);
  });
});

describe("getHipaaComplianceStatus", () => {
  it("returns baaAvailable true when config has baaAvailable true", () => {
    const config: HipaaBaaConfig = { baaAvailable: true };
    const status = getHipaaComplianceStatus(config);
    expect(status.baaAvailable).toBe(true);
  });

  it("returns baaAvailable false when config has baaAvailable false", () => {
    const config: HipaaBaaConfig = { baaAvailable: false };
    const status = getHipaaComplianceStatus(config);
    expect(status.baaAvailable).toBe(false);
  });
});
