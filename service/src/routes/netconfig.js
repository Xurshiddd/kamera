// =============================================================================
//  «Kamera IP/parol» bo'limi: ko'p kameraning IP manzilini (boshqa podsetga)
//  va/yoki parolini bir martada o'zgartirish. Har kamera uchun:
//    1) kameraga ulanish (joriy parol)  2) yangi IP bo'shligini tekshirish
//    3) parolni almashtirish  4) IP/maska/shlyuzni yozish va yangi manzilda
//    kamera (o'sha seriya raqami) paydo bo'lishini kutish
//    5) NVR kanalini (IP + parol) va tizimdagi yozuvlarni yangilash.
//
//  Xavfsizlik: netconfig.manage ruxsati + bo'limning ALOHIDA paroli. Parol
//  to'g'ri bo'lsa qisqa muddatli "ochish tokeni" beriladi (X-Netconfig-Token),
//  bo'lim parolini almashtirish barcha ochish tokenlarini bekor qiladi.
// =============================================================================

import { Router } from "express";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import db, { getSetting, setSetting } from "../db.js";
import { requirePerm } from "../auth.js";
import { audit, hashPassword, verifyPassword, SUPERADMIN } from "../rbac.js";
import { listChannels, setChannelSource } from "../hikvision.js";
import { isIp, isPrivate } from "../scanner.js";
import { stopLive } from "../live.js";
import { addPath, deletePath } from "../mediamtx.js";
import {
  login as camLogin, getNetwork, setNetwork, setPassword, waitFor, ipInUse,
  maskToBits, sameSubnet, passwordProblem, cam, probeInfo,
} from "../camnet.js";

const router = Router();
router.use(requirePerm("netconfig.manage"));

const JWT_SECRET = process.env.JWT_SECRET;
const UNLOCK_TTL = 20 * 60; // soniya
const PW_KEY = "netconfig_password_hash";
const VER_KEY = "netconfig_password_ver";
const isSuper = (u) => u?.roles?.includes(SUPERADMIN);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// .env dagi NETCONFIG_PASSWORD — faqat DB'da hali parol bo'lmasa (birinchi marta).
if (!getSetting(PW_KEY) && (process.env.NETCONFIG_PASSWORD || "").length >= 8) {
  setSetting(PW_KEY, hashPassword(process.env.NETCONFIG_PASSWORD));
  console.log("[netconfig] bo'lim paroli .env dan o'rnatildi");
}
const pwVer = () => Number(getSetting(VER_KEY) || 0);

// --- Ochish (alohida parol) ---
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 5;
const fails = new Map(); // userId -> { count, firstAt }
function blocked(userId) {
  const r = fails.get(userId);
  if (r && Date.now() - r.firstAt > WINDOW_MS) fails.delete(userId);
  return (fails.get(userId)?.count || 0) >= MAX_FAILS;
}
function addFail(userId) {
  const r = fails.get(userId) || { count: 0, firstAt: Date.now() };
  r.count++;
  fails.set(userId, r);
}

function requireUnlock(req, res, next) {
  const t = req.get("x-netconfig-token");
  try {
    const p = jwt.verify(t || "", JWT_SECRET, { algorithms: ["HS256"] });
    if (p.scope === "netconfig" && Number(p.sub) === req.user.id && p.pv === pwVer()) return next();
  } catch { /* pastda */ }
  return res.status(423).json({ error: "Boʻlim qulflangan — parolni qayta kiriting", locked: true });
}

router.get("/status", (req, res) => {
  res.json({ configured: Boolean(getSetting(PW_KEY)), canSetup: isSuper(req.user), ttl: UNLOCK_TTL });
});

// Birinchi marta parol o'rnatish (faqat superadmin, o'z hisob paroli bilan).
router.post("/setup", (req, res) => {
  if (!isSuper(req.user)) return res.status(403).json({ error: "Faqat superadmin oʻrnata oladi" });
  if (getSetting(PW_KEY)) return res.status(409).json({ error: "Parol allaqachon oʻrnatilgan" });
  const { accountPassword, password } = req.body || {};
  const u = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!verifyPassword(accountPassword, u?.password_hash)) return res.status(401).json({ error: "Hisob parolingiz notoʻgʻri" });
  if (typeof password !== "string" || password.length < 10) return res.status(400).json({ error: "Boʻlim paroli kamida 10 belgi boʻlsin" });
  if (password === accountPassword) return res.status(400).json({ error: "Boʻlim paroli hisob parolidan farq qilsin" });
  setSetting(PW_KEY, hashPassword(password));
  setSetting(VER_KEY, String(pwVer() + 1));
  audit(req, "netconfig.setup");
  res.json({ ok: true });
});

router.post("/unlock", async (req, res) => {
  if (!req.user.id) return res.status(403).json({ error: "Faqat xodim hisobi bilan" });
  const hash = getSetting(PW_KEY);
  if (!hash) return res.status(409).json({ error: "Boʻlim paroli hali oʻrnatilmagan" });
  if (blocked(req.user.id)) return res.status(429).json({ error: "Xato urinishlar koʻp. 15 daqiqadan soʻng qayta urining." });
  if (!verifyPassword(req.body?.password, hash)) {
    addFail(req.user.id);
    audit(req, "netconfig.unlock_fail");
    await sleep(700);
    return res.status(401).json({ error: "Boʻlim paroli notoʻgʻri" });
  }
  fails.delete(req.user.id);
  audit(req, "netconfig.unlock");
  const token = jwt.sign({ sub: String(req.user.id), scope: "netconfig", pv: pwVer() }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: UNLOCK_TTL,
  });
  res.json({ token, expiresIn: UNLOCK_TTL });
});

// Bo'lim parolini almashtirish (superadmin) — barcha ochish tokenlari bekor.
router.post("/password", requireUnlock, (req, res) => {
  if (!isSuper(req.user)) return res.status(403).json({ error: "Faqat superadmin almashtira oladi" });
  const { current, next } = req.body || {};
  if (!verifyPassword(current, getSetting(PW_KEY))) return res.status(401).json({ error: "Joriy boʻlim paroli notoʻgʻri" });
  if (typeof next !== "string" || next.length < 10) return res.status(400).json({ error: "Yangi parol kamida 10 belgi boʻlsin" });
  setSetting(PW_KEY, hashPassword(next));
  setSetting(VER_KEY, String(pwVer() + 1));
  audit(req, "netconfig.password");
  res.json({ ok: true });
});

// --- Qurilmalar ro'yxati (IP bo'yicha: bitta kamera bir nechta NVR'da bo'lishi mumkin) ---
const ipKey = (ip) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);

async function buildDevices() {
  const map = new Map();
  const warnings = [];
  const get = (ip) => {
    if (!map.has(ip)) map.set(ip, { ip, name: null, nvr: [], direct: null, discovered: null, online: null });
    return map.get(ip);
  };
  const nvrs = db.prepare("SELECT * FROM nvrs ORDER BY name").all();
  const nvrIps = new Set(nvrs.map((n) => n.ip));
  const camByCh = new Map(
    db.prepare("SELECT id, name, slug, nvr_id, channel FROM cameras WHERE nvr_id IS NOT NULL").all().map((c) => [`${c.nvr_id}:${c.channel}`, c])
  );
  const lists = await Promise.all(
    nvrs.map((n) =>
      listChannels(n).catch((e) => {
        warnings.push(`«${n.name}» NVR kanallarini olib boʻlmadi: ${e.message}`);
        return [];
      })
    )
  );
  nvrs.forEach((n, i) => {
    for (const ch of lists[i]) {
      if (!ch.ip || !isIp(ch.ip)) continue;
      const d = get(ch.ip);
      const c = camByCh.get(`${n.id}:${ch.channel}`);
      d.nvr.push({ nvr_id: n.id, nvr_name: n.name, channel: ch.channel, name: ch.name, online: ch.online, camera_id: c?.id ?? null });
      d.name ||= c?.name || ch.name || null;
      if (ch.online !== null) d.online = Boolean(d.online) || ch.online;
    }
  });
  for (const c of db.prepare("SELECT id, name, ip, login, parol FROM cameras WHERE nvr_id IS NULL AND ip != ''").all()) {
    if (!isIp(c.ip)) continue;
    const d = get(c.ip);
    d.direct = { id: c.id, name: c.name };
    d.name ||= c.name;
  }
  for (const r of db
    .prepare(
      `SELECT id, ip, device_name, note FROM discovered_cameras
       WHERE camera_id IS NULL AND nvr_id IS NULL AND (kind = 'camera' OR (kind IS NULL AND connected_at IS NOT NULL))`
    )
    .all()) {
    const d = get(r.ip);
    d.discovered = { id: r.id };
    d.name ||= r.note || r.device_name || null;
  }
  for (const ip of nvrIps) map.delete(ip);
  const devices = [...map.values()].sort((a, b) => ipKey(a.ip) - ipKey(b.ip));
  return { devices, warnings, nvrIps };
}

// Kamera uchun saqlangan login/parollar (to'g'ridan qo'shilgan yoki skanerda ulangan).
function savedCreds(d) {
  const out = [];
  if (d.direct) {
    const c = db.prepare("SELECT login, parol FROM cameras WHERE id = ?").get(d.direct.id);
    if (c?.login && c?.parol) out.push(c);
  }
  if (d.discovered) {
    const c = db.prepare("SELECT login, parol FROM discovered_cameras WHERE id = ?").get(d.discovered.id);
    if (c?.login && c?.parol) out.push(c);
  }
  return out;
}

router.get("/devices", requireUnlock, async (req, res) => {
  const { devices, warnings } = await buildDevices();
  res.json({
    devices: devices.map((d) => ({ ...d, saved_creds: savedCreds(d).length > 0 })),
    warnings,
  });
});

// =============================================================================
//  Ish (job): bir vaqtda bittasi, fonda. Login/parollar faqat yopiq
//  o'zgaruvchida (job obyektida emas) va ish tugashi bilan unutiladi.
// =============================================================================
let job = null;
const CONCURRENCY = 4;

const publicJob = (j) => j && {
  id: j.id, mode: j.mode, running: j.running, cancelled: j.cancelled,
  started_at: j.started_at, finished_at: j.finished_at, by: j.by,
  settings: j.settings,
  items: j.items,
  summary: {
    total: j.items.length,
    ok: j.items.filter((i) => i.state === "ok").length,
    warn: j.items.filter((i) => i.state === "warn").length,
    error: j.items.filter((i) => i.state === "error").length,
    queued: j.items.filter((i) => i.state === "queued").length,
    running: j.items.filter((i) => i.state === "running").length,
  },
};

router.get("/jobs/current", requireUnlock, (req, res) => res.json(publicJob(job)));

router.post("/jobs/current/cancel", requireUnlock, (req, res) => {
  if (!job?.running) return res.status(409).json({ error: "Ishlayotgan vazifa yoʻq" });
  job.cancelled = true;
  audit(req, "netconfig.cancel", { details: { id: job.id } });
  res.json(publicJob(job));
});

router.post("/jobs", requireUnlock, async (req, res) => {
  if (job?.running) return res.status(409).json({ error: "Boshqa vazifa hali tugamagan" });
  const b = req.body || {};
  const mode = b.mode === "apply" ? "apply" : "check";
  const login = String(b.login || "").trim();
  const parol = String(b.parol || "");
  const newParol = mode === "apply" && b.newParol ? String(b.newParol) : "";
  const mask = String(b.mask || "").trim();
  const gateway = String(b.gateway || "").trim();
  const dns = String(b.dns || "").trim();
  const raw = Array.isArray(b.items) ? b.items : [];
  if (!raw.length) return res.status(400).json({ error: "Kamera tanlanmagan" });
  if (raw.length > 300) return res.status(400).json({ error: "Bir martada 300 tadan koʻp kamera boʻlmasin" });
  if (!login || !parol) return res.status(400).json({ error: "Kameralarning joriy login va parolini kiriting" });
  if (newParol) {
    const p = passwordProblem(newParol);
    if (p) return res.status(400).json({ error: `Yangi parol: ${p}` });
  }

  const { devices, nvrIps } = await buildDevices();
  const byIp = new Map(devices.map((d) => [d.ip, d]));
  const items = [];
  const seenNew = new Set();
  const seenOld = new Set();
  for (const r of raw) {
    const ip = String(r?.ip || "").trim();
    const d = byIp.get(ip);
    if (!d) return res.status(400).json({ error: `${ip || "?"} — roʻyxatda yoʻq (sahifani yangilang)` });
    if (seenOld.has(ip)) return res.status(400).json({ error: `${ip} ikki marta tanlangan` });
    seenOld.add(ip);
    let newIp = mode === "apply" ? String(r?.newIp || "").trim() : "";
    if (newIp === ip) newIp = "";
    if (newIp) {
      if (!isIp(newIp) || !isPrivate(newIp)) return res.status(400).json({ error: `${newIp} — notoʻgʻri yoki lokal boʻlmagan manzil` });
      if (seenNew.has(newIp)) return res.status(400).json({ error: `${newIp} ikki kameraga berilgan` });
      if (byIp.has(newIp) || nvrIps.has(newIp)) return res.status(400).json({ error: `${newIp} — bu manzilda tizimdagi boshqa qurilma bor` });
      seenNew.add(newIp);
    }
    items.push({ ip, newIp: newIp || null, name: d.name, nvr: d.nvr.map((n) => `${n.nvr_name} · D${n.channel}`), state: "queued", step: null, msg: null });
  }

  if (mode === "apply") {
    const changesIp = items.some((i) => i.newIp);
    if (!changesIp && !newParol) return res.status(400).json({ error: "Oʻzgarish yoʻq: yangi IP yoki yangi parol kiriting" });
    if (changesIp) {
      const bits = maskToBits(mask);
      if (bits === null || bits < 8 || bits > 30) return res.status(400).json({ error: "Tarmoq maskasi notoʻgʻri (masalan 255.255.255.0)" });
      if (!gateway || !isIp(gateway)) return res.status(400).json({ error: "Shlyuz (gateway) manzilini kiriting" });
      if (dns && !isIp(dns)) return res.status(400).json({ error: "DNS manzili notoʻgʻri" });
      for (const i of items) {
        if (!i.newIp) continue;
        if (!sameSubnet(i.newIp, gateway, mask)) return res.status(400).json({ error: `${i.newIp} shlyuz ${gateway} bilan bir tarmoqda emas` });
        if (i.newIp === gateway) return res.status(400).json({ error: `${i.newIp} — shlyuz manzili kameraga berilmaydi` });
        const size = 2 ** (32 - bits);
        const host = ipKey(i.newIp) % size;
        if (host === 0 || host === size - 1) return res.status(400).json({ error: `${i.newIp} — tarmoq yoki broadcast manzili` });
      }
    }
  }

  job = {
    id: crypto.randomUUID(),
    mode,
    running: true,
    cancelled: false,
    started_at: new Date().toISOString(),
    finished_at: null,
    by: req.user.username,
    settings: { mask: mask || null, gateway: gateway || null, dns: dns || null, login, passwordChange: Boolean(newParol) },
    items,
  };
  const actor = { user: req.user, clientIp: req.clientIp };
  audit(req, `netconfig.${mode}`, {
    details: { count: items.length, ipChanges: items.filter((i) => i.newIp).length, passwordChange: Boolean(newParol), gateway: gateway || null },
  });
  res.status(202).json(publicJob(job));

  const opts = { mode, login, parol, newParol, mask, gateway, dns, byIp, actor };
  const j = job;
  runJob(j, opts)
    .catch((e) => console.error("[netconfig]", e))
    .finally(() => {
      j.running = false;
      j.finished_at = new Date().toISOString();
      for (const i of j.items) if (i.state === "queued") Object.assign(i, { state: "skipped", msg: "Bekor qilindi" });
      opts.parol = opts.newParol = null; // parollarni xotirada saqlamaymiz
    });
});

async function runJob(j, opts) {
  let next = 0;
  const worker = async () => {
    while (next < j.items.length && !j.cancelled) {
      const it = j.items[next++];
      try {
        await processItem(it, opts);
      } catch (e) {
        Object.assign(it, { state: "error", msg: e.message || String(e) });
      }
      it.step = null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, j.items.length) }, worker));
}

// Bir NVR'ga ketma-ket yozamiz (parallel PUT'lar NVR'ni chalg'itmasin).
const nvrLocks = new Map();
function withNvr(nvrId, fn) {
  const prev = nvrLocks.get(nvrId) || Promise.resolve();
  const p = prev.catch(() => {}).then(fn);
  nvrLocks.set(nvrId, p.catch(() => {}));
  return p;
}

async function processItem(it, o) {
  const d = o.byIp.get(it.ip);
  it.state = "running";
  const step = (s) => (it.step = s);

  // 1) Ulanish: kiritilgan parol, saqlangan parol(lar), va (qayta urinishda)
  //    allaqachon o'rnatilgan yangi parol.
  step("Kameraga ulanmoqda");
  const cands = [{ login: o.login, parol: o.parol }, ...savedCreds(d)];
  if (o.newParol) cands.push({ login: o.login, parol: o.newParol });
  let conn;
  let moved = false;
  try {
    conn = await camLogin(it.ip, cands);
  } catch (e) {
    // Oldingi urinishda IP o'zgargan bo'lishi mumkin — yangi manzilni tekshiramiz.
    if (e.reason === "down" && it.newIp) {
      conn = await camLogin(it.newIp, cands).catch(() => null);
      moved = Boolean(conn);
    }
    if (!conn) throw e;
  }
  let c = conn.creds;
  const vendor = conn.vendor;
  const serial = conn.info.serial;
  it.model = [vendor === "dahua" ? "Dahua" : "Hikvision", conn.info.model].filter(Boolean).join(" ");
  it.serial = serial;

  step("Tarmoq sozlamasi oʻqilmoqda");
  const net = await getNetwork(c, vendor);
  it.current = { ip: net.ip, mask: net.mask, gateway: net.gateway, dhcp: net.dhcp };
  if (o.mode === "check") {
    const pwNote = o.newParol ? "" : c.parol === o.parol ? "" : " (saqlangan parol bilan ulandi)";
    Object.assign(it, { state: "ok", msg: `Ulandi${pwNote}${net.dhcp ? " · DHCP rejimida" : ""}` });
    return;
  }

  // 2) Yangi IP band emasmi — hech narsa o'zgartirishdan OLDIN.
  if (it.newIp && !moved) {
    step("Yangi manzil tekshirilmoqda");
    if (await ipInUse(it.newIp)) throw new Error(`${it.newIp} band — tarmoqda boshqa qurilma javob beryapti`);
  }

  const notes = [];
  let pwChanged = Boolean(o.newParol) && c.parol === o.newParol;
  // 3) Parol.
  if (o.newParol && !pwChanged) {
    step("Parol almashtirilmoqda");
    await setPassword(c, o.newParol, vendor);
    const c2 = cam(c.ip, c.login, o.newParol);
    let ok = false;
    for (let k = 0; k < 4 && !ok; k++) {
      await sleep(1500);
      ok = await probeInfo(c2, vendor).then(() => true, () => false);
    }
    if (!ok) throw new Error("Kamera yangi parolni tasdiqlamadi — kamera sahifasida tekshiring");
    c = c2;
    pwChanged = true;
    notes.push("parol almashtirildi");
  }

  // 4) IP.
  let finalIp = c.ip;
  let ipError = null;
  if (it.newIp && !moved) {
    step("IP manzil yozilmoqda");
    const r = await setNetwork(c, net, { ip: it.newIp, mask: o.mask, gateway: o.gateway, dns: o.dns });
    step(r.rebooted ? "Kamera qayta ishga tushmoqda" : "Yangi manzil kutilmoqda");
    const info = await waitFor(it.newIp, c, serial, {
      timeoutMs: r.rebooted ? 240000 : 150000,
      vendor,
      onTick: (s) => step(`Yangi manzil kutilmoqda (${s} s)`),
    });
    if (info) {
      finalIp = it.newIp;
      notes.push(`IP → ${it.newIp}`);
    } else {
      const oldAlive = await probeInfo(c, vendor).then(() => true, () => false);
      if (oldAlive) ipError = "Kamera IP manzilni oʻzgartirmadi (eski manzilda ishlayapti)";
      else {
        finalIp = it.newIp;
        notes.push(`IP → ${it.newIp} (tasdiqlanmadi)`);
        it.unverified = true;
      }
    }
  } else if (moved) {
    finalIp = it.newIp;
    notes.push(`IP allaqachon ${it.newIp}`);
  }
  const ipChanged = finalIp !== it.ip;

  // 5) NVR va tizimdagi yozuvlar.
  const nvrErrors = [];
  if (ipChanged || pwChanged) {
    step("NVR yangilanmoqda");
    for (const ref of d.nvr) {
      const nvr = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(ref.nvr_id);
      if (!nvr) continue;
      try {
        await withNvr(nvr.id, () =>
          setChannelSource(nvr, ref.channel, { ip: ipChanged ? finalIp : null, password: pwChanged ? o.newParol : null })
        );
        if (ipChanged) db.prepare("UPDATE cameras SET cam_ip = ? WHERE nvr_id = ? AND channel = ?").run(finalIp, nvr.id, ref.channel);
        if (ref.camera_id) {
          const cm = db.prepare("SELECT id, slug FROM cameras WHERE id = ?").get(ref.camera_id);
          if (cm) await stopLive(cm.id, cm.slug);
        }
      } catch (e) {
        nvrErrors.push(`${nvr.name} · D${ref.channel}: ${e.message}`);
      }
    }
    if (d.direct) {
      const cm = db.prepare("SELECT * FROM cameras WHERE id = ?").get(d.direct.id);
      if (cm) {
        const upd = { ...cm, ip: finalIp, login: c.login, parol: c.parol };
        db.prepare("UPDATE cameras SET ip = ?, login = ?, parol = ? WHERE id = ?").run(upd.ip, upd.login, upd.parol, cm.id);
        await deletePath(cm.slug);
        await addPath(upd).catch((e) => nvrErrors.push(`MediaMTX: ${e.message}`));
      }
    }
    if (d.discovered) {
      db.transaction(() => {
        if (ipChanged) db.prepare("DELETE FROM discovered_cameras WHERE ip = ? AND id != ?").run(finalIp, d.discovered.id);
        db.prepare("UPDATE discovered_cameras SET ip = ?, login = ?, parol = ? WHERE id = ?").run(finalIp, c.login, c.parol, d.discovered.id);
      })();
    }
    if (ipChanged) {
      // Skaner ro'yxatidagi eski manzil endi bo'sh.
      db.prepare("DELETE FROM discovered_cameras WHERE ip = ? AND camera_id IS NULL AND nvr_id IS NULL").run(it.ip);
    }
  }

  audit(o.actor, "netconfig.camera", {
    cameraId: d.direct?.id ?? d.nvr.find((n) => n.camera_id)?.camera_id ?? null,
    details: { ip: it.ip, newIp: ipChanged ? finalIp : null, passwordChanged: pwChanged, ipError, nvrErrors: nvrErrors.length ? nvrErrors : undefined },
  });

  const problems = [ipError, ...nvrErrors.map((e) => `NVR yangilanmadi — ${e}`)].filter(Boolean);
  if (it.unverified) problems.push("Server yangi manzilga ulana olmadi — tarmoq marshrutini (VLAN/shlyuz) tekshiring");
  const msg = [notes.join(", ") || "Oʻzgarish kerak emas edi", ...problems].join(". ");
  it.state = ipError && !pwChanged ? "error" : problems.length ? "warn" : "ok";
  it.msg = msg;
  it.finalIp = finalIp;
}

export default router;
