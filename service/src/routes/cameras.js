import { Router } from "express";
import db from "../db.js";
import { addPath, deletePath, probeCodec } from "../mediamtx.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";
import { isOnDemand, stopLive } from "../live.js";

const router = Router();
const BASE = process.env.STREAM_BASE || "http://localhost:8888";
const DEFAULT_RTSP = process.env.DEFAULT_RTSP_PATH || "Streaming/Channels/101";

// Nomdan URL uchun xavfsiz slug yasaymiz.
export function makeSlug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Kameraning tashqi HLS URL'i.
function publicUrls(slug) {
  return { hls: `${BASE}/${slug}/index.m3u8` };
}

// Ko'rsatish tartibi: bo'sh/noto'g'ri qiymat -> NULL (tartibsiz).
function normalizeOrder(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Yagona ko'rsatish tartibi (admin ham, mehmon ham shu tartibda ko'radi):
// avval sort_order berilganlar (o'sish bo'yicha), keyin NULL'lar (id bo'yicha).
export const DISPLAY_ORDER = "(sort_order IS NULL), sort_order, id";

// DB qatori -> API javobi (login/parol CHIQMAYDI).
function toApi(r) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    codec: r.codec,
    order: r.sort_order,
    is_public: Boolean(r.is_public),
    nvr_id: r.nvr_id ?? null,
    nvr_name: r.nvr_name ?? null,
    channel: r.channel ?? null,
    stream: r.stream || "main",
    // NVR'siz kamera maydonlari
    ip: r.nvr_id ? null : r.ip,
    port: r.nvr_id ? null : r.port,
    created_at: r.created_at,
    ...publicUrls(r.slug),
  };
}

const SELECT = `SELECT c.*, n.name AS nvr_name FROM cameras c LEFT JOIN nvrs n ON n.id = c.nvr_id`;

router.get("/", requirePerm("cameras.manage"), (req, res) => {
  const rows = db
    .prepare(`${SELECT} ORDER BY (c.sort_order IS NULL), c.sort_order, c.id`)
    .all();
  res.json(rows.map(toApi));
});

// Bitta kamera — tahrirlash formasi uchun (parol QAYTARILMAYDI).
router.get("/:id(\\d+)", requirePerm("cameras.manage"), (req, res) => {
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  res.json({
    ...toApi(row),
    login: row.nvr_id ? null : row.login,
    rtsp_path: row.nvr_id ? null : row.rtsp_path,
  });
});

// NVR + kanal maydonlarini tekshirish. Xato bo'lsa matn qaytaradi.
function nvrFields(body) {
  const nvrId = Number(body.nvrId);
  const channel = Number(body.channel);
  if (!db.prepare("SELECT 1 FROM nvrs WHERE id = ?").get(nvrId)) return { error: "NVR topilmadi" };
  if (!Number.isInteger(channel) || channel < 1 || channel > 999) return { error: "Kanal raqami noto'g'ri" };
  const stream = body.stream === "sub" ? "sub" : "main";
  return { nvr_id: nvrId, channel, stream };
}

// Yangi kamera qo'shish: NVR kanali (nvrId + channel) YOKI to'g'ridan IP kamera.
router.post("/", requirePerm("cameras.manage"), async (req, res) => {
  const body = req.body || {};
  const { name, order, isPublic = true } = body;
  if (!name) return res.status(400).json({ error: "Nom majburiy" });

  const slug = makeSlug(name);
  if (!slug) return res.status(400).json({ error: "Nom noto'g'ri" });
  if (db.prepare("SELECT 1 FROM cameras WHERE slug = ?").get(slug)) {
    return res.status(409).json({ error: "Bu nomli kamera bor" });
  }

  const camera = {
    name,
    slug,
    ip: "",
    port: 0,
    login: "",
    parol: "",
    rtsp_path: "",
    codec: null,
    sort_order: normalizeOrder(order),
    is_public: isPublic ? 1 : 0,
    nvr_id: null,
    channel: null,
    stream: "main",
  };

  if (body.nvrId) {
    const f = nvrFields(body);
    if (f.error) return res.status(400).json({ error: f.error });
    Object.assign(camera, f);
    // NVR kamerasi on-demand: oqim birinchi ko'rishda yoqiladi, kodek ham o'shanda.
  } else {
    const { ip, port = 554, login, parol, rtspPath } = body;
    if (!ip || !login || !parol) {
      return res.status(400).json({ error: "IP, login va parol majburiy" });
    }
    Object.assign(camera, {
      ip,
      port: Number(port),
      login,
      parol,
      rtsp_path: rtspPath || DEFAULT_RTSP,
    });
    // H264 bo'lsa transkod qilinmaydi (CPU tejaladi); aniqlanmasa — transkod.
    camera.codec = await probeCodec(camera);
    try {
      await addPath(camera); // avval MediaMTX, keyin DB
    } catch (e) {
      return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
    }
  }

  const info = db
    .prepare(
      `INSERT INTO cameras (name, slug, ip, port, login, parol, rtsp_path, codec, sort_order,
         is_public, nvr_id, channel, stream)
       VALUES (@name, @slug, @ip, @port, @login, @parol, @rtsp_path, @codec, @sort_order,
         @is_public, @nvr_id, @channel, @stream)`
    )
    .run(camera);

  audit(req, "camera.create", { cameraId: info.lastInsertRowid, details: { name } });
  const row = db.prepare(`${SELECT} WHERE c.id = ?`).get(info.lastInsertRowid);
  res.status(201).json(toApi(row));
});

// Kamerani tahrirlash. Slug (demak HLS URL) O'ZGARMAYDI — boshqa saytlarga
// qo'yilgan embed'lar buzilmasligi uchun. Parol bo'sh kelsa eskisi qoladi.
router.put("/:id(\\d+)", requirePerm("cameras.manage"), async (req, res) => {
  const row = db.prepare("SELECT * FROM cameras WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });

  const body = req.body || {};
  const camera = {
    ...row,
    name: body.name || row.name,
    // order aniq yuborilgandagina o'zgaradi (null = tartibni olib tashlash).
    sort_order: "order" in body ? normalizeOrder(body.order) : row.sort_order,
    is_public: "isPublic" in body ? (body.isPublic ? 1 : 0) : row.is_public,
  };

  if (row.nvr_id) {
    // NVR kamerasi: NVR/kanal/oqim o'zgarishi mumkin. Manba o'zgarsa kodek qayta aniqlanadi.
    const f = nvrFields({
      nvrId: body.nvrId ?? row.nvr_id,
      channel: body.channel ?? row.channel,
      stream: body.stream ?? row.stream,
    });
    if (f.error) return res.status(400).json({ error: f.error });
    const changed = f.nvr_id !== row.nvr_id || f.channel !== row.channel || f.stream !== row.stream;
    Object.assign(camera, f);
    if (changed) {
      camera.codec = null;
      await stopLive(row.id, row.slug); // keyingi heartbeat yangi manbadan yoqadi
    }
  } else {
    const { ip, port, login, parol, rtspPath } = body;
    Object.assign(camera, {
      ip: ip || row.ip,
      port: Number(port || row.port),
      login: login || row.login,
      parol: parol || row.parol,
      rtsp_path: rtspPath || row.rtsp_path,
    });
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
  }

  db.prepare(
    `UPDATE cameras SET name=@name, ip=@ip, port=@port, login=@login, parol=@parol,
       rtsp_path=@rtsp_path, codec=@codec, sort_order=@sort_order, is_public=@is_public,
       nvr_id=@nvr_id, channel=@channel, stream=@stream
     WHERE id=@id`
  ).run(camera);

  audit(req, "camera.update", { cameraId: row.id, details: { name: camera.name } });
  res.json(toApi(db.prepare(`${SELECT} WHERE c.id = ?`).get(row.id)));
});

router.delete("/:id(\\d+)", requirePerm("cameras.manage"), async (req, res) => {
  const row = db.prepare("SELECT id, slug, nvr_id FROM cameras WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });

  if (isOnDemand(row)) await stopLive(row.id, row.slug);
  else await deletePath(row.slug);
  db.prepare("DELETE FROM cameras WHERE id = ?").run(row.id);
  audit(req, "camera.delete", { cameraId: row.id, details: { slug: row.slug } });
  res.json({ ok: true });
});

export default router;
