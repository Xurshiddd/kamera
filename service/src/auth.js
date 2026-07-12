import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const API_KEY = process.env.SERVICE_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Admin (brauzer) session tokeni qancha amal qiladi (soniya). Default 12 soat.
const ADMIN_TTL = Number(process.env.ADMIN_TOKEN_TTL_SECONDS || 12 * 60 * 60);

// --- Admin (brauzer) login ---
// Static SPA serverda ishlamaydi, shuning uchun parol tekshiruvi va session
// shu yerda (service'da) bo'ladi. SPA parolni yuboradi, JWT token oladi va
// keyingi so'rovlarda "Authorization: Bearer <token>" yuboradi.

// Doimiy vaqtli (timing-safe) taqqoslash: oddiy === har bir belgi mos kelganda
// biroz sekinroq ishlaydi va parolni belgima-belgi topishga yo'l ochadi.
// Ikkala qiymatni sha256 ga o'tkazish uzunlikni tenglashtiradi.
export function checkAdminPassword(password) {
  if (!ADMIN_PASSWORD || typeof password !== "string") return false;
  const a = crypto.createHash("sha256").update(password).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

export function issueAdminToken() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: ADMIN_TTL });
}

function verifyAdminToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET).role === "admin";
  } catch {
    return false;
  }
}

// Kamera route'lari uchun: x-api-key (server-to-server) YOKI admin Bearer
// tokeni (brauzerdagi SPA) qabul qilinadi.
export function requireAuth(req, res, next) {
  const key = req.get("x-api-key");
  if (API_KEY && key === API_KEY) return next();

  const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (m && verifyAdminToken(m[1])) return next();

  return res.status(401).json({ error: "Avtorizatsiya kerak" });
}
