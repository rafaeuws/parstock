import "dotenv/config";
import express from "express";
import helmet from "helmet";
import compression from "compression";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { db, initSchema, seedAdmin } from "./db.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import catalogRoutes from "./routes/catalog.js";
import daysRoutes from "./routes/days.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.warn("=".repeat(72));
  console.warn("[ATENÇÃO] Sem DATABASE_URL — usando SQLite em arquivo local.");
  console.warn("Em nuvem (Render/Railway/etc.) o disco é efêmero: os DADOS SERÃO PERDIDOS");
  console.warn("quando o serviço reiniciar ou dormir. Defina DATABASE_URL (PostgreSQL).");
  console.warn("=".repeat(72));
}
await initSchema();
await seedAdmin();

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "8mb" }));

const origins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));

// limite de tentativas de login
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." } });
app.use("/api/login", loginLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true, db: db.kind, time: new Date().toISOString() }));
app.use("/api", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api", catalogRoutes);
app.use("/api/pdvs", daysRoutes);

// ---- arquivos estáticos do front-end (build do Vite) ----
const publicDir = path.join(__dirname, "public");
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
} else {
  app.get("/", (req, res) => res.send("API do Par Stock ativa. Rode 'npm run build' para gerar a interface."));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

app.listen(PORT, () => console.log(`[par-stock] servidor rodando na porta ${PORT}`));
