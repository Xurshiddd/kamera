// MediaMTX HTTP API bilan ishlovchi klient.
// Kamera qo'shilganda "shu RTSP manzilni shu nom (slug) ostida tort" deymiz,
// o'chirilganda esa yo'lni olib tashlaymiz.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import db from "./db.js";
import { liveUrl } from "./hikvision.js";
import { probe } from "./scanner.js";

const execFileAsync = promisify(execFile);

const API = process.env.MEDIAMTX_API || "http://127.0.0.1:9997";

// Transkod chiqish balandligi (kenglik nisbatga qarab). CPU'da 480 qo'yish
// yukni ~2x kamaytiradi. H264 (copy) kameralarga ta'sir qilmaydi.
const HEIGHT = Number(process.env.VIDEO_HEIGHT || 720);

// Kamera qaysi VIDEO kodek berayotganini ffprobe bilan aniqlaymiz.
// Qaytaradi: "h264" | "hevc" | null (kamera javob bermasa/aniqlanmasa).
// null bo'lsa xavfsiz tanlov — transkod qilamiz.
export async function probeCodec(camera) {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-rtsp_transport", "tcp",
        // Tez javob: uzoq tahlil qilmasin (kodek nomi birinchi paketdayoq ma'lum).
        "-analyzeduration", "2000000",
        "-probesize", "2000000",
        "-select_streams", "v:0",
        "-show_entries", "stream=codec_name",
        "-of", "default=nw=1:nk=1",
        buildRtspSource(camera),
      ],
      { timeout: 15000 } // kamera osilib qolsa 15s dan keyin uzamiz
    );
    return stdout.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

// Kameraga BIR MARTA ulanib ko'rish (saqlashdan oldin): login/parol, yo'l va kodek.
// Qaytaradi: { ok:true, codec } | { ok:false, reason: "auth"|"path"|"down" }.
export async function checkCamera(camera) {
  return probe(buildRtspSource(camera));
}

// cam-run.sh 401 olganda qo'yadigan belgi: kamera parolni rad etgan, oqim
// bloklanmaslik uchun kutyapti. Yo'l qayta yaratilganda skript belgini o'chiradi.
const GUARD_DIR = path.join(process.env.HLS_DIR || "/hls", ".guard");
export function authBlocked(slug) {
  try {
    return fs.existsSync(path.join(GUARD_DIR, slug));
  } catch {
    return false;
  }
}

// RTSP manzilini login/parol bilan yasaymiz.
// Diqqat: bu manzil faqat server ichida qoladi, tashqariga CHIQMAYDI.
// NVR kamerasi bo'lsa (nvr_id) — manba NVR kanali (Streaming/Channels/{ch}01).
function buildRtspSource(c) {
  if (c.nvr_id) {
    const nvr = db.prepare("SELECT * FROM nvrs WHERE id = ?").get(c.nvr_id);
    if (!nvr) throw new Error(`NVR #${c.nvr_id} topilmadi`);
    return liveUrl(nvr, c.channel, c.stream || "main");
  }
  return `rtsp://${encodeURIComponent(c.login)}:${encodeURIComponent(
    c.parol
  )}@${c.ip}:${c.port}/${c.rtsp_path}`;
}

// Brauzerlar H265 (HEVC)'ni HLS orqali o'ynay olmaydi, shuning uchun:
//   H264 kamera          -> video COPY (transkod yo'q, CPU ~0)
//   H265/noma'lum kamera -> libx264 bilan H264 ga transkod
//
// Diqqat: ffmpeg MediaMTX'ning O'ZIGA (localhost:8554) qayta nashr qiladi, shu
// sabab MediaMTX image'ida ffmpeg bo'lishi shart (bluenviron/mediamtx:*-ffmpeg).
function buildTranscodeCmd(camera) {
  const source = buildRtspSource(camera);
  const out = `rtsp://localhost:8554/${camera.slug}`;

  // +genpts: buzuq timestamp'larni qayta hosil qilamiz (HLS "gap"ni oldini oladi).
  // -nostats: progress qatorlari yo'q (cam-run.sh loglarni qatorma-qator o'qiydi).
  const input = `-nostats -rtsp_transport tcp -fflags +genpts -i "${source}"`;
  // cam-run.sh: kamera parolni rad etsa (401) uzoq kutadi — kamera bloklanmasin.
  const ffmpeg = `sh /cam-run.sh ${camera.slug} ffmpeg`;
  // Ovoz: kamera G.711 -> AAC (HLS + barcha brauzerlar uchun). Ovoz bo'lmasa zararsiz.
  const audio = `-c:a aac -b:a 128k -ar 48000`;
  // MediaMTX'ga qayta nashrni TCP orqali qilamiz. UDP (default)'da ko'p kamera
  // bir vaqtda push qilganda paketlar yo'qolib ("RTP packets lost", "invalid FU-A")
  // kadrlar buziladi -> HLS "teshik"li, sekin ochiladi. TCP ishonchli.
  const output = `-rtsp_transport tcp -f rtsp "${out}"`;

  // --- Kamera ALLAQACHON H264 bersa -> TRANSKOD YO'Q (CPU ~0) ---
  // Video shundayligicha uzatiladi, faqat ovoz AAC ga o'giriladi (arzon).
  // Segment uzunligini kamera keyframe oralig'i belgilaydi, shuning uchun
  // kamerada I-Frame Interval ~ 2x fps bo'lsin (12fps -> 24, 15fps -> 30).
  if (camera.codec === "h264") {
    return `${ffmpeg} ${input} -c:v copy ${audio} ${output}`;
  }

  // --- H265 (yoki kodek noma'lum) -> H264 ga transkod (CPU, libx264) ---
  // BITRATE CHEKLOVI: har oqim ~1.5 Mbps. Ko'p kamera birga ochilganda kanal
  // bo'g'ilib qolmasligi uchun MUHIM.
  const rate = `-b:v 1M -maxrate 1500k -bufsize 3M`;
  // Doimiy 15fps + har 2s (30 kadr) da keyframe -> teng 2s HLS segmentlari.
  const gop = `-r 15 -g 30 -force_key_frames "expr:gte(t,n_forced*2)"`;

  // zerolatency: lookahead/B-kadrlarsiz (jonli efir uchun past kechikish).
  return (
    `${ffmpeg} ${input} -vf scale=-2:${HEIGHT} ` +
    `-c:v libx264 -preset veryfast -tune zerolatency -profile:v high ${rate} ` +
    `${gop} ${audio} ${output}`
  );
}

export async function addPath(camera) {
  const res = await fetch(`${API}/v3/config/paths/add/${camera.slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // Always-on: yo'l yaratilishi bilan ffmpeg ishga tushadi va DOIM ishlab
      // turadi (kimdir ko'radimi-yo'qmi — farqi yo'q). Shu sabab pleyer ochilishi
      // bilan oqim DARROV yuklanadi (sovuq start / kutish yo'q).
      // Kamchilik: har bir kamera 24/7 ishlaydi -> doimiy CPU yuki (H265'da).
      runOnInit: buildTranscodeCmd(camera),
      runOnInitRestart: true, // ffmpeg yiqilsa/kamera uzilsa — qayta ishga tushadi
    }),
  });
  // Yo'l allaqachon bor bo'lsa MediaMTX xato beradi — buni e'tiborsiz qoldiramiz.
  if (!res.ok && res.status !== 400) {
    throw new Error(`MediaMTX addPath xato: ${res.status}`);
  }
}

export async function deletePath(slug) {
  await fetch(`${API}/v3/config/paths/delete/${slug}`, {
    method: "DELETE",
  }).catch(() => {});
}
