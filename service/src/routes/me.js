import { Router } from "express";
import db from "../db.js";
import { requireAuth, revokeTokens, issueToken } from "../auth.js";
import { allowedCameraIds, hashPassword, verifyPassword, audit } from "../rbac.js";
import { DISPLAY_ORDER } from "./cameras.js";

const router = Router();
const BASE = process.env.STREAM_BASE || "http://localhost:8888";

// Joriy foydalanuvchi: profil, rollar, ruxsatlar. SPA menyu va sahifalarni
// shunga qarab ko'rsatadi (haqiqiy tekshiruv baribir har API'da).
router.get("/me", requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id,
    username: u.username,
    full_name: u.full_name || null,
    roles: u.roles,
    permissions: [...u.perms],
  });
});

// Foydalanuvchi ko'ra oladigan kameralar (jonli/playback sahifalari uchun).
// Sirlar (ip/login/parol) qaytmaydi.
router.get("/me/cameras", requireAuth, (req, res) => {
  const ids = allowedCameraIds(req.user);
  const rows = db
    .prepare(
      `SELECT id, name, slug, is_public, nvr_id IS NOT NULL AS has_nvr
       FROM cameras ORDER BY ${DISPLAY_ORDER}`
    )
    .all()
    .filter((r) => ids === null || ids.has(r.id));
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      is_public: Boolean(r.is_public),
      playback: Boolean(r.has_nvr),
      hls: `${BASE}/${r.slug}/index.m3u8`,
    }))
  );
});

// O'z parolini almashtirish.
router.post("/me/password", requireAuth, (req, res) => {
  if (!req.user.id) return res.status(400).json({ error: "API kalit uchun emas" });
  const { current, next } = req.body || {};
  if (typeof next !== "string" || next.length < 8) {
    return res.status(400).json({ error: "Yangi parol kamida 8 belgi" });
  }
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!verifyPassword(current, row?.password_hash)) {
    return res.status(400).json({ error: "Joriy parol noto'g'ri" });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(next),
    req.user.id
  );
  // Boshqa qurilmalardagi (yoki o'g'irlangan) eski tokenlar bekor qilinadi;
  // shu brauzer yangi token bilan davom etadi.
  revokeTokens(req.user.id);
  audit(req, "me.password");
  res.json({ ok: true, token: issueToken(req.user.id) });
});

export default router;
