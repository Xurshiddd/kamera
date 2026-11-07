import { Router } from "express";
import db from "../db.js";
import { resolveUser } from "../auth.js";
import { canAccessCamera } from "../rbac.js";

// =============================================================================
//  /hls/ (jonli oqim) uchun ruxsat — nginx `auth_request` har bir playlist va
//  segment so'rovida shu yerga so'raydi (ichki; tashqaridan yopiq).
//
//  - Ochiq (is_public) kamera: hammaga ruxsat (mehmon sahifasi, LMS embed).
//  - Yopiq kamera: faqat Bearer token bilan, `live.view` + shu kameraga ruxsat
//    yoki `cameras.manage` bo'lsa.
//  Javob: 204 ruxsat | 401 login kerak | 403 ruxsat yo'q.
// =============================================================================

const router = Router();

// slug -> { id, is_public } keshi: so'rovlar ko'p (har 2 s da har tomoshabin).
let cache = new Map();
let cachedAt = 0;
function cameraBySlug(slug) {
  if (Date.now() - cachedAt > 10000) {
    cache = new Map(
      db.prepare("SELECT id, slug, is_public FROM cameras").all().map((c) => [c.slug, c])
    );
    cachedAt = Date.now();
  }
  return cache.get(slug);
}

router.get("/hls-auth", (req, res) => {
  const uri = String(req.get("x-original-uri") || "");
  const m = uri.match(/^\/hls\/([^/?#]+)\//);
  const cam = m && cameraBySlug(decodeURIComponent(m[1]));
  if (!cam) return res.sendStatus(403);
  if (cam.is_public) return res.sendStatus(204);

  const user = resolveUser(req);
  if (!user) return res.sendStatus(401);
  const ok =
    user.perms.has("cameras.manage") || (user.perms.has("live.view") && canAccessCamera(user, cam.id));
  res.sendStatus(ok ? 204 : 403);
});

export default router;
