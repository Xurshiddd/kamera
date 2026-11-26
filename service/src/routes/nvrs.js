import { Router } from "express";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";
import { deviceInfo, listChannels, listStreams, getStream, setStream, setChannelName, snapshot, forgetStreamInfo } from "../hikvision.js";
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

// IP -> shu IP'dagi kamera (to'g'ridan yoki istalgan NVR orqali).
// Bitta IP kamera bir nechta NVR'da yozilayotgan bo'lishi mumkin — tizimga
// faqat BIR marta qo'shiladi.
function ipOwners() {
  const m = new Map();
  for (const c of db
    .prepare(
      `SELECT c.id, c.name, c.nvr_id, c.channel, n.name AS nvr_name,
              CASE WHEN c.nvr_id IS NULL THEN c.ip ELSE c.cam_ip END AS real_ip
       FROM cameras c LEFT JOIN nvrs n ON n.id = c.nvr_id
       ORDER BY c.id`
    )
    .all()) {
    if (!c.real_ip) continue;
    if (!m.has(c.real_ip)) m.set(c.real_ip, []);
    m.get(c.real_ip).push(c);
  }
  return m;
}

// Kanal ro'yxatidan shu NVR kameralarini NVR bilan moslab qo'yamiz: nom va
// IP. NVR — asosiy manba: kanalga boshqa kamera ulangan yoki NVR'da nom
// o'zgargan bo'lishi mumkin. Nom/IP o'zgarsa kanalda boshqa kamera bo'lishi
// ehtimoli bor — saqlangan kodek tozalanadi (keyingi ochilishda qayta
// aniqlanadi) va ochiq jonli oqim yangi sozlama bilan qayta ochiladi.
async function syncChannels(nvrId, channels) {
  const cams = new Map(
    db.prepare("SELECT id, slug, channel, name, cam_ip FROM cameras WHERE nvr_id = ?").all(nvrId).map((c) => [c.channel, c])
  );
  const upd = db.prepare("UPDATE cameras SET name = ?, cam_ip = ?, codec = NULL WHERE id = ?");
  const changed = [];
  db.transaction(() => {
    for (const ch of channels) {
      const c = cams.get(ch.channel);
      if (!c) continue;
      const name = ch.name || c.name;
      const ip = ch.ip || c.cam_ip;
      if (name === c.name && ip === c.cam_ip) continue;
      upd.run(name, ip, c.id);
      changed.push(c);
    }
  })();
  for (const c of changed) await stopLive(c.id, c.slug).catch(() => {});
  return changed.length;
}

// Boshqa joydagi (boshqa NVR yoki boshqa kanal / to'g'ridan) shu IP'li kamera.
function otherOwner(owners, ip, nvrId, channel) {
  return (owners.get(ip) || []).find((c) => !(c.nvr_id === nvrId && c.channel === channel)) || null;
}

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
  await syncChannels(row.id, channels);
  const imported = new Map(
    db
      .prepare("SELECT id, channel, name FROM cameras WHERE nvr_id = ?")
      .all(row.id)
      .map((c) => [c.channel, c])
  );
  const owners = ipOwners();
  res.json(
    channels.map((ch) => {
      const dup = ch.ip ? otherOwner(owners, ch.ip, row.id, ch.channel) : null;
      return {
        ...ch,
        camera_id: imported.get(ch.channel)?.id ?? null,
        camera_name: imported.get(ch.channel)?.name ?? null,
        // Shu kamera tizimda boshqa joydan allaqachon bor.
        dup: dup
          ? {
              camera_id: dup.id,
              camera_name: dup.name,
              where: dup.nvr_id ? `${dup.nvr_name} · D${dup.channel}` : "to'g'ridan",
            }
          : null,
      };
    })
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

  await syncChannels(row.id, channels);
  const owners = ipOwners();
  const exists = db.prepare("SELECT 1 FROM cameras WHERE nvr_id = ? AND channel = ?");
  const slugTaken = db.prepare("SELECT 1 FROM cameras WHERE slug = ?");
  const ins = db.prepare(
    `INSERT INTO cameras (name, slug, ip, port, login, parol, rtsp_path, codec,
       is_public, nvr_id, channel, stream)
     VALUES (?, ?, '', 0, '', '', '', NULL, ?, ?, ?, 'main')`
  );
  const setIp = db.prepare("UPDATE cameras SET cam_ip = ? WHERE id = ?");
  const toGroup = groupId
    ? db.prepare(
        "INSERT OR IGNORE INTO camera_group_items (group_id, camera_id) SELECT id, ? FROM camera_groups WHERE id = ?"
      )
    : null;

  const created = [];
  const skipped = [];
  db.transaction(() => {
    for (const ch of channels) {
      if (!wanted.has(ch.channel) || exists.get(row.id, ch.channel)) continue;
      // Shu IP'li kamera boshqa NVR'dan (yoki shu NVR'ning boshqa kanalidan) qo'shilgan.
      const dup = ch.ip ? otherOwner(owners, ch.ip, row.id, ch.channel) : null;
      if (dup) {
        skipped.push({ channel: ch.channel, ip: ch.ip, camera_id: dup.id, camera_name: dup.name });
        continue;
      }
      const name = ch.name || `Kanal ${ch.channel}`;
      // Slug kanal raqami bilan — nomlar takrorlansa ham (masalan ikkita "2.208") noyob.
      let slug = makeSlug(`${name}-k${ch.channel}`) || `k${ch.channel}`;
      if (slugTaken.get(slug)) slug = `${slug}-n${row.id}`;
      const id = ins.run(name, slug, isPublic, row.id, ch.channel).lastInsertRowid;
      if (ch.ip) {
        setIp.run(ch.ip, id);
        owners.set(ch.ip, [{ id, name, nvr_id: row.id, channel: ch.channel, nvr_name: row.name }]);
      }
      if (toGroup) toGroup.run(id, groupId);
      created.push({ id, name, slug, channel: ch.channel });
    }
  })();

  audit(req, "nvr.import", { details: { nvr: row.name, count: created.length, skipped: skipped.length } });
  res.status(201).json({ created: created.length, cameras: created, skipped });
});

// =============================================================================
//  Kamera sozlamalari (NVR orqali): nom, kodek, o'lcham, sifat, kadr tezligi.
// =============================================================================

function nvrOr404(req, res) {
  const row = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(req.params.id);
  if (!row) res.status(404).json({ error: "NVR topilmadi" });
  return row;
}
const chOf = (req) => Number(req.params.ch);
const busyMsg = (e) =>
  e.status === 403
    ? "Kamera hozir javob bermayapti (qayta ishga tushayotgan yoki oʻchiq boʻlishi mumkin). 1–2 daqiqadan keyin urinib koʻring."
    : e.message;

// Hamma kanallar: nom, IP, holat + asosiy oqim sozlamasi + platformadagi kamera.
router.get("/:id(\\d+)/streams", manage, async (req, res) => {
  const row = nvrOr404(req, res);
  if (!row) return;
  let channels, streams;
  try {
    [channels, streams] = await Promise.all([listChannels(row), listStreams(row)]);
  } catch (e) {
    return res.status(502).json({ error: "NVR'dan maʼlumot olib boʻlmadi: " + e.message });
  }
  await syncChannels(row.id, channels);
  const cams = new Map(
    db.prepare("SELECT id, channel, name FROM cameras WHERE nvr_id = ?").all(row.id).map((c) => [c.channel, c])
  );
  res.json(
    channels.map((ch) => ({
      ...ch,
      stream: streams.get(ch.channel) || null,
      camera_id: cams.get(ch.channel)?.id ?? null,
      camera_name: cams.get(ch.channel)?.name ?? null,
    }))
  );
});

router.get("/:id(\\d+)/channels/:ch(\\d+)/stream", manage, async (req, res) => {
  const row = nvrOr404(req, res);
  if (!row) return;
  try {
    res.json(await getStream(row, chOf(req)));
  } catch (e) {
    res.status(502).json({ error: busyMsg(e) });
  }
});

router.put("/:id(\\d+)/channels/:ch(\\d+)/stream", manage, async (req, res) => {
  const row = nvrOr404(req, res);
  if (!row) return;
  const ch = chOf(req);
  const b = req.body || {};
  let cur;
  try {
    cur = await getStream(row, ch);
  } catch (e) {
    return res.status(502).json({ error: busyMsg(e) });
  }
  const { caps, current } = cur;
  const ch2 = {};
  // Faqat kamera qo'llaydigan qiymatlar qabul qilinadi.
  if (b.codec !== undefined) {
    // Imkoniyatlar ro'yxati o'qilmasa — "qo'llamaydi" deb bo'lmaydi, alohida xato.
    if (!caps.codecs.length) {
      return res.status(502).json({ error: "Kamera qoʻllaydigan kodeklarni oʻqib boʻlmadi", code: "nocaps" });
    }
    if (!caps.codecs.includes(b.codec)) {
      return res.status(400).json({ error: `Bu kamera ${b.codec} ni qoʻllamaydi`, code: "unsupported" });
    }
    ch2.codec = b.codec;
  }
  if (b.width !== undefined || b.height !== undefined) {
    const ok = caps.resolutions.some((r) => r.width === Number(b.width) && r.height === Number(b.height));
    if (!ok) return res.status(400).json({ error: "Bu oʻlcham qoʻllanmaydi" });
    ch2.width = Number(b.width);
    ch2.height = Number(b.height);
  }
  if (b.rc !== undefined) {
    if (!caps.rc.includes(b.rc)) return res.status(400).json({ error: "Bitreyt turi notoʻgʻri" });
    ch2.rc = b.rc;
  }
  if (b.bitrate !== undefined) {
    const v = Number(b.bitrate);
    const r = caps.bitrate || { min: 32, max: 16384 };
    if (!Number.isInteger(v) || v < r.min || v > r.max) {
      return res.status(400).json({ error: `Bitreyt ${r.min}–${r.max} kbit/s oraligʻida boʻlsin` });
    }
    ch2.bitrate = v;
  }
  if (b.fps !== undefined) {
    if (!caps.fps.includes(Number(b.fps))) return res.status(400).json({ error: "Kadr tezligi notoʻgʻri" });
    ch2.fps = Number(b.fps);
  }
  if (typeof b.smart === "boolean" && current.smart !== null) ch2.smart = b.smart;
  if (!Object.keys(ch2).length) return res.status(400).json({ error: "Oʻzgarish yoʻq" });

  let next;
  try {
    next = await setStream(row, ch, ch2);
  } catch (e) {
    return res.status(502).json({ error: busyMsg(e) });
  }
  forgetStreamInfo(row);
  // Kodek o'zgargan bo'lishi mumkin — jonli oqim qayta aniqlab, qayta ochilsin.
  for (const c of db.prepare("SELECT id, slug FROM cameras WHERE nvr_id = ? AND channel = ?").all(row.id, ch)) {
    db.prepare("UPDATE cameras SET codec = NULL WHERE id = ?").run(c.id);
    await stopLive(c.id, c.slug);
  }
  const camera = db.prepare("SELECT id FROM cameras WHERE nvr_id = ? AND channel = ?").get(row.id, ch);
  audit(req, "nvr.stream", {
    cameraId: camera?.id ?? null,
    details: { nvr: row.name, channel: ch, before: current, changes: ch2 },
  });
  res.json({ ok: true, stream: next, restarting: true });
});

// Kanal nomi: avval NVR'ga yoziladi (kamera login/paroli o'zgarmaydi), keyin
// saytdagi kameraga (agar import qilingan bo'lsa). NVR xato bersa sayt ham
// o'zgarmaydi — ikkalasi bir xil bo'lib qolsin.
router.put("/:id(\\d+)/channels/:ch(\\d+)/name", manage, async (req, res) => {
  const row = nvrOr404(req, res);
  if (!row) return;
  const ch = chOf(req);
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 32) return res.status(400).json({ error: "Nom 1–32 belgi boʻlsin" });
  try {
    await setChannelName(row, ch, name);
  } catch (e) {
    return res.status(502).json({ error: "NVR'da nomni oʻzgartirib boʻlmadi: " + busyMsg(e) });
  }
  const cam = db.prepare("SELECT id, name FROM cameras WHERE nvr_id = ? AND channel = ?").get(row.id, ch);
  if (cam) db.prepare("UPDATE cameras SET name = ? WHERE id = ?").run(name, cam.id);
  audit(req, "camera.rename", {
    cameraId: cam?.id ?? null,
    details: { nvr: row.name, channel: ch, from: cam?.name ?? null, to: name },
  });
  res.json({ ok: true, id: cam?.id ?? null, name });
});

router.get("/:id(\\d+)/channels/:ch(\\d+)/snapshot", manage, async (req, res) => {
  const row = nvrOr404(req, res);
  if (!row) return;
  try {
    const img = await snapshot(row, chOf(req));
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "no-store" }).send(img);
  } catch (e) {
    res.status(502).json({ error: busyMsg(e) });
  }
});

export default router;
