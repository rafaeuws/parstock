import { Router } from "express";
import { db, nowISO } from "../db.js";
import { checkPassword, hashPassword, signToken, authRequired } from "../auth.js";
import { userRow, publicUser } from "../helpers.js";

const r = Router();

r.post("/login", (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: "Informe login e senha." });
  const row = db.prepare("SELECT * FROM users WHERE lower(login) = lower(?)").get(String(login).trim());
  if (!row || !checkPassword(password, row.pass_hash)) {
    return res.status(401).json({ error: "Login ou senha incorretos." });
  }
  const user = userRow(row.id);
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

r.get("/me", authRequired, (req, res) => {
  const user = userRow(req.auth.id);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
  res.json({ user: publicUser(user) });
});

r.post("/change-password", authRequired, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: "A nova senha precisa de pelo menos 4 caracteres." });
  }
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.auth.id);
  if (!row) return res.status(401).json({ error: "Usuário não encontrado." });
  // se não é a primeira troca obrigatória, confere a senha atual
  if (!row.must_change) {
    if (!currentPassword || !checkPassword(currentPassword, row.pass_hash)) {
      return res.status(400).json({ error: "Senha atual incorreta." });
    }
  }
  db.prepare("UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?").run(hashPassword(newPassword), row.id);
  res.json({ ok: true });
});

export default r;
