import { Router } from "express";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit, SUPERADMIN } from "../rbac.js";

const router = Router();

// Ruxsatlar katalogi (rol tahrirlash formasi uchun).
router.get("/permissions", requirePerm("roles.manage", "users.manage"), (req, res) => {
  res.json(db.prepare("SELECT code, description FROM permissions ORDER BY code").all());
});

function listRoles(where = "", ...args) {
  const roles = db
    .prepare(`SELECT id, name, description, system FROM roles ${where} ORDER BY id`)
    .all(...args);
  const perms = db.prepare("SELECT perm_code FROM role_permissions WHERE role_id = ?");
  const users = db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role_id = ?");
  return roles.map((r) => ({
    ...r,
    system: Boolean(r.system),
    permissions: perms.all(r.id).map((p) => p.perm_code),
    users: users.get(r.id).n,
  }));
}

// Rollar ro'yxati users.manage uchun ham kerak (foydalanuvchiga rol berish).
router.get("/roles", requirePerm("roles.manage", "users.manage"), (req, res) =>
  res.json(listRoles())
);

function setPerms(roleId, perms) {
  db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(roleId);
  const valid = new Set(db.prepare("SELECT code FROM permissions").all().map((p) => p.code));
  const ins = db.prepare("INSERT INTO role_permissions (role_id, perm_code) VALUES (?, ?)");
  for (const p of new Set(perms)) if (valid.has(p)) ins.run(roleId, p);
}

router.post("/roles", requirePerm("roles.manage"), (req, res) => {
  const { name, description = null, permissions = [] } = req.body || {};
  if (typeof name !== "string" || !name.trim() || name.length > 64) {
    return res.status(400).json({ error: "Rol nomi kerak" });
  }
  if (db.prepare("SELECT 1 FROM roles WHERE name = ?").get(name.trim())) {
    return res.status(409).json({ error: "Bu nomli rol bor" });
  }
  let id;
  db.transaction(() => {
    id = db
      .prepare("INSERT INTO roles (name, description) VALUES (?, ?)")
      .run(name.trim(), description).lastInsertRowid;
    setPerms(id, Array.isArray(permissions) ? permissions : []);
  })();
  audit(req, "role.create", { details: { id, name } });
  res.status(201).json(listRoles("WHERE id = ?", id)[0]);
});

router.put("/roles/:id(\\d+)", requirePerm("roles.manage"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM roles WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  if (row.name === SUPERADMIN) {
    return res.status(400).json({ error: "superadmin roli o'zgartirilmaydi" });
  }
  const { name, description, permissions } = req.body || {};
  const newName = row.system ? row.name : (name || row.name).trim(); // tizim rolini qayta nomlash yo'q
  db.transaction(() => {
    db.prepare("UPDATE roles SET name = ?, description = ? WHERE id = ?").run(
      newName,
      description === undefined ? row.description : description,
      id
    );
    if (Array.isArray(permissions)) setPerms(id, permissions);
  })();
  audit(req, "role.update", { details: { id, name: newName, permissions } });
  res.json(listRoles("WHERE id = ?", id)[0]);
});

router.delete("/roles/:id(\\d+)", requirePerm("roles.manage"), (req, res) => {
  const row = db.prepare("SELECT * FROM roles WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  if (row.system) return res.status(400).json({ error: "Tizim rolini o'chirib bo'lmaydi" });
  db.prepare("DELETE FROM roles WHERE id = ?").run(row.id);
  audit(req, "role.delete", { details: { id: row.id, name: row.name } });
  res.json({ ok: true });
});

export default router;
