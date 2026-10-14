/** Aplica las migraciones SQL pendientes en orden. Uso: npm run db:migrate */
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvFile } from "./load-env";

export async function migrate(connectionString: string, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.resolve(import.meta.dirname, "../migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
    for (const f of files) {
      if (applied.has(f)) continue;
      const sql = await readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations(name) VALUES ($1)`, [f]);
        await client.query("COMMIT");
        log(`✓ ${f}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Falló la migración ${f}: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("Falta DATABASE_URL"); process.exit(1); }
  migrate(url).then(() => console.log("Migraciones al día.")).catch((e) => { console.error(e.message); process.exit(1); });
}
