import { Router } from "express";
import db from "../db.js";
import { addPath, deletePath } from "../mediamtx.js";
import { requireAuth, issueStreamToken } from "../auth.js";

const router = Router();
const BASE = process.env.STREAM_BASE || "http://localhost:8888";
const DEFAULT_RTSP = process.env.DEFAULT_RTSP_PATH || "Streaming/Channels/101";

// Nomdan URL uchun xavfsiz slug yasaymiz.
function makeSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Bitta kamera uchun tashqi URL'larni yasaymiz (login/parolsiz, faqat slug).
function publicUrls(slug) {
  const token = issueStreamToken(slug);
  return {
    hls: `${BASE}/${slug}/index.m3u8?token=${token}`,
    webrtc: `${BASE}/${slug}/whep?token=${token}`,
    embed: `${BASE}/${slug}`,
  };
}

// Hamma kamerani ko'rsatish (parolsiz).
router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, name, slug, ip, port, created_at FROM cameras ORDER BY id DESC")
    .all();
  res.json(rows.map((r) => ({ ...r, ...publicUrls(r.slug) })));
});

// Yangi kamera qo'shish.
router.post("/", requireAuth, async (req, res) => {
  const { name, ip, port = 554, login, parol, rtspPath } = req.body || {};
  if (!name || !ip || !login || !parol) {
    return res.status(400).json({ error: "name, ip, login, parol majburiy" });
  }

  const slug = makeSlug(name);
  if (!slug) return res.status(400).json({ error: "Nom noto'g'ri" });

  const exists = db.prepare("SELECT 1 FROM cameras WHERE slug = ?").get(slug);
  if (exists) return res.status(409).json({ error: "Bu nomli kamera bor" });

  const camera = {
    name,
    slug,
    ip,
    port: Number(port),
    login,
    parol,
    rtsp_path: rtspPath || DEFAULT_RTSP,
  };

  try {
    await addPath(camera); // avval MediaMTX, keyin DB
  } catch (e) {
    return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
  }

  const info = db
    .prepare(
      `INSERT INTO cameras (name, slug, ip, port, login, parol, rtsp_path)
       VALUES (@name, @slug, @ip, @port, @login, @parol, @rtsp_path)`
    )
    .run(camera);

  res.status(201).json({ id: info.lastInsertRowid, name, slug, ...publicUrls(slug) });
});

// Bitta kamera uchun yangi (yangilangan) tomosha tokeni — eski muddati tugaganda.
router.get("/:slug/token", requireAuth, (req, res) => {
  const row = db.prepare("SELECT slug FROM cameras WHERE slug = ?").get(req.params.slug);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  res.json(publicUrls(row.slug));
});

// Kamerani o'chirish.
router.delete("/:id", requireAuth, async (req, res) => {
  const row = db.prepare("SELECT slug FROM cameras WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });

  await deletePath(row.slug);
  db.prepare("DELETE FROM cameras WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
