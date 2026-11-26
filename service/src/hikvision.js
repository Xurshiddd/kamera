// =============================================================================
//  Hikvision NVR klienti (ISAPI, HTTP Digest auth).
//
//  DIQQAT — vaqt: NVR ISAPI va RTSP playback'da vaqtni "...Z" bilan yozadi,
//  lekin aslida bu NVR'ning MAHALLIY vaqti (Asia/Tashkent). Shuning uchun bu
//  modul vaqtni "YYYY-MM-DDTHH:MM:SS" (mahalliy, zonasiz) satr sifatida
//  qabul qiladi/qaytaradi va "Z"ni faqat formal ravishda qo'shadi/olib tashlaydi.
// =============================================================================

import crypto from "node:crypto";
import http from "node:http";

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

function parseChallenge(header) {
  const out = {};
  for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  return out;
}

function digestHeader(nvr, method, uri, ch) {
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${nvr.login}:${ch.realm}:${nvr.parol}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = ch.qop ? ch.qop.split(",")[0].trim() : null;
  const response = qop
    ? md5(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${ch.nonce}:${ha2}`);
  let h =
    `Digest username="${nvr.login}", realm="${ch.realm}", nonce="${ch.nonce}", ` +
    `uri="${uri}", response="${response}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (ch.opaque) h += `, opaque="${ch.opaque}"`;
  return h;
}

// ISAPI so'rovi: avval auth'siz, 401 kelsa digest bilan qaytariladi.
export async function isapi(nvr, path, { method = "GET", body, timeout = 15000, raw = false } = {}) {
  const url = `http://${nvr.ip}:${nvr.http_port || 80}${path}`;
  const headers = body ? { "Content-Type": "application/xml" } : {};
  const opts = () => ({ method, body, headers: { ...headers }, signal: AbortSignal.timeout(timeout) });

  let res = await fetch(url, opts());
  if (res.status === 401) {
    const www = res.headers.get("www-authenticate") || "";
    await res.arrayBuffer().catch(() => {});
    if (!/^digest/i.test(www)) throw new Error("NVR digest auth so'ramadi");
    const o = opts();
    o.headers.Authorization = digestHeader(nvr, method, path, parseChallenge(www));
    res = await fetch(url, o);
  }
  if (res.status === 401) {
    const err = new Error("NVR login yoki parol noto'g'ri");
    err.status = 401;
    throw err;
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const sub = tag(t, "subStatusCode") || tag(t, "statusString");
    const err = new Error(`NVR HTTP ${res.status}${sub ? ` (${sub})` : ""}`);
    err.status = res.status;
    err.sub = sub;
    throw err;
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// --- Kichik XML yordamchilar (ISAPI javoblari oddiy, kutubxona shart emas) ---
export const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? decodeXml(m[1]) : null;
};
export const blocks = (xml, name) =>
  [...xml.matchAll(new RegExp(`<${name}[ >][\\s\\S]*?</${name}>`, "g"))].map((m) => m[0]);
const decodeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export async function deviceInfo(nvr) {
  const x = await isapi(nvr, "/ISAPI/System/deviceInfo", { timeout: 8000 });
  return {
    model: tag(x, "model"),
    name: tag(x, "deviceName"),
    serial: tag(x, "serialNumber"),
    firmware: tag(x, "firmwareVersion"),
    type: tag(x, "deviceType"), // "IPCamera" | "NVR" | "DVR" | ...
    mac: tag(x, "macAddress"),
  };
}

// IP kanallar: [{ channel, name, ip, online }]
export async function listChannels(nvr) {
  const [cx, sx] = await Promise.all([
    isapi(nvr, "/ISAPI/ContentMgmt/InputProxy/channels"),
    isapi(nvr, "/ISAPI/ContentMgmt/InputProxy/channels/status").catch(() => ""),
  ]);
  const online = new Map(
    blocks(sx, "InputProxyChannelStatus").map((b) => [Number(tag(b, "id")), tag(b, "online") === "true"])
  );
  return blocks(cx, "InputProxyChannel").map((b) => ({
    channel: Number(tag(b, "id")),
    name: (tag(b, "name") || "").trim(),
    ip: tag(b, "ipAddress"),
    online: online.get(Number(tag(b, "id"))) ?? null,
  }));
}

// Kanal nomini NVR'da o'zgartirish. Joriy XML olinib faqat <name> almashtiriladi.
// GET kamera parolini qaytarmaydi, lekin PUT'da parol bo'lmasa NVR eskisini
// saqlab qoladi (2026-11-09 da 2-kanalda sinalgan: kamera onlayn qoldi).
export const escXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export async function setChannelName(nvr, channel, name) {
  const path = `/ISAPI/ContentMgmt/InputProxy/channels/${channel}`;
  const x = await isapi(nvr, path);
  if (!/<name>[^<]*<\/name>/.test(x)) throw new Error("NVR javobida kanal nomi yo'q");
  // Birinchi <name> — kanal nomi (sourceInputPortDescriptor'dan oldin keladi).
  const body = x.replace(/<name>[^<]*<\/name>/, `<name>${escXml(name)}</name>`);
  const r = await isapi(nvr, path, { method: "PUT", body, timeout: 20000 });
  const status = tag(r, "statusString");
  if (status && status !== "OK") throw new Error(`NVR: ${status} ${tag(r, "subStatusCode") || ""}`.trim());
}

// Kanal manbasini (kamera IP'si va/yoki paroli) NVR'da yangilash — kamera
// IP'si yoki paroli o'zgartirilgandan keyin NVR uni yo'qotmasligi uchun.
// Faqat sourceInputPortDescriptor ichidagi <ipAddress> va <password> almashadi.
export async function setChannelSource(nvr, channel, { ip, password } = {}) {
  const path = `/ISAPI/ContentMgmt/InputProxy/channels/${channel}`;
  const x = await isapi(nvr, path);
  const m = x.match(/<sourceInputPortDescriptor[\s\S]*?<\/sourceInputPortDescriptor>/);
  if (!m) throw new Error("NVR javobida kanal manbasi yo'q");
  let d = m[0];
  if (ip) {
    if (!/<ipAddress>[^<]*<\/ipAddress>/.test(d)) throw new Error("NVR javobida kamera IP'si yo'q");
    d = d.replace(/<ipAddress>[^<]*<\/ipAddress>/, `<ipAddress>${escXml(ip)}</ipAddress>`);
  }
  if (password) {
    const pw = `<password>${escXml(password)}</password>`;
    if (/<password>[^<]*<\/password>/.test(d)) d = d.replace(/<password>[^<]*<\/password>/, pw);
    else if (/<\/userName>/.test(d)) d = d.replace(/<\/userName>/, `</userName>${pw}`);
    else d = d.replace(/<\/sourceInputPortDescriptor>$/, `${pw}</sourceInputPortDescriptor>`);
  }
  const r = await isapi(nvr, path, { method: "PUT", body: x.replace(m[0], d), timeout: 20000 });
  const status = tag(r, "statusString");
  if (status && status !== "OK") throw new Error(`NVR: ${status} ${tag(r, "subStatusCode") || ""}`.trim());
}

// Kanal/oqim -> RTSP "trackID": 1-kanal asosiy oqim = 101, qo'shimcha = 102.
const trackId = (channel, stream = "main") => `${channel}0${stream === "sub" ? 2 : 1}`;

// "YYYY-MM-DDTHH:MM:SS" (mahalliy) -> ISAPI "…Z" va qaytarish.
const toNvr = (local) => `${local}Z`;
const fromNvr = (s) => s.replace(/Z$/, "").slice(0, 19);

// Yozuv FAYLLARI (NVR ichidagi bo'laklar): [{ start, end, uri }] — vaqtlar
// mahalliy satr. Oraliqqa qisman tushgan fayl ham qaytadi (haqiqiy chegarasi
// bilan, agar so'rov oynasi uni to'liq qamrasa). NVR bir martada cheklangan
// son qaytaradi -> sahifalab olamiz.
export async function searchFiles(nvr, channel, from, to, { max = 2000 } = {}) {
  const out = [];
  const searchId = crypto.randomUUID().toUpperCase();
  for (let pos = 0; pos < max; ) {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><CMSearchDescription>` +
      `<searchID>${searchId}</searchID>` +
      `<trackList><trackID>${trackId(channel)}</trackID></trackList>` +
      `<timeSpanList><timeSpan><startTime>${toNvr(from)}</startTime>` +
      `<endTime>${toNvr(to)}</endTime></timeSpan></timeSpanList>` +
      `<maxResults>100</maxResults><searchResultPostion>${pos}</searchResultPostion>` +
      `<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>` +
      `</CMSearchDescription>`;
    const x = await isapi(nvr, "/ISAPI/ContentMgmt/search", { method: "POST", body, timeout: 30000 });
    const items = blocks(x, "searchMatchItem").map((b) => ({
      start: fromNvr(tag(b, "startTime") || ""),
      end: fromNvr(tag(b, "endTime") || ""),
      uri: tag(b, "playbackURI"),
    }));
    out.push(...items.filter((i) => i.start && i.end && i.uri));
    if (tag(x, "responseStatusStrg") !== "MORE" || !items.length) break;
    pos += items.length;
  }
  out.sort((a, b) => a.start.localeCompare(b.start));
  return out;
}

// Timeline uchun: ketma-ket (uzilishsiz) bo'laklar birlashtirilgan oraliqlar.
export async function searchRecordings(nvr, channel, from, to) {
  const merged = [];
  for (const r of await searchFiles(nvr, channel, from, to)) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else merged.push({ start: r.start, end: r.end });
  }
  return merged;
}

// Yozuv faylini yuklab olish (ISAPI download) — tarmoq tezligida (RTSP
// playback'dek real vaqtda emas). Hikvision GET + XML body talab qiladi
// (fetch buni qilolmaydi) va URI'da name/size bo'lishi SHART; NVR vaqt
// bo'yicha qirqmaydi — butun faylni beradi (qirqish ffmpeg'da).
// Qaytaradi: http.IncomingMessage (MPEG-PS oqimi). Chaqiruvchi .destroy() qila oladi.
export function downloadFile(nvr, uri) {
  const esc = uri.replace(/&/g, "&amp;");
  const body = `<downloadRequest><playbackURI>${esc}</playbackURI></downloadRequest>`;
  const path = "/ISAPI/ContentMgmt/download";

  const send = (auth) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: nvr.ip,
          port: nvr.http_port || 80,
          path,
          method: "GET",
          headers: {
            "Content-Type": "application/xml",
            "Content-Length": Buffer.byteLength(body),
            ...(auth ? { Authorization: auth } : {}),
          },
          timeout: 30000,
        },
        resolve
      );
      req.on("timeout", () => req.destroy(new Error("NVR javob bermadi (timeout)")));
      req.on("error", reject);
      req.end(body);
    });

  return (async () => {
    let res = await send(null);
    if (res.statusCode === 401) {
      const www = res.headers["www-authenticate"] || "";
      res.resume();
      res = await send(digestHeader(nvr, "GET", path, parseChallenge(www)));
    }
    if (res.statusCode !== 200) {
      let txt = "";
      for await (const c of res) txt += c;
      throw new Error(`NVR download HTTP ${res.statusCode}: ${tag(txt, "subStatusString") || tag(txt, "statusString") || ""}`);
    }
    res.setTimeout(0);
    return res;
  })();
}

// RTSP manzillar (login/parol ichida — faqat server ichida ishlatiladi).
function rtspBase(nvr) {
  return `rtsp://${encodeURIComponent(nvr.login)}:${encodeURIComponent(nvr.parol)}@${nvr.ip}:${nvr.rtsp_port || 554}`;
}
export function liveUrl(nvr, channel, stream = "main") {
  return `${rtspBase(nvr)}/Streaming/Channels/${trackId(channel, stream)}`;
}
// start/end: "YYYY-MM-DDTHH:MM:SS" mahalliy vaqt.
export function playbackUrl(nvr, channel, start, end) {
  const f = (s) => s.replace(/[-:]/g, "") + "Z";
  let u = `${rtspBase(nvr)}/Streaming/tracks/${trackId(channel)}?starttime=${f(start)}`;
  if (end) u += `&endtime=${f(end)}`;
  return u;
}

// =============================================================================
//  Kamera oqimi sozlamalari (NVR orqali, StreamingProxy).
//  NVR IP kameraga o'zi yozadi. Kodek/Smart o'zgarsa kamera qayta ishga
//  tushadi: ~40–90 s tasvir va yozuv yo'q, shu vaqt ichida NVR 403 qaytaradi.
//  Kalit kadr oralig'i (GOP) bu API'da yo'q — uni kamera sahifasida sozlash kerak.
// =============================================================================

const streamPath = (channel, stream = "main") =>
  `/ISAPI/ContentMgmt/StreamingProxy/channels/${trackId(channel, stream)}`;

function parseStream(xml) {
  const smart = xml.match(/<SmartCodec>\s*<enabled>(\w+)<\/enabled>/);
  const rc = tag(xml, "videoQualityControlType");
  return {
    id: Number(tag(xml, "id")),
    codec: tag(xml, "videoCodecType"), // "H.264" | "H.265"
    width: Number(tag(xml, "videoResolutionWidth")) || 0,
    height: Number(tag(xml, "videoResolutionHeight")) || 0,
    rc, // "VBR" | "CBR"
    bitrate: Number(rc === "CBR" ? tag(xml, "constantBitRate") : tag(xml, "vbrUpperCap")) || 0, // kbit/s
    quality: Number(tag(xml, "fixedQuality")) || null,
    fps: Number(tag(xml, "maxFrameRate")) || 0, // 2500 = 25 kadr/s; 0 = to'liq
    smart: smart ? smart[1] === "true" : null, // null = kamera qo'llamaydi
  };
}

// Barcha kanallarning ASOSIY oqimi (bitta so'rov). Map<channel, stream>
export async function listStreams(nvr) {
  const x = await isapi(nvr, "/ISAPI/ContentMgmt/StreamingProxy/channels", { timeout: 60000 });
  const out = new Map();
  for (const b of blocks(x, "StreamingChannel")) {
    const s = parseStream(b);
    if (s.id % 100 === 1) out.set(Math.floor(s.id / 100), s);
  }
  return out;
}

const opts = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*\\sopt="([^"]*)"`));
  return m ? m[1].split(",").map((v) => v.trim()).filter(Boolean) : [];
};
const range = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*\\smin="(\\d+)"[^>]*\\smax="(\\d+)"`));
  return m ? { min: Number(m[1]), max: Number(m[2]) } : null;
};

// Bitta kanal: joriy sozlama + kamera qo'llaydigan qiymatlar.
export async function getStream(nvr, channel) {
  const [x, c] = await Promise.all([
    isapi(nvr, streamPath(channel)),
    isapi(nvr, `${streamPath(channel)}/capabilities`).catch(() => ""),
  ]);
  const w = opts(c, "videoResolutionWidth").map(Number);
  const h = opts(c, "videoResolutionHeight").map(Number);
  return {
    current: parseStream(x),
    caps: {
      codecs: opts(c, "videoCodecType"),
      // Kenglik va balandlik ro'yxatlari juft-juft keladi (1280↔720, 1920↔1080).
      resolutions: w.length === h.length ? w.map((v, i) => ({ width: v, height: h[i] })) : [],
      rc: opts(c, "videoQualityControlType"),
      fps: opts(c, "maxFrameRate").map(Number),
      bitrate: range(c, "vbrUpperCap") || range(c, "constantBitRate"),
    },
  };
}

// Kanal oqimining NVR'dagi sozlamasi: { codec: "h264"|"hevc"|null, audio: bool }.
//
// Nega kerak:
//  - Kodek: ba'zi kameralar (masalan 3200x1800 H.265) NVR orqali jonli oqimda
//    uzoq vaqt kalit kadr/VPS-SPS-PPS yubormaydi — ffprobe kodekni 15+ s
//    aniqlay olmaydi. NVR sozlamasida esa kodek darhol ma'lum.
//  - Ovoz: ovozi o'chiq kanal yozuvida ham RTSP SDP audio trekni e'lon qiladi,
//    lekin paket yubormaydi — ffmpeg (7.x) audio enkoderni birinchi kadrsiz
//    ochmaydi va HLS hech qachon boshlanmaydi.
// Kanal-kanal so'rov NVR orqali kameraga boradi (ba'zan 10+ s), shuning uchun
// hamma kanal bitta so'rovda (~0.7 s) olinib, NVR bo'yicha 10 daqiqa keshlanadi.
// Aniqlab bo'lmasa null.
const STREAM_INFO_TTL_MS = 10 * 60 * 1000;
const streamInfoCache = new Map(); // "ip:port" -> { at, map: Promise<Map<streamId, info>> }
const CODEC_NAMES = { "H.264": "h264", "H.265": "hevc" };

export async function streamInfo(nvr, channel, stream = "main") {
  const key = `${nvr.ip}:${nvr.http_port || 80}`;
  let c = streamInfoCache.get(key);
  if (!c || Date.now() - c.at > STREAM_INFO_TTL_MS) {
    c = {
      at: Date.now(),
      map: isapi(nvr, "/ISAPI/ContentMgmt/StreamingProxy/channels", { timeout: 10000 }).then((x) => {
        const m = new Map();
        for (const b of blocks(x, "StreamingChannel")) {
          const a = b.match(/<Audio>[\s\S]*?<\/Audio>/);
          m.set(Number(tag(b, "id")), {
            codec: CODEC_NAMES[tag(b, "videoCodecType")] || null,
            audio: a ? tag(a[0], "enabled") === "true" : false,
          });
        }
        return m;
      }),
    };
    streamInfoCache.set(key, c);
    c.map.catch(() => streamInfoCache.delete(key)); // xato keshlanmasin
  }
  try {
    return (await c.map).get(Number(channel) * 100 + (stream === "sub" ? 2 : 1)) ?? null;
  } catch {
    return null;
  }
}

// Kanal sozlamasi o'zgardi (kodek va h.k.) — keyingi so'rov yangisini olsin.
export function forgetStreamInfo(nvr) {
  streamInfoCache.delete(`${nvr.ip}:${nvr.http_port || 80}`);
}

// O'zgartirish: joriy XML olinadi, faqat berilgan maydonlar almashtiriladi
// (NVR qolgan maydonlarni o'zgarmagan holda qabul qiladi).
// changes: { codec, width, height, rc, bitrate, fps, smart }
export async function setStream(nvr, channel, changes) {
  let x = await isapi(nvr, streamPath(channel));
  const set = (name, v) => {
    if (v === undefined || v === null) return;
    const re = new RegExp(`(<${name}>)[^<]*(</${name}>)`);
    if (re.test(x)) x = x.replace(re, `$1${v}$2`);
    else if (name === "constantBitRate" || name === "vbrUpperCap") {
      x = x.replace("</videoQualityControlType>", `</videoQualityControlType><${name}>${v}</${name}>`);
    }
  };
  set("videoCodecType", changes.codec);
  set("videoResolutionWidth", changes.width);
  set("videoResolutionHeight", changes.height);
  set("videoQualityControlType", changes.rc);
  if (changes.bitrate) {
    const rc = changes.rc || tag(x, "videoQualityControlType");
    set(rc === "CBR" ? "constantBitRate" : "vbrUpperCap", changes.bitrate);
  }
  set("maxFrameRate", changes.fps);
  if (typeof changes.smart === "boolean") {
    x = x.replace(/(<SmartCodec>\s*<enabled>)\w+(<\/enabled>)/, `$1${changes.smart}$2`);
  }
  const r = await isapi(nvr, streamPath(channel), { method: "PUT", body: x, timeout: 30000 });
  const status = tag(r, "statusString");
  if (status && status !== "OK") throw new Error(`NVR: ${status} ${tag(r, "subStatusCode") || ""}`.trim());
  return parseStream(x);
}

// Kameradan joriy kadr (JPEG).
export function snapshot(nvr, channel) {
  return isapi(nvr, `${streamPath(channel)}/picture`, { raw: true, timeout: 15000 });
}
