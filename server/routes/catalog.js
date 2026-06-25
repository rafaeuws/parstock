import { Router } from "express";
import { db, newId, nowISO } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { userRow, userHasHotel, canManagePdvs } from "../helpers.js";

const r = Router();
r.use(authRequired);

/* ---------- HOTÉIS ---------- */
r.get("/hotels", async (req, res, next) => {
  try {
    const user = await userRow(req.auth.id);
    const rows = await db.all("SELECT * FROM hotels ORDER BY name");
    const list = user.role === "admin" ? rows : rows.filter((h) => user.hotelIds.includes(h.id));
    res.json(list.map((h) => ({ id: h.id, name: h.name })));
  } catch (e) { next(e); }
});

r.post("/hotels", requireRole("admin"), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: "Informe o nome do hotel." });
    const id = newId();
    await db.run("INSERT INTO hotels (id,name,created_at) VALUES (?,?,?)", [id, name.trim(), nowISO()]);
    res.status(201).json({ id, name: name.trim() });
  } catch (e) { next(e); }
});

r.delete("/hotels/:id", requireRole("admin"), async (req, res, next) => {
  try { await db.run("DELETE FROM hotels WHERE id = ?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); }
});

/* ---------- PDVs ---------- */
r.get("/pdvs", async (req, res, next) => {
  try {
    const user = await userRow(req.auth.id);
    const hotelId = req.query.hotelId;
    if (!hotelId) return res.status(400).json({ error: "hotelId obrigatório." });
    if (!userHasHotel(user, hotelId)) return res.status(403).json({ error: "Sem acesso a este hotel." });
    const rows = await db.all("SELECT * FROM pdvs WHERE hotel_id = ? ORDER BY name", [hotelId]);
    const result = [];
    for (const p of rows) {
      let pending = 0;
      if (user.role === "admin" || user.role === "gerente") {
        const c = await db.get("SELECT COUNT(*) AS n FROM days WHERE pdv_id = ? AND status = 'pending'", [p.id]);
        pending = Number(c.n);
      }
      result.push({ id: p.id, hotelId: p.hotel_id, name: p.name, pending });
    }
    res.json(result);
  } catch (e) { next(e); }
});

r.post("/pdvs", async (req, res, next) => {
  try {
    const user = await userRow(req.auth.id);
    if (!canManagePdvs(user.role)) return res.status(403).json({ error: "Permissão insuficiente." });
    const { hotelId, name } = req.body || {};
    if (!hotelId || !name || !name.trim()) return res.status(400).json({ error: "Dados incompletos." });
    if (!userHasHotel(user, hotelId)) return res.status(403).json({ error: "Sem acesso a este hotel." });
    const hotel = await db.get("SELECT 1 AS x FROM hotels WHERE id = ?", [hotelId]);
    if (!hotel) return res.status(404).json({ error: "Hotel não encontrado." });
    const id = newId();
    await db.run("INSERT INTO pdvs (id,hotel_id,name,created_at) VALUES (?,?,?,?)", [id, hotelId, name.trim(), nowISO()]);
    res.status(201).json({ id, hotelId, name: name.trim(), pending: 0 });
  } catch (e) { next(e); }
});

r.delete("/pdvs/:id", requireRole("admin"), async (req, res, next) => {
  try { await db.run("DELETE FROM pdvs WHERE id = ?", [req.params.id]); res.json({ ok: true }); } catch (e) { next(e); }
});

export default r;
