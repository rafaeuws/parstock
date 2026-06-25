const TOKEN_KEY = "parstock.token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); };

async function req(path, { method = "GET", body } = {}) {
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", ...(getToken() ? { Authorization: "Bearer " + getToken() } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || "Erro de comunicação com o servidor.");
    err.status = res.status;
    if (res.status === 401 && getToken()) { setToken(null); }
    throw err;
  }
  return data;
}

export const api = {
  login: (login, password) => req("/login", { method: "POST", body: { login, password } }),
  me: () => req("/me"),
  changePassword: (currentPassword, newPassword) => req("/change-password", { method: "POST", body: { currentPassword, newPassword } }),

  listUsers: () => req("/users"),
  createUser: (u) => req("/users", { method: "POST", body: u }),
  updateUser: (id, u) => req("/users/" + id, { method: "PUT", body: u }),
  deleteUser: (id) => req("/users/" + id, { method: "DELETE" }),

  listHotels: () => req("/hotels"),
  createHotel: (name) => req("/hotels", { method: "POST", body: { name } }),
  deleteHotel: (id) => req("/hotels/" + id, { method: "DELETE" }),

  listPdvs: (hotelId) => req("/pdvs?hotelId=" + encodeURIComponent(hotelId)),
  createPdv: (hotelId, name) => req("/pdvs", { method: "POST", body: { hotelId, name } }),
  deletePdv: (id) => req("/pdvs/" + id, { method: "DELETE" }),

  getProducts: (pid) => req("/pdvs/" + pid + "/products"),
  saveProducts: (pid, items) => req("/pdvs/" + pid + "/products", { method: "PUT", body: items }),
  getIndex: (pid) => req("/pdvs/" + pid + "/index"),
  getDays: (pid, from, to) => req("/pdvs/" + pid + "/days" + (from && to ? `?from=${from}&to=${to}` : "")),
  getDay: (pid, date) => req("/pdvs/" + pid + "/day/" + date),
  saveDay: (pid, date, rec) => req("/pdvs/" + pid + "/day/" + date, { method: "PUT", body: rec }),
  validateDay: (pid, date) => req("/pdvs/" + pid + "/day/" + date + "/validate", { method: "POST" }),
  exportPdv: (pid) => req("/pdvs/" + pid + "/export"),
  importPdv: (pid, dump) => req("/pdvs/" + pid + "/import", { method: "POST", body: dump }),
};
