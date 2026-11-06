import { Router } from "express";
import db from "../db.js";
import { DISPLAY_ORDER } from "./cameras.js";

const router = Router();
const BASE = process.env.STREAM_BASE || "http://localhost:8888";

// Mehmon (guest) sahifasi uchun OCHIQ ro'yxat — auth yo'q. Faqat ko'rish uchun
// kerak bo'lgan maydonlar qaytadi: ip/port/login/parol kabi sirlar CHIQMAYDI.
// HLS'ning o'zi allaqachon ochiq statik fayl, shuning uchun bu ro'yxat ham
// maxfiy ma'lumot ochmaydi.
router.get("/public/cameras", (req, res) => {
  const rows = db
    .prepare(`SELECT id, name, slug FROM cameras WHERE is_public = 1
       ORDER BY ${DISPLAY_ORDER}`)
    .all();
  res.json(
    rows.map((r) => ({ ...r, hls: `${BASE}/${r.slug}/index.m3u8` }))
  );
});

export default router;
