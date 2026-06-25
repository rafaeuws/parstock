import { db } from "./db.js";

export const todayISO = () => new Date().toLocaleDateString("en-CA");

export function userRow(id) {
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!u) return null;
  return {
    id: u.id, name: u.name, login: u.login, role: u.role,
    hotelIds: JSON.parse(u.hotel_ids || "[]"),
    mustChange: !!u.must_change,
  };
}

export const publicUser = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, hotelIds: u.hotelIds, mustChange: u.mustChange });

// papel pode acessar um hotel?
export function userHasHotel(user, hotelId) {
  if (user.role === "admin") return true;
  return (user.hotelIds || []).includes(hotelId);
}

// papel pode acessar um PDV (via hotel do PDV)?
export function userHasPdv(user, pdvId) {
  const pdv = db.prepare("SELECT hotel_id FROM pdvs WHERE id = ?").get(pdvId);
  if (!pdv) return false;
  return userHasHotel(user, pdv.hotel_id);
}

export const canValidate = (role) => role === "admin" || role === "gerente";
export const canEditRetroactive = (role) => role === "admin" || role === "gerente";
export const canManagePdvs = (role) => role === "admin" || role === "gerente";
