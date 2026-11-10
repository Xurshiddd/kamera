// =============================================================================
//  Rollar va ruxsatlar (RBAC).
//
//  Yangi funksiya qo'shilganda: PERMISSIONS ro'yxatiga yangi kod qo'shing va
//  route'da requirePerm("kod") ishlating. Service ishga tushganda kod DB'ga
//  avtomatik yoziladi va admin panelda rolga biriktirish uchun chiqadi.
// =============================================================================

import bcrypt from "bcryptjs";
import db from "./db.js";

export const PERMISSIONS = {
  "live.view": "Jonli efirni ko'rish",
  "playback.view": "Yozuvlarni qayta ko'rish",
  "playback.export": "Yozuvdan klip yuklab olish",
  "cameras.all": "Barcha kameralarga kirish (guruhdan qat'i nazar)",
  "cameras.manage": "Kameralarni qo'shish/tahrirlash/o'chirish",
  "nvr.manage": "NVR qurilmalarini boshqarish",
  "discovery.manage": "Tarmoqni skanerlash va topilgan kameralarga ulanish",
  "netconfig.manage": "Kameralar IP manzili va parolini ommaviy oʻzgartirish (alohida parol bilan)",
  "status.view": "Server holatini ko'rish",
  "users.manage": "Foydalanuvchilarni boshqarish",
  "roles.manage": "Rollar va ruxsatlarni boshqarish",
  "groups.manage": "Kamera guruhlarini boshqarish",
  "audit.view": "Audit jurnalini ko'rish",
};

// Tizim rollari: birinchi ishga tushishda yaratiladi (keyin admin panelda
// o'zgartirish mumkin; superadmin har doim hamma ruxsatga ega bo'ladi).
const DEFAULT_ROLES = {
  superadmin: {
    description: "To'liq boshqaruv",
    perms: Object.keys(PERMISSIONS),
  },
  dekanat: {
    description: "Dekanat xodimi: jonli va yozuvlar (o'z kameralari)",
    perms: ["live.view", "playback.view", "playback.export"],
  },
};

export const SUPERADMIN = "superadmin";

export function seedRbac() {
  const insPerm = db.prepare(
    `INSERT INTO permissions (code, description) VALUES (?, ?)
     ON CONFLICT(code) DO UPDATE SET description = excluded.description`
  );
  // Koddan olib tashlangan ruxsatlar DB'dan ham o'chadi.
  const codes = Object.keys(PERMISSIONS);
  db.transaction(() => {
    for (const [code, desc] of Object.entries(PERMISSIONS)) insPerm.run(code, desc);
    db.prepare(
      `DELETE FROM permissions WHERE code NOT IN (${codes.map(() => "?").join(",")})`
    ).run(...codes);

    for (const [name, r] of Object.entries(DEFAULT_ROLES)) {
      const exists = db.prepare("SELECT id FROM roles WHERE name = ?").get(name);
      if (exists) continue;
      const { lastInsertRowid: roleId } = db
        .prepare("INSERT INTO roles (name, description, system) VALUES (?, ?, 1)")
        .run(name, r.description);
      const ins = db.prepare(
        "INSERT INTO role_permissions (role_id, perm_code) VALUES (?, ?)"
      );
      for (const p of r.perms) ins.run(roleId, p);
    }
  })();

  // Birinchi superadmin foydalanuvchi — .env dagi ADMIN_USERNAME/ADMIN_PASSWORD.
  const hasUsers = db.prepare("SELECT 1 FROM users LIMIT 1").get();
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!hasUsers && password) {
    const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(SUPERADMIN);
    const { lastInsertRowid: userId } = db
      .prepare(
        "INSERT INTO users (username, password_hash, full_name) VALUES (?, ?, ?)"
      )
      .run(username, bcrypt.hashSync(password, 10), "Administrator");
    db.prepare("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)").run(
      userId,
      role.id
    );
    console.log(`[rbac] boshlang'ich superadmin yaratildi: ${username}`);
  }
}

// Foydalanuvchining rollari va ruxsatlari (har so'rovda chaqiriladi —
// o'zgarishlar darhol kuchga kiradi).
export function loadUser(userId) {
  const user = db
    .prepare(
      "SELECT id, username, full_name, active FROM users WHERE id = ?"
    )
    .get(userId);
  if (!user || !user.active) return null;

  const roles = db
    .prepare(
      `SELECT r.name FROM roles r JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .all(userId)
    .map((r) => r.name);

  let perms;
  if (roles.includes(SUPERADMIN)) {
    perms = Object.keys(PERMISSIONS);
  } else {
    perms = db
      .prepare(
        `SELECT DISTINCT rp.perm_code AS code FROM role_permissions rp
         JOIN user_roles ur ON ur.role_id = rp.role_id WHERE ur.user_id = ?`
      )
      .all(userId)
      .map((r) => r.code);
  }
  return { ...user, roles, perms: new Set(perms) };
}

// Foydalanuvchi ko'ra oladigan kamera id'lari. null = cheklovsiz (hammasi).
export function allowedCameraIds(user) {
  if (!user || user.perms.has("cameras.all")) return null;
  return new Set(
    db
      .prepare(
        `SELECT DISTINCT gi.camera_id AS id FROM camera_group_items gi
         JOIN user_camera_groups ug ON ug.group_id = gi.group_id
         WHERE ug.user_id = ?`
      )
      .all(user.id)
      .map((r) => r.id)
  );
}

export function canAccessCamera(user, cameraId) {
  const ids = allowedCameraIds(user);
  return ids === null || ids.has(Number(cameraId));
}

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

// Foydalanuvchi bo'lmasa ham taxminan bir xil vaqt sarflash uchun soxta hash
// (username mavjudligini javob vaqtidan bilib bo'lmasin).
const DUMMY_HASH = bcrypt.hashSync("dummy-password-x", 10);

export function verifyPassword(pw, hash) {
  if (typeof pw !== "string") return false;
  return bcrypt.compareSync(pw, hash || DUMMY_HASH) && Boolean(hash);
}

export function audit(req, action, { cameraId = null, details = null } = {}) {
  try {
    db.prepare(
      `INSERT INTO audit_log (user_id, username, action, camera_id, details, ip)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      req.user?.id ?? null,
      req.user?.username ?? null,
      action,
      cameraId,
      details ? JSON.stringify(details) : null,
      req.clientIp || null
    );
  } catch (e) {
    console.error("[audit]", e.message);
  }
}
