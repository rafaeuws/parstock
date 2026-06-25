import { Router } from "express";
import { db, newId, nowISO } from "../db.js";
import { authRequired, requireRole } from "../auth.js";
import { userRow, userHasHotel, canManagePdvs } from "../helpers.js";

const r = Router();
r.use(authRequired);

/* ---------- HOTÉIS ---------- */
r.get("/hotels", (req, res) => {
  const user = userRow(req.auth.id);
  const rows = db.prepare("SELECT * FROM hotels ORDER BY name COLLATE NOCASE").all();
  const list = user.role === "admin" ? rows : rows.filter((h) => user.hotelIds.includes(h.id));
  res.json(list.map((h) => ({ id: h.id, name: h.name })));
});

r.post("/hotels", requireRole("admin"), (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Informe o nome do hotel." });
  const id = newId();
  db.prepare("INSERT INTO hotels (id,name,created_at) VALUES (?,?,?)").run(id, name.trim(), nowISO());
  res.status(201).json({ id, name: name.trim() });
});

r.delete("/hotels/:id", requireRole("admin"), (req, res) => {
  db.prepare("DELETE FROM hotels WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

/* ---------- PDVs ---------- */
r.get("/pdvs", (req, res) => {
  const user = userRow(req.auth.id);
  const hotelId = req.query.hotelId;
  if (!hotelId) return res.status(400).json({ error: "hotelId obrigatório." });
  if (!userHasHotel(user, hotelId)) return res.status(403).json({ error: "Sem acesso a este hotel." });
  const rows = db.prepare("SELECT * FROM pdvs WHERE hotel_id = ? ORDER BY name COLLATE NOCASE").all(hotelId);
  // contagem de pendências (para quem valida)
  const withPend = rows.map((p) => {
    let pending = 0;
    if (user.role === "admin" || user.role === "gerente") {
      pending = db.prepare("SELECT COUNT(*) AS n FROM days WHERE pdv_id = ? AND status = 'pending'").get(p.id).n;
    }
    return { id: p.id, hotelId: p.hotel_id, name: p.name, pending };
  });
  res.json(withPend);
});

r.post("/pdvs", (req, res) => {
  const user = userRow(req.auth.id);
  if (!canManagePdvs(user.role)) return res.status(403).json({ error: "Permissão insuficiente." });
  const { hotelId, name } = req.body || {};
  if (!hotelId || !name || !name.trim()) return res.status(400).json({ error: "Dados incompletos." });
  if (!userHasHotel(user, hotelId)) return res.status(403).json({ error: "Sem acesso a este hotel." });
  const hotel = db.prepare("SELECT 1 FROM hotels WHERE id = ?").get(hotelId);
  if (!hotel) return res.status(404).json({ error: "Hotel não encontrado." });
  const id = newId();
  db.prepare("INSERT INTO pdvs (id,hotel_id,name,created_at) VALUES (?,?,?,?)").run(id, hotelId, name.trim(), nowISO());
  res.status(201).json({ id, hotelId, name: name.trim(), pending: 0 });
});

r.delete("/pdvs/:id", requireRole("admin"), (req, res) => {
  db.prepare("DELETE FROM pdvs WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default r;
