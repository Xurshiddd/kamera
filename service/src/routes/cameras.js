import { Router } from "express";
import db from "../db.js";
import { addPath, deletePath, checkCamera, authBlocked } from "../mediamtx.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";
import { isOnDemand, stopLive } from "../live.js";

const router = Router();
const BASE = process.env.STREAM_BASE || "http://localhost:8888";
const DEFAULT_RTSP = process.env.DEFAULT_RTSP_PATH || "Streaming/Channels/101";

// Kameraga ulanish xatolari (forma maydoni yonida ko'rsatiladi).
const CHECK_ERR = {
  auth: {
    status: 422,
    field: "parol",
    error: "Login yoki parol notoʻgʻri — kamera rad etdi. Kamera saqlanmadi. Diqqat: bir necha marta xato kiritilsa kamera vaqtincha bloklanadi.",
  },
  path: {
    status: 422,
    field: "rtspPath",
    error: "Kamera javob berdi, lekin video yoʻli (RTSP yoʻli) topilmadi — brend yoki yoʻlni tekshiring. Kamera saqlanmadi.",
  },
};
const DOWN_MSG = "Kameraning RTSP portiga ulanib boʻlmadi (IP/port notoʻgʻri yoki kamera oʻchiq).";
const sendCheckErr = (res, reason) => {
  const e = CHECK_ERR[reason];
  return res.status(e.status).json({ error: e.error, reason, field: e.field });
};

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
export function toApi(r) {
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
    source: r.source || null, // 'scan' = tarmoq skaneri orqali qo'shilgan
    // NVR'siz kamera maydonlari
    ip: r.nvr_id ? null : r.ip,
    port: r.nvr_id ? null : r.port,
    // Kamera parolni rad etgan (401) — oqim bloklanmaslik uchun kutyapti.
    auth_blocked: authBlocked(r.slug),
    created_at: r.created_at,
    ...publicUrls(r.slug),
  };
}

export const SELECT = `SELECT c.*, n.name AS nvr_name FROM cameras c LEFT JOIN nvrs n ON n.id = c.nvr_id`;

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

// DB'ga yozish (MediaMTX'ga qo'shish chaqiruvchining ishi).
export function insertCamera(camera) {
  return db
    .prepare(
      `INSERT INTO cameras (name, slug, ip, port, login, parol, rtsp_path, codec, sort_order,
         is_public, nvr_id, channel, stream, source)
       VALUES (@name, @slug, @ip, @port, @login, @parol, @rtsp_path, @codec, @sort_order,
         @is_public, @nvr_id, @channel, @stream, @source)`
    )
    .run({ source: null, ...camera });
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
    // Avval bir marta ulanib ko'ramiz: noto'g'ri parol bilan saqlansa MediaMTX
    // qayta-qayta urinib kamerani bloklab qo'yadi.
    // H264 bo'lsa transkod qilinmaydi (CPU tejaladi); aniqlanmasa — transkod.
    const chk = await checkCamera(camera);
    if (!chk.ok && CHECK_ERR[chk.reason]) {
      audit(req, "camera.check_fail", { details: { ip, reason: chk.reason } });
      return sendCheckErr(res, chk.reason);
    }
    camera.codec = chk.ok ? chk.codec : null; // "down" — kamera vaqtincha o'chiq bo'lishi mumkin
    try {
      await addPath(camera); // avval MediaMTX, keyin DB
    } catch (e) {
      return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
    }
  }

  const info = insertCamera(camera);

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
    const connChanged = ["ip", "port", "login", "parol", "rtsp_path"].some((k) => camera[k] !== row[k]);
    // Faqat nom/tartib/ochiqlik o'zgarsa kameraga qayta ulanmaymiz (ortiqcha
    // login urinishlari yo'q, oqim uzilmaydi). Lekin oqim 401 tufayli kutishda
    // bo'lsa (kamera vaqtincha bloklangan, parol aslida to'g'ri bo'lishi mumkin),
    // saqlash oqimni qayta ishga tushiradi.
    if (connChanged || authBlocked(row.slug)) {
      // Avval eski ffmpeg'ni to'xtatamiz — kamera ulanishi bo'shasin (ko'p
      // kameralar bir vaqtda 1-2 ta RTSP mijozgagina ruxsat beradi), keyin
      // bir marta ulanib tekshiramiz va kodekni aniqlaymiz.
      await deletePath(row.slug);
      await new Promise((r) => setTimeout(r, 1500));
      const chk = await checkCamera(camera);
      if (!chk.ok && CHECK_ERR[chk.reason]) {
        // Saqlamaymiz; eski sozlama bilan oqimni qaytaramiz.
        await addPath(row).catch(() => {});
        audit(req, "camera.check_fail", { cameraId: row.id, details: { ip: camera.ip, reason: chk.reason } });
        return sendCheckErr(res, chk.reason);
      }
      camera.codec = chk.ok ? chk.codec : null;
      try {
        await addPath(camera);
      } catch (e) {
        return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
      }
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

// Formadagi «Ulanishni tekshirish»: saqlamasdan bir marta ulanib ko'radi.
// Tahrirlashda parol bo'sh bo'lsa saqlangan parol ishlatiladi (id orqali).
router.post("/check", requirePerm("cameras.manage"), async (req, res) => {
  const b = req.body || {};
  const row = b.id ? db.prepare("SELECT * FROM cameras WHERE id = ? AND nvr_id IS NULL").get(b.id) : null;
  const camera = {
    ip: String(b.ip || "").trim(),
    port: Number(b.port) || 554,
    login: String(b.login || "").trim(),
    parol: b.parol ? String(b.parol) : row?.parol || "",
    rtsp_path: String(b.rtspPath || "").replace(/^\/+/, "") || DEFAULT_RTSP,
  };
  if (!/^[\w.-]+$/.test(camera.ip) || !camera.login || !camera.parol) {
    return res.status(400).json({ error: "IP, login va parol kerak" });
  }
  const chk = await checkCamera(camera);
  audit(req, "camera.check", { cameraId: row?.id ?? null, details: { ip: camera.ip, ok: chk.ok, reason: chk.reason } });
  if (chk.ok) {
    const codec = chk.codec === "h264" ? "H.264" : chk.codec === "hevc" ? "H.265" : chk.codec;
    return res.json({ ok: true, codec: chk.codec, message: `Ulandi — login/parol toʻgʻri (${codec}${chk.width ? `, ${chk.width}×${chk.height}` : ""})` });
  }
  if (CHECK_ERR[chk.reason]) {
    const e = CHECK_ERR[chk.reason];
    return res.status(422).json({ ok: false, reason: chk.reason, field: e.field, error: e.error.replace(" Kamera saqlanmadi.", "") });
  }
  res.status(422).json({ ok: false, reason: "down", field: "ip", error: DOWN_MSG });
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
