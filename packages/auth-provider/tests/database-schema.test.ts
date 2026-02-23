import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "../src/db/migrate.js";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

describe("Database schema migrations", () => {
  describe("migration files", () => {
    it("exist in db/migrations and are ordered", () => {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      expect(files.length).toBeGreaterThanOrEqual(9);
      expect(files[0]).toBe("001_users.sql");
      expect(files).toContain("002_organizations.sql");
      expect(files).toContain("003_organization_memberships.sql");
      expect(files).toContain("004_sessions.sql");
      expect(files).toContain("005_oauth_accounts.sql");
      expect(files).toContain("006_webauthn_credentials.sql");
      expect(files).toContain("007_audit_logs.sql");
      expect(files).toContain("008_applications.sql");
      expect(files).toContain("009_rls.sql");
    });

    it("001_users creates users table with expected columns", () => {
      const sql = readFileSync(join(MIGRATIONS_DIR, "001_users.sql"), "utf8");
      expect(sql).toContain("CREATE TABLE users");
      expect(sql).toContain("email VARCHAR(255)");
      expect(sql).toContain("password_hash");
      expect(sql).toContain("deleted_at");
      expect(sql).toContain("valid_email");
    });

    it("002_organizations creates organizations table", () => {
      const sql = readFileSync(join(MIGRATIONS_DIR, "002_organizations.sql"), "utf8");
      expect(sql).toContain("CREATE TABLE organizations");
      expect(sql).toContain("slug VARCHAR(255) UNIQUE");
      expect(sql).toContain("saml_config JSONB");
    });

    it("007_audit_logs creates partitioned audit_logs", () => {
      const sql = readFileSync(join(MIGRATIONS_DIR, "007_audit_logs.sql"), "utf8");
      expect(sql).toContain("CREATE TABLE audit_logs");
      expect(sql).toContain("PARTITION BY RANGE (created_at)");
      expect(sql).toContain("event_type");
      expect(sql).toContain("PARTITION OF audit_logs");
    });

    it("009_rls enables RLS on users and organization_memberships", () => {
      const sql = readFileSync(join(MIGRATIONS_DIR, "009_rls.sql"), "utf8");
      expect(sql).toContain("ROW LEVEL SECURITY");
      expect(sql).toContain("user_isolation");
      expect(sql).toContain("org_membership_isolation");
    });
  });

  describe("runMigrations", () => {
    it("creates _schema_migrations and runs pending migrations when client provided", async () => {
      const queries: string[] = [];
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        end: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockImplementation((q: string) => {
          queries.push(q.trim().slice(0, 80));
          if (q.includes("SELECT name FROM _schema_migrations")) {
            return Promise.resolve({ rows: [] });
          }
          if (q.includes("INSERT INTO _schema_migrations")) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as import("pg").Client;

      await runMigrations(client);

      const createMigrationTable = queries.some((q) =>
        q.includes("CREATE TABLE IF NOT EXISTS _schema_migrations")
      );
      expect(createMigrationTable).toBe(true);
      expect(client.query).toHaveBeenCalled();
    });

    it("returns list of migration names when run with all pending", async () => {
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        end: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockImplementation((q: string) => {
          if (q.includes("SELECT name FROM _schema_migrations")) {
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as import("pg").Client;

      const ran = await runMigrations(client);
      expect(ran.length).toBeGreaterThanOrEqual(9);
      expect(ran).toContain("001_users.sql");
      expect(ran).toContain("009_rls.sql");
    });

    it("returns empty array when all migrations already applied", async () => {
      const files = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();
      const client = {
        connect: vi.fn().mockResolvedValue(undefined),
        end: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockImplementation((q: string) => {
          if (q.includes("SELECT name FROM _schema_migrations")) {
            return Promise.resolve({
              rows: files.map((name) => ({ name })),
            });
          }
          return Promise.resolve({ rows: [] });
        }),
      } as unknown as import("pg").Client;

      const ran = await runMigrations(client);
      expect(ran).toEqual([]);
    });
  });
});
