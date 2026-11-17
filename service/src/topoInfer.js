// =============================================================================
//  Switch'larni NVR jurnalidan taxmin qilish.
//
//  G'oya: switch'ning toki (yoki uplink kabeli) uzilsa, uning ortidagi HAMMA
//  kameralar bir necha soniya ichida birga uziladi. NVR har bir uzilishni
//  (Exception/ipcDisconnect/<kanal>) vaqti bilan jurnalga yozadi. Shu
//  jurnaldan "doim birga uziladigan" kameralar guruhlanadi:
//    - guruh (yuqori chegara)  -> bitta switch;
//    - katta guruh (past chegara) -> bir nechta switch bitta yuqori switch
//      ortida (ketma-ketlik).
//  Ba'zi kameralar o'zi tez-tez uzilib turadi — ular tasodifan boshqalar bilan
//  mos tushadi. Shuning uchun juftlik faqat tasodifdan ancha ko'p birga
//  uzilgan bo'lsa hisobga olinadi.
//
//  Jurnal NVR'da ~40 kun saqlanadi; yig'ilgan yozuvlar bazada qoladi
//  (nvr_disconnects), keyingi safar faqat yangi kunlar olinadi va tarix
//  NVR'dagidan uzunroq bo'lib boradi.
// =============================================================================

import crypto from "node:crypto";
import db, { getSetting, setSetting } from "./db.js";
import { isapi, blocks, tag, listChannels } from "./hikvision.js";

const WINDOW = 10; // soniya: shu oraliqda uzilganlar "birga" hisoblanadi
const HI = 0.25; // switch guruhi chegarasi (o'rtacha o'xshashlik)
const LO = 0.1; // yuqori switch (katta guruh) chegarasi
const FIRST_DAYS = 90; // birinchi yig'ishda necha kun orqaga
const NVR_CAP = 2000; // NVR bitta qidiruvda shundan ko'p bermaydi

// --- Vaqt: NVR mahalliy vaqtni "Z" bilan yozadi (hikvision.js'dagi izohga qarang)
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const parse = (s) => Date.parse(s + "Z");
// NVR soati Toshkent vaqtida — "hozir"ni ham shunday ifodalaymiz.
const nowLocal = () => Date.now() + 5 * 3600e3;

async function searchOnce(nvr, from, to) {
  const sid = crypto.randomUUID().toUpperCase();
  const rows = [];
  let pos = 0;
  let status;
  do {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><CMSearchDescription><searchID>${sid}</searchID>` +
      `<metaId>log.std-cgi.com/Exception</metaId><timeSpanList><timeSpan>` +
      `<startTime>${fmt(from)}Z</startTime><endTime>${fmt(to)}Z</endTime></timeSpan></timeSpanList>` +
      `<maxResults>100</maxResults><searchResultPostion>${pos}</searchResultPostion></CMSearchDescription>`;
    const x = await isapi(nvr, "/ISAPI/ContentMgmt/logSearch", { method: "POST", body, timeout: 30000 });
    status = tag(x, "responseStatusStrg");
    const items = blocks(x, "searchMatchItem");
    for (const b of items) {
      const meta = (tag(b, "metaId") || "").split("/");
      if (meta[2] !== "ipcDisconnect") continue;
      const channel = Number(meta[3]);
      const t = (tag(b, "StartDateTime") || "").replace("Z", "");
      if (!Number.isInteger(channel) || !t) continue;
      const ip = ((tag(b, "additionInformation") || "").match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) || []).find((s) => s !== "0.0.0.0");
      rows.push({ channel, t, ip: ip || null });
    }
    pos += items.length;
    if (!items.length) break;
  } while (status === "MORE");
  return { rows, capped: pos >= NVR_CAP };
}

// NVR qidiruvi 2000 ta bilan cheklangan — ko'p bo'lsa oraliq ikkiga bo'linadi.
async function searchRange(nvr, from, to) {
  const { rows, capped } = await searchOnce(nvr, from, to);
  if (capped && to - from > 600e3) {
    const mid = Math.floor((from + to) / 2 / 1000) * 1000;
    return [...(await searchRange(nvr, from, mid)), ...(await searchRange(nvr, mid + 1000, to))];
  }
  return rows;
}

// Bitta NVR jurnalini bazaga yig'ish (oxirgi yig'ilgan kundan boshlab).
export async function collect(nvr, { onDay, isCancelled } = {}) {
  const key = `topo_last_${nvr.id}`;
  const last = getSetting(key);
  const today = Math.floor(nowLocal() / 86400e3) * 86400e3;
  // Oxirgi kun qaytadan olinadi (u kun tugamagan bo'lishi mumkin edi).
  let day = last ? parse(last) : today - FIRST_DAYS * 86400e3;
  const ins = db.prepare("INSERT OR IGNORE INTO nvr_disconnects (nvr_id, channel, t, ip) VALUES (?, ?, ?, ?)");

  // Kanal nomlari/IP'lari (kameralar ro'yxatiga import qilinmaganlar uchun ham).
  try {
    const ch = await listChannels(nvr);
    setSetting(`topo_channels_${nvr.id}`, JSON.stringify(ch.map((c) => ({ channel: c.channel, name: c.name, ip: c.ip }))));
  } catch {
    /* nomlar bo'lmasa ham tahlil ishlaydi */
  }

  let added = 0;
  const days = Math.round((today - day) / 86400e3) + 1;
  let i = 0;
  for (; day <= today; day += 86400e3) {
    if (isCancelled?.()) break;
    const rows = await searchRange(nvr, day, day + 86400e3 - 1000);
    db.transaction(() => {
      for (const r of rows) added += ins.run(nvr.id, r.channel, r.t, r.ip).changes;
    })();
    setSetting(key, fmt(day));
    onDay?.(++i, days, fmt(day).slice(0, 10), rows.length);
  }
  return added;
}

// ---------------------------------------------------------------------------
//  Tahlil
// ---------------------------------------------------------------------------

// Jismoniy kamera kaliti: kameralar ro'yxatida bo'lsa — uning guruhi (bir xil
// IP'li NVR'lar orasida bitta), aks holda "nvr:kanal".
function cameraIndex() {
  const rows = db
    .prepare("SELECT c.id, c.name, COALESCE(c.cam_ip, c.ip) AS ip, c.nvr_id, c.channel, l.device_id FROM cameras c LEFT JOIN camera_links l ON l.camera_id = c.id ORDER BY c.id")
    .all();
  const byIp = new Map();
  const byChan = new Map();
  for (const r of rows) {
    let g = byIp.get(r.ip);
    if (!g) {
      g = { key: `c${r.id}`, camera_id: r.id, name: r.name, ip: r.ip, device_id: r.device_id ?? null };
      byIp.set(r.ip, g);
    } else if (g.device_id == null && r.device_id != null) {
      g.device_id = r.device_id;
    }
    if (r.nvr_id != null) byChan.set(`${r.nvr_id}:${r.channel}`, g);
  }
  return byChan;
}

function channelNames() {
  const out = new Map();
  for (const n of db.prepare("SELECT id, name FROM nvrs").all()) {
    let list = [];
    try {
      list = JSON.parse(getSetting(`topo_channels_${n.id}`) || "[]");
    } catch {}
    for (const c of list) out.set(`${n.id}:${c.channel}`, { name: c.name, ip: c.ip, nvr: n.name });
  }
  return out;
}

export function analyze() {
  const byChan = cameraIndex();
  const names = channelNames();
  const events = new Map(); // key -> vaqtlar (ms, tartiblangan)
  const info = new Map(); // key -> {key, camera_id, name, ip, device_id}
  let total = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const r of db.prepare("SELECT nvr_id, channel, t, ip FROM nvr_disconnects").iterate()) {
    const ck = `${r.nvr_id}:${r.channel}`;
    const cam = byChan.get(ck);
    const key = cam ? cam.key : `n${ck}`;
    if (!info.has(key)) {
      const nm = names.get(ck);
      info.set(
        key,
        cam
          ? { key, camera_id: cam.camera_id, name: cam.name, ip: cam.ip, device_id: cam.device_id }
          : { key, camera_id: null, name: nm?.name || `Kanal ${r.channel}`, ip: nm?.ip || r.ip, device_id: null, nvr: nm?.nvr || null, channel: r.channel }
      );
      events.set(key, []);
    }
    const t = parse(r.t);
    events.get(key).push(t);
    total++;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
  }
  const W = WINDOW * 1000;
  for (const [k, v] of events) {
    // Ikki NVR bir kamerani bir vaqtda yozsa — bitta hodisa.
    v.sort((a, b) => a - b);
    events.set(k, v.filter((t, i) => i === 0 || t - v[i - 1] > W));
  }
  // Deyarli hamma kamera birga uzilgan paytlar (NVR qayta yuklanishi, NVR'ning
  // o'z kabeli) switch haqida hech narsa demaydi; ustiga NVR kanallarni
  // tartib bilan tekshirgani uchun raqami yaqin kanallarni sun'iy
  // "bog'laydi". Shunday paytlar tahlildan chiqariladi.
  let nvrWide = 0;
  {
    const all = [];
    for (const [k, v] of events) for (const t of v) all.push([t, k]);
    all.sort((a, b) => a[0] - b[0]);
    const limit = Math.max(20, Math.ceil(events.size * 0.6));
    const drop = new Map(); // key -> Set(t)
    let s = 0;
    while (s < all.length) {
      let e = s;
      while (e + 1 < all.length && all[e + 1][0] - all[e][0] <= W) e++;
      const uniq = new Set();
      for (let i = s; i <= e; i++) uniq.add(all[i][1]);
      if (uniq.size >= limit) {
        nvrWide++;
        for (let i = s; i <= e; i++) {
          if (!drop.has(all[i][1])) drop.set(all[i][1], new Set());
          drop.get(all[i][1]).add(all[i][0]);
        }
      }
      s = e + 1;
    }
    for (const [k, ts] of drop) events.set(k, events.get(k).filter((t) => !ts.has(t)));
    for (const [k, v] of events) if (!v.length) events.delete(k);
  }

  const keys = [...events.keys()];
  const n = keys.length;
  const span = Math.max(maxT - minT, 86400e3);

  // A'ning nechta uzilishiga B ham ±W ichida uzilgan.
  const co = (A, B) => {
    let c = 0;
    let j = 0;
    for (const t of A) {
      while (j < B.length && B[j] < t - W) j++;
      if (j < B.length && B[j] <= t + W) c++;
    }
    return c;
  };

  // O'xshashlik matritsasi (faqat tasodifdan ancha yuqori juftliklar).
  const sim = Array.from({ length: n }, () => new Float64Array(n));
  const coCount = Array.from({ length: n }, () => new Uint32Array(n));
  for (let a = 0; a < n; a++) {
    const A = events.get(keys[a]);
    for (let b = a + 1; b < n; b++) {
      const B = events.get(keys[b]);
      const c = Math.min(co(A, B), co(B, A));
      if (c < 2) continue;
      const expected = (A.length * B.length * 2 * W) / span;
      if (c < 3 * expected + 2) continue;
      sim[a][b] = sim[b][a] = c / Math.min(A.length, B.length);
      coCount[a][b] = coCount[b][a] = c;
    }
  }

  // O'rtacha bog'lanishli (average linkage) ierarxik klasterlash.
  let clusters = keys.map((_, i) => ({ m: [i], groups: null }));
  let L = sim.map((row) => Array.from(row)); // klasterlar orasidagi o'rtacha o'xshashlik
  const merge = (th, onMerge) => {
    for (;;) {
      let best = -1;
      let bi = -1;
      let bj = -1;
      for (let i = 0; i < clusters.length; i++)
        for (let j = i + 1; j < clusters.length; j++)
          if (L[i][j] > best) {
            best = L[i][j];
            bi = i;
            bj = j;
          }
      if (best < th) break;
      const ci = clusters[bi];
      const cj = clusters[bj];
      const ni = ci.m.length;
      const nj = cj.m.length;
      for (let k = 0; k < clusters.length; k++) {
        if (k === bi || k === bj) continue;
        L[bi][k] = L[k][bi] = (L[bi][k] * ni + L[bj][k] * nj) / (ni + nj);
      }
      onMerge?.(ci, cj);
      ci.m = ci.m.concat(cj.m);
      clusters.splice(bj, 1);
      L.splice(bj, 1);
      for (const row of L) row.splice(bj, 1);
    }
  };

  const avgSim = (m) => {
    let s = 0;
    let p = 0;
    for (let i = 0; i < m.length; i++)
      for (let j = i + 1; j < m.length; j++) {
        s += sim[m[i]][m[j]];
        p++;
      }
    return p ? s / p : 0;
  };
  // Guruhning kamida yarmi birga uzilgan holatlar soni.
  const jointOutages = (m) => {
    const all = [];
    m.forEach((i, gi) => {
      for (const t of events.get(keys[i])) all.push([t, gi]);
    });
    all.sort((a, b) => a[0] - b[0]);
    let count = 0;
    let s = 0;
    while (s < all.length) {
      let e = s;
      while (e + 1 < all.length && all[e + 1][0] - all[e][0] <= W) e++;
      const uniq = new Set();
      for (let k = s; k <= e; k++) uniq.add(all[k][1]);
      if (uniq.size >= Math.max(2, Math.ceil(m.length / 2))) count++;
      s = e + 1;
    }
    return count;
  };
  const member = (i) => ({ ...info.get(keys[i]), outages: events.get(keys[i]).length });
  const describe = (m) => ({
    confidence: Math.round(avgSim(m) * 100),
    outages: jointOutages(m),
    members: m.map(member).sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true })),
  });

  // 1-bosqich: switch guruhlari.
  merge(HI);
  for (const c of clusters) c.groups = c.m.length > 1 ? [c.m.slice()] : [];
  // 2-bosqich: guruhlar yuqori switch ostida birlashadi.
  merge(LO, (ci, cj) => {
    ci.groups = ci.groups.concat(cj.groups);
  });

  const supers = [];
  for (const c of clusters) {
    if (c.m.length < 2) continue;
    const inGroups = new Set(c.groups.flat());
    const loose = c.m.filter((i) => !inGroups.has(i));
    supers.push({
      ...describe(c.m),
      groups: c.groups.map(describe).sort((a, b) => b.members.length - a.members.length),
      loose: loose.map(member),
    });
  }
  supers.sort((a, b) => b.members.length - a.members.length);

  const grouped = new Set(clusters.filter((c) => c.m.length > 1).flatMap((c) => c.m));
  return {
    events: total,
    from: Number.isFinite(minT) ? fmt(minT) : null,
    to: Number.isFinite(maxT) ? fmt(maxT) : null,
    cameras: n,
    nvr_wide: nvrWide,
    supers,
    ungrouped: keys.map((_, i) => i).filter((i) => !grouped.has(i)).map(member),
  };
}
