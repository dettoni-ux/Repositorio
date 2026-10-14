import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://ia:ia_local@localhost:5432/influence_ads_test";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.META_APP_ID = "1234567890";
process.env.META_APP_SECRET = "secreto-de-prueba";
process.env.META_GRAPH_VERSION = "v26.0";
process.env.APP_URL = "http://localhost:3000";
process.env.STORAGE_DIR ??= mkdtempSync(path.join(tmpdir(), "ia-storage-"));
