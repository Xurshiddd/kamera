// Oddiy, kutubxonasiz session — imzolangan cookie.
// Cookie ichida muddat (exp) va uning HMAC imzosi turadi.
// Imzo serverdagi maxfiy kalit (sessionSecret) bilan tekshiriladi,
// shuning uchun foydalanuvchi cookie'ni o'zgartira olmaydi.
import crypto from "node:crypto";

export const SESSION_COOKIE = "admin_session";
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 kun

function secret() {
  const cfg = useRuntimeConfig();
  // Ishlab chiqarishda NUXT_SESSION_SECRET majburiy.
  return cfg.sessionSecret || "dev-xavfsiz-emas-almashtiring";
}

function sign(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}

// Yangi session qiymati: "exp.imzo"
export function createSession(): string {
  const exp = String(Date.now() + TTL_SECONDS * 1000);
  return `${exp}.${sign(exp)}`;
}

// Cookie qiymatini tekshiramiz: imzo to'g'rimi + muddati o'tmaganmi.
export function verifySession(token?: string): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  // Vaqtga bog'liq bo'lmagan (constant-time) solishtirish.
  const expected = sign(exp);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return false;
  }
  return Number(exp) > Date.now();
}

export const SESSION_MAX_AGE = TTL_SECONDS;
