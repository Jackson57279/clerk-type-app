import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("Monorepo and CI setup", () => {
  it("package has required scripts", () => {
    const pkgPath = join(process.cwd(), "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.build).toBeDefined();
    expect(pkg.scripts?.test).toBeDefined();
    expect(pkg.scripts?.lint).toBeDefined();
  });

  it("workspace root has workspaces and scripts", () => {
    const rootPath = join(process.cwd(), "..", "..", "package.json");
    if (!existsSync(rootPath)) return;
    const root = JSON.parse(readFileSync(rootPath, "utf-8")) as {
      workspaces?: string[];
      scripts?: Record<string, string>;
    };
    expect(Array.isArray(root.workspaces)).toBe(true);
    expect(root.workspaces).toContain("packages/*");
    expect(root.scripts?.build).toBeDefined();
    expect(root.scripts?.test).toBeDefined();
    expect(root.scripts?.lint).toBeDefined();
  });

  it("CI workflow exists and runs lint, test, build", () => {
    const workflowPath = join(process.cwd(), "..", "..", ".github", "workflows", "ci.yml");
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("bun run lint");
    expect(content).toContain("bun run test");
    expect(content).toContain("bun run build");
  });
});
