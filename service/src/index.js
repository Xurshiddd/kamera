import "dotenv/config";
import express from "express";
import cors from "cors";

import camerasRouter from "./routes/cameras.js";
import streamAuthRouter from "./routes/streamAuth.js";
import { syncCameras } from "./syncCameras.js";

const app = express();
app.use(express.json());

// Admin panel boshqa manzilda (boshqa IP/domen) tursa ham ulana olsin.
// Ishlab chiqarishda origin'ni aniq admin domeniga cheklang.
app.use(cors());

app.get("/health", (req, res) => res.json({ ok: true }));

// MediaMTX'ning auth-callback'i (himoya tokenda, API kalitda emas)
app.use("/api", streamAuthRouter);

// Admin panel ishlatadigan kamera API'si (API kalit bilan himoyalangan)
app.use("/api/cameras", camerasRouter);

const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, async () => {
  console.log(`[service] http://0.0.0.0:${PORT} da ishlamoqda`);
  await syncCameras(); // startup'da DB -> MediaMTX
});
