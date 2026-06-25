import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
if (!process.env.JWT_SECRET) {
  console.warn("[auth] JWT_SECRET não definido — usando segredo temporário. Defina JWT_SECRET em produção para manter sessões válidas após reinício.");
}
const EXPIRES = process.env.TOKEN_TTL || "12h";

export const hashPassword = (plain) => bcrypt.hashSync(plain, 10);
export const checkPassword = (plain, hash) => bcrypt.compareSync(plain, hash);
export const signToken = (user) => jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: EXPIRES });

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    const payload = jwt.verify(token, SECRET);
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.auth || !roles.includes(req.auth.role)) return res.status(403).json({ error: "Permissão insuficiente." });
  next();
};
