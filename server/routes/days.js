import { Router } from "express";
import { db, nowISO } from "../db.js";
import { authRequired } from "../auth.js";
import { userRow, userHasPdv, canValidate, canEditRetroactive, todayISO } from "../helpers.js";

const r = Router();
r.use(authRequired);

// middleware: garante acesso ao PDV e injeta req.pdvId / req.user
function pdvGuard(req, res, next) {
  const user = userRow(req.auth.id);
  const pdvId = req.params.pid;
  if (!userHasPdv(user, pdvId)) return res.status(403).json({ error: "Sem acesso a este PDV." });
  req.user = user;
  req.pdvId = pdvId;
  next();
}

const dayOut = (row) => ({
  date: row.date,
  ...JSON.parse(row.data),
  status: row.status,
  savedBy: row.saved_by ? JSON.parse(row.saved_by) : null,
  savedAt: row.saved_at,
  validatedBy: row.validated_by ? JSON.parse(row.validated_by) : null,
  validatedAt: row.validated_at,
});

/* ---------- PRODUTOS ---------- */
r.get("/:pid/products", pdvGuard, (req, res) => {
  const row = db.prepare("SELECT items FROM products WHERE pdv_id = ?").get(req.pdvId);
  res.json(row ? JSON.parse(row.items) : []);
});

r.put("/:pid/products", pdvGuard, (req, res) => {
  const items = Array.isArray(req.body) ? req.body : (req.body && req.body.items) || [];
  db.prepare("INSERT INTO products (pdv_id, items) VALUES (?, ?) ON CONFLICT(pdv_id) DO UPDATE SET items = excluded.items")
    .run(req.pdvId, JSON.stringify(items));
  res.json(items);
});

/* ---------- ÍNDICE + PENDÊNCIAS ---------- */
r.get("/:pid/index", pdvGuard, (req, res) => {
  const rows = db.prepare("SELECT date, status FROM days WHERE pdv_id = ? ORDER BY date").all(req.pdvId);
  res.json({
    dates: rows.map((x) => x.date),
    pending: rows.filter((x) => x.status === "pending").map((x) => x.date),
  });
});

/* ---------- DIAS POR INTERVALO ---------- */
r.get("/:pid/days", pdvGuard, (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) rows = db.prepare("SELECT * FROM days WHERE pdv_id = ? AND date >= ? AND date <= ? ORDER BY date").all(req.pdvId, from, to);
  else rows = db.prepare("SELECT * FROM days WHERE pdv_id = ? ORDER BY date").all(req.pdvId);
  const map = {};
  for (const row of rows) map[row.date] = dayOut(row);
  res.json(map);
});

/* ---------- UM DIA ---------- */
r.get("/:pid/day/:date", pdvGuard, (req, res) => {
  const row = db.prepare("SELECT * FROM days WHERE pdv_id = ? AND date = ?").get(req.pdvId, req.params.date);
  res.json(row ? dayOut(row) : null);
});

/* ---------- SALVAR DIA (com regra de papel) ---------- */
r.put("/:pid/day/:date", pdvGuard, (req, res) => {
  const date = req.params.date;
  const user = req.user;
  // supervisor não altera dias retroativos
  if (!canEditRetroactive(user.role) && date < todayISO()) {
    return res.status(403).json({ error: "Seu perfil não pode alterar dias anteriores a hoje." });
  }
  const payload = req.body || {};
  const data = { time: payload.time || "", resp: payload.resp || "", items: payload.items || {} };
  const stamp = JSON.stringify({ id: user.id, name: user.name, role: user.role });
  const now = nowISO();
  const supervisor = user.role === "supervisor";
  const status = supervisor ? "pending" : "validated";
  const validatedBy = supervisor ? null : stamp;
  const validatedAt = supervisor ? null : now;

  db.prepare(`
    INSERT INTO days (pdv_id, date, data, status, saved_by, saved_at, validated_by, validated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pdv_id, date) DO UPDATE SET
      data=excluded.data, status=excluded.status, saved_by=excluded.saved_by,
      saved_at=excluded.saved_at, validated_by=excluded.validated_by, validated_at=excluded.validated_at
  `).run(req.pdvId, date, JSON.stringify(data), status, stamp, now, validatedBy, validatedAt);
  const row = db.prepare("SELECT * FROM days WHERE pdv_id = ? AND date = ?").get(req.pdvId, date);
  res.json(dayOut(row));
});

/* ---------- VALIDAR DIA (gerente/admin) ---------- */
r.post("/:pid/day/:date/validate", pdvGuard, (req, res) => {
  if (!canValidate(req.user.role)) return res.status(403).json({ error: "Apenas gerente ou administrador podem validar." });
  const row = db.prepare("SELECT * FROM days WHERE pdv_id = ? AND date = ?").get(req.pdvId, req.params.date);
  if (!row) return res.status(404).json({ error: "Dia não encontrado." });
  const stamp = JSON.stringify({ id: req.user.id, name: req.user.name, role: req.user.role });
  db.prepare("UPDATE days SET status='validated', validated_by=?, validated_at=? WHERE pdv_id=? AND date=?")
    .run(stamp, nowISO(), req.pdvId, req.params.date);
  res.json(dayOut(db.prepare("SELECT * FROM days WHERE pdv_id = ? AND date = ?").get(req.pdvId, req.params.date)));
});

/* ---------- EXPORTAR / IMPORTAR (backup por PDV) ---------- */
r.get("/:pid/export", pdvGuard, (req, res) => {
  const products = db.prepare("SELECT items FROM products WHERE pdv_id = ?").get(req.pdvId);
  const days = db.prepare("SELECT * FROM days WHERE pdv_id = ? ORDER BY date").all(req.pdvId);
  res.json({
    _type: "parstock-pdv-backup", version: 1, exportedAt: nowISO(),
    products: products ? JSON.parse(products.items) : [],
    days: days.map(dayOut),
  });
});

r.post("/:pid/import", pdvGuard, (req, res) => {
  if (!canValidate(req.user.role)) return res.status(403).json({ error: "Apenas gerente ou administrador podem importar." });
  const d = req.body || {};
  if (d._type !== "parstock-pdv-backup") return res.status(400).json({ error: "Arquivo de backup inválido." });
  db.tx(() => {
    db.prepare("INSERT INTO products (pdv_id, items) VALUES (?, ?) ON CONFLICT(pdv_id) DO UPDATE SET items = excluded.items")
      .run(req.pdvId, JSON.stringify(d.products || []));
    for (const day of d.days || []) {
      const data = { time: day.time || "", resp: day.resp || "", items: day.items || {} };
      db.prepare(`INSERT INTO days (pdv_id,date,data,status,saved_by,saved_at,validated_by,validated_at)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(pdv_id,date) DO UPDATE SET data=excluded.data,status=excluded.status,saved_by=excluded.saved_by,saved_at=excluded.saved_at,validated_by=excluded.validated_by,validated_at=excluded.validated_at`)
        .run(req.pdvId, day.date, JSON.stringify(data), day.status || "validated",
          day.savedBy ? JSON.stringify(day.savedBy) : null, day.savedAt || null,
          day.validatedBy ? JSON.stringify(day.validatedBy) : null, day.validatedAt || null);
    }
  });
  res.json({ ok: true });
});

export default r;
