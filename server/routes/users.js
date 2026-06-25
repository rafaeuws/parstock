import { Router } from "express";
import { db, newId, nowISO } from "../db.js";
import { hashPassword, authRequired, requireRole } from "../auth.js";

const r = Router();
r.use(authRequired, requireRole("admin"));

const out = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, hotelIds: JSON.parse(u.hotel_ids || "[]"), mustChange: !!Number(u.must_change) });

r.get("/", async (req, res, next) => {
  try { res.json((await db.all("SELECT * FROM users ORDER BY name")).map(out)); } catch (e) { next(e); }
});

r.post("/", async (req, res, next) => {
  try {
    const { name, login, password, role, hotelIds } = req.body || {};
    if (!name || !login || !password || !role) return res.status(400).json({ error: "Dados incompletos." });
    if (!["admin", "gerente", "supervisor"].includes(role)) return res.status(400).json({ error: "Perfil inválido." });
    if (String(password).length < 4) return res.status(400).json({ error: "Senha muito curta." });
    const dup = await db.get("SELECT 1 AS x FROM users WHERE lower(login) = lower(?)", [String(login).trim()]);
    if (dup) return res.status(409).json({ error: "Já existe um usuário com este login." });
    const id = newId();
    const hs = role === "admin" ? "[]" : JSON.stringify(Array.isArray(hotelIds) ? hotelIds : []);
    await db.run("INSERT INTO users (id,name,login,pass_hash,role,hotel_ids,must_change,created_at) VALUES (?,?,?,?,?,?,1,?)",
      [id, name.trim(), String(login).trim(), hashPassword(password), role, hs, nowISO()]);
    res.status(201).json(out(await db.get("SELECT * FROM users WHERE id = ?", [id])));
  } catch (e) { next(e); }
});

r.put("/:id", async (req, res, next) => {
  try {
    const { name, login, password, role, hotelIds, resetPassword } = req.body || {};
    const row = await db.get("SELECT * FROM users WHERE id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Usuário não encontrado." });
    if (!["admin", "gerente", "supervisor"].includes(role)) return res.status(400).json({ error: "Perfil inválido." });
    if (login) {
      const dup = await db.get("SELECT 1 AS x FROM users WHERE lower(login) = lower(?) AND id <> ?", [String(login).trim(), row.id]);
      if (dup) return res.status(409).json({ error: "Já existe um usuário com este login." });
    }
    const hs = role === "admin" ? "[]" : JSON.stringify(Array.isArray(hotelIds) ? hotelIds : []);
    await db.run("UPDATE users SET name=?, login=?, role=?, hotel_ids=? WHERE id=?",
      [(name || row.name).trim(), (login || row.login).trim(), role, hs, row.id]);
    if (password && String(password).length >= 4) await db.run("UPDATE users SET pass_hash=?, must_change=1 WHERE id=?", [hashPassword(password), row.id]);
    else if (resetPassword) await db.run("UPDATE users SET must_change=1 WHERE id=?", [row.id]);
    res.json(out(await db.get("SELECT * FROM users WHERE id = ?", [row.id])));
  } catch (e) { next(e); }
});

r.delete("/:id", async (req, res, next) => {
  try {
    if (req.params.id === req.auth.id) return res.status(400).json({ error: "Você não pode excluir a própria conta." });
    await db.run("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
