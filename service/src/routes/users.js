import { Router } from "express";
import db from "../db.js";
import { requirePerm, revokeTokens } from "../auth.js";
import { hashPassword, audit, SUPERADMIN } from "../rbac.js";

const router = Router();
router.use(requirePerm("users.manage"));

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

function listUsers(where = "", ...args) {
  const users = db
    .prepare(
      `SELECT id, username, full_name, active, created_at, last_login_at
       FROM users ${where} ORDER BY username`
    )
    .all(...args);
  const roles = db.prepare("SELECT role_id FROM user_roles WHERE user_id = ?");
  const groups = db.prepare("SELECT group_id FROM user_camera_groups WHERE user_id = ?");
  return users.map((u) => ({
    ...u,
    active: Boolean(u.active),
    role_ids: roles.all(u.id).map((r) => r.role_id),
    group_ids: groups.all(u.id).map((g) => g.group_id),
  }));
}

function isSuperadmin(userId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = ? AND r.name = ?`
      )
      .get(userId, SUPERADMIN)
  );
}

// Faol superadminlar soni — oxirgisini o'chirib/bloklab qo'yishning oldini olamiz.
function activeSuperadmins() {
  return db
    .prepare(
      `SELECT COUNT(DISTINCT u.id) AS n FROM users u
       JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE r.name = ? AND u.active = 1`
    )
    .get(SUPERADMIN).n;
}

// Superadmin rolini faqat superadmin bera oladi/oladi.
function touchesSuperadmin(roleIds) {
  const sa = db.prepare("SELECT id FROM roles WHERE name = ?").get(SUPERADMIN);
  return roleIds.includes(sa.id);
}

function setLinks(userId, roleIds, groupIds) {
  if (Array.isArray(roleIds)) {
    db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(userId);
    const ins = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)");
    for (const r of roleIds) ins.run(userId, Number(r));
  }
  if (Array.isArray(groupIds)) {
    db.prepare("DELETE FROM user_camera_groups WHERE user_id = ?").run(userId);
    const ins = db.prepare(
      "INSERT OR IGNORE INTO user_camera_groups (user_id, group_id) VALUES (?, ?)"
    );
    for (const g of groupIds) ins.run(userId, Number(g));
  }
}

const ids = (v) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : undefined);

// Huquqni oshirishdan himoya: superadmin bo'lmagan xodim faqat O'ZIDA BOR
// ruxsatlardan iborat rollarni bera oladi (aks holda users.manage'li xodim
// o'ziga yoki sherigiga kattaroq rol berib qo'yishi mumkin edi).
const isSaCaller = (req) => req.user.id === null || req.user.roles.includes(SUPERADMIN);
function rolesBeyondCaller(req, roleIds) {
  if (isSaCaller(req) || !roleIds?.length) return false;
  const q = db.prepare("SELECT perm_code FROM role_permissions WHERE role_id = ?");
  return roleIds.some((r) => q.all(r).some((p) => !req.user.perms.has(p.perm_code)));
}

router.get("/", (req, res) => res.json(listUsers()));

router.post("/", (req, res) => {
  const { username, password, full_name = null } = req.body || {};
  const roleIds = ids(req.body?.role_ids) || [];
  const groupIds = ids(req.body?.group_ids) || [];
  if (!USERNAME_RE.test(username || "")) {
    return res.status(400).json({ error: "Login 3-32 belgi: harf, raqam, . _ -" });
  }
  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "Parol kamida 8 belgi" });
  }
  if (touchesSuperadmin(roleIds) && !isSaCaller(req)) {
    return res.status(403).json({ error: "Superadmin rolini faqat superadmin beradi" });
  }
  if (rolesBeyondCaller(req, roleIds)) {
    return res.status(403).json({ error: "Oʻzingizda yoʻq huquqli rolni bera olmaysiz" });
  }
  if (db.prepare("SELECT 1 FROM users WHERE username = ?").get(username)) {
    return res.status(409).json({ error: "Bu login band" });
  }
  let id;
  try {
    db.transaction(() => {
      id = db
        .prepare("INSERT INTO users (username, password_hash, full_name) VALUES (?, ?, ?)")
        .run(username, hashPassword(password), full_name).lastInsertRowid;
      setLinks(id, roleIds, groupIds);
    })();
  } catch (e) {
    return res.status(400).json({ error: "Noto'g'ri rol yoki guruh" });
  }
  audit(req, "user.create", { details: { id, username } });
  res.status(201).json(listUsers("WHERE id = ?", id)[0]);
});

router.put("/:id(\\d+)", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });

  const body = req.body || {};
  const roleIds = ids(body.role_ids);
  const groupIds = ids(body.group_ids);
  const callerIsSa = isSaCaller(req);
  const targetIsSa = isSuperadmin(id);

  if (!callerIsSa && (targetIsSa || (roleIds && touchesSuperadmin(roleIds)))) {
    return res.status(403).json({ error: "Superadminni faqat superadmin o'zgartiradi" });
  }
  if (!callerIsSa && roleIds && id === req.user.id) {
    return res.status(403).json({ error: "Oʻz rollaringizni oʻzgartira olmaysiz" });
  }
  if (rolesBeyondCaller(req, roleIds)) {
    return res.status(403).json({ error: "Oʻzingizda yoʻq huquqli rolni bera olmaysiz" });
  }
  if (body.password !== undefined && body.password !== "" &&
      (typeof body.password !== "string" || body.password.length < 8)) {
    return res.status(400).json({ error: "Parol kamida 8 belgi" });
  }

  const active = "active" in body ? (body.active ? 1 : 0) : row.active;
  try {
    db.transaction(() => {
      db.prepare("UPDATE users SET full_name = ?, active = ? WHERE id = ?").run(
        "full_name" in body ? body.full_name : row.full_name,
        active,
        id
      );
      if (body.password) {
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
          hashPassword(body.password),
          id
        );
        // Admin parolni tiklasa — xodimning barcha ochiq sessiyalari yopiladi.
        revokeTokens(id);
      }
      setLinks(id, roleIds, groupIds);
      if (activeSuperadmins() === 0) throw new Error("LAST_SA");
    })();
  } catch (e) {
    if (e.message === "LAST_SA") {
      return res.status(400).json({ error: "Oxirgi faol superadminni olib bo'lmaydi" });
    }
    return res.status(400).json({ error: "Noto'g'ri rol yoki guruh" });
  }
  audit(req, "user.update", {
    details: { id, username: row.username, password: Boolean(body.password), active },
  });
  res.json(listUsers("WHERE id = ?", id)[0]);
});

router.delete("/:id(\\d+)", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT username FROM users WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  if (id === req.user.id) return res.status(400).json({ error: "O'zingizni o'chira olmaysiz" });
  const callerIsSa = req.user.id === null || req.user.roles.includes(SUPERADMIN);
  if (isSuperadmin(id) && !callerIsSa) {
    return res.status(403).json({ error: "Superadminni faqat superadmin o'chiradi" });
  }
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM users WHERE id = ?").run(id);
      if (activeSuperadmins() === 0) throw new Error("LAST_SA");
    })();
  } catch {
    return res.status(400).json({ error: "Oxirgi faol superadminni o'chirib bo'lmaydi" });
  }
  audit(req, "user.delete", { details: { id, username: row.username } });
  res.json({ ok: true });
});

export default router;
