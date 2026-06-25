import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), "data", "parstock.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

/**
 * Camada de banco única que funciona com:
 *   1) better-sqlite3 (recomendado em produção — maduro e rápido)
 *   2) node:sqlite     (embutido no Node >= 22.5 — sem compilação nativa)
 * Toda a aplicação usa apenas parâmetros posicionais "?", compatíveis com ambos.
 */
async function makeDb() {
  try {
    const require = createRequire(import.meta.url);
    const Better = require("better-sqlite3");
    const d = new Better(DB_PATH);
    d.pragma("journal_mode = WAL");
    d.pragma("foreign_keys = ON");
    console.log("[db] usando better-sqlite3");
    return {
      exec: (s) => d.exec(s),
      prepare: (s) => { const st = d.prepare(s); return { run: (...a) => st.run(...a), get: (...a) => st.get(...a) ?? null, all: (...a) => st.all(...a) }; },
      tx: (fn) => d.transaction(fn)(),
    };
  } catch (e) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(DB_PATH);
    d.exec("PRAGMA journal_mode = WAL;");
    d.exec("PRAGMA foreign_keys = ON;");
    console.log("[db] usando node:sqlite (embutido)");
    return {
      exec: (s) => d.exec(s),
      prepare: (s) => { const st = d.prepare(s); return { run: (...a) => st.run(...a), get: (...a) => st.get(...a) ?? null, all: (...a) => st.all(...a) }; },
      tx: (fn) => { d.exec("BEGIN"); try { const r = fn(); d.exec("COMMIT"); return r; } catch (err) { d.exec("ROLLBACK"); throw err; } },
    };
  }
}

export const db = await makeDb();

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL, role TEXT NOT NULL, hotel_ids TEXT NOT NULL DEFAULT '[]',
    must_change INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hotels (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pdvs (
    id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
    name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (pdv_id TEXT PRIMARY KEY REFERENCES pdvs(id) ON DELETE CASCADE, items TEXT NOT NULL DEFAULT '[]');
  CREATE TABLE IF NOT EXISTS days (
    pdv_id TEXT NOT NULL REFERENCES pdvs(id) ON DELETE CASCADE, date TEXT NOT NULL, data TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', saved_by TEXT, saved_at TEXT, validated_by TEXT, validated_at TEXT,
    PRIMARY KEY (pdv_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_days_pdv ON days(pdv_id);
  CREATE INDEX IF NOT EXISTS idx_days_status ON days(pdv_id, status);
`);

export const newId = () => randomUUID();
export const nowISO = () => new Date().toISOString();

export function seedAdmin() {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (existing > 0) return;
  const login = process.env.SEED_ADMIN_LOGIN || "admin";
  const pass = process.env.SEED_ADMIN_PASSWORD || "rafa1411";
  const hash = bcrypt.hashSync(pass, 10);
  db.prepare("INSERT INTO users (id,name,login,pass_hash,role,hotel_ids,must_change,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(newId(), "Administrador", login, hash, "admin", "[]", 0, nowISO());
  console.log(`[seed] Administrador criado — login: "${login}".`);
}
