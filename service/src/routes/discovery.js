// =============================================================================
//  Tarmoq skaneri: NVR'ga ulanmagan IP kameralarni topish, saqlash, login/parol
//  bilan ulanib tekshirish va asosiy kameralar ro'yxatiga o'tkazish.
// =============================================================================

import { Router } from "express";
import crypto from "node:crypto";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";
import { listChannels, deviceInfo } from "../hikvision.js";
import { addPath } from "../mediamtx.js";
import { parseTargets, scan, candidatePaths, probe, rtspUrl, grabFrame, kindFromInfo, MAX_HOSTS } from "../scanner.js";
import { makeSlug, insertCamera, toApi, SELECT } from "./cameras.js";

const router = Router();
const perm = requirePerm("discovery.manage");

// Qator -> API (parol chiqmaydi). Holat: added | connected | new.
function toRow(r) {
  return {
    id: r.id,
    ip: r.ip,
    ports: JSON.parse(r.ports || "[]"),
    vendor: r.vendor,
    model: r.model,
    hint: r.hint,
    in_nvr: r.in_nvr,
    kind: r.kind, // camera | nvr | other | null
    kind_manual: Boolean(r.kind_manual),
    server: r.server,
    device_name: r.device_name,
    serial: r.serial,
    mac: r.mac,
    firmware: r.firmware,
    note: r.note,
    nvr_id: r.nvr_id,
    nvr_name: r.nvr_name ?? null,
    login: r.login,
    rtsp_port: r.rtsp_port,
    rtsp_path: r.rtsp_path,
    codec: r.codec,
    width: r.width,
    height: r.height,
    connected_at: r.connected_at,
    camera_id: r.camera_id,
    camera_name: r.camera_name ?? null,
    first_seen: r.first_seen,
    last_seen: r.last_seen,
    status: r.camera_id ? "added" : r.nvr_id ? "nvr_added" : r.connected_at ? "connected" : "new",
  };
}
const SEL = `SELECT d.*, c.name AS camera_name, n.name AS nvr_name FROM discovered_cameras d
  LEFT JOIN cameras c ON c.id = d.camera_id LEFT JOIN nvrs n ON n.id = d.nvr_id`;
const getRow = (id) => db.prepare(`${SEL} WHERE d.id = ?`).get(id);

router.get("/", perm, (req, res) => {
  const rows = db.prepare(`${SEL} ORDER BY d.ip`).all();
  // IP bo'yicha tabiiy tartib (192.168.18.9 < 192.168.18.10).
  const key = (ip) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
  rows.sort((a, b) => key(a.ip) - key(b.ip));
  res.json(rows.map(toRow));
});

// Taklif qilinadigan tarmoqlar: NVR va mavjud kameralar turgan /24'lar.
router.get("/suggest", perm, (req, res) => {
  const ips = [
    ...db.prepare("SELECT ip FROM nvrs").all(),
    ...db.prepare("SELECT ip FROM cameras WHERE nvr_id IS NULL AND ip != ''").all(),
  ].map((r) => r.ip);
  const nets = [...new Set(ips.filter((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)).map((ip) => ip.replace(/\.\d+$/, ".0/24")))];
  res.json({ networks: nets, max: MAX_HOSTS });
});

// --- Skan jobi (bir vaqtda bittasi) ---
let job = null;

router.get("/scan", perm, (req, res) => res.json(job));

router.post("/scan", perm, async (req, res) => {
  if (job?.running) return res.status(409).json({ error: "Skaner allaqachon ishlayapti" });
  let ips;
  try {
    ips = parseTargets(req.body?.targets);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  job = {
    id: crypto.randomUUID(),
    running: true,
    targets: String(req.body.targets).trim(),
    total: ips.length,
    done: 0,
    found: 0,
    added: 0,
    skippedNvr: 0,
    warnings: [],
    error: null,
    started_at: new Date().toISOString(),
    finished_at: null,
  };
  audit(req, "discovery.scan", { details: { targets: job.targets, hosts: ips.length } });
  res.status(202).json(job);
  runScan(job, ips).catch((e) => {
    job.error = e.message;
  }).finally(() => {
    job.running = false;
    job.finished_at = new Date().toISOString();
  });
});

async function runScan(j, ips) {
  // NVR'larga ulangan kameralar (ular kerak emas) va NVR'larning o'zi.
  const inNvr = new Map(); // ip -> "NVR nomi · D12"
  const nvrIps = new Set();
  for (const nvr of db.prepare("SELECT * FROM nvrs").all()) {
    nvrIps.add(nvr.ip);
    try {
      for (const ch of await listChannels(nvr)) {
        if (ch.ip) inNvr.set(ch.ip, `${nvr.name} · D${ch.channel}`);
      }
    } catch (e) {
      j.warnings.push(`«${nvr.name}» NVR kanallarini olib boʻlmadi (${e.message}) — uning kameralari ham roʻyxatga tushishi mumkin.`);
    }
  }
  const direct = new Map(
    db.prepare("SELECT id, ip FROM cameras WHERE nvr_id IS NULL AND ip != ''").all().map((c) => [c.ip, c.id])
  );

  const found = await scan(ips, {
    onProgress: (done, total, n) => {
      j.done = done;
      j.found = n;
    },
  });

  const exists = db.prepare("SELECT id FROM discovered_cameras WHERE ip = ?");
  const ins = db.prepare(
    `INSERT INTO discovered_cameras (ip, ports, vendor, model, hint, server, kind, camera_id)
     VALUES (@ip, @ports, @vendor, @model, @hint, @server, @kind, @camera_id)`
  );
  const upd = db.prepare(
    `UPDATE discovered_cameras SET ports=@ports, vendor=COALESCE(@vendor, vendor),
       model=COALESCE(@model, model), hint=COALESCE(@hint, hint), server=COALESCE(@server, server),
       kind=CASE WHEN kind_manual = 1 OR connected_at IS NOT NULL OR nvr_id IS NOT NULL THEN kind ELSE COALESCE(@kind, kind) END,
       in_nvr=NULL,
       camera_id=COALESCE(camera_id, @camera_id), last_seen=datetime('now')
     WHERE ip=@ip`
  );
  const markNvr = db.prepare("UPDATE discovered_cameras SET in_nvr = ?, last_seen = datetime('now') WHERE ip = ?");

  db.transaction(() => {
    for (const d of found) {
      if (nvrIps.has(d.ip)) continue;
      if (inNvr.has(d.ip)) {
        // Ilgari topilgan, endi NVR'ga qo'shilgan bo'lsa — belgilab qo'yamiz.
        markNvr.run(inNvr.get(d.ip), d.ip);
        j.skippedNvr++;
        continue;
      }
      const row = {
        ip: d.ip,
        ports: JSON.stringify(d.ports),
        vendor: d.vendor,
        model: d.model,
        hint: d.hint,
        server: d.server,
        kind: d.kind,
        camera_id: direct.get(d.ip) ?? null,
      };
      if (exists.get(d.ip)) upd.run(row);
      else {
        ins.run(row);
        j.added++;
      }
    }
  })();
  j.found = found.length;
}

// --- Ulanish: login/parol bilan tekshirish ---
// 1) ISAPI deviceInfo (Hikvision): qurilma turi, model, nom, seriya, MAC — aniq.
//    NVR/DVR bo'lsa avtomatik «NVR qurilmalar»ga qo'shiladi.
// 2) Kamera (yoki ISAPI yo'q) bo'lsa — RTSP oqim yo'li sinab ko'riladi.
function uniqueNvrName(base) {
  let name = base;
  for (let i = 2; db.prepare("SELECT 1 FROM nvrs WHERE name = ?").get(name); i++) name = `${base} (${i})`;
  return name;
}

router.post("/:id(\\d+)/connect", perm, async (req, res) => {
  const d = getRow(req.params.id);
  if (!d) return res.status(404).json({ error: "Topilmadi" });
  if (d.nvr_id) return res.status(409).json({ error: "Bu qurilma allaqachon NVR sifatida qoʻshilgan" });
  const b = req.body || {};
  const login = String(b.login || "").trim();
  const parol = String(b.parol || "") || d.parol || "";
  const port = Number(b.rtspPort || d.rtsp_port || 554);
  if (!login || !parol) return res.status(400).json({ error: "Login va parol majburiy" });
  if (!Number.isInteger(port) || port < 1 || port > 65535) return res.status(400).json({ error: "Port notoʻgʻri" });
  const AUTH_MSG = "Login yoki parol notoʻgʻri. Diqqat: koʻp xato urinishda qurilma vaqtincha bloklanishi mumkin.";

  // 1) Qurilma o'zi haqida (faqat HTTP 80 ochiq bo'lsa).
  let info = null;
  if (JSON.parse(d.ports || "[]").includes(80)) {
    try {
      info = await deviceInfo({ ip: d.ip, http_port: 80, login, parol });
    } catch (e) {
      if (e.status === 401) {
        audit(req, "discovery.connect", { details: { ip: d.ip, ok: false, login } });
        return res.status(422).json({ error: AUTH_MSG, reason: "auth" });
      }
      // ISAPI yo'q (Hikvision emas) — RTSP bilan davom etamiz.
    }
  }
  const detected = kindFromInfo(info);
  // Qo'lda belgilangan tur ustun turadi.
  const kind = d.kind_manual ? d.kind : detected;
  if (info) {
    db.prepare(
      `UPDATE discovered_cameras SET kind = CASE WHEN kind_manual = 1 THEN kind ELSE ? END,
         model = COALESCE(?, model), device_name = ?, serial = ?, mac = ?, firmware = ?, vendor = COALESCE(vendor, 'Hikvision')
       WHERE id = ?`
    ).run(detected, info.model, info.name, info.serial, info.mac, info.firmware, d.id);
  }

  // NVR/DVR -> «NVR qurilmalar»ga avtomatik qo'shamiz.
  if (kind === "nvr") {
    let nvrId = db.prepare("SELECT id FROM nvrs WHERE ip = ?").get(d.ip)?.id;
    if (!nvrId) {
      const name = uniqueNvrName(info?.model || info?.name || `NVR ${d.ip}`);
      nvrId = db
        .prepare("INSERT INTO nvrs (name, ip, http_port, rtsp_port, login, parol) VALUES (?, ?, 80, ?, ?, ?)")
        .run(name, d.ip, port, login, parol).lastInsertRowid;
      audit(req, "nvr.create", { details: { id: nvrId, name, ip: d.ip, source: "scan" } });
    }
    // Shu NVR'ga ulangan, ilgari topilgan kameralar — endi «NVR'da».
    try {
      const nvr = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(nvrId);
      const mark = db.prepare("UPDATE discovered_cameras SET in_nvr = ? WHERE ip = ? AND camera_id IS NULL");
      for (const ch of await listChannels(nvr)) if (ch.ip) mark.run(`${nvr.name} · D${ch.channel}`, ch.ip);
    } catch { /* keyingi skanda belgilanadi */ }
    db.prepare("UPDATE discovered_cameras SET login = ?, nvr_id = ?, connected_at = datetime('now') WHERE id = ?").run(login, nvrId, d.id);
    audit(req, "discovery.connect", { details: { ip: d.ip, ok: true, login, kind } });
    return res.json(toRow(getRow(d.id)));
  }

  // 2) Kamera: RTSP oqim yo'lini topamiz.
  const custom = String(b.rtspPath ?? "").trim().replace(/^\/+/, "");
  const paths = custom ? [custom] : candidatePaths(d.vendor || (info ? "Hikvision" : null));
  let hit = null;
  let reason = "down";
  for (const path of paths) {
    const r = await probe(rtspUrl({ ip: d.ip, port, login, parol, path }));
    if (r.ok) {
      hit = { path, ...r };
      break;
    }
    reason = r.reason;
    // Noto'g'ri parolda boshqa yo'llarni sinamaymiz: kamera bloklab qo'yishi mumkin.
    if (r.reason === "auth" || r.reason === "down") break;
  }
  audit(req, "discovery.connect", { details: { ip: d.ip, ok: !!hit, login, kind } });
  if (!hit) {
    const msg = {
      auth: AUTH_MSG,
      path: "Qurilma javob berdi, lekin video yoʻli topilmadi — RTSP yoʻlini qoʻlda kiriting.",
      down: `Qurilmaning RTSP portiga (${port}) ulanib boʻlmadi.`,
    }[reason];
    return res.status(422).json({ error: msg, reason, row: toRow(getRow(d.id)) });
  }
  db.prepare(
    `UPDATE discovered_cameras SET login=?, parol=?, rtsp_port=?, rtsp_path=?, codec=?, width=?, height=?,
       kind = CASE WHEN kind_manual = 1 THEN kind ELSE COALESCE(kind, 'camera') END,
       connected_at=datetime('now') WHERE id=?`
  ).run(login, parol, port, hit.path, hit.codec, hit.width, hit.height, d.id);
  res.json(toRow(getRow(d.id)));
});

// Qo'lda: tur va izoh (masalan "3-bino NVR, server xonasi").
router.put("/:id(\\d+)", perm, (req, res) => {
  const d = getRow(req.params.id);
  if (!d) return res.status(404).json({ error: "Topilmadi" });
  const b = req.body || {};
  if ("kind" in b) {
    if (b.kind !== null && !["camera", "nvr", "other"].includes(b.kind)) return res.status(400).json({ error: "Tur notoʻgʻri" });
    db.prepare("UPDATE discovered_cameras SET kind = ?, kind_manual = ? WHERE id = ?").run(b.kind, b.kind ? 1 : 0, d.id);
  }
  if ("note" in b) {
    const note = String(b.note || "").trim().slice(0, 120) || null;
    db.prepare("UPDATE discovered_cameras SET note = ? WHERE id = ?").run(note, d.id);
  }
  res.json(toRow(getRow(d.id)));
});

// Ulangan kameradan kadr (tekshirish uchun).
router.get("/:id(\\d+)/snapshot", perm, async (req, res) => {
  const d = getRow(req.params.id);
  if (!d?.connected_at || !d.rtsp_path) return res.status(404).json({ error: "Avval kameraga ulaning" });
  try {
    const img = await grabFrame(rtspUrl({ ip: d.ip, port: d.rtsp_port, login: d.login, parol: d.parol, path: d.rtsp_path }));
    res.set({ "Content-Type": "image/jpeg", "Cache-Control": "no-store" }).send(img);
  } catch {
    res.status(502).json({ error: "Kadr olinmadi" });
  }
});

// Asosiy kameralarga o'tkazish (to'g'ridan IP kamera, source='scan').
router.post("/:id(\\d+)/promote", perm, requirePerm("cameras.manage"), async (req, res) => {
  const d = getRow(req.params.id);
  if (!d) return res.status(404).json({ error: "Topilmadi" });
  if (d.camera_id) return res.status(409).json({ error: "Bu kamera allaqachon qoʻshilgan" });
  if (d.nvr_id) return res.status(400).json({ error: "Bu NVR — kanallarini «NVR qurilmalar» boʻlimidan import qiling" });
  if (!d.connected_at || !d.rtsp_path) return res.status(400).json({ error: "Avval login/parol bilan ulaning" });
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 60) return res.status(400).json({ error: "Nom 1–60 belgi boʻlsin" });

  let slug = makeSlug(name) || "kamera";
  if (db.prepare("SELECT 1 FROM cameras WHERE slug = ?").get(slug)) slug = `${slug}-${d.ip.split(".").pop()}`;
  if (db.prepare("SELECT 1 FROM cameras WHERE slug = ?").get(slug)) {
    return res.status(409).json({ error: "Bu nomli kamera bor — boshqa nom tanlang" });
  }
  const camera = {
    name,
    slug,
    ip: d.ip,
    port: d.rtsp_port,
    login: d.login,
    parol: d.parol,
    rtsp_path: d.rtsp_path,
    codec: d.codec === "h264" || d.codec === "hevc" ? d.codec : null,
    sort_order: null,
    is_public: req.body?.isPublic ? 1 : 0,
    nvr_id: null,
    channel: null,
    stream: "main",
    source: "scan",
  };
  try {
    await addPath(camera);
  } catch (e) {
    return res.status(502).json({ error: "MediaMTX'ga ulanmadi: " + e.message });
  }
  const id = insertCamera(camera).lastInsertRowid;
  const groupId = Number(req.body?.groupId) || null;
  if (groupId) {
    db.prepare(
      "INSERT OR IGNORE INTO camera_group_items (group_id, camera_id) SELECT id, ? FROM camera_groups WHERE id = ?"
    ).run(id, groupId);
  }
  db.prepare("UPDATE discovered_cameras SET camera_id = ? WHERE id = ?").run(id, d.id);
  audit(req, "camera.create", { cameraId: id, details: { name, ip: d.ip, source: "scan" } });
  res.status(201).json({ camera: toApi(db.prepare(`${SELECT} WHERE c.id = ?`).get(id)), row: toRow(getRow(d.id)) });
});

// Ro'yxatdan olib tashlash (kamera emas yoki kerak emas). Keyingi skanda yana chiqishi mumkin.
router.delete("/:id(\\d+)", perm, (req, res) => {
  const d = getRow(req.params.id);
  if (!d) return res.status(404).json({ error: "Topilmadi" });
  db.prepare("DELETE FROM discovered_cameras WHERE id = ?").run(d.id);
  audit(req, "discovery.delete", { details: { ip: d.ip } });
  res.json({ ok: true });
});

export default router;
