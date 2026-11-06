import { Router } from "express";
import fs from "node:fs";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit, canAccessCamera } from "../rbac.js";
import { searchRecordings } from "../hikvision.js";
import {
  TIME_RE, nvrOf, startSession, beat, stopSession,
  createExport, listExports, getExport, exportFile, deleteExport, EXPORT_MAX_MINUTES,
} from "../playback.js";

const router = Router();
const view = requirePerm("playback.view");

// Kamera + ruxsat tekshiruvi. Xato bo'lsa javobni o'zi yuboradi va null qaytaradi.
function cameraFor(req, res, id) {
  const camera = db.prepare("SELECT * FROM cameras WHERE id = ?").get(Number(id));
  if (!camera) return res.status(404).json({ error: "Kamera topilmadi" }), null;
  if (!canAccessCamera(req.user, camera.id)) return res.status(403).json({ error: "Ruxsat yo'q" }), null;
  if (!camera.nvr_id) return res.status(400).json({ error: "Bu kamera NVR'ga ulanmagan — yozuvlar yo'q" }), null;
  return camera;
}

const fail = (res, e) => res.status(e.status || 502).json({ error: e.message });

// Kun bo'yicha yozuvlar (timeline uchun): ?date=YYYY-MM-DD
router.get("/playback/:id(\\d+)/day", view, async (req, res) => {
  const camera = cameraFor(req, res, req.params.id);
  if (!camera) return;
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "date=YYYY-MM-DD kerak" });
  try {
    const from = `${date}T00:00:00`;
    const to = `${date}T23:59:59`;
    const ranges = (await searchRecordings(nvrOf(camera), camera.channel, from, to)).map((r) => ({
      start: r.start < from ? from : r.start,
      end: r.end > to ? to : r.end,
    }));
    res.json({ date, ranges });
  } catch (e) {
    fail(res, e);
  }
});

// Oy bo'yicha yozuvi bor kunlar (kalendar uchun): ?month=YYYY-MM
router.get("/playback/:id(\\d+)/days", view, async (req, res) => {
  const camera = cameraFor(req, res, req.params.id);
  if (!camera) return;
  const month = String(req.query.month || "");
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "month=YYYY-MM kerak" });
  try {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${month}-01T00:00:00`;
    const to = `${month}-${String(last).padStart(2, "0")}T23:59:59`;
    const days = new Set();
    for (const r of await searchRecordings(nvrOf(camera), camera.channel, from, to)) {
      // Oraliq qamragan har bir kunni belgilaymiz.
      for (let d = Date.parse(`${r.start.slice(0, 10)}T00:00:00Z`); d <= Date.parse(`${r.end.slice(0, 10)}T00:00:00Z`); d += 86400000) {
        const day = new Date(d).toISOString().slice(0, 10);
        if (day.startsWith(month)) days.add(day);
      }
    }
    res.json({ month, days: [...days].sort() });
  } catch (e) {
    fail(res, e);
  }
});

// --- Ko'rish sessiyalari ---
router.post("/playback/sessions", view, async (req, res) => {
  const { cameraId, start } = req.body || {};
  if (!TIME_RE.test(start || "")) return res.status(400).json({ error: "start=YYYY-MM-DDTHH:MM:SS kerak" });
  const camera = cameraFor(req, res, cameraId);
  if (!camera) return;
  try {
    const s = await startSession({ user: req.user, camera, start });
    audit(req, "playback.view", { cameraId: camera.id, details: { start } });
    res.status(201).json(s);
  } catch (e) {
    fail(res, e);
  }
});

router.post("/playback/sessions/:sid/beat", view, (req, res) => {
  beat(req.params.sid, req.user) ? res.json({ ok: true }) : res.status(404).json({ error: "Sessiya tugagan" });
});

router.delete("/playback/sessions/:sid", view, (req, res) => {
  stopSession(req.params.sid, req.user);
  res.json({ ok: true });
});

// --- Eksport (qirqib yuklab olish) ---
const exp = requirePerm("playback.export");

router.get("/playback/exports/limits", exp, (req, res) => res.json({ maxMinutes: EXPORT_MAX_MINUTES }));

router.post("/playback/exports", exp, (req, res) => {
  const { cameraId, start, end } = req.body || {};
  if (!TIME_RE.test(start || "") || !TIME_RE.test(end || "")) {
    return res.status(400).json({ error: "start va end = YYYY-MM-DDTHH:MM:SS kerak" });
  }
  const camera = cameraFor(req, res, cameraId);
  if (!camera) return;
  try {
    const job = createExport({ user: req.user, camera, start, end });
    audit(req, "playback.export", { cameraId: camera.id, details: { start, end } });
    res.status(201).json(job);
  } catch (e) {
    fail(res, e);
  }
});

router.get("/playback/exports", exp, (req, res) => res.json(listExports(req.user)));

router.get("/playback/exports/:jid", exp, (req, res) => {
  const j = getExport(req.params.jid, req.user);
  j ? res.json(j) : res.status(404).json({ error: "Topilmadi" });
});

router.delete("/playback/exports/:jid", exp, (req, res) => {
  deleteExport(req.params.jid, req.user) ? res.json({ ok: true }) : res.status(404).json({ error: "Topilmadi" });
});

// Fayl: brauzer <a href> orqali (Authorization yubora olmaydi) — job kaliti bilan.
router.get("/playback/exports/:jid/file", (req, res) => {
  const j = exportFile(req.params.jid, req.query.key);
  if (!j) return res.status(404).json({ error: "Fayl topilmadi yoki muddati o'tgan" });
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Disposition", `attachment; filename="${j.filename}"`);
  res.setHeader("Content-Length", fs.statSync(j.file).size);
  fs.createReadStream(j.file).pipe(res);
});

export default router;
