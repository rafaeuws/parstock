import { Router } from "express";
import { db } from "../db.js";
import { checkPassword, hashPassword, signToken, authRequired } from "../auth.js";
import { userRow, publicUser } from "../helpers.js";

const r = Router();

r.post("/login", async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) return res.status(400).json({ error: "Informe login e senha." });
    const row = await db.get("SELECT * FROM users WHERE lower(login) = lower(?)", [String(login).trim()]);
    if (!row || !checkPassword(password, row.pass_hash)) return res.status(401).json({ error: "Login ou senha incorretos." });
    const user = await userRow(row.id);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) { next(e); }
});

r.get("/me", authRequired, async (req, res, next) => {
  try {
    const user = await userRow(req.auth.id);
    if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
    res.json({ user: publicUser(user) });
  } catch (e) { next(e); }
});

r.post("/change-password", authRequired, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ error: "A nova senha precisa de pelo menos 4 caracteres." });
    const row = await db.get("SELECT * FROM users WHERE id = ?", [req.auth.id]);
    if (!row) return res.status(401).json({ error: "Usuário não encontrado." });
    if (!Number(row.must_change)) {
      if (!currentPassword || !checkPassword(currentPassword, row.pass_hash)) return res.status(400).json({ error: "Senha atual incorreta." });
    }
    await db.run("UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?", [hashPassword(newPassword), row.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
