// =============================================================================
//  Kameraning o'zida (to'g'ridan, ISAPI) tarmoq va parol sozlamalari.
//  Faqat Hikvision (ISAPI) kameralari. Har bir amal kameraning joriy XML'ini
//  olib, faqat kerakli maydonlarni almashtiradi — qolgan sozlamalar o'zgarmaydi.
// =============================================================================

import { isapi, tag, blocks, escXml, deviceInfo } from "./hikvision.js";
import { tcpOpen, isIp, ipToInt } from "./scanner.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const cam = (ip, login, parol) => ({ ip, http_port: 80, login, parol });

// --- Tekshiruvlar ---

export function maskToBits(mask) {
  if (!isIp(mask)) return null;
  const n = ipToInt(mask);
  const bits = n.toString(2).padStart(32, "0");
  if (!/^1+0*$/.test(bits)) return null;
  return bits.indexOf("0") === -1 ? 32 : bits.indexOf("0");
}
export const sameSubnet = (a, b, mask) => {
  const m = ipToInt(mask);
  // JS bit amallari 32-bit ishorali — >>> 0 bilan ishorasiz qilamiz.
  return ((ipToInt(a) & m) >>> 0) === ((ipToInt(b) & m) >>> 0);
};

// Hikvision parol talabi: 8–16 belgi, kamida 2 xil tur (raqam, kichik, katta, belgi).
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8 || pw.length > 16) return "Parol 8–16 belgi boʻlsin";
  if (/[^\x21-\x7e]/.test(pw)) return "Parolda faqat lotin harflari, raqamlar va belgilar boʻlsin (boʻshliqsiz)";
  const kinds = [/[0-9]/, /[a-z]/, /[A-Z]/, /[^0-9a-zA-Z]/].filter((r) => r.test(pw)).length;
  if (kinds < 2) return "Parolda kamida 2 xil belgi turi boʻlsin (masalan harf + raqam)";
  return null;
}

// Manzil band emasmi (biror qurilma kameraga xos portda javob bersa — band).
export async function ipInUse(ip) {
  const r = await Promise.all([80, 554, 8000, 443].map((p) => tcpOpen(ip, p, 1200)));
  return r.some(Boolean);
}

// --- So'rov va ishlab chiqaruvchi ---
// Hikvision — ISAPI (XML), Dahua — CGI (key=value). Ikkalasi ham HTTP Digest.
const clean = (e) => {
  const err = new Error(String(e.message || e).replace(/^NVR /, "").replace("NVR login", "Login"));
  err.status = e.status;
  err.sub = e.sub;
  return err;
};
const req = (c, path, opts) => isapi(c, path, opts).catch((e) => {
  throw clean(e);
});

// Dahua javobi: "table.Network.eth0.IPAddress=1.2.3.4" qatorlari -> { kalit: qiymat }
const kv = (txt) =>
  Object.fromEntries(
    String(txt)
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([^=]+?)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1].replace(/^table\./, ""), m[2].trim()])
  );

async function dahuaInfo(c) {
  const x = kv(await req(c, "/cgi-bin/magicBox.cgi?action=getSystemInfo", { timeout: 8000 }));
  return { model: x.deviceType || x.updateSerial || null, serial: x.serialNumber || null, name: null, type: x.deviceType || null };
}

// Qurilma haqida (ishlab chiqaruvchi aniqlangan bo'lsa — faqat o'shani so'raydi).
export async function probeInfo(c, vendor) {
  if (vendor === "dahua") return { vendor, info: await dahuaInfo(c) };
  try {
    return { vendor: "hikvision", info: await deviceInfo(c) };
  } catch (e) {
    // ISAPI yo'q (404) — Dahua bo'lishi mumkin.
    if (vendor || e.status !== 404) throw clean(e);
  }
  try {
    return { vendor: "dahua", info: await dahuaInfo(c) };
  } catch (e) {
    if (e.status === 401) throw e;
    const err = new Error("Qurilma turi qoʻllanmaydi (faqat Hikvision va Dahua)");
    err.status = e.status || 404;
    err.unsupported = true;
    throw err;
  }
}

// --- Ulanish (bir nechta parol sinab ko'riladi) ---
// Qaytaradi: { creds, info, vendor } yoki xato (.reason = "auth" | "down" | "isapi").
// DIQQAT: har noto'g'ri urinish kamerada hisoblanadi (5–7 tadan keyin bloklaydi),
// shuning uchun ro'yxat qisqa bo'lsin.
export async function login(ip, candidates) {
  let lastErr = null;
  let vendor = null;
  const tried = new Set();
  for (const cand of candidates) {
    if (!cand?.login || !cand?.parol) continue;
    const k = `${cand.login}\u0000${cand.parol}`;
    if (tried.has(k)) continue;
    tried.add(k);
    const creds = cam(ip, cand.login, cand.parol);
    try {
      const r = await probeInfo(creds, vendor);
      return { creds, info: r.info, vendor: r.vendor };
    } catch (e) {
      if (e.status !== 401) {
        const err = new Error(e.unsupported ? e.message : e.status ? `Qurilma javobi: ${e.message}` : "Kameraga ulanib boʻlmadi");
        err.reason = e.status ? "isapi" : "down";
        throw err;
      }
      lastErr = e;
    }
  }
  const err = new Error(
    lastErr ? "Kamera login/paroli notoʻgʻri (bir necha xato urinishdan keyin kamera vaqtincha bloklanadi)" : "Login/parol berilmagan"
  );
  err.reason = "auth";
  throw err;
}

// --- Tarmoq sozlamasi ---
async function ifaceId(c) {
  const x = await req(c, "/ISAPI/System/Network/interfaces", { timeout: 8000 });
  const ids = blocks(x, "NetworkInterface").map((b) => tag(b, "id")).filter(Boolean);
  return ids[0] || "1";
}

export async function getNetwork(c, vendor = "hikvision") {
  if (vendor === "dahua") return dahuaGetNetwork(c);
  const id = await ifaceId(c);
  const xml = await req(c, `/ISAPI/System/Network/interfaces/${id}/ipAddress`, { timeout: 8000 });
  const gw = xml.match(/<DefaultGateway>[\s\S]*?<\/DefaultGateway>/)?.[0] || "";
  const dns = xml.match(/<PrimaryDNS>[\s\S]*?<\/PrimaryDNS>/)?.[0] || "";
  return {
    id,
    xml,
    dhcp: tag(xml, "addressingType") === "dynamic",
    ip: tag(xml, "ipAddress"),
    mask: tag(xml, "subnetMask"),
    gateway: tag(gw, "ipAddress"),
    dns: tag(dns, "ipAddress"),
  };
}

// IP'ni o'zgartirish. Kamera yangi manzilga darhol o'tadi (javob kelmasligi
// ham mumkin) yoki "qayta ishga tushirish kerak" deydi — u holda reboot.
// Qaytaradi: { rebooted }
export async function setNetwork(c, net, vals) {
  if (net.vendor === "dahua") return dahuaSetNetwork(c, net, vals);
  const { ip, mask, gateway, dns } = vals;
  let x = net.xml;
  const put = (re, v) => {
    if (!re.test(x)) throw new Error("Kamera tarmoq sozlamasi kutilgan koʻrinishda emas");
    x = x.replace(re, v);
  };
  put(/<addressingType>[^<]*<\/addressingType>/, "<addressingType>static</addressingType>");
  // Birinchi <ipAddress> — kameraning o'z manzili (shlyuz/DNS keyin keladi).
  put(/<ipAddress>[^<]*<\/ipAddress>/, `<ipAddress>${escXml(ip)}</ipAddress>`);
  put(/<subnetMask>[^<]*<\/subnetMask>/, `<subnetMask>${escXml(mask)}</subnetMask>`);
  if (gateway) {
    if (/<DefaultGateway>[\s\S]*?<\/DefaultGateway>/.test(x)) {
      x = x.replace(/<DefaultGateway>[\s\S]*?<\/DefaultGateway>/, (b) =>
        /<ipAddress>/.test(b)
          ? b.replace(/<ipAddress>[^<]*<\/ipAddress>/, `<ipAddress>${escXml(gateway)}</ipAddress>`)
          : b.replace("</DefaultGateway>", `<ipAddress>${escXml(gateway)}</ipAddress></DefaultGateway>`)
      );
    } else {
      x = x.replace("</subnetMask>", `</subnetMask><DefaultGateway><ipAddress>${escXml(gateway)}</ipAddress></DefaultGateway>`);
    }
  }
  if (dns && /<PrimaryDNS>[\s\S]*?<\/PrimaryDNS>/.test(x)) {
    x = x.replace(/<PrimaryDNS>[\s\S]*?<\/PrimaryDNS>/, (b) =>
      b.replace(/<ipAddress>[^<]*<\/ipAddress>/, `<ipAddress>${escXml(dns)}</ipAddress>`)
    );
  }

  let r;
  try {
    r = await req(c, `/ISAPI/System/Network/interfaces/${net.id}/ipAddress`, { method: "PUT", body: x, timeout: 12000 });
  } catch (e) {
    // Javob kelmay uzildi — odatda kamera allaqachon yangi IP'ga o'tgan.
    if (!e.status) return { rebooted: false, noReply: true };
    throw new Error(`Kamera IP'ni qabul qilmadi: ${e.message}`);
  }
  const code = tag(r, "statusCode");
  const sub = tag(r, "subStatusCode") || "";
  if (code === "7" || /reboot/i.test(sub)) {
    await req(c, "/ISAPI/System/reboot", { method: "PUT", timeout: 10000 }).catch(() => {});
    return { rebooted: true };
  }
  const status = tag(r, "statusString");
  if (status && status !== "OK") throw new Error(`Kamera: ${status} ${sub}`.trim());
  return { rebooted: false };
}

// Yangi manzilda shu kamera (seriya raqami bo'yicha) paydo bo'lishini kutish.
export async function waitFor(ip, creds, serial, { timeoutMs = 150000, onTick, vendor } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const { info } = await probeInfo({ ...creds, ip }, vendor);
      if (!serial || !info.serial || info.serial === serial) return info;
      const err = new Error(`Yangi manzilda boshqa qurilma javob beryapti (${info.model || "?"}, ${info.serial})`);
      err.fatal = true;
      throw err;
    } catch (e) {
      if (e.fatal) throw e;
    }
    onTick?.(Math.ceil((until - Date.now()) / 1000));
    await sleep(5000);
  }
  return null;
}

// --- Parol ---
// Kamera foydalanuvchisi (odatda admin, id=1) parolini almashtirish. Yangi
// proshivkalar eski parolni ham <loginPassword> da so'raydi; eskilari bu
// maydonni tanimasa — usiz qayta yuboramiz.
export async function setPassword(c, newPassword, vendor = "hikvision") {
  if (vendor === "dahua") return dahuaSetPassword(c, newPassword);
  const list = await req(c, "/ISAPI/Security/users", { timeout: 8000 });
  const user = blocks(list, "User").find((b) => tag(b, "userName") === c.login);
  if (!user) throw new Error(`Kamerada «${c.login}» foydalanuvchisi topilmadi`);
  const id = tag(user, "id");
  const base = `<?xml version="1.0" encoding="UTF-8"?><User version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">` +
    `<id>${escXml(id)}</id><userName>${escXml(c.login)}</userName><password>${escXml(newPassword)}</password>`;
  const send = (extra) =>
    req(c, `/ISAPI/Security/users/${id}`, { method: "PUT", body: `${base}${extra}</User>`, timeout: 12000 });
  let r;
  try {
    r = await send(`<loginPassword>${escXml(c.parol)}</loginPassword>`);
  } catch (e) {
    if (e.status !== 400) throw new Error(`Kamera parolni qabul qilmadi: ${e.message}`);
    try {
      r = await send("");
    } catch (e2) {
      throw new Error(`Kamera parolni qabul qilmadi: ${e2.message}${/weak|risk/i.test(e2.sub || "") ? " (parol juda oddiy)" : ""}`);
    }
  }
  const status = tag(r, "statusString");
  if (status && status !== "OK") throw new Error(`Kamera: ${status} ${tag(r, "subStatusCode") || ""}`.trim());
}

// =============================================================================
//  Dahua (CGI). Tarmoq: configManager "Network.<eth>.*"; parol: userManager.
// =============================================================================
async function dahuaGetNetwork(c) {
  const x = kv(await req(c, "/cgi-bin/configManager.cgi?action=getConfig&name=Network", { timeout: 8000 }));
  const eth = x["Network.DefaultInterface"] || "eth0";
  const g = (k) => x[`Network.${eth}.${k}`] || null;
  return {
    vendor: "dahua",
    id: eth,
    dhcp: g("DhcpEnable") === "true",
    ip: g("IPAddress"),
    mask: g("SubnetMask"),
    gateway: g("DefaultGateway"),
    dns: g("DnsServers[0]"),
  };
}

async function dahuaSetNetwork(c, net, { ip, mask, gateway, dns }) {
  const p = `Network.${net.id}`;
  const q = [
    `${p}.DhcpEnable=false`,
    `${p}.IPAddress=${encodeURIComponent(ip)}`,
    `${p}.SubnetMask=${encodeURIComponent(mask)}`,
    gateway ? `${p}.DefaultGateway=${encodeURIComponent(gateway)}` : null,
    dns ? `${p}.DnsServers[0]=${encodeURIComponent(dns)}` : null,
  ].filter(Boolean);
  let r;
  try {
    r = await req(c, `/cgi-bin/configManager.cgi?action=setConfig&${q.join("&")}`, { timeout: 12000 });
  } catch (e) {
    if (!e.status) return { rebooted: false, noReply: true };
    throw new Error(`Qurilma IP'ni qabul qilmadi: ${e.message}`);
  }
  if (!/^\s*OK/i.test(r)) throw new Error(`Qurilma IP'ni qabul qilmadi: ${String(r).trim().slice(0, 120)}`);
  return { rebooted: false };
}

async function dahuaSetPassword(c, newPassword) {
  const q = `action=modifyPassword&name=${encodeURIComponent(c.login)}&pwd=${encodeURIComponent(newPassword)}&pwdOld=${encodeURIComponent(c.parol)}`;
  let r;
  try {
    r = await req(c, `/cgi-bin/userManager.cgi?${q}`, { timeout: 12000 });
  } catch (e) {
    throw new Error(`Qurilma parolni qabul qilmadi: ${e.message}`);
  }
  if (!/^\s*OK/i.test(r)) throw new Error(`Qurilma parolni qabul qilmadi: ${String(r).trim().slice(0, 120)}`);
}
