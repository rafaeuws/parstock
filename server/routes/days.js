import { Router } from "express";
import { db, nowISO } from "../db.js";
import { authRequired } from "../auth.js";
import { userRow, userHasPdv, canValidate, canEditRetroactive, todayISO } from "../helpers.js";

const r = Router();
r.use(authRequired);

async function pdvGuard(req, res, next) {
  try {
    const user = await userRow(req.auth.id);
    if (!(await userHasPdv(user, req.params.pid))) return res.status(403).json({ error: "Sem acesso a este PDV." });
    req.user = user; req.pdvId = req.params.pid; next();
  } catch (e) { next(e); }
}

const dayOut = (row) => ({
  date: row.date, ...JSON.parse(row.data), status: row.status,
  savedBy: row.saved_by ? JSON.parse(row.saved_by) : null, savedAt: row.saved_at,
  validatedBy: row.validated_by ? JSON.parse(row.validated_by) : null, validatedAt: row.validated_at,
});

r.get("/:pid/products", pdvGuard, async (req, res, next) => {
  try { const row = await db.get("SELECT items FROM products WHERE pdv_id = ?", [req.pdvId]); res.json(row ? JSON.parse(row.items) : []); } catch (e) { next(e); }
});

r.put("/:pid/products", pdvGuard, async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : (req.body && req.body.items) || [];
    await db.run("INSERT INTO products (pdv_id, items) VALUES (?, ?) ON CONFLICT(pdv_id) DO UPDATE SET items = excluded.items", [req.pdvId, JSON.stringify(items)]);
    res.json(items);
  } catch (e) { next(e); }
});

r.get("/:pid/index", pdvGuard, async (req, res, next) => {
  try {
    const rows = await db.all("SELECT date, status FROM days WHERE pdv_id = ? ORDER BY date", [req.pdvId]);
    res.json({ dates: rows.map((x) => x.date), pending: rows.filter((x) => x.status === "pending").map((x) => x.date) });
  } catch (e) { next(e); }
});

r.get("/:pid/days", pdvGuard, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    const rows = (from && to)
      ? await db.all("SELECT * FROM days WHERE pdv_id = ? AND date >= ? AND date <= ? ORDER BY date", [req.pdvId, from, to])
      : await db.all("SELECT * FROM days WHERE pdv_id = ? ORDER BY date", [req.pdvId]);
    const map = {}; for (const row of rows) map[row.date] = dayOut(row); res.json(map);
  } catch (e) { next(e); }
});

r.get("/:pid/day/:date", pdvGuard, async (req, res, next) => {
  try { const row = await db.get("SELECT * FROM days WHERE pdv_id = ? AND date = ?", [req.pdvId, req.params.date]); res.json(row ? dayOut(row) : null); } catch (e) { next(e); }
});

r.put("/:pid/day/:date", pdvGuard, async (req, res, next) => {
  try {
    const date = req.params.date, user = req.user;
    if (!canEditRetroactive(user.role) && date < todayISO()) return res.status(403).json({ error: "Seu perfil não pode alterar dias anteriores a hoje." });
    const payload = req.body || {};
    const data = { time: payload.time || "", resp: payload.resp || "", items: payload.items || {} };
    const stamp = JSON.stringify({ id: user.id, name: user.name, role: user.role });
    const now = nowISO();
    const supervisor = user.role === "supervisor";
    const status = supervisor ? "pending" : "validated";
    await db.run(`INSERT INTO days (pdv_id, date, data, status, saved_by, saved_at, validated_by, validated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pdv_id, date) DO UPDATE SET data=excluded.data, status=excluded.status, saved_by=excluded.saved_by,
        saved_at=excluded.saved_at, validated_by=excluded.validated_by, validated_at=excluded.validated_at`,
      [req.pdvId, date, JSON.stringify(data), status, stamp, now, supervisor ? null : stamp, supervisor ? null : now]);
    res.json(dayOut(await db.get("SELECT * FROM days WHERE pdv_id = ? AND date = ?", [req.pdvId, date])));
  } catch (e) { next(e); }
});

r.post("/:pid/day/:date/validate", pdvGuard, async (req, res, next) => {
  try {
    if (!canValidate(req.user.role)) return res.status(403).json({ error: "Apenas gerente ou administrador podem validar." });
    const row = await db.get("SELECT * FROM days WHERE pdv_id = ? AND date = ?", [req.pdvId, req.params.date]);
    if (!row) return res.status(404).json({ error: "Dia não encontrado." });
    const stamp = JSON.stringify({ id: req.user.id, name: req.user.name, role: req.user.role });
    await db.run("UPDATE days SET status='validated', validated_by=?, validated_at=? WHERE pdv_id=? AND date=?", [stamp, nowISO(), req.pdvId, req.params.date]);
    res.json(dayOut(await db.get("SELECT * FROM days WHERE pdv_id = ? AND date = ?", [req.pdvId, req.params.date])));
  } catch (e) { next(e); }
});

r.get("/:pid/export", pdvGuard, async (req, res, next) => {
  try {
    const products = await db.get("SELECT items FROM products WHERE pdv_id = ?", [req.pdvId]);
    const days = await db.all("SELECT * FROM days WHERE pdv_id = ? ORDER BY date", [req.pdvId]);
    res.json({ _type: "parstock-pdv-backup", version: 1, exportedAt: nowISO(), products: products ? JSON.parse(products.items) : [], days: days.map(dayOut) });
  } catch (e) { next(e); }
});

r.post("/:pid/import", pdvGuard, async (req, res, next) => {
  try {
    if (!canValidate(req.user.role)) return res.status(403).json({ error: "Apenas gerente ou administrador podem importar." });
    const d = req.body || {};
    if (d._type !== "parstock-pdv-backup") return res.status(400).json({ error: "Arquivo de backup inválido." });
    await db.tx(async () => {
      await db.run("INSERT INTO products (pdv_id, items) VALUES (?, ?) ON CONFLICT(pdv_id) DO UPDATE SET items = excluded.items", [req.pdvId, JSON.stringify(d.products || [])]);
      for (const day of d.days || []) {
        const data = { time: day.time || "", resp: day.resp || "", items: day.items || {} };
        await db.run(`INSERT INTO days (pdv_id,date,data,status,saved_by,saved_at,validated_by,validated_at) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(pdv_id,date) DO UPDATE SET data=excluded.data,status=excluded.status,saved_by=excluded.saved_by,saved_at=excluded.saved_at,validated_by=excluded.validated_by,validated_at=excluded.validated_at`,
          [req.pdvId, day.date, JSON.stringify(data), day.status || "validated",
            day.savedBy ? JSON.stringify(day.savedBy) : null, day.savedAt || null,
            day.validatedBy ? JSON.stringify(day.validatedBy) : null, day.validatedAt || null]);
      }
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default r;
