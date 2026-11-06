// =============================================================================
//  Yozuvlarni qayta ko'rish (playback) va qirqib yuklab olish (export).
//
//  Vaqtlar hamma joyda NVR'ning MAHALLIY vaqti, "YYYY-MM-DDTHH:MM:SS" satr
//  (hikvision.js'dagi izohga qarang). Hisob-kitob uchun sekundga
//  o'giriladi — zona ahamiyatsiz, faqat ayirma kerak.
//
//  Ko'rish: NVR RTSP playback (real vaqt tezligida) -> ffmpeg -> HLS
//    /hls-pb/<sessiya-uuid>/index.m3u8. UUID taxmin qilib bo'lmaydi (122 bit)
//    va sessiya heartbeat'siz 60s da o'chadi — "imzolangan URL" kabi.
//  Eksport: kerakli NVR fayllari ISAPI orqali TEZ yuklanadi va ffmpeg
//    bilan qirqiladi -> MP4. Fon ishi (job), progress bilan.
// =============================================================================

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import db from "./db.js";
import { downloadFile, playbackUrl, searchFiles } from "./hikvision.js";
import { probeCodec } from "./mediamtx.js";

const PB_DIR = process.env.HLS_PB_DIR || "/hls-pb";
const EXPORT_DIR = path.join(process.env.DATA_DIR || "data", "exports");
fs.mkdirSync(EXPORT_DIR, { recursive: true });

const IDLE_MS = 60 * 1000;
const MAX_SESSIONS = Number(process.env.PLAYBACK_MAX_SESSIONS || 8);
const MAX_SESSIONS_PER_USER = 4;
export const EXPORT_MAX_MINUTES = Number(process.env.EXPORT_MAX_MINUTES || 24 * 60);
const EXPORT_TTL_MS = Number(process.env.EXPORT_TTL_MINUTES || 120) * 60 * 1000;
const EXPORT_PARALLEL = 2;
// Yozuvlarda kalit kadr (I-frame) oralig'i katta (bu NVR'da ~12s). Transkodsiz
// qirqishda klip so'ralgan soniyadan boshlanishi uchun shuncha oldindan
// olamiz, keyin MP4 edit-list bilan aniq joydan boshlaymiz.
const PREROLL_SEC = Number(process.env.EXPORT_PREROLL_SECONDS || 15);
// Ko'rish: "transcode" (default) — 720p, kalit kadr har 1s -> birinchi kadr tez
// chiqadi, lekin har sessiya ~0.3-0.6 CPU yadro. "copy" — CPU ~0, lekin
// birinchi segment kamera I-frame oralig'icha (bu yerda ~12s) kutadi.
const PLAYBACK_MODE = process.env.PLAYBACK_MODE === "copy" ? "copy" : "transcode";

// --- Vaqt yordamchilari ---
export const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
export const toSec = (s) => Date.parse(`${s}Z`) / 1000;
export const fromSec = (n) => new Date(n * 1000).toISOString().slice(0, 19);

export function nvrOf(camera) {
  const nvr = camera.nvr_id && db.prepare("SELECT * FROM nvrs WHERE id = ?").get(camera.nvr_id);
  if (!nvr) {
    const e = new Error("Bu kamera NVR'ga ulanmagan — yozuvlar yo'q");
    e.status = 400;
    throw e;
  }
  return nvr;
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// =============================================================================
//  Ko'rish sessiyalari
// =============================================================================
const sessions = new Map(); // id -> { id, userId, cameraId, start, proc, lastSeen, dir }

function killSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try {
    s.proc.kill("SIGKILL");
  } catch {}
  fs.rm(s.dir, { recursive: true, force: true }, () => {});
}

export async function startSession({ user, camera, start }) {
  const nvr = nvrOf(camera);
  // copy rejimida kodek kerak (H264 -> copy, boshqasi -> transkod).
  if (PLAYBACK_MODE === "copy" && !camera.codec) {
    camera.codec = await probeCodec(camera);
    if (camera.codec) db.prepare("UPDATE cameras SET codec = ? WHERE id = ?").run(camera.codec, camera.id);
  }
  // Bir foydalanuvchi bir kamerani qayta ochsa — eskisini yopamiz (vaqtga sakrash).
  for (const s of sessions.values()) {
    if (s.userId === user.id && s.cameraId === camera.id) killSession(s.id);
  }
  const mine = [...sessions.values()].filter((s) => s.userId === user.id).length;
  if (mine >= MAX_SESSIONS_PER_USER) {
    throw httpError(429, `Bir vaqtda ${MAX_SESSIONS_PER_USER} tadan ko'p yozuv ochib bo'lmaydi`);
  }
  if (sessions.size >= MAX_SESSIONS) {
    throw httpError(503, "Server band: ochiq yozuvlar chegarasi. Birozdan so'ng urining.");
  }

  const id = crypto.randomUUID();
  const dir = path.join(PB_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const video =
    PLAYBACK_MODE === "copy" && camera.codec === "h264"
      ? ["-c:v", "copy"]
      : ["-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
         "-g", "25", "-keyint_min", "25", "-sc_threshold", "0",
         "-b:v", "1200k", "-maxrate", "1500k", "-bufsize", "3M"];
  const args = [
    "-hide_banner", "-loglevel", "error",
    "-rtsp_transport", "tcp", "-fflags", "+genpts",
    "-i", playbackUrl(nvr, camera.channel, start),
    "-map", "0:v:0", "-map", "0:a:0?",
    ...video,
    "-c:a", "aac", "-b:a", "64k", "-ar", "48000",
    "-f", "hls", "-hls_time", "2", "-hls_list_size", "0",
    "-hls_playlist_type", "event", // pleyer yuklanganini orqaga surib ko'ra oladi
    "-hls_segment_filename", path.join(dir, "s%05d.ts"),
    path.join(dir, "index.m3u8"),
  ];
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
  proc.on("exit", (code) => {
    if (code && sessions.has(id)) console.error(`[playback ${id}] ffmpeg ${code}: ${err.trim()}`);
  });

  sessions.set(id, { id, userId: user.id, cameraId: camera.id, start, proc, lastSeen: Date.now(), dir });
  return { id, start, hls: `/hls-pb/${id}/index.m3u8` };
}

export function beat(id, user) {
  const s = sessions.get(id);
  if (!s || s.userId !== user.id) return false;
  s.lastSeen = Date.now();
  return true;
}

export function stopSession(id, user) {
  const s = sessions.get(id);
  if (!s || s.userId !== user.id) return false;
  killSession(id);
  return true;
}

// =============================================================================
//  Eksport (qirqib yuklab olish)
// =============================================================================
const jobs = new Map(); // id -> job
const queue = [];
let running = 0;

function publicJob(j) {
  return {
    id: j.id,
    cameraId: j.cameraId,
    cameraName: j.cameraName,
    start: j.start,
    end: j.end,
    status: j.status, // queued | running | done | error
    progress: j.progress,
    size: j.size,
    error: j.error,
    filename: j.filename,
    createdAt: j.createdAt,
    // Brauzer <a href> bilan yuklashi uchun (Authorization header yubora olmaydi):
    // faqat egasiga ko'rinadigan bir martalik emas, lekin taxmin qilib bo'lmaydigan kalit.
    downloadKey: j.status === "done" ? j.key : undefined,
  };
}

export function createExport({ user, camera, start, end }) {
  nvrOf(camera);
  const dur = toSec(end) - toSec(start);
  if (!(dur > 0)) throw httpError(400, "Tugash vaqti boshlanishdan keyin bo'lishi kerak");
  if (dur > EXPORT_MAX_MINUTES * 60) {
    throw httpError(400, `Eng ko'pi ${EXPORT_MAX_MINUTES} daqiqa qirqish mumkin`);
  }
  const active = [...jobs.values()].filter(
    (j) => j.userId === user.id && (j.status === "queued" || j.status === "running")
  ).length;
  if (active >= 3) throw httpError(429, "Avvalgi yuklab olishlar tugashini kuting");

  const id = crypto.randomUUID();
  const hhmm = (s) => s.slice(11, 16).replace(":", "");
  const job = {
    id,
    key: crypto.randomBytes(24).toString("base64url"),
    userId: user.id,
    cameraId: camera.id,
    cameraName: camera.name,
    camera,
    start,
    end,
    status: "queued",
    progress: 0,
    size: null,
    error: null,
    filename: `${camera.slug}_${start.slice(0, 10)}_${hhmm(start)}-${hhmm(end)}.mp4`,
    file: path.join(EXPORT_DIR, `${id}.mp4`),
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(id, job);
  queue.push(job);
  pump();
  return publicJob(job);
}

export function listExports(user) {
  return [...jobs.values()]
    .filter((j) => j.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicJob);
}

export function getExport(id, user) {
  const j = jobs.get(id);
  return j && j.userId === user.id ? publicJob(j) : null;
}

// Yuklab olish: egasining tokeni YOKI job kaliti (href uchun).
export function exportFile(id, key) {
  const j = jobs.get(id);
  if (!j || j.status !== "done") return null;
  const a = Buffer.from(String(key || ""));
  const b = Buffer.from(j.key);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return j;
}

export function deleteExport(id, user) {
  const j = jobs.get(id);
  if (!j || j.userId !== user.id) return false;
  j.cancelled = true;
  j.abort?.();
  jobs.delete(id);
  fs.rm(j.file, { force: true }, () => {});
  return true;
}

function pump() {
  while (running < EXPORT_PARALLEL && queue.length) {
    const job = queue.shift();
    if (job.cancelled) continue;
    running++;
    job.status = "running";
    runExport(job)
      .then(() => {
        job.status = "done";
        job.progress = 1;
        job.size = fs.statSync(job.file).size;
      })
      .catch((e) => {
        job.status = "error";
        job.error = e.message;
        fs.rm(job.file, { force: true }, () => {});
        if (!job.cancelled) console.error(`[export ${job.id}]`, e.message);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        job.camera = null;
        running--;
        pump();
      });
  }
}

// ffmpeg'ni ishga tushiradi; stdin'ga oqim beriladi. -progress orqali
// out_time'ni o'qib onTime(sekund) chaqiradi.
function runFfmpeg(args, { input, onTime, job }) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-progress", "pipe:1", "-nostats", ...args], {
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let err = "";
    proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    proc.stdout.on("data", (d) => {
      const m = String(d).match(/out_time_us=(\d+)/g);
      if (m && onTime) onTime(Number(m[m.length - 1].split("=")[1]) / 1e6);
    });
    const prevAbort = job.abort;
    job.abort = () => {
      proc.kill("SIGKILL");
      input?.destroy();
    };
    if (input) {
      input.pipe(proc.stdin);
      // ffmpeg kerakli joyni o'qib bo'lib chiqsa — NVR'dan yuklashni to'xtatamiz.
      proc.stdin.on("error", () => {});
      input.on("error", () => {});
    }
    proc.on("exit", (code) => {
      input?.destroy();
      job.abort = prevAbort;
      if (job.cancelled) return reject(new Error("Bekor qilindi"));
      code === 0 ? resolve() : reject(new Error(`ffmpeg xatosi: ${err.trim().split("\n").pop() || code}`));
    });
  });
}

async function runExport(job) {
  const { camera } = job;
  const nvr = nvrOf(camera);
  const s0 = toSec(job.start);
  const s1 = toSec(job.end);
  const total = s1 - s0;

  // Fayllarning HAQIQIY chegarasini bilish uchun oynani 1 kun oldindan
  // boshlaymiz (aks holda NVR birinchi fayl boshini so'rov boshiga qirqib
  // ko'rsatadi va ichidagi siljish noto'g'ri hisoblanadi).
  const files = (await searchFiles(nvr, camera.channel, fromSec(s0 - 86400), job.end)).filter(
    (f) => toSec(f.end) > s0 && toSec(f.start) < s1
  );
  if (!files.length) throw new Error("Bu oraliqda yozuv topilmadi");

  // Birinchi bo'lak PREROLL soniya oldindan (kalit kadr tushib qolmasin).
  const a0 = Math.max(s0 - PREROLL_SEC, toSec(files[0].start));
  // Yozuv so'ralgan vaqtdan KEYIN boshlansa (bo'shliq) a0 > s0 -> preroll 0.
  const preroll = Math.max(0, s0 - a0);
  const want = total + preroll;

  const tmp = `${job.file}.parts`;
  fs.mkdirSync(tmp, { recursive: true });
  const parts = [];
  let done = 0;
  try {
    // 1) Har bir NVR faylidan kerakli qism: tez yuklash (ISAPI) + qirqish (copy).
    for (const [i, f] of files.entries()) {
      const fs0 = toSec(f.start);
      const from = Math.max(i === 0 ? a0 : s0, fs0);
      const to = Math.min(s1, toSec(f.end));
      if (to <= from) continue;
      const part = path.join(tmp, `p${i}.ts`);
      const stream = await downloadFile(nvr, f.uri);
      await runFfmpeg(
        [
          "-fflags", "+genpts", "-i", "pipe:0",
          "-ss", String(from - fs0), "-t", String(to - from),
          "-map", "0:v:0", "-map", "0:a:0?",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "64k", "-ar", "48000",
          "-f", "mpegts", "-y", part,
        ],
        {
          input: stream,
          job,
          // NVR fayli boshidan o'qiladi; out_time faqat kerakli joydan o'sadi.
          onTime: (t) => (job.progress = Math.min(0.9, ((done + Math.max(0, t)) / want) * 0.9)),
        }
      );
      done += to - from;
      parts.push(part);
    }
    if (!parts.length) throw new Error("Bu oraliqda yozuv topilmadi");

    // 2) Bo'laklarni indeksli MKV ga (aniq izlash uchun TS yaramaydi).
    const joined = path.join(tmp, "joined.mkv");
    await runFfmpeg(["-i", `concat:${parts.join("|")}`, "-c", "copy", "-y", joined], { job });
    job.progress = 0.95;

    // 3) Aniq boshlanish: kalit kadrdan o'qiydi, lekin MP4 edit-list bilan
    //    ko'rsatish aynan so'ralgan soniyadan boshlanadi. Qayta kodlash yo'q.
    await runFfmpeg(
      [
        ...(preroll ? ["-ss", String(preroll)] : []),
        "-i", joined, "-t", String(total),
        "-c", "copy", "-movflags", "+faststart", "-y", job.file,
      ],
      { job }
    );
  } finally {
    fs.rm(tmp, { recursive: true, force: true }, () => {});
  }
}

// --- Tozalash: o'lik sessiyalar va eski eksportlar ---
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) if (now - s.lastSeen > IDLE_MS) killSession(s.id);
  for (const j of jobs.values()) {
    if (j.finishedAt && now - j.finishedAt > EXPORT_TTL_MS) {
      jobs.delete(j.id);
      fs.rm(j.file, { force: true }, () => {});
    }
  }
}, 15000).unref();

// Service qayta ishga tushganda qolib ketgan fayllar.
fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });
try {
  for (const d of fs.readdirSync(PB_DIR)) fs.rmSync(path.join(PB_DIR, d), { recursive: true, force: true });
} catch {}
