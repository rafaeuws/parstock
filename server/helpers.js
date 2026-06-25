import { db } from "./db.js";

export const todayISO = () => new Date().toLocaleDateString("en-CA");

export async function userRow(id) {
  const u = await db.get("SELECT * FROM users WHERE id = ?", [id]);
  if (!u) return null;
  return { id: u.id, name: u.name, login: u.login, role: u.role, hotelIds: JSON.parse(u.hotel_ids || "[]"), mustChange: !!Number(u.must_change) };
}

export const publicUser = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role, hotelIds: u.hotelIds, mustChange: u.mustChange });

export function userHasHotel(user, hotelId) {
  if (user.role === "admin") return true;
  return (user.hotelIds || []).includes(hotelId);
}

export async function userHasPdv(user, pdvId) {
  const pdv = await db.get("SELECT hotel_id FROM pdvs WHERE id = ?", [pdvId]);
  if (!pdv) return false;
  return userHasHotel(user, pdv.hotel_id);
}

export const canValidate = (role) => role === "admin" || role === "gerente";
export const canEditRetroactive = (role) => role === "admin" || role === "gerente";
export const canManagePdvs = (role) => role === "admin" || role === "gerente";
