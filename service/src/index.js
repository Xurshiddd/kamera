import "dotenv/config";
import express from "express";
import cors from "cors";

import camerasRouter from "./routes/cameras.js";
import publicRouter from "./routes/public.js";
import streamAuthRouter from "./routes/streamAuth.js";
import hlsAuthRouter from "./routes/hlsAuth.js";
import loginRouter from "./routes/login.js";
import statusRouter from "./routes/status.js";
import meRouter from "./routes/me.js";
import usersRouter from "./routes/users.js";
import rolesRouter from "./routes/roles.js";
import groupsRouter from "./routes/groups.js";
import auditRouter from "./routes/audit.js";
import nvrsRouter from "./routes/nvrs.js";
import liveRouter from "./routes/live.js";
import playbackRouter from "./routes/playback.js";
import { syncCameras } from "./syncCameras.js";
import { seedRbac } from "./rbac.js";
import { clientIpMiddleware } from "./clientIp.js";

// Ruxsatlar katalogi, tizim rollari va birinchi superadmin.
seedRbac();

const app = express();
app.disable("x-powered-by"); // texnologiya nomini oshkor qilmaymiz
// Body kichik JSON'lardan iborat (login, kamera CRUD) — katta payload DoS'iga
// yo'l qo'ymaslik uchun chegara.
app.use(express.json({ limit: "16kb" }));
app.use(clientIpMiddleware);

// Admin SPA gateway orqali same-origin keladi — CORS aslida kerak emas.
// Ochiq qoldiramiz: tashqi backend (LMS) API kalit bilan to'g'ridan chaqirsa
// ham ishlasin; himoya baribir auth'da (Bearer token / x-api-key).
app.use(cors());

// Gateway /api/* ni prefiksi bilan uzatadi, shuning uchun health ham /api ostida.
app.get("/api/health", (req, res) => res.json({ ok: true }));

// MediaMTX'ning auth-callback'i (himoya tokenda, API kalitda emas)
app.use("/api", streamAuthRouter);

// nginx auth_request: yopiq kameralarning /hls/ oqimi faqat ruxsati borlarga
app.use("/api", hlsAuthRouter);

// Login/parol -> JWT token
app.use("/api", loginRouter);

// Joriy foydalanuvchi, uning kameralari, parolni almashtirish
app.use("/api", meRouter);

// Boshqaruv: foydalanuvchilar, rollar/ruxsatlar, kamera guruhlari, audit
app.use("/api/users", usersRouter);
app.use("/api", rolesRouter); // /api/roles, /api/permissions
app.use("/api/groups", groupsRouter);
app.use("/api/audit", auditRouter);
app.use("/api/nvrs", nvrsRouter);

// Jonli efir heartbeat (NVR kameralari so'rov bo'yicha yoqiladi)
app.use("/api", liveRouter);

// Yozuvlarni qayta ko'rish va qirqib yuklab olish (NVR)
app.use("/api", playbackRouter);

// Mehmon (guest) sahifasi uchun ochiq kamera ro'yxati — auth'siz
app.use("/api", publicRouter);

// Server holati (uptime, RAM, disk, oqimlar) — admin sahifasi uchun
app.use("/api", statusRouter);

// Admin panel ishlatadigan kamera API'si (Bearer token yoki API kalit bilan)
app.use("/api/cameras", camerasRouter);

const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, async () => {
  console.log(`[service] http://0.0.0.0:${PORT} da ishlamoqda`);
  await syncCameras(); // startup'da DB -> MediaMTX
});
