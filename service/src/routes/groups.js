import { Router } from "express";
import db from "../db.js";
import { requirePerm } from "../auth.js";
import { audit } from "../rbac.js";

// Kamera guruhlari (masalan "Iqtisod fakulteti"). Foydalanuvchiga guruh
// biriktiriladi -> u faqat shu guruhdagi kameralarni ko'radi.
const router = Router();

function listGroups(where = "", ...args) {
  const groups = db.prepare(`SELECT id, name FROM camera_groups ${where} ORDER BY name`).all(...args);
  const cams = db.prepare("SELECT camera_id FROM camera_group_items WHERE group_id = ?");
  const users = db.prepare("SELECT COUNT(*) AS n FROM user_camera_groups WHERE group_id = ?");
  return groups.map((g) => ({
    ...g,
    camera_ids: cams.all(g.id).map((c) => c.camera_id),
    users: users.get(g.id).n,
  }));
}

function setCameras(groupId, cameraIds) {
  db.prepare("DELETE FROM camera_group_items WHERE group_id = ?").run(groupId);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO camera_group_items (group_id, camera_id) SELECT ?, id FROM cameras WHERE id = ?"
  );
  for (const c of cameraIds) ins.run(groupId, Number(c));
}

router.get("/", requirePerm("groups.manage", "users.manage"), (req, res) =>
  res.json(listGroups())
);

router.post("/", requirePerm("groups.manage"), (req, res) => {
  const { name, camera_ids = [] } = req.body || {};
  if (typeof name !== "string" || !name.trim() || name.length > 100) {
    return res.status(400).json({ error: "Guruh nomi kerak" });
  }
  if (db.prepare("SELECT 1 FROM camera_groups WHERE name = ?").get(name.trim())) {
    return res.status(409).json({ error: "Bu nomli guruh bor" });
  }
  let id;
  db.transaction(() => {
    id = db.prepare("INSERT INTO camera_groups (name) VALUES (?)").run(name.trim()).lastInsertRowid;
    setCameras(id, Array.isArray(camera_ids) ? camera_ids : []);
  })();
  audit(req, "group.create", { details: { id, name } });
  res.status(201).json(listGroups("WHERE id = ?", id)[0]);
});

router.put("/:id(\\d+)", requirePerm("groups.manage"), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM camera_groups WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  const { name, camera_ids } = req.body || {};
  try {
    db.transaction(() => {
      if (typeof name === "string" && name.trim()) {
        db.prepare("UPDATE camera_groups SET name = ? WHERE id = ?").run(name.trim(), id);
      }
      if (Array.isArray(camera_ids)) setCameras(id, camera_ids);
    })();
  } catch {
    return res.status(409).json({ error: "Bu nomli guruh bor" });
  }
  audit(req, "group.update", { details: { id, name, camera_ids } });
  res.json(listGroups("WHERE id = ?", id)[0]);
});

router.delete("/:id(\\d+)", requirePerm("groups.manage"), (req, res) => {
  const row = db.prepare("SELECT * FROM camera_groups WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Topilmadi" });
  db.prepare("DELETE FROM camera_groups WHERE id = ?").run(row.id);
  audit(req, "group.delete", { details: { id: row.id, name: row.name } });
  res.json({ ok: true });
});

export default router;
