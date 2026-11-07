// =============================================================================
//  Docker build vaqtida ishlaydi (`npm run generate` dan keyin).
//  Nuxt sahifalaridagi inline <script> (window.__NUXT__ config) har build'da
//  o'zgaradi — uning sha256 hash'ini hisoblab, CSP'ga qo'shamiz. Shunday qilib
//  'unsafe-inline' kerak emas: begona (inject qilingan) skript ishlamaydi.
//  Natija: nginx snippet (gateway.conf `include` qiladi).
// =============================================================================
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = ".output/public";
const out = process.argv[2] || "security-headers.conf";

const hashes = new Set();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) {
      const html = fs.readFileSync(p, "utf8");
      // src'siz va JSON bo'lmagan (ya'ni bajariladigan) inline skriptlar.
      for (const m of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) {
        hashes.add(`'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`);
      }
    }
  }
}
walk(root);
if (hashes.size > 5) throw new Error(`Inline skriptlar juda ko'p (${hashes.size}) — tekshiring`);

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(" ")}`.trim(),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

fs.writeFileSync(
  out,
  [
    "# Avtomatik yaratilgan (scripts/security-headers.mjs) — qo'lda o'zgartirmang.",
    `add_header Content-Security-Policy "${csp}" always;`,
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "SAMEORIGIN" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;',
    'add_header Cross-Origin-Opener-Policy "same-origin" always;',
    // HTTPS (Hestia) orqali kelganda brauzer keyingi safar faqat HTTPS ishlatadi.
    'add_header Strict-Transport-Security "max-age=15552000" always;',
    "",
  ].join("\n")
);
console.log(`[security-headers] ${hashes.size} ta inline skript hash'i -> ${out}`);
