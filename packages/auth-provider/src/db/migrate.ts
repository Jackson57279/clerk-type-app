import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

function getMigrationsDir(): string {
  return join(process.cwd(), "db", "migrations");
}

export async function runMigrations(client?: pg.Client): Promise<string[]> {
  const ownClient = !client;
  const c = client ?? new pg.Client({ connectionString: process.env.DATABASE_URL });
  if (ownClient) await c.connect();

  await c.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      run_at TIMESTAMP DEFAULT NOW()
    )
  `);

  const run = await c.query("SELECT name FROM _schema_migrations");
  const applied = new Set((run.rows as { name: string }[]).map((r) => r.name));

  const migrationsDir = getMigrationsDir();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    const name = file;
    if (applied.has(name)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await c.query("BEGIN");
    try {
      await c.query(sql);
      await c.query("INSERT INTO _schema_migrations (name) VALUES ($1)", [name]);
      await c.query("COMMIT");
      ran.push(name);
    } catch (err) {
      await c.query("ROLLBACK");
      throw err;
    }
  }

  if (ownClient) await c.end();
  return ran;
}
