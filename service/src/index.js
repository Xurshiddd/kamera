import "dotenv/config";
import express from "express";
import cors from "cors";

import camerasRouter from "./routes/cameras.js";
import streamAuthRouter from "./routes/streamAuth.js";
import loginRouter from "./routes/login.js";
import { syncCameras } from "./syncCameras.js";

const app = express();
app.use(express.json());

// Admin static SPA boshqa manzilda (boshqa IP/domen) turadi va brauzerdan
// to'g'ridan shu service'ga ulanadi. ADMIN_ORIGIN'da ruxsat etilgan
// manzillarni vergul bilan sanab bering (masalan: http://192.168.1.50/admin).
// Bo'sh bo'lsa (dev) — hamma origin'ga ruxsat.
const ORIGINS = (process.env.ADMIN_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(cors({ origin: ORIGINS.length ? ORIGINS : true }));

app.get("/health", (req, res) => res.json({ ok: true }));

// MediaMTX'ning auth-callback'i (himoya tokenda, API kalitda emas)
app.use("/api", streamAuthRouter);

// Brauzerdagi admin SPA uchun parol-login (JWT token qaytaradi)
app.use("/api", loginRouter);

// Admin panel ishlatadigan kamera API'si (Bearer token yoki API kalit bilan)
app.use("/api/cameras", camerasRouter);

const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, async () => {
  console.log(`[service] http://0.0.0.0:${PORT} da ishlamoqda`);
  await syncCameras(); // startup'da DB -> MediaMTX
});
