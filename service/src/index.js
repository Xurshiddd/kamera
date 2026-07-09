import "dotenv/config";
import express from "express";
import cors from "cors";

import camerasRouter from "./routes/cameras.js";
import streamAuthRouter from "./routes/streamAuth.js";
import loginRouter from "./routes/login.js";
import { syncCameras } from "./syncCameras.js";

const app = express();
app.use(express.json());

// Admin SPA gateway orqali same-origin keladi — CORS aslida kerak emas.
// Ochiq qoldiramiz: tashqi backend (LMS) API kalit bilan to'g'ridan chaqirsa
// ham ishlasin; himoya baribir auth'da (Bearer token / x-api-key).
app.use(cors());

// Gateway /api/* ni prefiksi bilan uzatadi, shuning uchun health ham /api ostida.
app.get("/api/health", (req, res) => res.json({ ok: true }));

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
