/** Crea un usuario adicional desde la terminal: npm run db:seed-admin -- correo@x.cl "Nombre" rol */
import pg from "pg";
import { loadEnvFile } from "./load-env";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";

loadEnvFile();
const [email, name, role = "admin"] = process.argv.slice(2);
if (!email || !name) { console.error('Uso: npm run db:seed-admin -- correo@x.cl "Nombre" [rol]'); process.exit(1); }
const password = randomBytes(12).toString("base64url");
const salt = randomBytes(16);
const hash = (await promisify(scrypt)(password, salt, 64) as Buffer);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const org = (await c.query(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`)).rows[0];
if (!org) { console.error("No hay organización: abre la app y completa /configurar primero."); process.exit(1); }
const u = (await c.query(`INSERT INTO users (email, name, password_hash) VALUES ($1,$2,$3) RETURNING id`, [email.toLowerCase(), name, `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`])).rows[0];
await c.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1,$2,$3)`, [org.id, u.id, role]);
await c.end();
console.log(`Usuario creado. Contraseña temporal: ${password}`);
