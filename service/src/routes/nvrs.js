import { Router } from "express";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";
import { deviceInfo, listChannels } from "../hikvision.js";
import { stopLive } from "../live.js";
import { makeSlug } from "./cameras.js";

const router = Router();
const manage = requirePerm("nvr.manage");

// Parol hech qachon qaytarilmaydi.
function listNvrs(where = "", ...args) {
  return db
    .prepare(
      `SELECT n.id, n.name, n.ip, n.http_port, n.rtsp_port, n.login, n.created_at,
              (SELECT COUNT(*) FROM cameras c WHERE c.nvr_id = n.id) AS cameras
       FROM nvrs n ${where} ORDER BY n.name`
    )
    .all(...args);
}

function readBody(body, old = {}) {
  return {
    name: (body.name ?? old.name ?? "").trim(),
    ip: (body.ip ?? old.ip ?? "").trim(),
    http_port: Number(body.http_port || old.http_port || 80),
    rtsp_port: Number(body.rtsp_port || old.rtsp_port || 554),
    login: (body.login ?? old.login ?? "").trim(),
    parol: body.parol || old.parol || "", // bo'sh -> eskisi qoladi
  };
}

function validate(n) {
  if (!n.name || !n.ip || !n.login || !n.parol) return "Nom, IP, login va parol majburiy";
  if (!/^[a-zA-Z0-9.\-]+$/.test(n.ip)) return "IP/host noto'g'ri";
  for (const p of [n.http_port, n.rtsp_port]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) return "Port noto'g'ri";
  }
  return null;
}

// Ro'yxat kamera formasiga ham kerak (NVR tanlash) — parolsiz.
router.get("/", requirePerm("nvr.manage", "cameras.manage"), (req, res) => res.json(listNvrs()));

// Saqlashdan OLDIN ulanib ko'ramiz — noto'g'ri parol bilan NVR qo'shilmasin.
router.post("/", manage, async (req, res) => {
  const n = readBody(req.body || {});
  const bad = validate(n);
  if (bad) return res.status(400).json({ error: bad });
  if (db.prepare("SELECT 1 FROM nvrs WHERE name = ?").get(n.name)) {
    return res.status(409).json({ error: "Bu nomli NVR bor" });
  }
  let info;
  try {
    info = await deviceInfo(n);
  } catch (e) {
    return res.status(502).json({ error: "NVR'ga ulanib bo'lmadi: " + e.message });
  }
  const id = db
    .prepare(
      `INSERT INTO nvrs (name, ip, http_port, rtsp_port, login, parol)
       VALUES (@name, @ip, @http_port, @rtsp_port, @login, @parol)`
    )
    .run(n).lastInsertRowid;
  audit(req, "nvr.create", { details: { id, name: n.name, ip: n.ip } });
  res.status(201).json({ ...listNvrs("WHERE n.id = ?", id)[0], info });
});

router.put("/:id(\\d+)", manage, async (req, res) => {
  const row = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  const n = readBody(req.body || {}, row);
  const bad = validate(n);
  if (bad) return res.status(400).json({ error: bad });
  try {
    await deviceInfo(n);
  } catch (e) {
    return res.status(502).json({ error: "NVR'ga ulanib bo'lmadi: " + e.message });
  }
  try {
    db.prepare(
      `UPDATE nvrs SET name=@name, ip=@ip, http_port=@http_port, rtsp_port=@rtsp_port,
         login=@login, parol=@parol WHERE id=@id`
    ).run({ ...n, id: row.id });
  } catch {
    return res.status(409).json({ error: "Bu nomli NVR bor" });
  }
  // Ulanish ma'lumoti o'zgardi — ochiq oqimlar yangi sozlama bilan qayta yoqilsin.
  for (const c of db.prepare("SELECT id, slug FROM cameras WHERE nvr_id = ?").all(row.id)) {
    await stopLive(c.id, c.slug);
  }
  audit(req, "nvr.update", { details: { id: row.id, name: n.name, ip: n.ip } });
  res.json(listNvrs("WHERE n.id = ?", row.id)[0]);
});

router.delete("/:id(\\d+)", manage, (req, res) => {
  const row = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  const n = db.prepare("SELECT COUNT(*) AS n FROM cameras WHERE nvr_id = ?").get(row.id).n;
  if (n) return res.status(409).json({ error: `Avval shu NVR'dagi ${n} ta kamerani o'chiring` });
  db.prepare("DELETE FROM nvrs WHERE id = ?").run(row.id);
  audit(req, "nvr.delete", { details: { id: row.id, name: row.name } });
  res.json({ ok: true });
});

router.post("/:id(\\d+)/test", manage, async (req, res) => {
  const row = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  try {
    res.json({ ok: true, info: await deviceInfo(row) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// NVR kanallari + qaysi biri allaqachon kamera sifatida qo'shilgan.
router.get("/:id(\\d+)/channels", manage, async (req, res) => {
  const row = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  let channels;
  try {
    channels = await listChannels(row);
  } catch (e) {
    return res.status(502).json({ error: "NVR'dan kanallarni olib bo'lmadi: " + e.message });
  }
  const imported = new Map(
    db
      .prepare("SELECT id, channel, name FROM cameras WHERE nvr_id = ?")
      .all(row.id)
      .map((c) => [c.channel, c])
  );
  res.json(
    channels.map((ch) => ({
      ...ch,
      camera_id: imported.get(ch.channel)?.id ?? null,
      camera_name: imported.get(ch.channel)?.name ?? null,
    }))
  );
});

// Tanlangan kanallarni kamera sifatida qo'shish. Default: YOPIQ (mehmon
// sahifasida ko'rinmaydi). Kodek birinchi ko'rishda aniqlanadi.
router.post("/:id(\\d+)/import", manage, async (req, res) => {
  const row = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  const wanted = new Set(
    (Array.isArray(req.body?.channels) ? req.body.channels : []).map(Number).filter(Number.isInteger)
  );
  if (!wanted.size) return res.status(400).json({ error: "Kanal tanlanmagan" });
  const isPublic = req.body?.isPublic ? 1 : 0;
  const groupId = req.body?.groupId ? Number(req.body.groupId) : null;

  let channels;
  try {
    channels = await listChannels(row);
  } catch (e) {
    return res.status(502).json({ error: "NVR'dan kanallarni olib bo'lmadi: " + e.message });
  }

  const exists = db.prepare("SELECT 1 FROM cameras WHERE nvr_id = ? AND channel = ?");
  const slugTaken = db.prepare("SELECT 1 FROM cameras WHERE slug = ?");
  const ins = db.prepare(
    `INSERT INTO cameras (name, slug, ip, port, login, parol, rtsp_path, codec,
       is_public, nvr_id, channel, stream)
     VALUES (?, ?, '', 0, '', '', '', NULL, ?, ?, ?, 'main')`
  );
  const toGroup = groupId
    ? db.prepare(
        "INSERT OR IGNORE INTO camera_group_items (group_id, camera_id) SELECT id, ? FROM camera_groups WHERE id = ?"
      )
    : null;

  const created = [];
  db.transaction(() => {
    for (const ch of channels) {
      if (!wanted.has(ch.channel) || exists.get(row.id, ch.channel)) continue;
      const name = ch.name || `Kanal ${ch.channel}`;
      // Slug kanal raqami bilan — nomlar takrorlansa ham (masalan ikkita "2.208") noyob.
      let slug = makeSlug(`${name}-k${ch.channel}`) || `k${ch.channel}`;
      if (slugTaken.get(slug)) slug = `${slug}-n${row.id}`;
      const id = ins.run(name, slug, isPublic, row.id, ch.channel).lastInsertRowid;
      if (toGroup) toGroup.run(id, groupId);
      created.push({ id, name, slug, channel: ch.channel });
    }
  })();

  audit(req, "nvr.import", { details: { nvr: row.name, count: created.length } });
  res.status(201).json({ created: created.length, cameras: created });
});

export default router;
