import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "../utils/session";

// Parolni tekshiramiz va to'g'ri bo'lsa imzolangan session cookie o'rnatamiz.
export default defineEventHandler(async (event) => {
  const { password } = (await readBody(event)) || {};
  const cfg = useRuntimeConfig();

  if (!cfg.adminPassword) {
    throw createError({
      statusCode: 500,
      statusMessage: "Server tomonda NUXT_ADMIN_PASSWORD sozlanmagan",
    });
  }
  if (!password || password !== cfg.adminPassword) {
    throw createError({ statusCode: 401, statusMessage: "Noto'g'ri parol" });
  }

  setCookie(event, SESSION_COOKIE, createSession(), {
    httpOnly: true, // JS o'qiy olmaydi (XSS himoyasi)
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    // HTTPS ortida ishlatilganda true qiling (Cloudflare Tunnel bilan avtomatik):
    secure: process.env.NODE_ENV === "production",
  });

  return { ok: true };
});
