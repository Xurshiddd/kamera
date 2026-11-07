import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import db from "./db.js";
import { loadUser, PERMISSIONS } from "./rbac.js";

const JWT_SECRET = process.env.JWT_SECRET || "";
// Zaif/bo'sh kalit bilan ishga tushmaymiz — token soxtalashtirilishi mumkin.
if (JWT_SECRET.length < 32) {
  console.error("[auth] JWT_SECRET kamida 32 belgi boʻlishi shart (openssl rand -base64 32). Toʻxtatildi.");
  process.exit(1);
}
// API kalit: qisqa bo'lsa umuman o'chiriladi (taxmin qilinmasin).
let API_KEY = process.env.SERVICE_API_KEY || "";
if (API_KEY && API_KEY.length < 24) {
  console.error("[auth] SERVICE_API_KEY 24 belgidan qisqa — x-api-key oʻchirildi.");
  API_KEY = "";
}
const API_KEY_BUF = Buffer.from(API_KEY);
const keyMatches = (key) => {
  if (!API_KEY || typeof key !== "string") return false;
  const b = Buffer.from(key);
  return b.length === API_KEY_BUF.length && crypto.timingSafeEqual(b, API_KEY_BUF);
};
// Session tokeni qancha amal qiladi (soniya). Default 12 soat.
const TOKEN_TTL = Number(process.env.ADMIN_TOKEN_TTL_SECONDS || 12 * 60 * 60);

// --- Session (brauzer) ---
// SPA login/parol yuboradi, JWT token oladi va keyingi so'rovlarda
// "Authorization: Bearer <token>" yuboradi. Token ichida faqat user id —
// rollar/ruxsatlar har so'rovda DB'dan olinadi (o'zgarish darhol ta'sir qiladi,
// bloklangan foydalanuvchi darhol chiqariladi).

const tokenVersion = (userId) =>
  db.prepare("SELECT token_version AS v FROM users WHERE id = ?").get(userId)?.v ?? 0;

export function issueToken(userId) {
  return jwt.sign({ sub: String(userId), tv: tokenVersion(userId) }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: TOKEN_TTL,
  });
}

// Parol almashganda: foydalanuvchining BARCHA eski tokenlari bekor bo'ladi.
export function revokeTokens(userId) {
  db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?").run(userId);
}

function userFromToken(token) {
  try {
    const { sub, tv } = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (!sub || (tv ?? 0) !== tokenVersion(Number(sub))) return null;
    return loadUser(Number(sub));
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

function bearerToken(req) {
  const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// req.user ni aniqlaydi (yo'q bo'lsa null). Javob qaytarmaydi.
export function resolveUser(req) {
  if (req.user !== undefined) return req.user;
  const key = req.get("x-api-key");
  if (keyMatches(key)) return (req.user = API_KEY_USER);
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
