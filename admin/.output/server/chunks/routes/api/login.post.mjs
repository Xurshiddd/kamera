import { c as defineEventHandler, r as readBody, u as useRuntimeConfig, e as createError, f as setCookie, h as createSession, S as SESSION_COOKIE, i as SESSION_MAX_AGE } from '../../_/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const login_post = defineEventHandler(async (event) => {
  const { password } = await readBody(event) || {};
  const cfg = useRuntimeConfig();
  if (!cfg.adminPassword) {
    throw createError({
      statusCode: 500,
      statusMessage: "Server tomonda NUXT_ADMIN_PASSWORD sozlanmagan"
    });
  }
  if (!password || password !== cfg.adminPassword) {
    throw createError({ statusCode: 401, statusMessage: "Noto'g'ri parol" });
  }
  setCookie(event, SESSION_COOKIE, createSession(), {
    httpOnly: true,
    // JS o'qiy olmaydi (XSS himoyasi)
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    // HTTPS ortida ishlatilganda true qiling (Cloudflare Tunnel bilan avtomatik):
    secure: true
  });
  return { ok: true };
});

export { login_post as default };
//# sourceMappingURL=login.post.mjs.map
