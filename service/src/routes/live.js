import { Router } from "express";
import db from "../db.js";
import { resolveUser } from "../auth.js";
import { canAccessCamera } from "../rbac.js";
import { watch } from "../live.js";

const router = Router();

// Pleyer kamerani ko'rayotganda har ~20s chaqiradi (heartbeat). NVR kamerasi
// bo'lsa oqim yoqiladi/yoqiq turadi; NVR'siz kamera uchun hech narsa qilmaydi.
//   - ochiq (is_public) kamera: login shart emas (mehmon sahifasi)
//   - yopiq kamera: live.view + kameraga ruxsat (guruh) kerak
router.post("/live/:id(\\d+)/watch", async (req, res) => {
  const camera = db.prepare("SELECT * FROM cameras WHERE id = ?").get(req.params.id);
  if (!camera) return res.status(404).json({ error: "Topilmadi" });

  if (!camera.is_public) {
    const user = resolveUser(req);
    if (!user) return res.status(401).json({ error: "Avtorizatsiya kerak" });
    const allowed =
      user.perms.has("cameras.manage") ||
      (user.perms.has("live.view") && canAccessCamera(user, camera.id));
    if (!allowed) return res.status(403).json({ error: "Ruxsat yo'q" });
  }

  try {
    const r = await watch(camera);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

export default router;
