import { Router } from "express";
import { db, newId, nowISO } from "../db.js";
import { hashPassword, authRequired, requireRole } from "../auth.js";

const r = Router();
r.use(authRequired, requireRole("admin"));

const out = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, hotelIds: JSON.parse(u.hotel_ids || "[]"), mustChange: !!u.must_change });

r.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all();
  res.json(rows.map(out));
});

r.post("/", (req, res) => {
  const { name, login, password, role, hotelIds } = req.body || {};
  if (!name || !login || !password || !role) return res.status(400).json({ error: "Dados incompletos." });
  if (!["admin", "gerente", "supervisor"].includes(role)) return res.status(400).json({ error: "Perfil inválido." });
  if (String(password).length < 4) return res.status(400).json({ error: "Senha muito curta." });
  const dup = db.prepare("SELECT 1 FROM users WHERE lower(login) = lower(?)").get(String(login).trim());
  if (dup) return res.status(409).json({ error: "Já existe um usuário com este login." });
  const id = newId();
  const hs = role === "admin" ? "[]" : JSON.stringify(Array.isArray(hotelIds) ? hotelIds : []);
  // novos usuários precisam trocar a senha no primeiro acesso
  db.prepare("INSERT INTO users (id,name,login,pass_hash,role,hotel_ids,must_change,created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run(id, name.trim(), String(login).trim(), hashPassword(password), role, hs, nowISO());
  res.status(201).json(out(db.prepare("SELECT * FROM users WHERE id = ?").get(id)));
});

r.put("/:id", (req, res) => {
  const { name, login, password, role, hotelIds, resetPassword } = req.body || {};
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Usuário não encontrado." });
  if (!["admin", "gerente", "supervisor"].includes(role)) return res.status(400).json({ error: "Perfil inválido." });
  if (login) {
    const dup = db.prepare("SELECT 1 FROM users WHERE lower(login) = lower(?) AND id <> ?").get(String(login).trim(), row.id);
    if (dup) return res.status(409).json({ error: "Já existe um usuário com este login." });
  }
  const hs = role === "admin" ? "[]" : JSON.stringify(Array.isArray(hotelIds) ? hotelIds : []);
  db.prepare("UPDATE users SET name=?, login=?, role=?, hotel_ids=? WHERE id=?")
    .run((name || row.name).trim(), (login || row.login).trim(), role, hs, row.id);
  if (password && String(password).length >= 4) {
    // ao redefinir senha, exige nova troca no próximo login
    db.prepare("UPDATE users SET pass_hash=?, must_change=1 WHERE id=?").run(hashPassword(password), row.id);
  } else if (resetPassword) {
    db.prepare("UPDATE users SET must_change=1 WHERE id=?").run(row.id);
  }
  res.json(out(db.prepare("SELECT * FROM users WHERE id = ?").get(row.id)));
});

r.delete("/:id", (req, res) => {
  if (req.params.id === req.auth.id) return res.status(400).json({ error: "Você não pode excluir a própria conta." });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default r;
