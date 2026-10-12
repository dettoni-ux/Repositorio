import pg from "pg";
import { migrate } from "../scripts/migrate";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://ia:ia_local@localhost:5432/influence_ads_test";

/** Recrea el esquema de la base de pruebas y aplica las migraciones. */
export default async function setup() {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
  await migrate(TEST_DB, () => undefined);
}
