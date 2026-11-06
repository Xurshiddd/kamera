import jwt from "jsonwebtoken";
import { loadUser, PERMISSIONS } from "./rbac.js";

const API_KEY = process.env.SERVICE_API_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
// Session tokeni qancha amal qiladi (soniya). Default 12 soat.
const TOKEN_TTL = Number(process.env.ADMIN_TOKEN_TTL_SECONDS || 12 * 60 * 60);

// --- Session (brauzer) ---
// SPA login/parol yuboradi, JWT token oladi va keyingi so'rovlarda
// "Authorization: Bearer <token>" yuboradi. Token ichida faqat user id —
// rollar/ruxsatlar har so'rovda DB'dan olinadi (o'zgarish darhol ta'sir qiladi,
// bloklangan foydalanuvchi darhol chiqariladi).

export function issueToken(userId) {
  return jwt.sign({ sub: String(userId) }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function userFromToken(token) {
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    return sub ? loadUser(Number(sub)) : null;
  } catch {
    return null;
  }
}

// Server-to-server (LMS) — x-api-key bilan to'liq huquq.
const API_KEY_USER = {
  id: null,
  username: "api-key",
  roles: ["api"],
  perms: new Set(Object.keys(PERMISSIONS)),
};

export function bearerToken(req) {
  const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// req.user ni aniqlaydi (yo'q bo'lsa null). Javob qaytarmaydi.
export function resolveUser(req) {
  if (req.user !== undefined) return req.user;
  const key = req.get("x-api-key");
  if (API_KEY && key === API_KEY) return (req.user = API_KEY_USER);
  const token = bearerToken(req);
  return (req.user = token ? userFromToken(token) : null);
}

export function requireAuth(req, res, next) {
  if (resolveUser(req)) return next();
  return res.status(401).json({ error: "Avtorizatsiya kerak" });
}

// Bir yoki bir nechta ruxsatdan BIRORTASI bo'lsa o'tkazadi.
export function requirePerm(...codes) {
  return (req, res, next) => {
    const user = resolveUser(req);
    if (!user) return res.status(401).json({ error: "Avtorizatsiya kerak" });
    if (codes.some((c) => user.perms.has(c))) return next();
    return res.status(403).json({ error: "Ruxsat yo'q" });
  };
}
