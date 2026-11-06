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
const fails = new Map(); // key -> { count, firstAt }

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

  const rec = fails.get(key);
  if (rec && rec.count >= MAX_FAILS) {
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
    req.user = null;
    audit(req, "login.fail", { details: { username: username.slice(0, 64) } });
    await sleep(FAIL_DELAY_MS);
    return res.status(401).json({ error: "Login yoki parol noto'g'ri" });
  }

  fails.delete(key);
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  req.user = { id: user.id, username: user.username };
  audit(req, "login");
  res.json({ token: issueToken(user.id) });
});

export default router;
