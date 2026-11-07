import { Router } from "express";
import db from "../db.js";
import { issueToken } from "../auth.js";
import { verifyPassword, audit } from "../rbac.js";

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
const fails = new Map(); // IP -> { count, firstAt }
// Bitta login'ga turli IP'lardan terib ko'rish (yoki IP soxtalashtirish) uchun
// login nomi bo'yicha ham hisob: 15 daqiqada 10 xato -> 15 daqiqa blok.
const MAX_USER_FAILS = 10;
const userFails = new Map(); // username -> { count, firstAt }

// Muddati o'tgan yozuvlarni tozalaymiz (xotira o'sib ketmasin).
function prune(now) {
  for (const m of [fails, userFails]) {
    for (const [k, v] of m) {
      if (now - v.firstAt > WINDOW_MS) m.delete(k);
    }
  }
  // Favqulodda himoya: kimdir IP'larni soxtalashtirib to'ldirsa ham
  // xotira portlamasin.
  if (fails.size > 5000) fails.clear();
  if (userFails.size > 5000) userFails.clear();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SPA login/parol yuboradi. To'g'ri bo'lsa JWT token qaytaramiz; SPA uni
// saqlab, keyingi so'rovlarda Bearer sifatida yuboradi.
router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string" || !username) {
    return res.status(400).json({ error: "Login va parolni kiriting" });
  }

  const now = Date.now();
  prune(now);
  // Hisob IP bo'yicha: bitta IP'dan turli login'larni terib ko'rish ham cheklanadi.
  const key = req.clientIp;

  const uKey = username.trim().toLowerCase().slice(0, 64);
  const rec = fails.get(key);
  const uRec = userFails.get(uKey);
  if ((rec && rec.count >= MAX_FAILS) || (uRec && uRec.count >= MAX_USER_FAILS)) {
    return res.status(429).json({
      error: "Urinishlar ko'payib ketdi. 15 daqiqadan so'ng qayta urining.",
    });
  }

  const user = db
    .prepare("SELECT id, username, password_hash, active FROM users WHERE username = ?")
    .get(username.trim());
  const ok = verifyPassword(password, user?.password_hash);

  if (!ok || !user.active) {
    const r = fails.get(key) || { count: 0, firstAt: now };
    r.count++;
    fails.set(key, r);
    const u = userFails.get(uKey) || { count: 0, firstAt: now };
    u.count++;
    userFails.set(uKey, u);
    req.user = null;
    audit(req, "login.fail", { details: { username: username.slice(0, 64) } });
    await sleep(FAIL_DELAY_MS);
    return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
  }

  fails.delete(key);
  userFails.delete(uKey);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  req.user = { id: user.id, username: user.username };
  audit(req, "login");
  res.json({ token: issueToken(user.id) });
});

export default router;
