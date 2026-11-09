// =============================================================================
//  Tarmoq skaneri: lokal tarmoqdagi IP kameralarni topish (NVR'ga ulanmaganlarini
//  ham). Usul — oddiy TCP ulanish (port scan) + HTTP orqali ishlab chiqaruvchini
//  taxmin qilish. Multicast (ONVIF/SADP) ishlatilmaydi: Docker bridge tarmog'idan
//  o'tmaydi, TCP esa marshrut bo'lgan har qanday subnetga ishlaydi.
//
//  Faqat xususiy (RFC1918) manzillar skanerlanadi va bir martada ≤ 2048 host.
// =============================================================================

import net from "node:net";
import { execFile } from "node:child_process";

// Kameralarga xos portlar. 554 (RTSP) bo'lsa — deyarli aniq kamera/NVR.
export const PORTS = [554, 80, 8000, 37777, 34567];
const CAMERA_PORTS = new Set([554, 8000, 37777, 34567]);
export const MAX_HOSTS = 2048;

// --- IP yordamchilar ---
const ipToInt = (ip) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const intToIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");
const isIp = (s) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s) && s.split(".").every((o) => Number(o) <= 255);

export function isPrivate(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// "192.168.18.0/24, 192.168.19.10-50, 10.0.0.5" -> ["192.168.18.1", ...]
export function parseTargets(input) {
  const parts = String(input || "").split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) throw new Error("Tarmoq manzili kiritilmagan (masalan 192.168.18.0/24)");
  const out = new Set();
  const add = (n) => {
    out.add(intToIp(n));
    if (out.size > MAX_HOSTS) throw new Error(`Bir martada ${MAX_HOSTS} tadan ortiq manzil skanerlanmaydi`);
  };
  for (const p of parts) {
    let m;
    if ((m = p.match(/^([\d.]+)\/(\d{1,2})$/))) {
      const bits = Number(m[2]);
      if (!isIp(m[1]) || bits < 21 || bits > 32) throw new Error(`Notoʻgʻri tarmoq: ${p} (/21–/32 boʻlsin)`);
      const size = 2 ** (32 - bits);
      const base = Math.floor(ipToInt(m[1]) / size) * size;
      // /31 va /32 dan tashqari tarmoq va broadcast manzili tashlab ketiladi.
      const [from, to] = size > 2 ? [base + 1, base + size - 2] : [base, base + size - 1];
      for (let n = from; n <= to; n++) add(n);
    } else if ((m = p.match(/^([\d.]+)-(\d{1,3})$/))) {
      if (!isIp(m[1]) || Number(m[2]) > 255) throw new Error(`Notoʻgʻri oraliq: ${p}`);
      const start = ipToInt(m[1]);
      const end = start - (start % 256) + Number(m[2]);
      if (end < start) throw new Error(`Notoʻgʻri oraliq: ${p}`);
      for (let n = start; n <= end; n++) add(n);
    } else if (isIp(p)) add(ipToInt(p));
    else throw new Error(`Tushunarsiz manzil: ${p}`);
  }
  for (const ip of out) {
    if (!isPrivate(ip)) throw new Error(`Faqat lokal (xususiy) tarmoqlar skanerlanadi: ${ip}`);
  }
  return [...out];
}

function tcpOpen(ip, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.setTimeout(timeout, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

async function httpProbe(ip, path) {
  try {
    const r = await fetch(`http://${ip}${path}`, { signal: AbortSignal.timeout(3000), redirect: "manual" });
    const body = r.status === 200 ? (await r.text()).slice(0, 4000) : (await r.arrayBuffer(), "");
    const www = r.headers.get("www-authenticate") || "";
    return {
      status: r.status,
      server: r.headers.get("server") || "",
      realm: (www.match(/realm="([^"]*)"/i) || [])[1] || "",
      body,
    };
  } catch {
    return null;
  }
}

// Qurilma turi taxmini (parolsiz). Aniq tur ulanganda ISAPI deviceInfo'dan olinadi.
//  - realm "IP Camera(XXXX)"              -> kamera (eski/o'rta Hikvision kamera)
//  - HTTP Server "DNVRS-Webs" / realm NVR -> NVR/DVR
//  - hex realm + "Webs"                   -> aniqlab bo'lmaydi (yangi proshivkali
//    NVR ham, kamera ham shunday javob beradi)
export function guessKind({ realm = "", server = "" }) {
  if (/IP Camera|IPC|DS-2CD/i.test(realm)) return "camera";
  if (/DNVRS|DVRS|NVR|DVR/i.test(server) || /NVR|DVR|DS-[789]\d/i.test(realm)) return "nvr";
  return null;
}
// ISAPI deviceType -> kind
export function kindFromType(t) {
  if (!t) return null;
  if (/camera|ipc|ipdome/i.test(t)) return "camera";
  if (/nvr|dvr|hvr|xvr|cvr/i.test(t)) return "nvr";
  return "other";
}
// deviceInfo -> kind. Eski proshivkalar <deviceType> bermaydi — model va nomdan.
//   DS-2CD/2DE/2XD... = kamera; DS-7xxx/8xxx/9xxx (NI/HI/HQHI...) = NVR/DVR.
export function kindFromInfo(info) {
  if (!info) return null;
  if (info.type) return kindFromType(info.type);
  const m = String(info.model || "");
  if (/^(i?DS-2|IPC)/i.test(m)) return "camera";
  if (/^i?DS-[789]\d/i.test(m) || /NVR|DVR/i.test(m)) return "nvr";
  const n = String(info.name || "");
  if (/video recorder|NVR|DVR/i.test(n)) return "nvr";
  if (/camera|IPC/i.test(n)) return "camera";
  return null;
}

// Ishlab chiqaruvchi/model taxmini (login talab qilmaydigan so'rovlar).
async function fingerprint(ip, ports) {
  const res = await fingerprintRaw(ip, ports);
  return { ...res, kind: guessKind({ realm: res.hint || "", server: res.server || "" }) };
}

async function fingerprintRaw(ip, ports) {
  const info = { vendor: null, model: null, hint: null, server: null };
  if (ports.includes(8000)) info.vendor = "Hikvision";
  if (ports.includes(37777)) info.vendor = "Dahua";
  if (ports.includes(34567)) info.vendor = "XMeye";
  if (!ports.includes(80)) return info;

  const hik = await httpProbe(ip, "/ISAPI/System/deviceInfo");
  // Hikvision: /ISAPI 401 (digest realm "IP Camera(..)", "DS-2CD..") yoki 200 XML.
  if (
    hik &&
    ((hik.status === 200 && /<deviceInfo/i.test(hik.body)) ||
      (hik.status === 401 && (/IP Camera|DS-|Hik|NVR|DVR/i.test(hik.realm) || (hik.realm && ports.includes(8000)))))
  ) {
    info.vendor = "Hikvision";
    info.model = (hik.body.match(/<model>([^<]*)<\/model>/) || [])[1] || null;
    info.hint = hik.realm || null;
    info.server = hik.server || null;
    return info;
  }
  const dahua = await httpProbe(ip, "/cgi-bin/magicBox.cgi?action=getDeviceType");
  if (dahua && (dahua.status === 401 || dahua.status === 200) && (/Login to/i.test(dahua.realm) || /type=/.test(dahua.body))) {
    info.vendor = "Dahua";
    info.model = (dahua.body.match(/type=(.+)/) || [])[1]?.trim() || null;
    info.hint = dahua.realm || null;
    info.server = dahua.server || null;
    return info;
  }
  const root = await httpProbe(ip, "/");
  if (root) {
    info.server = root.server || null;
    info.hint = root.realm || root.server || (root.body.match(/<title>([^<]{1,60})<\/title>/i) || [])[1] || null;
    if (!info.vendor && /hikvision|webs/i.test(info.hint || "")) info.vendor = "Hikvision";
    if (!info.vendor && /dahua|dh/i.test(root.server)) info.vendor = "Dahua";
  }
  return info;
}

// Skaner: hostlarni parallel tekshiradi. onProgress(done, total, foundCount).
// Qaytaradi: [{ ip, ports, vendor, model, hint }] — faqat kameraga o'xshaganlari.
export async function scan(ips, { concurrency = 64, onProgress } = {}) {
  const found = [];
  let i = 0;
  let done = 0;
  async function worker() {
    while (i < ips.length) {
      const ip = ips[i++];
      const open = [];
      await Promise.all(PORTS.map(async (p) => (await tcpOpen(ip, p)) && open.push(p)));
      if (open.some((p) => CAMERA_PORTS.has(p))) {
        open.sort((a, b) => a - b);
        found.push({ ip, ports: open, ...(await fingerprint(ip, open)) });
      }
      done++;
      onProgress?.(done, ips.length, found.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ips.length) }, worker));
  found.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));
  return found;
}

// --- Kameraga ulanish (RTSP) ---

// Ishlab chiqaruvchiga qarab sinab ko'riladigan asosiy oqim yo'llari.
const PATHS = {
  Hikvision: ["Streaming/Channels/101", "h264/ch1/main/av_stream"],
  Dahua: ["cam/realmonitor?channel=1&subtype=0"],
  XMeye: ["user=admin_password=_channel=1_stream=0.sdp"],
};
const GENERIC = [
  "Streaming/Channels/101",
  "cam/realmonitor?channel=1&subtype=0",
  "h264/ch1/main/av_stream",
  "live/ch00_0",
  "stream1",
  "11",
  "",
];
export function candidatePaths(vendor) {
  return [...new Set([...(PATHS[vendor] || []), ...GENERIC])];
}

export const rtspUrl = ({ ip, port, login, parol, path }) =>
  `rtsp://${encodeURIComponent(login)}:${encodeURIComponent(parol)}@${ip}:${port}/${path}`;

// ffprobe: { ok, codec, width, height } yoki { ok:false, reason: "auth"|"path"|"down" }
export function probe(url) {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      [
        "-v", "error", "-rtsp_transport", "tcp", "-timeout", "8000000",
        "-analyzeduration", "2000000", "-probesize", "2000000",
        "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "json", url,
      ],
      { timeout: 15000 },
      (err, stdout, stderr) => {
        const s = (stderr || "") + (err?.message || "");
        try {
          const st = JSON.parse(stdout || "{}").streams?.[0];
          if (st?.codec_name) return resolve({ ok: true, codec: st.codec_name, width: st.width || 0, height: st.height || 0 });
        } catch { /* pastda */ }
        if (/401|Unauthorized/i.test(s)) return resolve({ ok: false, reason: "auth" });
        if (/404|Not Found|454|Session Not Found|400 Bad Request/i.test(s)) return resolve({ ok: false, reason: "path" });
        resolve({ ok: false, reason: "down" });
      }
    );
  });
}

// Bitta kadr (JPEG). H.265 / uzun GOP'da kalit kadrni kutishi mumkin.
export function grabFrame(url) {
  return new Promise((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-v", "error", "-rtsp_transport", "tcp", "-timeout", "8000000", "-i", url,
       "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "5", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
      { timeout: 25000, encoding: "buffer", maxBuffer: 5 * 1024 * 1024 },
      (err, stdout) => (stdout?.length ? resolve(stdout) : reject(err || new Error("Kadr olinmadi")))
    );
  });
}
