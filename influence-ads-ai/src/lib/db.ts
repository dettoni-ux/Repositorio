import "server-only";
import pg from "pg";

// numeric/bigint → number (los montos de Meta caben con holgura en un double)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// date → string YYYY-MM-DD (evita desfases de zona horaria)
pg.types.setTypeParser(1082, (v) => v);

const globalForPg = globalThis as unknown as { __iaPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPg.__iaPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Falta DATABASE_URL en la configuración del servidor.");
    globalForPg.__iaPool = new pg.Pool({ connectionString, max: 10 });
  }
  return globalForPg.__iaPool;
}

export type Queryable = Pick<pg.Pool, "query"> | pg.PoolClient;

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool(),
): Promise<T[]> {
  const res = await db.query<T>(text, params);
  return res.rows;
}

export async function q1<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Queryable = pool(),
): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
