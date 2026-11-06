// =============================================================================
//  So'rov bo'yicha (on-demand) jonli oqim — NVR kameralari uchun.
//
//  NVR'da 100+ kamera bor; hammasini 24/7 tortish NVR'dan yuzlab Mbps va
//  serverda yuzlab ffmpeg degani. Shuning uchun NVR kamerasi faqat kimdir
//  ko'rayotganda yoqiladi: pleyer har ~20s da /api/live/:id/watch chaqiradi
//  (heartbeat), oxirgi heartbeat'dan IDLE_MS o'tsa oqim o'chiriladi.
//
//  To'g'ridan ulangan (NVR'siz) kameralar avvalgidek always-on qoladi.
// =============================================================================

import fs from "node:fs/promises";
import path from "node:path";
import db from "./db.js";
import { addPath, deletePath, probeCodec } from "./mediamtx.js";

const IDLE_MS = Number(process.env.LIVE_IDLE_SECONDS || 60) * 1000;
const MAX_ACTIVE = Number(process.env.LIVE_MAX_ACTIVE || 32);

const HLS_DIR = process.env.HLS_DIR || null;

const active = new Map(); // cameraId -> { slug, lastSeen, ready: Promise }

// MediaMTX yo'lni o'chirganda segment fayllarini diskda qoldiradi. Keyingi
// ochilishda gateway eski (qotib qolgan) playlist'ni bermasligi uchun
// katalogni o'chiramiz. Slug faqat [a-z0-9-] — yo'l tashqarisiga chiqolmaydi.
async function stopPath(slug) {
  await deletePath(slug);
  if (!HLS_DIR || !/^[a-z0-9-]+$/.test(slug)) return;
  await fs.rm(path.join(HLS_DIR, slug), { recursive: true, force: true }).catch(() => {});
}

export const isOnDemand = (camera) => Boolean(camera.nvr_id);

export function activeCount() {
  return active.size;
}

// Kamerani ko'rish boshlandi / davom etmoqda. Birinchi chaqiruvda MediaMTX
// yo'lini yaratadi (ffmpeg NVR'dan tortishni boshlaydi).
export async function watch(camera) {
  if (!isOnDemand(camera)) return { started: false };
  const now = Date.now();
  const cur = active.get(camera.id);
  if (cur) {
    cur.lastSeen = now;
    await cur.ready;
    return { started: false };
  }
  if (active.size >= MAX_ACTIVE) {
    const err = new Error("Bir vaqtda ochiq oqimlar chegarasiga yetildi. Birozdan so'ng urining.");
    err.status = 503;
    throw err;
  }

  const entry = { slug: camera.slug, lastSeen: now, ready: null };
  entry.ready = (async () => {
    // Kodek noma'lum bo'lsa bir marta aniqlab, saqlab qo'yamiz (H264 -> copy).
    if (!camera.codec) {
      const codec = await probeCodec(camera);
      if (codec) {
        camera.codec = codec;
        db.prepare("UPDATE cameras SET codec = ? WHERE id = ?").run(codec, camera.id);
      }
    }
    await addPath(camera);
  })();
  active.set(camera.id, entry);
  try {
    await entry.ready;
  } catch (e) {
    active.delete(camera.id);
    throw e;
  }
  return { started: true };
}

// Kamera o'chirildi/tahrirlandi — oqimni darhol to'xtatamiz (keyingi
// heartbeat yangi sozlama bilan qayta yoqadi).
export async function stopLive(cameraId, slug) {
  const cur = active.get(cameraId);
  active.delete(cameraId);
  await stopPath(cur?.slug || slug);
}

// Hech kim ko'rmayotgan oqimlarni o'chiramiz.
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of active) {
    if (now - e.lastSeen > IDLE_MS) {
      active.delete(id);
      stopPath(e.slug);
    }
  }
}, 15000).unref();
