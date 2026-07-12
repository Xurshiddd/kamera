import { Router } from "express";
import { checkAdminPassword, issueAdminToken } from "../auth.js";

const router = Router();

// =============================================================================
//  Brute-force himoyasi (xotirada, tashqi kutubxonasiz).
//
//  Har bir mijoz (IP) uchun: 15 daqiqa ichida 5 ta xato urinish -> shu IP
//  15 daqiqaga bloklanadi. Har xato urinishga ~0.7s sun'iy kechikish ham
//  qo'shiladi — parol terib ko'rish (dictionary attack) amalda foydasiz
//  bo'lib qoladi. Muvaffaqiyatli kirish hisobni nolga qaytaradi.
// =============================================================================
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const FAIL_DELAY_MS = 700;
const fails = new Map(); // key -> { count, firstAt }

// Mijoz IP'sini aniqlash. Zanjir: mijoz -> Hestia -> gateway -> service.
// Hestia haqiqiy mijoz IP'sini XFF oxiriga qo'shadi, gateway esa Hestia
// IP'sini qo'shadi -> haqiqiy mijoz OXIRIDAN BITTA OLDINGI element.
// (Mijoz o'zi soxta XFF yuborsa u ro'yxat BOSHIGA tushadi — ta'sir qilmaydi.)
function clientKey(req) {
  const xff = (req.get("x-forwarded-for") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (xff.length >= 2) return xff[xff.length - 2];
  return xff[0] || req.socket.remoteAddress || "nomalum";
}

// Muddati o'tgan yozuvlarni tozalaymiz (xotira o'sib ketmasin).
function prune(now) {
  for (const [k, v] of fails) {
    if (now - v.firstAt > WINDOW_MS) fails.delete(k);
  }
  // Favqulodda himoya: kimdir IP'larni soxtalashtirib to'ldirsa ham
  // xotira portlamasin.
  if (fails.size > 5000) fails.clear();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Brauzerdagi admin SPA shu yerga parol yuboradi. To'g'ri bo'lsa JWT token
// qaytaramiz; SPA uni saqlab, keyingi so'rovlarda Bearer sifatida yuboradi.
router.post("/login", async (req, res) => {
  const { password } = req.body || {};
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Serverda ADMIN_PASSWORD sozlanmagan" });
  }

  const now = Date.now();
  prune(now);
  const key = clientKey(req);

  const rec = fails.get(key);
  if (rec && rec.count >= MAX_FAILS) {
    return res.status(429).json({
      error: "Urinishlar ko'payib ketdi. 15 daqiqadan so'ng qayta urining.",
    });
  }

  if (!checkAdminPassword(password)) {
    const r = fails.get(key) || { count: 0, firstAt: now };
    r.count++;
    fails.set(key, r);
    await sleep(FAIL_DELAY_MS);
    return res.status(401).json({ error: "Noto'g'ri parol" });
  }

  fails.delete(key);
  res.json({ token: issueAdminToken() });
});

export default router;
