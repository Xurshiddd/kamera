import { Router } from "express";
import db from "../db.js";
import { addPath, deletePath, probeCodec } from "../mediamtx.js";
import { requireAuth } from "../auth.js";

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

// Kameraning tashqi HLS URL'i. Ko'rish ochiq (statik fayllar), shuning uchun
// token KERAK EMAS — URL toza va boshqa saytga qo'yilganda muddatsiz ishlaydi.
function publicUrls(slug) {
  return { hls: `${BASE}/${slug}/index.m3u8` };
}

// Hamma kamerani ko'rsatish (parolsiz).
router.get("/", requireAuth, (req, res) => {
  const rows = db
    .prepare("SELECT id, name, slug, ip, port, codec, created_at FROM cameras ORDER BY id DESC")
    .all();
  res.json(rows.map((r) => ({ ...r, ...publicUrls(r.slug) })));
});

// Bitta kamera — tahrirlash formasi uchun (parol QAYTARILMAYDI).
router.get("/:id(\\d+)", requireAuth, (req, res) => {
  const row = db
    .prepare("SELECT id, name, slug, ip, port, login, rtsp_path, codec FROM cameras WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  res.json({ ...row, ...publicUrls(row.slug) });
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
    codec: null,
  };

  // Kamera H264 mi H265 mi? H264 bo'lsa transkod qilinmaydi (CPU tejaladi).
  // Aniqlanmasa (null) — xavfsiz tanlov sifatida transkod qilinadi.
  camera.codec = await probeCodec(camera);

  try {
    await addPath(camera); // avval MediaMTX, keyin DB
  } catch (e) {
    return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
  }

  const info = db
    .prepare(
      `INSERT INTO cameras (name, slug, ip, port, login, parol, rtsp_path, codec)
       VALUES (@name, @slug, @ip, @port, @login, @parol, @rtsp_path, @codec)`
    )
    .run(camera);

  res
    .status(201)
    .json({ id: info.lastInsertRowid, name, slug, codec: camera.codec, ...publicUrls(slug) });
});

// Kamerani tahrirlash. Slug (demak HLS URL) O'ZGARMAYDI — boshqa saytlarga
// qo'yilgan embed'lar buzilmasligi uchun. Parol bo'sh kelsa eskisi qoladi.
router.put("/:id(\\d+)", requireAuth, async (req, res) => {
  const row = db.prepare("SELECT * FROM cameras WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });

  const { name, ip, port, login, parol, rtspPath } = req.body || {};
  const camera = {
    ...row,
    name: name || row.name,
    ip: ip || row.ip,
    port: Number(port || row.port),
    login: login || row.login,
    parol: parol || row.parol,
    rtsp_path: rtspPath || row.rtsp_path,
  };

  // Avval eski ffmpeg'ni to'xtatamiz — kamera ulanishi bo'shasin (ko'p
  // kameralar bir vaqtda 1-2 ta RTSP mijozgagina ruxsat beradi), keyin
  // kodekni qayta aniqlaymiz (IP/oqim o'zgargan bo'lishi mumkin).
  await deletePath(row.slug);
  await new Promise((r) => setTimeout(r, 1500));
  camera.codec = await probeCodec(camera);

  try {
    await addPath(camera);
  } catch (e) {
    return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
  }

  db.prepare(
    `UPDATE cameras SET name=@name, ip=@ip, port=@port, login=@login,
       parol=@parol, rtsp_path=@rtsp_path, codec=@codec WHERE id=@id`
  ).run(camera);

  res.json({
    id: row.id,
    name: camera.name,
    slug: camera.slug,
    codec: camera.codec,
    ...publicUrls(camera.slug),
  });
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
