import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

/**
 * Camada de banco assíncrona e única para:
 *   - PostgreSQL  (quando DATABASE_URL está definido) — recomendado em produção/Render
 *   - SQLite      (better-sqlite3, ou node:sqlite embutido) — ótimo para uso local
 * Todas as queries usam "?" como placeholder; no Postgres são convertidos para $1, $2...
 * Tipos mantidos simples (TEXT/INTEGER) para o mesmo schema valer nos dois bancos.
 */
const DATABASE_URL = process.env.DATABASE_URL;

function pgFactory() {
  const require = createRequire(import.meta.url);
  const { Pool } = require("pg");
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(DATABASE_URL) || /\/(localhost|127\.0\.0\.1)/.test(DATABASE_URL);
  const ssl = process.env.DATABASE_SSL === "disable" ? false : (isLocal ? false : { rejectUnauthorized: false });
  const pool = new Pool({ connectionString: DATABASE_URL, ssl, max: 5 });
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => "$" + (++i)); };
  console.log("[db] usando PostgreSQL");
  return {
    kind: "pg",
    exec: async (sql) => { await pool.query(sql); },
    get: async (sql, p = []) => (await pool.query(toPg(sql), p)).rows[0] ?? null,
    all: async (sql, p = []) => (await pool.query(toPg(sql), p)).rows,
    run: async (sql, p = []) => { await pool.query(toPg(sql), p); },
    tx: async (fn) => { const c = await pool.connect(); try { await c.query("BEGIN"); const r = await fn(); await c.query("COMMIT"); return r; } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); } },
  };
}

function sqliteFactory() {
  const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "parstock.db");
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  let d, kind;
  try {
    const require = createRequire(import.meta.url);
    const Better = require("better-sqlite3");
    d = new Better(DB_PATH); d.pragma("journal_mode = WAL"); d.pragma("foreign_keys = ON"); kind = "better-sqlite3";
  } catch {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite");
    d = new DatabaseSync(DB_PATH); d.exec("PRAGMA journal_mode = WAL;"); d.exec("PRAGMA foreign_keys = ON;"); kind = "node:sqlite";
  }
  console.log("[db] usando " + kind + " (arquivo: " + DB_PATH + ")");
  return {
    kind: "sqlite",
    exec: async (sql) => d.exec(sql),
    get: async (sql, p = []) => d.prepare(sql).get(...p) ?? null,
    all: async (sql, p = []) => d.prepare(sql).all(...p),
    run: async (sql, p = []) => d.prepare(sql).run(...p),
    tx: async (fn) => { d.exec("BEGIN"); try { const r = await fn(); d.exec("COMMIT"); return r; } catch (e) { d.exec("ROLLBACK"); throw e; } },
  };
}

export const db = DATABASE_URL ? pgFactory() : sqliteFactory();

export async function initSchema() {
  // statements individuais (compatível com pg e sqlite)
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE,
      pass_hash TEXT NOT NULL, role TEXT NOT NULL, hotel_ids TEXT NOT NULL DEFAULT '[]',
      must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS hotels (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS pdvs (
      id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      name TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS products (pdv_id TEXT PRIMARY KEY REFERENCES pdvs(id) ON DELETE CASCADE, items TEXT NOT NULL DEFAULT '[]')`,
    `CREATE TABLE IF NOT EXISTS days (
      pdv_id TEXT NOT NULL REFERENCES pdvs(id) ON DELETE CASCADE, date TEXT NOT NULL, data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft', saved_by TEXT, saved_at TEXT, validated_by TEXT, validated_at TEXT,
      PRIMARY KEY (pdv_id, date))`,
    `CREATE INDEX IF NOT EXISTS idx_days_pdv ON days(pdv_id)`,
    `CREATE INDEX IF NOT EXISTS idx_days_status ON days(pdv_id, status)`,
  ];
  for (const s of stmts) await db.exec(s);
}

export const newId = () => randomUUID();
export const nowISO = () => new Date().toISOString();

export async function seedAdmin() {
  const row = await db.get("SELECT COUNT(*) AS n FROM users");
  if (Number(row.n) > 0) return;
  const login = process.env.SEED_ADMIN_LOGIN || "admin";
  const pass = process.env.SEED_ADMIN_PASSWORD || "rafa1411";
  const hash = bcrypt.hashSync(pass, 10);
  await db.run("INSERT INTO users (id,name,login,pass_hash,role,hotel_ids,must_change,created_at) VALUES (?,?,?,?,?,?,?,?)",
    [newId(), "Administrador", login, hash, "admin", "[]", 0, nowISO()]);
  console.log(`[seed] Administrador criado — login: "${login}".`);
}
